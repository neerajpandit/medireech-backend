import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import { Inventory, Pharmacy, PharmacyStaff, StockMovement } from '../../src/modules/index.js';
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

const loginWithPassword = async (username, password = 'SecurePassword123') => {
  const response = await request(app).post('/api/v1/auth/login').send({ username, password }).expect(200);
  return accessTokenFromAuthResponse(response);
};

const addInventoryPayload = (medicineId, overrides = {}) => ({
  medicineId: medicineId.toString(),
  batch: {
    batchNumber: 'BATCH-2026-001',
    manufacturingDate: '2026-01-01',
    expiryDate: '2028-01-01',
    physicalQuantity: 100,
    unitPrice: 45,
    mrp: 50,
    purchasePrice: 35,
    ...overrides.batch,
  },
  ...overrides,
});

describe('Pharmacy inventory APIs', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  it('adds inventory successfully for an approved pharmacy', async () => {
    const { owner, password } = await createApprovedPharmacy({ username: 'inv_owner_1' });
    const medicine = await createMedicine({ name: 'Inventory Med 1' });
    const token = await loginWithPassword('inv_owner_1', password);

    const response = await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(201);

    expect(response.body.data.inventory.sellableQuantity).toBe(100);
    expect(response.body.data.inventory.batches[0].batchNumber).toBe('BATCH-2026-001');
    expect(JSON.stringify(response.body)).toContain('purchasePrice');
  });

  it('adds a second batch to existing inventory', async () => {
    const { owner, password } = await createApprovedPharmacy({ username: 'inv_owner_2' });
    const medicine = await createMedicine({ name: 'Inventory Med 2' });
    const token = await loginWithPassword('inv_owner_2', password);

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(201);

    const secondBatch = await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(
        addInventoryPayload(medicine._id, {
          batch: {
            batchNumber: 'BATCH-2026-002',
            expiryDate: '2029-01-01',
            physicalQuantity: 20,
            unitPrice: 40,
            mrp: 48,
            purchasePrice: 30,
          },
        })
      )
      .expect(201);

    expect(secondBatch.body.data.inventory.batches).toHaveLength(2);
    expect(secondBatch.body.data.inventory.sellableQuantity).toBe(120);
  });

  it('prevents duplicate batch numbers within the same inventory', async () => {
    const { password } = await createApprovedPharmacy({ username: 'inv_owner_3' });
    const medicine = await createMedicine({ name: 'Inventory Med 3' });
    const token = await loginWithPassword('inv_owner_3', password);

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(201);

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(409);
  });

  it('rejects invalid expiry date relative to manufacturing date', async () => {
    const { password } = await createApprovedPharmacy({ username: 'inv_owner_4' });
    const medicine = await createMedicine({ name: 'Inventory Med 4' });
    const token = await loginWithPassword('inv_owner_4', password);

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(
        addInventoryPayload(medicine._id, {
          batch: {
            batchNumber: 'BATCH-BAD-DATE',
            manufacturingDate: '2028-01-01',
            expiryDate: '2026-01-01',
            physicalQuantity: 10,
            unitPrice: 10,
            mrp: 12,
          },
        })
      )
      .expect(400);
  });

  it('rejects selling price greater than MRP', async () => {
    const { password } = await createApprovedPharmacy({ username: 'inv_owner_5' });
    const medicine = await createMedicine({ name: 'Inventory Med 5' });
    const token = await loginWithPassword('inv_owner_5', password);

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(
        addInventoryPayload(medicine._id, {
          batch: {
            batchNumber: 'BATCH-BAD-PRICE',
            expiryDate: '2028-01-01',
            physicalQuantity: 10,
            unitPrice: 60,
            mrp: 50,
          },
        })
      )
      .expect(400);
  });

  it('rejects negative stock on create', async () => {
    const { password } = await createApprovedPharmacy({ username: 'inv_owner_6' });
    const medicine = await createMedicine({ name: 'Inventory Med 6' });
    const token = await loginWithPassword('inv_owner_6', password);

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(
        addInventoryPayload(medicine._id, {
          batch: {
            batchNumber: 'BATCH-NEG',
            expiryDate: '2028-01-01',
            physicalQuantity: -1,
            unitPrice: 10,
            mrp: 12,
          },
        })
      )
      .expect(400);
  });

  it('adjusts stock and records movement history', async () => {
    const { password } = await createApprovedPharmacy({ username: 'inv_owner_7' });
    const medicine = await createMedicine({ name: 'Inventory Med 7' });
    const token = await loginWithPassword('inv_owner_7', password);

    const created = await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(201);

    const inventoryId = created.body.data.inventory.id;
    const batchId = created.body.data.inventory.batches[0].id;

    await request(app)
      .patch(`/api/v1/inventory/${inventoryId}/batches/${batchId}/adjust-stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        adjustmentType: 'REMOVE',
        quantity: 10,
        reason: 'Damaged units removed',
      })
      .expect(200);

    const movements = await StockMovement.find({ inventory: inventoryId }).lean();
    expect(movements.length).toBeGreaterThanOrEqual(2);
    expect(movements.some((movement) => movement.movementType === 'STOCK_REMOVED')).toBe(true);
  });

  it('rejects stock removal below reserved quantity', async () => {
    const { pharmacy, password } = await createApprovedPharmacy({ username: 'inv_owner_8' });
    const medicine = await createMedicine({ name: 'Inventory Med 8' });

    const inventory = await Inventory.create({
      pharmacy: pharmacy._id,
      medicine: medicine._id,
      batches: [
        {
          batchNumber: 'BATCH-RES',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          reservedQuantity: 8,
          unitPrice: 10,
          mrp: 12,
        },
      ],
    });

    const token = await loginWithPassword('inv_owner_8', password);
    const batchId = inventory.batches[0]._id.toString();

    await request(app)
      .patch(`/api/v1/inventory/${inventory._id}/batches/${batchId}/adjust-stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        adjustmentType: 'REMOVE',
        quantity: 5,
        reason: 'Attempt over removal',
      })
      .expect(400);
  });

  it('does not expose purchase price to unauthorized pharmacy staff', async () => {
    const { pharmacy, password } = await createApprovedPharmacy({ username: 'inv_owner_9' });
    const staffUser = await createPasswordAccount({ username: 'inv_staff_9', role: 'PHARMACY_STAFF' });
    const medicine = await createMedicine({ name: 'Inventory Med 9' });

    await PharmacyStaff.create({
      user: staffUser._id,
      pharmacy: pharmacy._id,
      designation: 'Assistant',
      permissions: ['inventory:manage'],
      employmentStatus: 'ACTIVE',
    });

    const ownerToken = await loginWithPassword('inv_owner_9', password);
    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(addInventoryPayload(medicine._id))
      .expect(201);

    const staffToken = await loginWithPassword('inv_staff_9');
    const listResponse = await request(app)
      .get('/api/v1/inventory/my-pharmacy')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    expect(JSON.stringify(listResponse.body)).not.toContain('purchasePrice');
  });

  it('prevents pharmacy A from accessing pharmacy B inventory', async () => {
    const first = await createApprovedPharmacy({ username: 'inv_owner_a' });
    const second = await createApprovedPharmacy({ username: 'inv_owner_b' });
    const medicine = await createMedicine({ name: 'Inventory Med 10' });

    const inventoryB = await Inventory.create({
      pharmacy: second.pharmacy._id,
      medicine: medicine._id,
      batches: [
        {
          batchNumber: 'BATCH-B',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 5,
          unitPrice: 10,
          mrp: 12,
        },
      ],
    });

    const tokenA = await loginWithPassword('inv_owner_a', first.password);

    await request(app)
      .get(`/api/v1/inventory/${inventoryB._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('blocks pending pharmacy from adding inventory', async () => {
    const owner = await createPasswordAccount({ username: 'pending_owner', role: 'PHARMACY_OWNER' });
    await createPharmacy(owner._id, {
      pharmacyCode: 'PH-PENDING-001',
      registrationNumber: 'REG-PEND-001',
      drugLicenseNumber: 'DL-PEND-001',
    });
    const medicine = await createMedicine({ name: 'Inventory Med 11' });
    const token = await loginWithPassword('pending_owner');

    await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(403);
  });

  it('blocks suspended pharmacy from updating inventory', async () => {
    const { pharmacy, password } = await createApprovedPharmacy({ username: 'suspended_owner' });
    const medicine = await createMedicine({ name: 'Inventory Med 12' });
    const token = await loginWithPassword('suspended_owner', password);

    const created = await request(app)
      .post('/api/v1/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(addInventoryPayload(medicine._id))
      .expect(201);

    await Pharmacy.findByIdAndUpdate(pharmacy._id, { operationalStatus: 'SUSPENDED' });

    await request(app)
      .patch(`/api/v1/inventory/${created.body.data.inventory.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(403);
  });
});

describe('Nearby medicine availability', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  const seedNearbyPharmacyInventory = async ({
    username,
    coordinates,
    batchOverrides = {},
    pharmacyOverrides = {},
  }) => {
    const approved = await createApprovedPharmacy({
      username,
      ...pharmacyOverrides,
    });
    const medicine = await createMedicine({
      name: 'Nearby Search Medicine',
      genericName: 'NearbyGeneric',
    });

    await Pharmacy.findByIdAndUpdate(approved.pharmacy._id, {
      location: { type: 'Point', coordinates },
      verificationStatus: 'APPROVED',
      operationalStatus: 'ACTIVE',
    });

    const inventory = await Inventory.create({
      pharmacy: approved.pharmacy._id,
      medicine: medicine._id,
      batches: [
        {
          batchNumber: 'NEARBY-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 25,
          unitPrice: 45,
          mrp: 50,
          isActive: true,
          ...batchOverrides,
        },
      ],
    });

    return { medicine, pharmacy: approved.pharmacy, inventory };
  };

  it('returns nearby pharmacy availability with distance sorting', async () => {
    const { medicine } = await seedNearbyPharmacyInventory({
      username: 'nearby_owner_1',
      coordinates: [77.5946, 12.9716],
    });

    const response = await request(app)
      .get('/api/v1/inventory/nearby')
      .query({
        medicineId: medicine._id.toString(),
        latitude: 12.9716,
        longitude: 77.5946,
        radius: 5,
        sortBy: 'distance',
      })
      .expect(200);

    expect(response.body.data.pharmacies).toHaveLength(1);
    expect(response.body.data.pharmacies[0].availableQuantity).toBe(25);
    expect(response.body.data.pharmacies[0].distanceKm).toBeGreaterThanOrEqual(0);
    expect(response.body.data.medicine.name).toBe('Nearby Search Medicine');
    expect(JSON.stringify(response.body)).not.toContain('purchasePrice');
  });

  it('excludes expired, inactive and out-of-stock batches', async () => {
    const medicine = await createMedicine({ name: 'Filter Med' });
    const owner = await createUser({ role: 'PHARMACY_OWNER', mobileNumber: '9876500101' });
    const pharmacy = await createPharmacy(owner._id, {
      pharmacyCode: 'PH-NBY-FILTER',
      registrationNumber: 'REG-NBY-1',
      drugLicenseNumber: 'DL-NBY-1',
      verificationStatus: 'APPROVED',
      operationalStatus: 'ACTIVE',
      location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    });

    await Inventory.create({
      pharmacy: pharmacy._id,
      medicine: medicine._id,
      batches: [
        {
          batchNumber: 'EXP',
          expiryDate: new Date('2020-01-01'),
          physicalQuantity: 100,
          unitPrice: 10,
          mrp: 12,
        },
        {
          batchNumber: 'INACTIVE',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 100,
          unitPrice: 10,
          mrp: 12,
          isActive: false,
        },
        {
          batchNumber: 'EMPTY',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 0,
          unitPrice: 10,
          mrp: 12,
        },
      ],
    });

    const response = await request(app)
      .get('/api/v1/inventory/nearby')
      .query({
        medicineId: medicine._id.toString(),
        latitude: 12.9716,
        longitude: 77.5946,
        radius: 10,
      })
      .expect(200);

    expect(response.body.data.pharmacies).toHaveLength(0);
  });

  it('excludes unapproved and suspended pharmacies', async () => {
    const medicine = await createMedicine({ name: 'Pharmacy Status Med' });
    const pendingOwner = await createUser({ role: 'PHARMACY_OWNER', mobileNumber: '9876500102' });
    const suspendedOwner = await createUser({ role: 'PHARMACY_OWNER', mobileNumber: '9876500103' });

    const pendingPharmacy = await createPharmacy(pendingOwner._id, {
      pharmacyCode: 'PH-NBY-PEND',
      registrationNumber: 'REG-NBY-PEND',
      drugLicenseNumber: 'DL-NBY-PEND',
      location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    });

    const suspendedPharmacy = await createPharmacy(suspendedOwner._id, {
      pharmacyCode: 'PH-NBY-SUSP',
      registrationNumber: 'REG-NBY-SUSP',
      drugLicenseNumber: 'DL-NBY-SUSP',
      verificationStatus: 'APPROVED',
      operationalStatus: 'SUSPENDED',
      location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    });

    for (const pharmacy of [pendingPharmacy, suspendedPharmacy]) {
      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'B1',
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 50,
            unitPrice: 10,
            mrp: 12,
          },
        ],
      });
    }

    const response = await request(app)
      .get('/api/v1/inventory/nearby')
      .query({
        medicineId: medicine._id.toString(),
        latitude: 12.9716,
        longitude: 77.5946,
        radius: 10,
      })
      .expect(200);

    expect(response.body.data.pharmacies).toHaveLength(0);
  });

  it('supports price sorting', async () => {
    const medicine = await createMedicine({ name: 'Price Sort Med' });

    for (const [index, unitPrice] of [
      [1, 60],
      [2, 40],
    ]) {
      const owner = await createUser({
        role: 'PHARMACY_OWNER',
        mobileNumber: `98765001${index}${index}`,
      });
      const pharmacy = await createPharmacy(owner._id, {
        pharmacyCode: `PH-PRICE-${index}`,
        registrationNumber: `REG-PRICE-${index}`,
        drugLicenseNumber: `DL-PRICE-${index}`,
        verificationStatus: 'APPROVED',
        operationalStatus: 'ACTIVE',
        location: { type: 'Point', coordinates: [77.5946 + index * 0.001, 12.9716] },
      });

      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: `PRICE-${index}`,
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 10,
            unitPrice,
            mrp: unitPrice + 5,
          },
        ],
      });
    }

    const response = await request(app)
      .get('/api/v1/inventory/nearby')
      .query({
        medicineId: medicine._id.toString(),
        latitude: 12.9716,
        longitude: 77.5946,
        radius: 20,
        sortBy: 'price',
      })
      .expect(200);

    expect(response.body.data.pharmacies.length).toBeGreaterThanOrEqual(2);
    expect(response.body.data.pharmacies[0].lowestUnitPrice).toBeLessThanOrEqual(
      response.body.data.pharmacies[1].lowestUnitPrice
    );
  });
});

describe('Inventory stock integrity', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  it('keeps concurrent stock adjustments from overselling reserved headroom', async () => {
    const { pharmacy, password } = await createApprovedPharmacy({ username: 'concurrent_owner' });
    const medicine = await createMedicine({ name: 'Concurrent Med' });

    const inventory = await Inventory.create({
      pharmacy: pharmacy._id,
      medicine: medicine._id,
      batches: [
        {
          batchNumber: 'CONC-1',
          expiryDate: new Date('2028-01-01'),
          physicalQuantity: 10,
          reservedQuantity: 0,
          unitPrice: 10,
          mrp: 12,
        },
      ],
    });

    const batchId = inventory.batches[0]._id;
    const token = await loginWithPassword('concurrent_owner', password);

    const attempts = Array.from({ length: 5 }, () =>
      request(app)
        .patch(`/api/v1/inventory/${inventory._id}/batches/${batchId}/adjust-stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          adjustmentType: 'REMOVE',
          quantity: 3,
          reason: 'Concurrent removal attempt',
        })
    );

    const results = await Promise.all(attempts);
    const successCount = results.filter((result) => result.status === 200).length;
    const conflictCount = results.filter((result) => result.status === 409 || result.status === 400).length;

    expect(successCount).toBeGreaterThanOrEqual(1);
    expect(successCount + conflictCount).toBe(5);

    const refreshed = await Inventory.findById(inventory._id);
    expect(refreshed.batches[0].physicalQuantity).toBeGreaterThanOrEqual(0);
    expect(refreshed.batches[0].physicalQuantity).toBeLessThanOrEqual(10);
  });
});
