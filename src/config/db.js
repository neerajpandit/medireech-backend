import mongoose from 'mongoose';
import { env } from './env.js';
import { redactSecrets } from '../utils/redact.js';

let listenersAttached = false;
let transactionSupport = false;

const attachConnectionListeners = () => {
  if (listenersAttached) {
    return;
  }

  mongoose.connection.on('error', (error) => {
    const reason = redactSecrets(error instanceof Error ? error.message : 'Unknown database error');
    console.error(`MongoDB error: ${reason}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  listenersAttached = true;
};

export const connectDB = async () => {
  mongoose.set('strictQuery', true);
  attachConnectionListeners();

  try {
    const connection = await mongoose.connect(env.mongodbUri, {
      autoIndex: !env.isProduction,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
    });

    const { host, name } = connection.connection;
    transactionSupport = await detectTransactionSupport();
    console.log(
      `MongoDB connected (host: ${host}, database: ${name}${transactionSupport ? ', replica set' : ', standalone'})`
    );

    return connection;
  } catch (error) {
    const reason = redactSecrets(error instanceof Error ? error.message : 'Unknown connection error');
    throw new Error(`MongoDB connection failed: ${reason}`);
  }
};

const detectTransactionSupport = async () => {
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    return false;
  }
};

export const supportsMongoTransactions = async () => {
  if (transactionSupport) {
    return true;
  }

  if (mongoose.connection.readyState !== 1) {
    return false;
  }

  transactionSupport = await detectTransactionSupport();
  return transactionSupport;
};

export const disconnectDB = async () => {
  transactionSupport = false;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
};
