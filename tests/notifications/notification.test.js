import { jest } from '@jest/globals';
import http from 'node:http';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';

const sendFcmToTokens = jest.fn(async () => ({
  successCount: 1,
  failureCount: 0,
  invalidTokens: [],
}));

await jest.unstable_mockModule('../../src/config/firebase.js', () => ({
  isFcmConfigured: () => true,
  sendFcmToTokens,
  getFirebaseMessaging: jest.fn(),
}));

const { default: app } = await import('../../src/app.js');
const { processPendingNotificationOutbox, processNotificationOutboxRecord } = await import(
  '../../src/modules/notifications/notification.controller.js'
);
const { enqueueNotificationOutbox } = await import('../../src/utils/enqueueNotificationOutbox.js');
const { attachSocketServer } = await import('../../src/socket/socketServer.js');
const {
  DeviceToken,
  Notification,
  NotificationOutbox,
} = await import('../../src/modules/index.js');
const { NOTIFICATION_EVENT_TYPES } = await import('../../src/constants/notification.types.js');
const { accessTokenFromAuthResponse } = await import('../helpers/authCookies.js');
const {
  clearMemoryDb,
  connectMemoryDb,
  createApprovedPharmacy,
  createMedicine,
  createPasswordAccount,
  createUser,
  disconnectMemoryDb,
} = await import('../helpers/memoryDb.js');

const loginCustomer = async (mobileNumber = '9876512000') => {
  await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber }).expect(200);
  const response = await request(app)
    .post('/api/v1/auth/customer/verify-otp')
    .send({ mobileNumber, otp: '123456' })
    .expect(200);
  return accessTokenFromAuthResponse(response);
};

const loginWithUsername = async (username, password = 'SecurePassword123') => {
  const response = await request(app).post('/api/v1/auth/login').send({ username, password }).expect(200);
  return accessTokenFromAuthResponse(response);
};

const seedInventory = async (pharmacyId, medicine) => {
  const { Inventory } = await import('../../src/modules/index.js');
  return Inventory.create({
    pharmacy: pharmacyId,
    medicine: medicine._id,
    batches: [
      {
        batchNumber: 'NTF-B1',
        expiryDate: new Date('2028-01-01'),
        physicalQuantity: 20,
        reservedQuantity: 0,
        unitPrice: 40,
        mrp: 45,
      },
    ],
  });
};

describe('Notification system (Phase 8)', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    sendFcmToTokens.mockClear();
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('In-app notifications API', () => {
    it('creates notification via outbox processing and lists with pagination', async () => {
      const customer = await createUser({ mobileNumber: '9876512001' });
      const token = await loginCustomer('9876512001');

      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.IMPORTANT_UPDATE,
        recipient: customer._id,
        payload: { status: 'INFO' },
        idempotencyKey: `important:${customer._id.toString()}`,
      });

      await processPendingNotificationOutbox({ batchSize: 10 });

      const listResponse = await request(app)
        .get('/api/v1/notifications?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(listResponse.body.data.notifications).toHaveLength(1);
      expect(listResponse.body.data.notifications[0].type).toBe('IMPORTANT_UPDATE');
      expect(listResponse.body.meta.total).toBe(1);
    });

    it('marks one notification and all notifications as read', async () => {
      const customer = await createUser({ mobileNumber: '9876512002' });
      const token = await loginCustomer('9876512002');

      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_CONFIRMED,
        recipient: customer._id,
        payload: { reservationCode: 'ABC123' },
        idempotencyKey: `confirmed:${customer._id.toString()}`,
      });
      await processPendingNotificationOutbox({ batchSize: 10 });

      const listed = await Notification.find({ recipient: customer._id });
      const notificationId = listed[0]._id.toString();

      await request(app)
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_READY_FOR_PICKUP,
        recipient: customer._id,
        payload: { reservationCode: 'ABC124' },
        idempotencyKey: `ready:${customer._id.toString()}`,
      });
      await processPendingNotificationOutbox({ batchSize: 10 });

      await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const unreadCount = await Notification.countDocuments({ recipient: customer._id, isRead: false });
      expect(unreadCount).toBe(0);
    });

    it('prevents cross-user access to notification records', async () => {
      const ownerA = await createUser({ mobileNumber: '9876512003' });
      const ownerB = await createUser({ mobileNumber: '9876512004' });
      const tokenB = await loginCustomer('9876512004');

      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.ACCOUNT_STATUS_CHANGED,
        recipient: ownerA._id,
        idempotencyKey: `status:${ownerA._id.toString()}`,
      });
      await processPendingNotificationOutbox({ batchSize: 10 });

      const notification = await Notification.findOne({ recipient: ownerA._id });

      await request(app)
        .patch(`/api/v1/notifications/${notification._id.toString()}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      const listB = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(listB.body.data.notifications).toHaveLength(0);
    });
  });

  describe('Device management', () => {
    it('registers, updates, and removes devices without exposing raw tokens', async () => {
      const customer = await createUser({ mobileNumber: '9876512005' });
      const token = await loginCustomer('9876512005');

      const first = await request(app)
        .post('/api/v1/notifications/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          token: 'fcm-token-device-one-abcdefghijklmnopqrst',
          platform: 'ANDROID',
          deviceId: 'device-1',
          deviceName: 'Pixel',
        })
        .expect(200);

      expect(first.body.data.device.token).toBeUndefined();

      await request(app)
        .post('/api/v1/notifications/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          token: 'fcm-token-device-one-refreshed-abcdefghijklmnop',
          platform: 'ANDROID',
          deviceId: 'device-1',
          deviceName: 'Pixel',
        })
        .expect(200);

      await request(app)
        .post('/api/v1/notifications/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          token: 'fcm-token-device-two-abcdefghijklmnopqrst',
          platform: 'IOS',
          deviceId: 'device-2',
        })
        .expect(200);

      const activeCount = await DeviceToken.countDocuments({ user: customer._id, isActive: true });
      expect(activeCount).toBe(2);

      await request(app)
        .delete('/api/v1/notifications/devices/device-2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const remaining = await DeviceToken.countDocuments({ user: customer._id, isActive: true });
      expect(remaining).toBe(1);
    });

    it('deactivates invalid FCM tokens after push processing', async () => {
      const customer = await createUser({ mobileNumber: '9876512006' });

      await DeviceToken.create({
        user: customer._id,
        token: 'invalid-fcm-token-value-1234567890',
        platform: 'ANDROID',
        deviceId: 'bad-device',
        isActive: true,
      });

      sendFcmToTokens.mockResolvedValueOnce({
        successCount: 0,
        failureCount: 1,
        invalidTokens: ['invalid-fcm-token-value-1234567890'],
      });

      const outbox = await NotificationOutbox.create({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_CONFIRMED,
        recipient: customer._id,
        idempotencyKey: `push-invalid:${customer._id.toString()}`,
        payload: { reservationCode: 'XYZ999' },
      });

      await processNotificationOutboxRecord(outbox);

      const device = await DeviceToken.findOne({ user: customer._id, deviceId: 'bad-device' });
      expect(device.isActive).toBe(false);
      expect(sendFcmToTokens).toHaveBeenCalled();
    });
  });

  describe('Outbox worker processing', () => {
    it('does not duplicate notifications when processing the same idempotency key twice', async () => {
      const customer = await createUser({ mobileNumber: '9876512007' });

      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_EXPIRED,
        recipient: customer._id,
        idempotencyKey: `expired-once:${customer._id.toString()}`,
        payload: { reservationCode: 'EXP001' },
      });

      await processPendingNotificationOutbox({ batchSize: 5 });
      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_EXPIRED,
        recipient: customer._id,
        idempotencyKey: `expired-once:${customer._id.toString()}`,
        payload: { reservationCode: 'EXP001' },
      });
      await processPendingNotificationOutbox({ batchSize: 5 });

      const count = await Notification.countDocuments({ recipient: customer._id });
      expect(count).toBe(1);
    });
  });

  describe('Socket.IO', () => {
    it('accepts authenticated connections and rejects invalid tokens', async () => {
      await createUser({ mobileNumber: '9876512008' });
      const token = await loginCustomer('9876512008');

      const httpServer = http.createServer(app);
      await attachSocketServer(httpServer);
      await new Promise((resolve) => httpServer.listen(0, resolve));
      const { port } = httpServer.address();

      const validSocket = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token },
        transports: ['websocket'],
      });

      await new Promise((resolve, reject) => {
        validSocket.on('connect', resolve);
        validSocket.on('connect_error', reject);
      });

      const invalidSocket = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: 'invalid.jwt.token' },
        transports: ['websocket'],
      });

      await new Promise((resolve) => {
        invalidSocket.on('connect_error', () => resolve());
      });

      validSocket.close();
      invalidSocket.close();
      await new Promise((resolve) => httpServer.close(resolve));
    });

    it('delivers reservation events to pharmacy owner room without sensitive payload fields', async () => {
      const { owner, pharmacy } = await createApprovedPharmacy({ username: 'socket_pharm_owner' });
      const ownerToken = await loginWithUsername('socket_pharm_owner');

      const httpServer = http.createServer(app);
      await attachSocketServer(httpServer);
      await new Promise((resolve) => httpServer.listen(0, resolve));
      const { port } = httpServer.address();

      const socket = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: ownerToken },
        transports: ['websocket'],
      });

      await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
      });

      const eventPromise = new Promise((resolve) => {
        socket.on('reservation:created', (payload) => resolve(payload));
      });

      await enqueueNotificationOutbox({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_CREATED,
        recipient: owner._id,
        payload: { pharmacyId: pharmacy._id, reservationCode: 'RSV100' },
        idempotencyKey: `socket-created:${pharmacy._id.toString()}`,
      });
      await processPendingNotificationOutbox({ batchSize: 5 });

      const payload = await eventPromise;
      expect(payload.data.reservationCode).toBe('RSV100');
      expect(JSON.stringify(payload)).not.toMatch(/password|otp|prescription/i);

      socket.close();
      await new Promise((resolve) => httpServer.close(resolve));
    });
  });

  describe('Reservation integration', () => {
    it('queues pharmacy notification when a customer creates a reservation', async () => {
      const customerToken = await loginCustomer('9876512009');
      const { owner, pharmacy } = await createApprovedPharmacy({ username: 'notify_pharm_owner' });
      const medicine = await createMedicine({ name: 'Notify Med' });
      await seedInventory(pharmacy._id, medicine);

      await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 1 }],
        })
        .expect(201);

      const outbox = await NotificationOutbox.findOne({
        eventType: NOTIFICATION_EVENT_TYPES.RESERVATION_CREATED,
        recipient: owner._id,
      });
      expect(outbox).toBeTruthy();

      await processPendingNotificationOutbox({ batchSize: 5 });
      const inApp = await Notification.findOne({ recipient: owner._id, type: 'RESERVATION_CREATED' });
      expect(inApp).toBeTruthy();
    });

    it('notifies customer when pharmacy application is approved', async () => {
      const superAdmin = await createPasswordAccount({ username: 'super_notify_admin', role: 'SUPER_ADMIN' });
      const superToken = await loginWithUsername('super_notify_admin');

      const owner = await createPasswordAccount({
        username: 'pending_pharm_owner',
        role: 'PHARMACY_OWNER',
        mobileNumber: '9876512010',
      });

      const { Pharmacy } = await import('../../src/modules/pharmacies/pharmacy.model.js');
      const pharmacy = await Pharmacy.create({
        pharmacyName: 'Pending Notify Pharmacy',
        owner: owner._id,
        pharmacyCode: 'PH-NOTIFY-001',
        registrationNumber: 'REG-NOTIFY-001',
        drugLicenseNumber: 'DL-NOTIFY-001',
        phone: '9876512011',
        email: 'pending@example.com',
        address: {
          addressLine: '1 Test Lane',
          city: 'Delhi',
          district: 'Delhi',
          state: 'Delhi',
          pincode: '110001',
          country: 'India',
        },
        location: { type: 'Point', coordinates: [77.2, 28.6] },
        verificationStatus: 'PENDING',
        operationalStatus: 'INACTIVE',
        verificationDocuments: [
          {
            documentType: 'drugLicenseDocument',
            fileType: 'PDF',
            fileKey: 'private/drug-license/notify-test.pdf',
            uploadedAt: new Date(),
          },
          {
            documentType: 'ownerIdentityDocument',
            fileType: 'PDF',
            fileKey: 'private/owner-id/notify-test.pdf',
            uploadedAt: new Date(),
          },
        ],
      });

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacy._id.toString()}/approve`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ note: 'Approved for notifications test' })
        .expect(200);

      const outbox = await NotificationOutbox.findOne({
        eventType: NOTIFICATION_EVENT_TYPES.PHARMACY_APPLICATION_APPROVED,
        recipient: owner._id,
      });
      expect(outbox).toBeTruthy();

      await processPendingNotificationOutbox({ batchSize: 5 });
      const notification = await Notification.findOne({
        recipient: owner._id,
        type: 'PHARMACY_APPLICATION_APPROVED',
      });
      expect(notification).toBeTruthy();
      expect(superAdmin._id).toBeTruthy();
    });
  });
});
