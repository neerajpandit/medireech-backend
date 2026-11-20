import { UserSession } from '../modules/auth/userSession.model.js';

export const revokeAllUserSessions = async (userId) =>
  UserSession.updateMany(
    { user: userId, isRevoked: false },
    { $set: { isRevoked: true, revokedAt: new Date() } }
  );
