import bcrypt from 'bcrypt';
import { assertEnv, env } from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import '../src/modules/index.js';
import { USER_ACCOUNT_STATUS, USER_ROLES } from '../src/constants/database.enums.js';
import { User } from '../src/modules/users/user.model.js';

const run = async () => {
  try {
    assertEnv();

    const username = env.superAdminUsername;
    const password = env.superAdminPassword;

    if (!username || !password) {
      throw new Error('SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must be set for bootstrap');
    }

    if (password.length < 12) {
      throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters');
    }

    await connectDB();

    const normalizedUsername = username.trim().toLowerCase();
    const existingSuperAdmin = await User.findOne({
      role: USER_ROLES.SUPER_ADMIN,
      username: normalizedUsername,
    });

    if (existingSuperAdmin) {
      console.log('Super Admin already exists. No changes were made.');
      return;
    }

    const duplicateUsername = await User.findOne({ username: normalizedUsername });

    if (duplicateUsername) {
      throw new Error('SUPER_ADMIN_USERNAME is already used by another account');
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

    await User.create({
      fullName: 'MediReech Super Admin',
      username: normalizedUsername,
      passwordHash,
      role: USER_ROLES.SUPER_ADMIN,
      accountStatus: USER_ACCOUNT_STATUS.ACTIVE,
      isEmailVerified: true,
    });

    console.log('Super Admin account created successfully.');
  } catch (error) {
    console.error(`Super Admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
};

run();
