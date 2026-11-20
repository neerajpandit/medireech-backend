import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const generateOtpCode = () => {
  if (env.otpFixedCode) {
    return env.otpFixedCode;
  }

  const max = 10 ** env.otpLength;
  const value = crypto.randomInt(0, max);
  return String(value).padStart(env.otpLength, '0');
};

export const hashOtpCode = async (otpCode) => bcrypt.hash(otpCode, env.bcryptSaltRounds);

export const verifyOtpCode = async (otpCode, otpHash) => bcrypt.compare(otpCode, otpHash);
