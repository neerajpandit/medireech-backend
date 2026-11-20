import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import { RESERVATION_PHARMACY_RESPONSE_SLA_MINUTES } from '../../src/constants/database.enums.js';
import { Inventory, Reservation, StockMovement } from '../../src/modules/index.js';
import { processExpiredPendingReservations } from '../../src/jobs/reservationExpiry.js';
import { accessTokenFromAuthResponse } from '../helpers/authCookies.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createApprovedPharmacy,
  createMedicine,
  createPasswordAccount,
  createPharmacy,
  createUser,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

const loginCustomer = async (mobileNumber = '9876511000') => {
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

const seedInventory = async (pharmacyId, medicine, batches) => {
  return Inventory.create({
    pharmacy: pharmacyId,
    medicine: medicine._id,
    batches,
  });
};

describe('Reservation management', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('Creation', () => {
    it('creates a pending reservation without holding stock', async () => {
      const customerToken = await loginCustomer();
      const { pharmacy } = await createApprovedPharmacy({ username: 'res_owner_1' });
      const medicine = await createMedicine({ name: 'Reservation Med 1' });
      const inventory = await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'RES-B1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 20,
          reservedQuantity: 0,
          unitPrice: 40,
          mrp: 45,
        },
      ]);

      const response = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 2 }],
        })
        .expect(201);

      expect(response.body.data.reservation.status).toBe('PENDING');
      const expiresAt = new Date(response.body.data.reservation.expiresAt);
      const createdAt = new Date(response.body.data.reservation.createdAt);
      expect(expiresAt.getTime() - createdAt.getTime()).toBeCloseTo(
        RESERVATION_PHARMACY_RESPONSE_SLA_MINUTES * 60 * 1000,
        -2
      );

      const refreshed = await Inventory.findById(inventory._id);
      expect(refreshed.batches[0].reservedQuantity).toBe(0);
    });

    it('rejects guest and invalid pharmacy or stock', async () => {
      const customerToken = await loginCustomer('9876511001');
      const medicine = await createMedicine({ name: 'Reservation Med 2' });

      await request(app)
        .post('/api/v1/reservations')
        .send({
          pharmacyId: '507f1f77bcf86cd799439011',
          items: [{ medicineId: medicine._id.toString(), quantity: 1 }],
        })
        .expect(401);

      const owner = await createUser({ role: 'PHARMACY_OWNER', mobileNumber: '9876511002' });
      const pendingPharmacy = await createPharmacy(owner._id, {
        pharmacyCode: 'PH-RES-PEND',
        registrationNumber: 'REG-RES-PEND',
        drugLicenseNumber: 'DL-RES-PEND',
      });

      await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pendingPharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 1 }],
        })
        .expect(403);

      const { pharmacy } = await createApprovedPharmacy({ username: 'res_owner_2' });
      await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'LOW-STOCK',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 1,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 5 }],
        })
        .expect(409);
    });

    it('deduplicates reservation creation using idempotency key', async () => {
      const customerToken = await loginCustomer('9876511003');
      const { pharmacy } = await createApprovedPharmacy({ username: 'res_owner_3' });
      const medicine = await createMedicine({ name: 'Reservation Med 3' });
      await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'IDEM-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const payload = {
        pharmacyId: pharmacy._id.toString(),
        items: [{ medicineId: medicine._id.toString(), quantity: 1 }],
        idempotencyKey: 'idem-key-reservation-001',
      };

      const first = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload)
        .expect(201);

      const second = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload)
        .expect(200);

      expect(second.body.data.reservation.id).toBe(first.body.data.reservation.id);
      expect(await Reservation.countDocuments()).toBe(1);
    });
  });

  describe('Acceptance and FEFO', () => {
    it('accepts reservation with FEFO allocation and records stock movements', async () => {
      const customerToken = await loginCustomer('9876511010');
      const { pharmacy, password } = await createApprovedPharmacy({ username: 'res_accept_owner' });
      const pharmacyToken = await loginPharmacyOwner('res_accept_owner', password);
      const medicine = await createMedicine({ name: 'FEFO Med' });

      await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'BATCH-A',
          expiryDate: new Date('2027-03-01'),
          physicalQuantity: 10,
          unitPrice: 40,
          mrp: 45,
        },
        {
          batchNumber: 'BATCH-B',
          expiryDate: new Date('2027-06-01'),
          physicalQuantity: 20,
          unitPrice: 42,
          mrp: 48,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 15 }],
        })
        .expect(201);

      const reservationId = created.body.data.reservation.id;

      const accepted = await request(app)
        .patch(`/api/v1/reservations/${reservationId}/accept`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ confirmUpdatedPricing: true })
        .expect(200);

      expect(accepted.body.data.reservation.status).toBe('CONFIRMED');
      expect(accepted.body.data.reservation.items[0].batchAllocations).toHaveLength(2);

      const inventory = await Inventory.findOne({ pharmacy: pharmacy._id, medicine: medicine._id });
      expect(inventory.batches[0].reservedQuantity).toBe(10);
      expect(inventory.batches[1].reservedQuantity).toBe(5);

      const movements = await StockMovement.find({ referenceId: reservationId });
      expect(movements.some((movement) => movement.movementType === 'STOCK_RESERVED')).toBe(true);
    });

    it('blocks unauthorized acceptance and expired reservations', async () => {
      const customerToken = await loginCustomer('9876511011');
      const first = await createApprovedPharmacy({ username: 'res_accept_a' });
      const second = await createApprovedPharmacy({ username: 'res_accept_b' });
      const medicine = await createMedicine({ name: 'Accept Guard Med' });

      await seedInventory(first.pharmacy._id, medicine, [
        {
          batchNumber: 'G-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: first.pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 2 }],
        })
        .expect(201);

      const otherOwnerToken = await loginPharmacyOwner('res_accept_b', second.password);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/accept`)
        .set('Authorization', `Bearer ${otherOwnerToken}`)
        .expect(404);

      await createPasswordAccount({ username: 'ops_admin_res', role: 'OPERATIONS_ADMIN' });
      const opsToken = await loginPharmacyOwner('ops_admin_res');

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/accept`)
        .set('Authorization', `Bearer ${opsToken}`)
        .expect(403);

      await Reservation.findByIdAndUpdate(created.body.data.reservation.id, {
        expiresAt: new Date(Date.now() - 60_000),
      });

      const ownerToken = await loginPharmacyOwner('res_accept_a', first.password);
      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/accept`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
    });
  });

  describe('Rejection, cancellation, ready and collection', () => {
    it('rejects pending reservation without inventory changes', async () => {
      const customerToken = await loginCustomer('9876511020');
      const { pharmacy, password } = await createApprovedPharmacy({ username: 'res_reject_owner' });
      const pharmacyToken = await loginPharmacyOwner('res_reject_owner', password);
      const medicine = await createMedicine({ name: 'Reject Med' });
      const inventory = await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'RJ-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 2 }],
        })
        .expect(201);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/reject`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({})
        .expect(400);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/reject`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ reason: 'Out of stock after review' })
        .expect(200);

      const refreshed = await Inventory.findById(inventory._id);
      expect(refreshed.batches[0].reservedQuantity).toBe(0);
    });

    it('cancels confirmed reservation and releases stock once', async () => {
      const customerToken = await loginCustomer('9876511021');
      const { pharmacy, password } = await createApprovedPharmacy({ username: 'res_cancel_owner' });
      const pharmacyToken = await loginPharmacyOwner('res_cancel_owner', password);
      const medicine = await createMedicine({ name: 'Cancel Med' });

      await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'CN-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 3 }],
        })
        .expect(201);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/accept`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ confirmUpdatedPricing: true })
        .expect(200);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Changed plans' })
        .expect(200);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Changed plans again' })
        .expect(200);

      const inventory = await Inventory.findOne({ pharmacy: pharmacy._id, medicine: medicine._id });
      expect(inventory.batches[0].reservedQuantity).toBe(0);

      const releaseMovements = await StockMovement.find({
        movementType: 'STOCK_RELEASED',
        referenceId: created.body.data.reservation.id,
      });
      expect(releaseMovements).toHaveLength(1);
    });

    it('marks ready and collects reservation with stock deduction', async () => {
      const customerToken = await loginCustomer('9876511022');
      const { pharmacy, password } = await createApprovedPharmacy({ username: 'res_collect_owner' });
      const pharmacyToken = await loginPharmacyOwner('res_collect_owner', password);
      const medicine = await createMedicine({ name: 'Collect Med' });

      await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'CL-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 4 }],
        })
        .expect(201);

      const reservationCode = created.body.data.reservation.reservationCode;

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/accept`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ confirmUpdatedPricing: true })
        .expect(200);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/ready`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/collect`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ reservationCode: 'WRONG-CODE' })
        .expect(409);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/collect`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ reservationCode })
        .expect(200);

      await request(app)
        .patch(`/api/v1/reservations/${created.body.data.reservation.id}/collect`)
        .set('Authorization', `Bearer ${pharmacyToken}`)
        .send({ reservationCode })
        .expect(200);

      const inventory = await Inventory.findOne({ pharmacy: pharmacy._id, medicine: medicine._id });
      expect(inventory.batches[0].physicalQuantity).toBe(6);
      expect(inventory.batches[0].reservedQuantity).toBe(0);
    });
  });

  describe('Expiry worker', () => {
    it('expires pending reservations idempotently without touching inventory', async () => {
      const customerToken = await loginCustomer('9876511030');
      const { pharmacy } = await createApprovedPharmacy({ username: 'res_expire_owner' });
      const medicine = await createMedicine({ name: 'Expire Med' });
      const inventory = await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'EX-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 2 }],
        })
        .expect(201);

      await Reservation.findByIdAndUpdate(created.body.data.reservation.id, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const firstRun = await processExpiredPendingReservations();
      const secondRun = await processExpiredPendingReservations();

      expect(firstRun.expiredCount).toBe(1);
      expect(secondRun.expiredCount).toBe(0);

      const reservation = await Reservation.findById(created.body.data.reservation.id);
      expect(reservation.status).toBe('EXPIRED');

      const refreshedInventory = await Inventory.findById(inventory._id);
      expect(refreshedInventory.batches[0].reservedQuantity).toBe(0);
    });
  });

  describe('Concurrency', () => {
    it('prevents double acceptance when two accept requests race', async () => {
      const customerToken = await loginCustomer('9876511040');
      const { pharmacy, password } = await createApprovedPharmacy({ username: 'res_race_owner' });
      const pharmacyToken = await loginPharmacyOwner('res_race_owner', password);
      const medicine = await createMedicine({ name: 'Race Med' });

      await seedInventory(pharmacy._id, medicine, [
        {
          batchNumber: 'RC-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          unitPrice: 10,
          mrp: 12,
        },
      ]);

      const created = await request(app)
        .post('/api/v1/reservations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          pharmacyId: pharmacy._id.toString(),
          items: [{ medicineId: medicine._id.toString(), quantity: 4 }],
        })
        .expect(201);

      const reservationId = created.body.data.reservation.id;

      const attempts = await Promise.all([
        request(app)
          .patch(`/api/v1/reservations/${reservationId}/accept`)
          .set('Authorization', `Bearer ${pharmacyToken}`)
          .send({ confirmUpdatedPricing: true }),
        request(app)
          .patch(`/api/v1/reservations/${reservationId}/accept`)
          .set('Authorization', `Bearer ${pharmacyToken}`)
          .send({ confirmUpdatedPricing: true }),
      ]);

      const successCount = attempts.filter((attempt) => attempt.status === 200).length;
      expect(successCount).toBe(1);

      const inventory = await Inventory.findOne({ pharmacy: pharmacy._id, medicine: medicine._id });
      expect(inventory.batches[0].reservedQuantity).toBe(4);
    });
  });
});
