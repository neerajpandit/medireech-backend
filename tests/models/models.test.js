import mongoose from 'mongoose';
import { RESERVATION_PHARMACY_RESPONSE_SLA_MINUTES } from '../../src/constants/database.enums.js';
import {
  AuditLog,
  Inventory,
  Medicine,
  Pharmacy,
  PharmacyStaff,
  Prescription,
  Reservation,
  User,
} from '../../src/modules/index.js';
import { computeInventorySellableQuantity } from '../../src/utils/inventoryStock.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createMedicine,
  createPharmacy,
  createUser,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

describe('MediReech Mongoose models', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('User model', () => {
    it('normalizes Indian mobile numbers for customer accounts', async () => {
      const user = await User.create({
        fullName: 'Asha Kumar',
        mobileNumber: '+91 9876543210',
        email: 'Asha@Example.com',
        role: 'CUSTOMER',
      });

      expect(user.mobileNumber).toBe('9876543210');
      expect(user.email).toBe('asha@example.com');
    });

    it('hides password hashes for username-based accounts by default', async () => {
      const user = await createUser({
        role: 'SUPER_ADMIN',
        username: 'super_admin_test',
        plainPassword: 'SecurePassword123',
      });

      const fetched = await User.findById(user._id);
      expect(fetched.passwordHash).toBeUndefined();

      const withSecrets = await User.findById(user._id).select('+passwordHash');
      expect(withSecrets.passwordHash).toEqual(expect.any(String));
    });

    it('rejects customer accounts with username or password fields', async () => {
      await expect(
        User.create({
          fullName: 'Bad Customer',
          mobileNumber: '9876500099',
          role: 'CUSTOMER',
          username: 'customer_user',
        })
      ).rejects.toThrow(/Customer accounts cannot have a username/);
    });

    it('rejects invalid mobile numbers', async () => {
      await expect(
        User.create({
          fullName: 'Invalid Mobile',
          mobileNumber: '12345',
          role: 'CUSTOMER',
        })
      ).rejects.toThrow(/valid 10-digit Indian mobile number/);
    });

    it('enforces unique mobile numbers at the database level', async () => {
      await createUser({ mobileNumber: '9876500011' });

      await expect(createUser({ mobileNumber: '9876500011' })).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('Pharmacy model', () => {
    it('stores GeoJSON points and keeps verification separate from operational status', async () => {
      const owner = await createUser({ mobileNumber: '9876500020', role: 'PHARMACY_OWNER' });
      const pharmacy = await createPharmacy(owner._id, {
        pharmacyCode: 'PH-GEO-001',
        phone: '+919876500021',
      });

      expect(pharmacy.phone).toBe('9876500021');
      expect(pharmacy.location.coordinates).toEqual([77.5946, 12.9716]);
      expect(pharmacy.verificationStatus).toBe('PENDING');
      expect(pharmacy.operationalStatus).toBe('INACTIVE');
    });

    it('rejects invalid coordinates', async () => {
      const owner = await createUser({ mobileNumber: '9876500030', role: 'PHARMACY_OWNER' });

      await expect(
        createPharmacy(owner._id, {
          pharmacyCode: 'PH-BAD-GEO',
          location: {
            type: 'Point',
            coordinates: [200, 95],
          },
        })
      ).rejects.toThrow(/coordinates must be \[longitude, latitude\]/);
    });

    it('registers a 2dsphere index for location queries', async () => {
      const indexes = await Pharmacy.collection.indexes();
      expect(indexes.some((index) => index.key.location === '2dsphere')).toBe(true);
    });
  });

  describe('PharmacyStaff model', () => {
    it('prevents duplicate active memberships for the same user and pharmacy', async () => {
      const owner = await createUser({ mobileNumber: '9876500040', role: 'PHARMACY_OWNER' });
      const staffUser = await createUser({ mobileNumber: '9876500041', role: 'PHARMACY_STAFF' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-STAFF-001' });

      await PharmacyStaff.create({
        user: staffUser._id,
        pharmacy: pharmacy._id,
        designation: 'Pharmacist',
        employmentStatus: 'ACTIVE',
        invitedBy: owner._id,
      });

      await expect(
        PharmacyStaff.create({
          user: staffUser._id,
          pharmacy: pharmacy._id,
          designation: 'Cashier',
          employmentStatus: 'ACTIVE',
          invitedBy: owner._id,
        })
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('Medicine model', () => {
    it('supports catalogue deduplication for active medicines', async () => {
      await createMedicine({
        name: 'Paracetamol 500mg Tablet',
        strength: '500mg',
        dosageForm: 'TABLET',
        packSize: '10 tablets',
      });

      await expect(
        createMedicine({
          name: 'Paracetamol 500mg Tablet',
          strength: '500mg',
          dosageForm: 'TABLET',
          packSize: '10 tablets',
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('registers a text search index', async () => {
      const indexes = await Medicine.collection.indexes();
      const textIndex = indexes.find((index) => index.weights);
      expect(textIndex).toBeDefined();
      expect(textIndex.weights.name).toBeGreaterThan(textIndex.weights.searchKeywords);
    });
  });

  describe('Inventory model', () => {
    it('rejects negative quantities and reserved quantities above physical stock', async () => {
      const owner = await createUser({ mobileNumber: '9876500050', role: 'PHARMACY_OWNER' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-INV-001' });
      const medicine = await createMedicine({
        name: 'Ibuprofen 400mg Tablet',
        strength: '400mg',
        dosageForm: 'TABLET',
        packSize: '10 tablets',
      });

      await expect(
        Inventory.create({
          pharmacy: pharmacy._id,
          medicine: medicine._id,
          batches: [
            {
              batchNumber: 'BATCH-NEG',
              expiryDate: new Date('2030-01-01T00:00:00.000Z'),
              physicalQuantity: -1,
              unitPrice: 10,
              mrp: 12,
            },
          ],
        })
      ).rejects.toThrow(/cannot be negative/);

      await expect(
        Inventory.create({
          pharmacy: pharmacy._id,
          medicine: medicine._id,
          batches: [
            {
              batchNumber: 'BATCH-OVER',
              expiryDate: new Date('2030-01-01T00:00:00.000Z'),
              physicalQuantity: 5,
              reservedQuantity: 6,
              unitPrice: 10,
              mrp: 12,
            },
          ],
        })
      ).rejects.toThrow(/cannot exceed physical quantity/);
    });

    it('enforces one inventory document per pharmacy and medicine pair', async () => {
      const owner = await createUser({ mobileNumber: '9876500051', role: 'PHARMACY_OWNER' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-INV-002' });
      const medicine = await createMedicine({
        name: 'Cetirizine 10mg Tablet',
        strength: '10mg',
        dosageForm: 'TABLET',
        packSize: '10 tablets',
      });

      await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'BATCH-A',
            expiryDate: new Date('2030-06-01T00:00:00.000Z'),
            physicalQuantity: 20,
            unitPrice: 5,
            mrp: 7,
          },
        ],
      });

      await expect(
        Inventory.create({
          pharmacy: pharmacy._id,
          medicine: medicine._id,
          batches: [],
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('computes sellable stock without counting expired batches', async () => {
      const owner = await createUser({ mobileNumber: '9876500052', role: 'PHARMACY_OWNER' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-INV-003' });
      const medicine = await createMedicine({
        name: 'Amoxicillin 250mg Capsule',
        strength: '250mg',
        dosageForm: 'CAPSULE',
        packSize: '10 capsules',
      });

      const inventory = await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'BATCH-ACTIVE',
            expiryDate: new Date('2030-01-01T00:00:00.000Z'),
            physicalQuantity: 10,
            reservedQuantity: 2,
            unitPrice: 20,
            mrp: 25,
            isActive: true,
          },
          {
            batchNumber: 'BATCH-EXPIRED',
            expiryDate: new Date('2020-01-01T00:00:00.000Z'),
            physicalQuantity: 100,
            reservedQuantity: 0,
            unitPrice: 20,
            mrp: 25,
            isActive: true,
          },
        ],
      });

      const sellableQuantity = computeInventorySellableQuantity(
        inventory,
        new Date('2026-01-01T00:00:00.000Z')
      );
      expect(sellableQuantity).toBe(8);
    });
  });

  describe('Reservation model', () => {
    it('requires at least one item and exposes the 15-minute pending expiry helper', async () => {
      const customer = await createUser({ mobileNumber: '9876500060', role: 'CUSTOMER' });
      const owner = await createUser({ mobileNumber: '9876500061', role: 'PHARMACY_OWNER' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-RES-001' });
      const medicine = await createMedicine({
        name: 'Azithromycin 500mg Tablet',
        strength: '500mg',
        dosageForm: 'TABLET',
        packSize: '3 tablets',
      });
      const inventory = await Inventory.create({
        pharmacy: pharmacy._id,
        medicine: medicine._id,
        batches: [
          {
            batchNumber: 'BATCH-R1',
            expiryDate: new Date('2030-01-01T00:00:00.000Z'),
            physicalQuantity: 30,
            unitPrice: 45,
            mrp: 55,
          },
        ],
      });

      const createdAt = new Date('2026-01-01T10:00:00.000Z');
      const expiresAt = Reservation.buildPendingExpiry(createdAt);

      expect(expiresAt.toISOString()).toBe(
        new Date(createdAt.getTime() + RESERVATION_PHARMACY_RESPONSE_SLA_MINUTES * 60 * 1000).toISOString()
      );

      await expect(
        Reservation.create({
          reservationCode: 'RES-NO-ITEMS',
          customer: customer._id,
          pharmacy: pharmacy._id,
          items: [],
          expiresAt,
        })
      ).rejects.toThrow(/At least one reservation item is required/);

      const reservation = await Reservation.create({
        reservationCode: 'RES-001',
        customer: customer._id,
        pharmacy: pharmacy._id,
        items: [
          {
            medicine: medicine._id,
            inventory: inventory._id,
            medicineName: medicine.name,
            dosageForm: medicine.dosageForm,
            quantity: 2,
            unitPrice: 45,
            mrpAtRequest: 55,
          },
        ],
        expiresAt,
        statusHistory: [
          {
            status: 'PENDING',
            changedBy: customer._id,
          },
        ],
      });

      expect(reservation.status).toBe('PENDING');
      expect(reservation.items).toHaveLength(1);
    });
  });

  describe('Prescription model', () => {
    it('stores private file references without returning URLs by default', async () => {
      const customer = await createUser({ mobileNumber: '9876500070', role: 'CUSTOMER' });

      const prescription = await Prescription.create({
        customer: customer._id,
        fileKey: 'prescriptions/customer-1/file.pdf',
        fileUrl: 'https://private-storage.example/prescriptions/customer-1/file.pdf',
        fileType: 'application/pdf',
      });

      const fetched = await Prescription.findById(prescription._id);
      expect(fetched.fileKey).toBeUndefined();
      expect(fetched.fileUrl).toBeUndefined();

      const withPrivateFields = await Prescription.findById(prescription._id).select('+fileKey +fileUrl');
      expect(withPrivateFields.fileKey).toBe('prescriptions/customer-1/file.pdf');
    });
  });

  describe('AuditLog model', () => {
    it('creates append-only audit records with indexed actor and resource fields', async () => {
      const actor = await createUser({ mobileNumber: '9876500080', role: 'SUPER_ADMIN' });
      const owner = await createUser({ mobileNumber: '9876500081', role: 'PHARMACY_OWNER' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-AUD-001' });

      const auditLog = await AuditLog.create({
        actor: actor._id,
        action: 'PHARMACY_APPROVED',
        resourceType: 'Pharmacy',
        resourceId: pharmacy._id,
        pharmacy: pharmacy._id,
        newValues: {
          verificationStatus: 'APPROVED',
        },
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });

      expect(auditLog.createdAt).toBeInstanceOf(Date);
      expect(auditLog.updatedAt).toBeUndefined();

      const indexes = await AuditLog.collection.indexes();
      expect(indexes.some((index) => index.name === 'audit_actor_created')).toBe(true);
      expect(indexes.some((index) => index.name === 'audit_resource_created')).toBe(true);
    });
  });
});
