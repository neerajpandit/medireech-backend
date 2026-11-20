import crypto from 'node:crypto';
import request from 'supertest';

process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
import app from '../../src/app.js';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../../src/constants/payment.constants.js';
import { Payment, Reservation } from '../../src/modules/index.js';
import { accessTokenFromAuthResponse } from '../helpers/authCookies.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createApprovedPharmacy,
  createMedicine,
  createPasswordAccount,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

const signPayment = (orderId, paymentId) =>
  crypto.createHmac('sha256', 'test_razorpay_secret').update(`${orderId}|${paymentId}`).digest('hex');

const signWebhook = (rawBody) =>
  crypto.createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');

const loginCustomer = async (mobileNumber = '9876521000') => {
  await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber }).expect(200);
  const response = await request(app)
    .post('/api/v1/auth/customer/verify-otp')
    .send({ mobileNumber, otp: '123456' })
    .expect(200);
  return accessTokenFromAuthResponse(response);
};

const loginPharmacyOwner = async (username, password = 'SecurePassword123') => {
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
        batchNumber: 'PAY-B1',
        expiryDate: new Date('2028-01-01'),
        physicalQuantity: 30,
        reservedQuantity: 0,
        unitPrice: 50,
        mrp: 55,
      },
    ],
  });
};

const createConfirmedOnlineReservation = async () => {
  const customerToken = await loginCustomer('9876521001');
  const { pharmacy } = await createApprovedPharmacy({ username: 'pay_pharm_owner' });
  const ownerToken = await loginPharmacyOwner('pay_pharm_owner');
  const medicine = await createMedicine({ name: 'Payment Med' });
  await seedInventory(pharmacy._id, medicine);

  const createResponse = await request(app)
    .post('/api/v1/reservations')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      pharmacyId: pharmacy._id.toString(),
      paymentMethod: PAYMENT_METHODS.ONLINE,
      items: [{ medicineId: medicine._id.toString(), quantity: 2 }],
    })
    .expect(201);

  const reservationId = createResponse.body.data.reservation.id;

  await request(app)
    .patch(`/api/v1/reservations/${reservationId}/accept`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({})
    .expect(200);

  const reservation = await Reservation.findById(reservationId);
  return { customerToken, ownerToken, reservation, pharmacy };
};

describe('Payment gateway (Phase 9)', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('Online payment order creation', () => {
    it('creates order from confirmed reservation snapshots in paise', async () => {
      const { customerToken, reservation } = await createConfirmedOnlineReservation();

      expect(reservation.totalAmount).toBe(10000);

      const orderResponse = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'order-key-001',
        })
        .expect(201);

      expect(orderResponse.body.data.razorpay.amount).toBe(10000);
      expect(orderResponse.body.data.payment.status).toBe(PAYMENT_STATUS.CREATED);
      expect(orderResponse.body.data.razorpay.orderId).toMatch(/^order_/);
    });

    it('rejects unauthenticated and wrong owner requests', async () => {
      const { reservation } = await createConfirmedOnlineReservation();

      await request(app)
        .post('/api/v1/payments/create-order')
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'order-key-unauth',
        })
        .expect(401);

      const otherToken = await loginCustomer('9876521002');
      await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'order-key-other',
        })
        .expect(404);
    });

    it('rejects payment for pending reservations', async () => {
      const customerToken = await loginCustomer('9876521003');
      const { pharmacy } = await createApprovedPharmacy({ username: 'pay_pending_owner' });
      const medicine = await createMedicine({ name: 'Pending Pay Med' });
      await seedInventory(pharmacy._id, medicine);

      const pending = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          paymentMethod: PAYMENT_METHODS.ONLINE,
          items: [{ medicineId: medicine._id.toString(), quantity: 1 }],
        })
        .expect(201);

      await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: pending.body.data.reservation.id,
          idempotencyKey: 'pending-order-key',
        })
        .expect(409);
    });

    it('handles duplicate idempotency keys safely', async () => {
      const { customerToken, reservation } = await createConfirmedOnlineReservation();

      const first = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'dup-order-key',
        })
        .expect(201);

      const second = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'dup-order-key',
        })
        .expect(200);

      expect(second.body.data.payment.id).toBe(first.body.data.payment.id);
    });
  });

  describe('Payment verification and webhooks', () => {
    it('accepts valid signatures and captures payment idempotently', async () => {
      const { customerToken, reservation } = await createConfirmedOnlineReservation();

      const orderResponse = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'verify-order-key',
        })
        .expect(201);

      const orderId = orderResponse.body.data.razorpay.orderId;
      const paymentId = 'pay_test_123456';

      const verifyResponse = await request(app)
        .post('/api/v1/payments/verify')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signPayment(orderId, paymentId),
        })
        .expect(200);

      expect(verifyResponse.body.data.payment.status).toBe(PAYMENT_STATUS.CAPTURED);

      await request(app)
        .post('/api/v1/payments/verify')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signPayment(orderId, paymentId),
        })
        .expect(200);

      const refreshedReservation = await Reservation.findById(reservation._id);
      expect(refreshedReservation.paymentStatus).toBe(PAYMENT_STATUS.CAPTURED);
      expect(refreshedReservation.status).toBe('CONFIRMED');
    });

    it('rejects invalid verification signatures and mismatched orders', async () => {
      const { customerToken, reservation } = await createConfirmedOnlineReservation();

      const orderResponse = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'bad-verify-key',
        })
        .expect(201);

      const orderId = orderResponse.body.data.razorpay.orderId;

      const invalidVerify = await request(app)
        .post('/api/v1/payments/verify')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: 'pay_bad',
          razorpay_signature: 'invalid-signature',
        });

      expect(invalidVerify.status).toBe(400);
      expect(invalidVerify.body.message).toMatch(/signature/i);
    });

    it('processes webhook signatures and ignores duplicates', async () => {
      const { customerToken, reservation } = await createConfirmedOnlineReservation();

      const orderResponse = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'webhook-order-key',
        })
        .expect(201);

      const orderId = orderResponse.body.data.razorpay.orderId;
      const payload = {
        id: 'evt_test_payment_captured',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_001',
              order_id: orderId,
              status: 'captured',
            },
          },
        },
      };

      const bodyString = JSON.stringify(payload);
      const signature = signWebhook(bodyString);

      await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(bodyString)
        .expect(200);

      const payment = await Payment.findOne({ razorpayOrderId: orderId });
      expect(payment.status).toBe(PAYMENT_STATUS.CAPTURED);

      await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(bodyString)
        .expect(200);

      await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'bad-signature')
        .send(bodyString)
        .expect(401);
    });
  });

  describe('Pay at pharmacy and refunds', () => {
    it('allows pharmacy cash collection and blocks customers', async () => {
      const customerToken = await loginCustomer('9876521010');
      const { pharmacy } = await createApprovedPharmacy({ username: 'cash_pharm_owner' });
      const ownerToken = await loginPharmacyOwner('cash_pharm_owner');
      const medicine = await createMedicine({ name: 'Cash Med' });
      await seedInventory(pharmacy._id, medicine);

      const reservationResponse = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          paymentMethod: PAYMENT_METHODS.PAY_AT_PHARMACY,
          items: [{ medicineId: medicine._id.toString(), quantity: 1 }],
        })
        .expect(201);

      await request(app)
        .patch(`/api/v1/reservations/${reservationResponse.body.data.reservation.id}/accept`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);

      const payment = await Payment.findOne({
        reservation: reservationResponse.body.data.reservation.id,
      });

      await request(app)
        .patch(`/api/v1/payments/${payment._id.toString()}/collect-cash`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({})
        .expect(403);

      const collectResponse = await request(app)
        .patch(`/api/v1/payments/${payment._id.toString()}/collect-cash`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ paymentReference: 'CASH-001' })
        .expect(200);

      expect(collectResponse.body.data.payment.status).toBe(PAYMENT_STATUS.CAPTURED);

      await request(app)
        .patch(`/api/v1/payments/${payment._id.toString()}/collect-cash`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);
    });

    it('supports super admin partial refund with limits', async () => {
      const { customerToken, reservation } = await createConfirmedOnlineReservation();

      const orderResponse = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          reservationId: reservation._id.toString(),
          idempotencyKey: 'refund-order-key',
        })
        .expect(201);

      const orderId = orderResponse.body.data.razorpay.orderId;
      const paymentId = 'pay_refund_001';

      await request(app)
        .post('/api/v1/payments/verify')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signPayment(orderId, paymentId),
        })
        .expect(200);

      const payment = await Payment.findOne({ razorpayOrderId: orderId });

      await createPasswordAccount({ username: 'super_pay_admin', role: 'SUPER_ADMIN' });
      const adminToken = await loginPharmacyOwner('super_pay_admin');

      await request(app)
        .post(`/api/v1/payments/${payment._id.toString()}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 150, reason: 'Partial goodwill refund' })
        .expect(400);

      const refundResponse = await request(app)
        .post(`/api/v1/payments/${payment._id.toString()}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50, reason: 'Partial refund test', idempotencyKey: 'refund-key-1' })
        .expect(201);

      expect(refundResponse.body.data.refund.amount).toBe(5000);
    });
  });
});
