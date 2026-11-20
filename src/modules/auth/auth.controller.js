import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { HTTP_STATUS } from '../../constants/index.js';
import { AUTH_MESSAGES, OTP_PURPOSE, USERNAME_PASSWORD_ROLES } from '../../constants/auth.constants.js';
import {
  EMPLOYMENT_STATUS,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
} from '../../constants/database.enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import {
  clearAuthCookies,
  readRefreshToken,
  setAccessCookie,
  setAuthCookies,
} from '../../utils/cookieAuth.js';
import { decodeTokenExpiry, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { normalizeEmail } from '../../utils/schemaValidators.js';
import { generateOtpCode, hashOtpCode, verifyOtpCode } from '../../utils/otp.js';
import { hashToken } from '../../utils/tokenHash.js';
import { normalizeIndianMobile } from '../../utils/schemaValidators.js';
import { env } from '../../config/env.js';
import { User } from '../users/user.model.js';
import { PharmacyStaff } from '../pharmacy-staff/pharmacyStaff.model.js';
import { Otp } from './otp.model.js';
import { UserSession } from './userSession.model.js';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';

const toSafeUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  username: user.username,
  mobileNumber: user.mobileNumber,
  email: user.email,
  role: user.role,
  accountStatus: user.accountStatus,
  isMobileVerified: user.isMobileVerified,
  isEmailVerified: user.isEmailVerified,
  profileImage: user.profileImage,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const assertActiveAccount = (user) => {
  if (user.accountStatus === USER_ACCOUNT_STATUS.BLOCKED) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Account is blocked');
  }

  if (user.accountStatus === USER_ACCOUNT_STATUS.DELETED) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Account is not available');
  }

  if (user.accountStatus !== USER_ACCOUNT_STATUS.ACTIVE) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Account is not active');
  }
};

const assertUsernamePasswordRole = (user) => {
  if (user.role === USER_ROLES.CUSTOMER) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      'Customer accounts must authenticate using mobile OTP'
    );
  }

  if (!USERNAME_PASSWORD_ROLES.includes(user.role)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This account cannot use username/password login');
  }
};

const assertRoleLoginEligibility = async (user) => {
  if (user.role === USER_ROLES.PHARMACY_STAFF) {
    const activeAssignment = await PharmacyStaff.findOne({
      user: user._id,
      employmentStatus: EMPLOYMENT_STATUS.ACTIVE,
    }).lean();

    if (!activeAssignment) {
      throw new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'No active pharmacy staff assignment found for this account'
      );
    }
  }
};

const getRequestMeta = (req) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent') || undefined,
});

const buildAuthPayload = async (user, req, res) => {
  const { ipAddress, userAgent } = getRequestMeta(req);
  const sessionId = new mongoose.Types.ObjectId();
  const sessionIdString = sessionId.toString();
  const tokenPayload = {
    userId: user._id.toString(),
    role: user.role,
    sessionId: sessionIdString,
  };

  const refreshToken = signRefreshToken(tokenPayload);
  const accessToken = signAccessToken(tokenPayload);
  const expiresAt = decodeTokenExpiry(refreshToken);

  if (!expiresAt) {
    throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Unable to determine session expiry');
  }

  await UserSession.create({
    _id: sessionId,
    user: user._id,
    refreshTokenHash: hashToken(refreshToken),
    ipAddress,
    userAgent,
    expiresAt,
    lastUsedAt: new Date(),
  });

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  user.lastLoginAt = new Date();

  setAuthCookies(res, { accessToken, refreshToken });

  return {
    user: toSafeUser(user),
  };
};

const findActiveOtp = async (mobileNumber) =>
  Otp.findOne({
    mobileNumber,
    purpose: OTP_PURPOSE.CUSTOMER_LOGIN,
    consumedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .select('+otpHash');

export const sendCustomerOtp = async (req, res) => {
  const mobileNumber = normalizeIndianMobile(req.body.mobileNumber);
  const existingUser = await User.findOne({ mobileNumber });

  if (existingUser && existingUser.role !== USER_ROLES.CUSTOMER) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      'This mobile number is linked to a non-customer account and cannot use OTP login'
    );
  }

  await Otp.deleteMany({
    mobileNumber,
    purpose: OTP_PURPOSE.CUSTOMER_LOGIN,
    consumedAt: { $exists: false },
  });

  const otpCode = generateOtpCode();
  const otpHash = await hashOtpCode(otpCode);
  const expiresAt = new Date(Date.now() + env.otpExpiresInMinutes * 60 * 1000);

  await Otp.create({
    mobileNumber,
    otpHash,
    purpose: OTP_PURPOSE.CUSTOMER_LOGIN,
    expiresAt,
  });

  if (env.isDevelopment || env.isTest) {
    console.log(`OTP generated for mobile ending ${mobileNumber.slice(-4)}`);
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      mobileNumber,
      expiresInMinutes: env.otpExpiresInMinutes,
      ...(env.exposeOtpInResponses ? { otp: otpCode } : {}),
    },
    AUTH_MESSAGES.OTP_SENT
  );

  res.status(response.statusCode).json(response);
};

export const verifyCustomerOtp = async (req, res) => {
  const mobileNumber = normalizeIndianMobile(req.body.mobileNumber);
  const { otp } = req.body;

  const otpRecord = await findActiveOtp(mobileNumber);

  if (!otpRecord) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'OTP expired or not found. Request a new OTP.');
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    throw new ApiError(HTTP_STATUS.TOO_MANY_REQUESTS, 'Maximum OTP attempts exceeded. Request a new OTP.');
  }

  const isValidOtp = await verifyOtpCode(otp, otpRecord.otpHash);

  if (!isValidOtp) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid OTP');
  }

  otpRecord.consumedAt = new Date();
  await otpRecord.save();

  let user = await User.findOne({ mobileNumber });

  if (user && user.role !== USER_ROLES.CUSTOMER) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      'This mobile number cannot be used for customer OTP authentication'
    );
  }

  if (!user) {
    user = await User.create({
      fullName: `Customer ${mobileNumber.slice(-4)}`,
      mobileNumber,
      role: USER_ROLES.CUSTOMER,
      isMobileVerified: true,
      accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
    });
  } else {
    assertActiveAccount(user);
    user.isMobileVerified = true;
    await user.save();
  }

  const authData = await buildAuthPayload(user, req, res);
  const response = new ApiResponse(HTTP_STATUS.OK, authData, AUTH_MESSAGES.LOGIN_SUCCESS);
  res.status(response.statusCode).json(response);
};

export const loginWithUsername = async (req, res) => {
  const { password } = req.body;
  const username = req.body.username ? String(req.body.username).trim().toLowerCase() : '';
  const email = req.body.email ? normalizeEmail(req.body.email) : '';

  const user = username
    ? await User.findOne({ username }).select('+passwordHash')
    : await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
  }

  assertUsernamePasswordRole(user);

  const passwordMatches = await bcrypt.compare(password, user.passwordHash || '');

  if (!passwordMatches) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE);
  }

  assertActiveAccount(user);
  await assertRoleLoginEligibility(user);

  const authData = await buildAuthPayload(user, req, res);
  const response = new ApiResponse(HTTP_STATUS.OK, authData, AUTH_MESSAGES.LOGIN_SUCCESS);
  res.status(response.statusCode).json(response);
};

export const refreshAccessToken = async (req, res) => {
  const refreshToken = readRefreshToken(req);

  if (!refreshToken) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Refresh token is required');
  }

  const payload = verifyRefreshToken(refreshToken);

  const session = await UserSession.findById(payload.sessionId).select('+refreshTokenHash');

  if (!session || session.isRevoked || session.expiresAt <= new Date()) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Session is invalid or expired');
  }

  if (session.user.toString() !== payload.sub) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Session does not belong to this user');
  }

  if (hashToken(refreshToken) !== session.refreshTokenHash) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid refresh token');
  }

  const user = await User.findById(payload.sub);

  if (!user) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User not found');
  }

  assertActiveAccount(user);

  session.lastUsedAt = new Date();
  await session.save();

  const accessToken = signAccessToken({
    userId: user._id.toString(),
    role: user.role,
    sessionId: session._id.toString(),
  });

  setAccessCookie(res, accessToken);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      tokenType: 'Bearer',
      expiresIn: env.jwtAccessExpiresIn,
    },
    AUTH_MESSAGES.REFRESH_SUCCESS
  );

  res.status(response.statusCode).json(response);
};

export const logout = async (req, res) => {
  const session = await UserSession.findById(req.auth.sessionId);

  if (session && !session.isRevoked) {
    session.isRevoked = true;
    session.revokedAt = new Date();
    await session.save();
  }

  clearAuthCookies(res);

  const response = new ApiResponse(HTTP_STATUS.OK, null, AUTH_MESSAGES.LOGOUT_SUCCESS);
  res.status(response.statusCode).json(response);
};

export const logoutAll = async (req, res) => {
  await UserSession.updateMany(
    {
      user: req.auth.userId,
      isRevoked: false,
    },
    {
      $set: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    }
  );

  clearAuthCookies(res);

  const response = new ApiResponse(HTTP_STATUS.OK, null, AUTH_MESSAGES.LOGOUT_ALL_SUCCESS);
  res.status(response.statusCode).json(response);
};

export const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.auth.userId);

  if (!user) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'User not found');
  }

  assertActiveAccount(user);

  const response = new ApiResponse(HTTP_STATUS.OK, toSafeUser(user), 'Current user fetched successfully');
  res.status(response.statusCode).json(response);
};

export const getActiveSessions = async (req, res) => {
  const sessions = await UserSession.find({
    user: req.auth.userId,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .select('_id ipAddress userAgent deviceLabel expiresAt lastUsedAt createdAt isRevoked');

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      sessions: sessions.map((session) => ({
        id: session._id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        deviceLabel: session.deviceLabel,
        expiresAt: session.expiresAt,
        lastUsedAt: session.lastUsedAt,
        createdAt: session.createdAt,
        isCurrent: session._id.toString() === req.auth.sessionId,
      })),
    },
    'Active sessions fetched successfully'
  );

  res.status(response.statusCode).json(response);
};

export const revokeSession = async (req, res) => {
  const session = await UserSession.findOne({
    _id: req.params.sessionId,
    user: req.auth.userId,
  });

  if (!session) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Session not found');
  }

  if (!session.isRevoked) {
    session.isRevoked = true;
    session.revokedAt = new Date();
    await session.save();
  }

  const response = new ApiResponse(HTTP_STATUS.OK, null, AUTH_MESSAGES.SESSION_REVOKED);
  res.status(response.statusCode).json(response);
};
