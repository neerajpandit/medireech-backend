import { HTTP_STATUS } from '../constants/index.js';
import { ApiError } from '../utils/ApiError.js';
import { readAccessToken } from '../utils/cookieAuth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { UserSession } from '../modules/auth/userSession.model.js';
import { User } from '../modules/users/user.model.js';
import { USER_ACCOUNT_STATUS } from '../constants/database.enums.js';

export const authenticate = async (req, _res, next) => {
  const token = readAccessToken(req);

  if (!token) {
    next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Authentication token is required'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).lean();

    if (!user) {
      next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User not found'));
      return;
    }

    if (user.accountStatus !== USER_ACCOUNT_STATUS.ACTIVE) {
      next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Account is not active'));
      return;
    }

    const session = await UserSession.findById(payload.sessionId).lean();

    if (!session || session.isRevoked || session.expiresAt <= new Date()) {
      next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Session is invalid or expired'));
      return;
    }

    req.auth = {
      userId: payload.sub,
      role: payload.role,
      sessionId: payload.sessionId,
      tokenPayload: payload,
      operationsPermissions: user.operationsPermissions || [],
    };

    next();
  } catch (error) {
    next(error);
  }
};
