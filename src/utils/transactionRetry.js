import mongoose from 'mongoose';
import { supportsMongoTransactions } from '../config/db.js';

export const isTransientTransactionError = (error) => {
  if (!error) {
    return false;
  }

  if (Array.isArray(error.errorLabels) && error.errorLabels.includes('TransientTransactionError')) {
    return true;
  }

  return error.code === 112 || error.codeName === 'WriteConflict';
};

export const applySession = (query, session) => (session ? query.session(session) : query);

export const sessionOption = (session) => (session ? { session } : {});

export const runWithTransactionRetry = async (operation, { maxAttempts = 3 } = {}) => {
  if (!(await supportsMongoTransactions())) {
    return operation(null);
  }

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();
      const result = await operation(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      lastError = error;

      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      if (!isTransientTransactionError(error) || attempt === maxAttempts) {
        throw error;
      }
    } finally {
      session.endSession();
    }
  }

  throw lastError;
};
