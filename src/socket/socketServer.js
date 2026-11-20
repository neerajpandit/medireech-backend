import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { isRedisConfigured, getRedisConnection } from '../config/redis.js';
import { USER_ACCOUNT_STATUS } from '../constants/database.enums.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { User } from '../modules/users/user.model.js';
import { Pharmacy } from '../modules/pharmacies/pharmacy.model.js';
import { PharmacyStaff } from '../modules/pharmacy-staff/pharmacyStaff.model.js';
import { USER_ROLES } from '../constants/database.enums.js';

let ioInstance = null;

const userRoom = (userId) => `user:${userId}`;
const pharmacyRoom = (pharmacyId) => `pharmacy:${pharmacyId}`;

export const getSocketIo = () => ioInstance;

export const emitToUser = (userId, event, payload) => {
  if (!ioInstance || !userId) {
    return;
  }

  ioInstance.to(userRoom(userId)).emit(event, payload);
};

export const emitToPharmacy = (pharmacyId, event, payload) => {
  if (!ioInstance || !pharmacyId) {
    return;
  }

  ioInstance.to(pharmacyRoom(pharmacyId)).emit(event, payload);
};

const authorizeSocketRooms = async (socket) => {
  const { sub: userId, role } = socket.data.auth;
  socket.join(userRoom(userId));

  if (role === USER_ROLES.PHARMACY_OWNER) {
    const pharmacy = await Pharmacy.findOne({ owner: userId }).select('_id').lean();
    if (pharmacy) {
      socket.join(pharmacyRoom(pharmacy._id.toString()));
    }
  }

  if (role === USER_ROLES.PHARMACY_STAFF) {
    const staff = await PharmacyStaff.findOne({ user: userId, employmentStatus: 'ACTIVE' })
      .select('pharmacy')
      .lean();
    if (staff?.pharmacy) {
      socket.join(pharmacyRoom(staff.pharmacy.toString()));
    }
  }
};

export const attachSocketServer = async (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
  });

  if (isRedisConfigured() && !env.isTest) {
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const connection = await getRedisConnection();
      const pubClient = connection;
      const subClient = connection.duplicate();
      ioInstance.adapter(createAdapter(pubClient, subClient));
    } catch (error) {
      console.warn('Socket.IO Redis adapter not configured. Single-instance mode only.');
    }
  }

  ioInstance.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        next(new Error('Authentication token is required'));
        return;
      }

      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('accountStatus role').lean();

      if (!user || user.accountStatus !== USER_ACCOUNT_STATUS.ACTIVE) {
        next(new Error('Unauthorized socket connection'));
        return;
      }

      socket.data.auth = { sub: payload.sub, role: user.role };
      await authorizeSocketRooms(socket);
      next();
    } catch (error) {
      next(new Error('Unauthorized socket connection'));
    }
  });

  ioInstance.on('connection', (socket) => {
    socket.emit('socket:connected', { success: true });
  });

  return ioInstance;
};

export const mapNotificationEventToSocketEvent = (eventType) => {
  const mapping = {
    RESERVATION_CREATED: 'reservation:created',
    RESERVATION_CONFIRMED: 'reservation:confirmed',
    RESERVATION_REJECTED: 'reservation:rejected',
    RESERVATION_EXPIRED: 'reservation:expired',
    RESERVATION_READY_FOR_PICKUP: 'reservation:ready',
    RESERVATION_CANCELLED: 'reservation:cancelled',
    RESERVATION_COLLECTED: 'reservation:collected',
    PHARMACY_APPLICATION_APPROVED: 'pharmacy:application-status-updated',
    PHARMACY_APPLICATION_REJECTED: 'pharmacy:application-status-updated',
    PHARMACY_DOCUMENTS_REQUESTED: 'pharmacy:application-status-updated',
    PHARMACY_SUSPENDED: 'pharmacy:application-status-updated',
    PHARMACY_REACTIVATED: 'pharmacy:application-status-updated',
  };

  return mapping[eventType] || 'notification:new';
};
