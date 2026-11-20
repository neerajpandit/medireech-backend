import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import app from './app.js';
import { env, assertEnv } from './config/env.js';
import { connectDB } from './config/db.js';
import './modules/index.js';
import { attachSocketServer } from './socket/socketServer.js';
import { redactSecrets } from './utils/redact.js';

const SHUTDOWN_TIMEOUT_MS = 10000;

let server;

const shutdown = async (signal) => {
  console.log(`${signal} received. Closing HTTP server.`);

  const forceTimer = setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
    }

    clearTimeout(forceTimer);
    process.exit(0);
  } catch (error) {
    clearTimeout(forceTimer);
    const reason = redactSecrets(error instanceof Error ? error.message : 'Unknown shutdown error');
    console.error(`Shutdown error: ${reason}`);
    process.exit(1);
  }
};

export const startServer = async () => {
  try {
    assertEnv();

    if (env.isDevelopment && (!env.jwtAccessSecret || !env.jwtRefreshSecret)) {
      console.warn(
        'JWT secrets are not set. They are mandatory in production and required before authentication is enabled.'
      );
    }

    await connectDB();

    server = http.createServer(app);
    await attachSocketServer(server);

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.port, () => {
        console.log(`MediReech API listening on port ${env.port} (${env.nodeEnv})`);
        resolve();
      });
    });
  } catch (error) {
    const reason = redactSecrets(error instanceof Error ? error.message : 'Unknown startup error');
    console.error(`Failed to start server: ${reason}`);
    process.exit(1);
  }
};

const registerProcessHandlers = () => {
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    const message = redactSecrets(reason instanceof Error ? reason.message : 'Unhandled promise rejection');
    console.error(`Unhandled rejection: ${message}`);
    shutdown('unhandledRejection').catch(() => process.exit(1));
  });

  process.on('uncaughtException', (error) => {
    const message = redactSecrets(error instanceof Error ? error.message : 'Uncaught exception');
    console.error(`Uncaught exception: ${message}`);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });
};

const isDirectExecution = () => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return path.resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectExecution()) {
  registerProcessHandlers();
  startServer();
}
