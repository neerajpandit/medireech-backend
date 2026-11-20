import mongoose from 'mongoose';
import { USERNAME_PASSWORD_ROLES } from '../../constants/auth.constants.js';
import { USER_ACCOUNT_STATUS, USER_ROLES } from '../../constants/database.enums.js';
import {
  normalizeEmail,
  normalizeIndianMobile,
  validateEmail,
  validateIndianMobile,
} from '../../utils/schemaValidators.js';

const { Schema } = mongoose;

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

const normalizeUsername = (value) => {
  if (value == null || value === '') {
    return undefined;
  }

  return String(value).trim().toLowerCase();
};

const requiresUsernamePassword = (role) => USERNAME_PASSWORD_ROLES.includes(role);

/**
 * Platform user. Role and pharmacy membership for authorization must come from
 * authenticated identity and verified staff records — never from client input alone.
 *
 * CUSTOMER accounts authenticate via mobile OTP and do not require username/password.
 * Pharmacy and admin accounts authenticate via username/password.
 */
const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Full name must be at least 2 characters'],
      maxlength: [120, 'Full name cannot exceed 120 characters'],
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      set: normalizeUsername,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [40, 'Username cannot exceed 40 characters'],
      match: [USERNAME_PATTERN, 'Username may contain lowercase letters, numbers, dots, underscores, and hyphens'],
    },
    mobileNumber: {
      type: String,
      trim: true,
      set: normalizeIndianMobile,
      validate: {
        validator(value) {
          if (value == null || value === '') {
            return true;
          }

          return validateIndianMobile(value);
        },
        message: 'Mobile number must be a valid 10-digit Indian mobile number',
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: normalizeEmail,
      validate: {
        validator: validateEmail,
        message: 'Email must be a valid email address',
      },
    },
    passwordHash: {
      type: String,
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: Object.values(USER_ROLES),
        message: 'Invalid user role',
      },
      required: [true, 'User role is required'],
      index: true,
    },
    profileImage: {
      type: String,
      trim: true,
    },
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    accountStatus: {
      type: String,
      enum: {
        values: Object.values(USER_ACCOUNT_STATUS),
        message: 'Invalid account status',
      },
      default: USER_ACCOUNT_STATUS.ACTIVE,
      index: true,
    },
    lastLoginAt: {
      type: Date,
    },
    operationsPermissions: {
      type: [String],
      default: [],
    },
    refreshTokenHash: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.refreshTokenHash;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.refreshTokenHash;
        return ret;
      },
    },
  }
);

userSchema.pre('validate', function validateAuthProfile() {
  if (this.role === USER_ROLES.CUSTOMER) {
    if (!this.mobileNumber) {
      this.invalidate('mobileNumber', 'Mobile number is required for customer accounts');
    }

    if (this.username) {
      this.invalidate('username', 'Customer accounts cannot have a username');
    }

    if (this.passwordHash) {
      this.invalidate('passwordHash', 'Customer accounts cannot have a password');
    }
  }

  if (requiresUsernamePassword(this.role)) {
    if (!this.username) {
      this.invalidate('username', 'Username is required for pharmacy and admin accounts');
    }

    if (!this.passwordHash) {
      this.invalidate('passwordHash', 'Password hash is required for pharmacy and admin accounts');
    }
  }
});

userSchema.index({ username: 1 }, { unique: true, sparse: true, name: 'user_username_unique_sparse' });
userSchema.index({ mobileNumber: 1 }, { unique: true, sparse: true, name: 'user_mobile_unique_sparse' });
userSchema.index({ email: 1 }, { unique: true, sparse: true, name: 'user_email_unique_sparse' });
userSchema.index({ role: 1, accountStatus: 1 }, { name: 'user_role_account_status' });
userSchema.index({ accountStatus: 1, createdAt: -1 }, { name: 'user_account_status_created' });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
