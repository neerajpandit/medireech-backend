import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import { Inventory, Pharmacy, User } from '../../src/modules/index.js';
import { verifyInventorySellableMatchesSummary } from '../../src/utils/nearbyDiscovery.js';
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

describe('Phase 6 medicine search and discovery', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('Medicine search', () => {
    beforeEach(async () => {
      await createMedicine({
        name: 'Paracetamol 500mg Tablet',
        genericName: 'Paracetamol',
        brandName: 'Calpol',
        composition: 'Paracetamol 500mg',
        dosageForm: 'TABLET',
        prescriptionType: 'OTC',
      });
      await createMedicine({
        name: 'Inactive Search Med',
        dosageForm: 'TABLET',
        prescriptionType: 'OTC',
        isActive: false,
      });
    });

    it('searches by name, generic name, brand name and composition', async () => {
      const byName = await request(app).get('/api/v1/medicines/search').query({ q: 'Paracetamol' }).expect(200);
      expect(byName.body.data.medicines.length).toBeGreaterThanOrEqual(1);

      const byGeneric = await request(app)
        .get('/api/v1/medicines/search')
        .query({ genericName: 'Paracetamol' })
        .expect(200);
      expect(byGeneric.body.data.medicines[0].genericName).toBe('Paracetamol');

      const byBrand = await request(app).get('/api/v1/medicines/search').query({ brandName: 'Calpol' }).expect(200);
      expect(byBrand.body.data.medicines[0].brandName).toBe('Calpol');

      const byComposition = await request(app)
        .get('/api/v1/medicines/search')
        .query({ composition: 'Paracetamol 500mg' })
        .expect(200);
      expect(byComposition.body.data.medicines[0].composition).toContain('Paracetamol');
    });

    it('returns autocomplete suggestions for active medicines only', async () => {
      const response = await request(app).get('/api/v1/medicines/autocomplete').query({ q: 'par' }).expect(200);

      expect(response.body.data.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.suggestions[0]).toMatchObject({
        name: expect.any(String),
        dosageForm: 'TABLET',
      });
      expect(JSON.stringify(response.body)).not.toContain('Inactive Search Med');
    });

    it('paginates search results and rejects invalid autocomplete query', async () => {
      const pageOne = await request(app)
        .get('/api/v1/medicines/search')
        .query({ q: 'Paracetamol', page: 1, limit: 1 })
        .expect(200);

      expect(pageOne.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(pageOne.body.data.medicines).toHaveLength(1);

      await request(app).get('/api/v1/medicines/autocomplete').query({ q: 'p' }).expect(400);
      await request(app).get('/api/v1/medicines/search').query({ page: 1 }).expect(400);
    });
  });

  describe('Nearby pharmacy search', () => {
    it('returns geospatial results with distance, availability and reserved stock deducted', async () => {
      const medicine = await createMedicine({ name: 'Geo Discovery Med' });
      const owner = await createUser({ role: 'PHARMACY_OWNER', mobileNumber: '9876510001' });
      const pharmacy = await createPharmacy(owner._id, {
        pharmacyCode: 'PH-DISC-001',
        registrationNumber: 'REG-DISC-001',
        drugLicenseNumber: 'DL-DISC-001',
        verificationStatus: 'APPROVED',
        operationalStatus: 'ACTIVE',
        location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      });

      const inventory = await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'GEO-1',
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 20,
            reservedQuantity: 5,
            unitPrice: 40,
            mrp: 45,
          },
        ],
      });

      expect(verifyInventorySellableMatchesSummary(inventory)).toBe(true);

      const response = await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
          sortBy: 'distance',
        })
        .expect(200);

      expect(response.body.data.pharmacies[0].availableQuantity).toBe(15);
      expect(response.body.data.pharmacies[0].distanceKm).toBeGreaterThanOrEqual(0);
    });

    it('sorts by availability and recommended ranking', async () => {
      const medicine = await createMedicine({ name: 'Sort Discovery Med' });

      for (const [index, qty] of [
        [1, 10],
        [2, 30],
      ]) {
        const owner = await createUser({
          role: 'PHARMACY_OWNER',
          mobileNumber: `98765100${index}${index}`,
        });
        const pharmacy = await createPharmacy(owner._id, {
          pharmacyCode: `PH-SORT-${index}`,
          registrationNumber: `REG-SORT-${index}`,
          drugLicenseNumber: `DL-SORT-${index}`,
          verificationStatus: 'APPROVED',
          operationalStatus: 'ACTIVE',
          location: { type: 'Point', coordinates: [77.5946 + index * 0.001, 12.9716] },
        });

        await Inventory.create({
          pharmacy: pharmacy._id,
          medicine: medicine._id,
          batches: [
            {
              batchNumber: `SORT-${index}`,
              expiryDate: new Date('2028-01-01'),
              physicalQuantity: qty,
              unitPrice: 20 + index,
              mrp: 30 + index,
            },
          ],
        });
      }

      const availabilitySort = await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 20,
          sortBy: 'availability',
        })
        .expect(200);

      expect(availabilitySort.body.data.pharmacies[0].availableQuantity).toBeGreaterThanOrEqual(
        availabilitySort.body.data.pharmacies[1].availableQuantity
      );

      const recommendedSort = await request(app)
        .get('/api/v1/medicines/' + medicine._id.toString() + '/availability')
        .query({
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 20,
          sortBy: 'recommended',
        })
        .expect(200);

      expect(recommendedSort.body.data.pharmacies.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by radius and price range and excludes pharmacies without inventory', async () => {
      const medicine = await createMedicine({ name: 'Filter Discovery Med' });
      const { pharmacy } = await createApprovedPharmacy({ username: 'disc_owner_1' });

      await Pharmacy.findByIdAndUpdate(pharmacy._id, {
        location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      });

      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'FILTER-1',
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 10,
            unitPrice: 55,
            mrp: 60,
          },
        ],
      });

      const ownerNoInventory = await createUser({ role: 'PHARMACY_OWNER', mobileNumber: '9876510099' });
      await createPharmacy(ownerNoInventory._id, {
        pharmacyCode: 'PH-NO-INV',
        registrationNumber: 'REG-NO-INV',
        drugLicenseNumber: 'DL-NO-INV',
        verificationStatus: 'APPROVED',
        operationalStatus: 'ACTIVE',
        location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      });

      const inRange = await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 2,
          minPrice: 50,
          maxPrice: 60,
        })
        .expect(200);

      expect(inRange.body.data.pharmacies).toHaveLength(1);

      const outOfRange = await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 28.6139,
          longitude: 77.209,
          radiusKm: 1,
        })
        .expect(200);

      expect(outOfRange.body.data.pharmacies).toHaveLength(0);
    });

    it('calculates multi-batch pharmacy availability and lowest price correctly', async () => {
      const medicine = await createMedicine({ name: 'Multi Batch Med' });
      const { pharmacy } = await createApprovedPharmacy({ username: 'multi_batch_owner' });

      await Pharmacy.findByIdAndUpdate(pharmacy._id, {
        location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      });

      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'MB-1',
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 10,
            unitPrice: 50,
            mrp: 55,
          },
          {
            batchNumber: 'MB-2',
            expiryDate: new Date('2029-01-01'),
            physicalQuantity: 5,
            unitPrice: 40,
            mrp: 48,
          },
        ],
      });

      const response = await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
        })
        .expect(200);

      expect(response.body.data.pharmacies[0].availableQuantity).toBe(15);
      expect(response.body.data.pharmacies[0].lowestUnitPrice).toBe(40);
      expect(response.body.data.pharmacies[0].lowestUnitPriceNote).toMatch(/part of the available stock/i);
    });
  });

  describe('Privacy and public pharmacy profile', () => {
    it('never exposes purchase price or owner private information in discovery responses', async () => {
      await createPasswordAccount({ username: 'super_privacy', role: 'SUPER_ADMIN' });
      const medicine = await createMedicine({ name: 'Privacy Med' });
      const { pharmacy, password } = await createApprovedPharmacy({ username: 'privacy_owner' });

      await Pharmacy.findByIdAndUpdate(pharmacy._id, {
        location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      });

      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'PRIV-1',
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 12,
            unitPrice: 30,
            mrp: 35,
            purchasePrice: 20,
          },
        ],
      });

      const nearby = await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
        })
        .expect(200);

      expect(JSON.stringify(nearby.body)).not.toMatch(/purchasePrice|passwordHash|private\/drug-license/i);

      const publicProfile = await request(app).get(`/api/v1/pharmacies/${pharmacy._id}/public`).expect(200);

      expect(publicProfile.body.data.pharmacy.pharmacyName).toBeTruthy();
      expect(JSON.stringify(publicProfile.body)).not.toMatch(
        /verificationDocuments|owner|passwordHash|private\/drug-license|email/i
      );
    });

    it('uses bounded inventory and geo queries without per-pharmacy inventory fetches', async () => {
      const medicine = await createMedicine({ name: 'Perf Med' });
      const { pharmacy } = await createApprovedPharmacy({ username: 'perf_owner' });

      await Pharmacy.findByIdAndUpdate(pharmacy._id, {
        location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      });

      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'PERF-1',
            expiryDate: new Date('2028-01-01'),
            physicalQuantity: 8,
            unitPrice: 22,
            mrp: 25,
          },
        ],
      });

      const inventoryFindSpy = jest.spyOn(Inventory, 'find');
      const aggregateSpy = jest.spyOn(Pharmacy, 'aggregate');

      await request(app)
        .get('/api/v1/inventory/nearby')
        .query({
          medicineId: medicine._id.toString(),
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
        })
        .expect(200);

      expect(aggregateSpy).toHaveBeenCalledTimes(1);
      expect(inventoryFindSpy).toHaveBeenCalledTimes(1);

      inventoryFindSpy.mockRestore();
      aggregateSpy.mockRestore();
    });
  });
});
