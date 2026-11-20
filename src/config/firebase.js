import { env } from './env.js';

let firebaseApp = null;
let messaging = null;
let warnedMissingCredentials = false;

const normalizePrivateKey = (value) => value.replace(/\\n/g, '\n');

export const isFcmConfigured = () =>
  Boolean(env.fcmProjectId && env.fcmClientEmail && env.fcmPrivateKey);

export const getFirebaseMessaging = async () => {
  if (!isFcmConfigured()) {
    if (!warnedMissingCredentials && !env.isTest) {
      console.warn('FCM credentials are not configured. Push delivery is disabled.');
      warnedMissingCredentials = true;
    }

    return null;
  }

  if (messaging) {
    return messaging;
  }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');

  if (getApps().length === 0) {
    firebaseApp = initializeApp({
      credential: cert({
        projectId: env.fcmProjectId,
        clientEmail: env.fcmClientEmail,
        privateKey: normalizePrivateKey(env.fcmPrivateKey),
      }),
    });
  }

  messaging = getMessaging(firebaseApp);
  return messaging;
};

export const sendFcmToTokens = async ({ tokens, title, body, data = {} }) => {
  const messagingClient = await getFirebaseMessaging();

  if (!messagingClient || tokens.length === 0) {
    return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
  }

  const response = await messagingClient.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value ?? '')])
    ),
  });

  const invalidTokens = [];
  response.responses.forEach((entry, index) => {
    if (!entry.success) {
      const code = entry.error?.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        invalidTokens.push(tokens[index]);
      }
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
};
