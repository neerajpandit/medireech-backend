import request from 'supertest';
import app from '../../src/app.js';
import { User, Pharmacy } from '../../src/modules/index.js';
import { accessTokenFromAuthResponse } from '../helpers/authCookies.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createPasswordAccount,
  createUser,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

const buildRegistrationPayload = (overrides = {}) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    owner: {
      fullName: 'Ravi Pharmacy Owner',
      username: `owner_${suffix}`,
      password: 'SecurePassword123',
      mobileNumber: `98765${String(suffix).slice(-5).padStart(5, '1')}`,
      email: `owner_${suffix}@example.com`,
    },
    pharmacy: {
      pharmacyName: 'City Care Pharmacy',
      registrationNumber: `REG-${suffix}`,
      drugLicenseNumber: `DL-${suffix}`,
      gstNumber: '29ABCDE1234F1Z5',
      phone: `98765${String(Number(suffix) + 1).slice(-5).padStart(5, '2')}`,
      email: `pharmacy_${suffix}@example.com`,
      address: {
        addressLine: '21 Park Street',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      location: {
        longitude: 77.5946,
        latitude: 12.9716,
      },
      openingHours: [
        {
          dayOfWeek: 1,
          opensAt: '09:00',
          closesAt: '21:00',
          isClosed: false,
        },
      ],
    },
    verificationDocuments: {
      drugLicenseDocument: {
        fileKey: `private/drug-license/${suffix}.pdf`,
        fileType: 'application/pdf',
      },
      ownerIdentityDocument: {
        fileKey: `private/owner-id/${suffix}.pdf`,
        fileType: 'application/pdf',
      },
    },
    ...overrides,
  };
};

const loginWithPassword = async (username, password = 'SecurePassword123') => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);

  return accessTokenFromAuthResponse(response);
};

describe('Pharmacy registration and verification', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('Registration', () => {
    it('registers a pharmacy application successfully', async () => {
      const payload = buildRegistrationPayload();

      const response = await request(app).post('/api/v1/pharmacies/register').send(payload).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.application.verificationStatus).toBe('PENDING');
      expect(response.body.data.application.operationalStatus).toBe('INACTIVE');
      expect(response.body.data.application.owner.role).toBe('PHARMACY_OWNER');
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|"password":/i);
      expect(JSON.stringify(response.body)).not.toMatch(/private\/drug-license/);
    });

    it('rejects duplicate username, mobile number, and drug licence', async () => {
      const payload = buildRegistrationPayload();
      await request(app).post('/api/v1/pharmacies/register').send(payload).expect(201);

      await request(app)
        .post('/api/v1/pharmacies/register')
        .send(
          buildRegistrationPayload({
            owner: {
              ...payload.owner,
              mobileNumber: '9999900001',
              email: 'other@example.com',
            },
            pharmacy: {
              ...payload.pharmacy,
              registrationNumber: 'REG-OTHER-001',
              drugLicenseNumber: 'DL-OTHER-001',
              phone: '9999900002',
              email: 'other-pharmacy@example.com',
            },
          })
        )
        .expect(409);

      await request(app)
        .post('/api/v1/pharmacies/register')
        .send(
          buildRegistrationPayload({
            owner: {
              ...payload.owner,
              username: 'unique_username_001',
            },
          })
        )
        .expect(409);

      await request(app)
        .post('/api/v1/pharmacies/register')
        .send(
          buildRegistrationPayload({
            owner: {
              ...payload.owner,
              username: 'unique_username_002',
              mobileNumber: '9999900003',
            },
            pharmacy: {
              ...payload.pharmacy,
              drugLicenseNumber: payload.pharmacy.drugLicenseNumber,
              registrationNumber: 'REG-OTHER-002',
              phone: '9999900004',
              email: 'other2@example.com',
            },
          })
        )
        .expect(409);
    });

    it('rejects invalid coordinates and incomplete document objects', async () => {
      const invalidCoordinates = buildRegistrationPayload({
        pharmacy: {
          ...buildRegistrationPayload().pharmacy,
          location: { longitude: 200, latitude: 95 },
        },
      });

      await request(app).post('/api/v1/pharmacies/register').send(invalidCoordinates).expect(400);

      const missingDocuments = buildRegistrationPayload();
      delete missingDocuments.verificationDocuments.drugLicenseDocument;

      await request(app).post('/api/v1/pharmacies/register').send(missingDocuments).expect(400);
    });

    it('registers a pharmacy application without verification documents', async () => {
      const payload = buildRegistrationPayload();
      delete payload.verificationDocuments;

      const response = await request(app).post('/api/v1/pharmacies/register').send(payload).expect(201);

      expect(response.body.data.application.verificationStatus).toBe('PENDING');
      expect(response.body.data.application.documents).toEqual([]);
    });

    it('rejects owner role manipulation in registration payload', async () => {
      const payload = buildRegistrationPayload({
        owner: {
          ...buildRegistrationPayload().owner,
          role: 'SUPER_ADMIN',
        },
      });

      await request(app).post('/api/v1/pharmacies/register').send(payload).expect(400);
    });

    it('does not leave partial registration data when duplicate username is detected', async () => {
      const payload = buildRegistrationPayload();
      await request(app).post('/api/v1/pharmacies/register').send(payload).expect(201);

      const usersBefore = await User.countDocuments();
      const pharmaciesBefore = await Pharmacy.countDocuments();

      await request(app)
        .post('/api/v1/pharmacies/register')
        .send(
          buildRegistrationPayload({
            owner: payload.owner,
            pharmacy: {
              ...buildRegistrationPayload().pharmacy,
              registrationNumber: 'REG-PARTIAL-001',
              drugLicenseNumber: 'DL-PARTIAL-001',
            },
          })
        )
        .expect(409);

      expect(await User.countDocuments()).toBe(usersBefore);
      expect(await Pharmacy.countDocuments()).toBe(pharmaciesBefore);
    });
  });

  describe('Verification and access control', () => {
    const registerAndLoginOwner = async () => {
      const payload = buildRegistrationPayload();
      const registerResponse = await request(app)
        .post('/api/v1/pharmacies/register')
        .send(payload)
        .expect(201);

      const token = await loginWithPassword(payload.owner.username);
      return { payload, registerResponse, ownerToken: token };
    };

    it('allows Super Admin approval, rejection, and document requests while preserving history', async () => {
      const { registerResponse, ownerToken } = await registerAndLoginOwner();
      const pharmacyId = registerResponse.body.data.application.id;

      await createPasswordAccount({ username: 'super_admin_phase4', role: 'SUPER_ADMIN' });
      const superAdminToken = await loginWithPassword('super_admin_phase4');

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/request-documents`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          reason: 'Please upload a clearer drug licence document',
          requiredDocuments: ['drugLicenseDocument'],
        })
        .expect(200);

      const resubmitResponse = await request(app)
        .patch('/api/v1/pharmacies/my-application/resubmit')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          note: 'Resubmitting updated drug licence reference',
          verificationDocuments: {
            drugLicenseDocument: {
              fileKey: 'private/drug-license/updated.pdf',
              fileType: 'application/pdf',
            },
            ownerIdentityDocument: {
              fileKey: 'private/owner-id/original.pdf',
              fileType: 'application/pdf',
            },
          },
        })
        .expect(200);

      expect(resubmitResponse.body.data.application.verificationStatus).toBe('PENDING');
      expect(resubmitResponse.body.data.application.applicationTimeline.length).toBeGreaterThan(1);

      const approveResponse = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ note: 'Approved after resubmission' })
        .expect(200);

      expect(approveResponse.body.data.application.verificationStatus).toBe('APPROVED');
      expect(approveResponse.body.data.application.operationalStatus).toBe('ACTIVE');
      expect(approveResponse.body.data.application.applicationTimeline.length).toBeGreaterThan(2);

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Too late to reject after approval' })
        .expect(409);
    });

    it('blocks Operations Admin from approve/reject/suspend actions', async () => {
      const { registerResponse } = await registerAndLoginOwner();
      const pharmacyId = registerResponse.body.data.application.id;

      await createPasswordAccount({ username: 'operations_admin_phase4', role: 'OPERATIONS_ADMIN' });
      const operationsToken = await loginWithPassword('operations_admin_phase4');

      await request(app)
        .get('/api/v1/admin/pharmacies/applications')
        .set('Authorization', `Bearer ${operationsToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/approve`)
        .set('Authorization', `Bearer ${operationsToken}`)
        .expect(403);

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/reject`)
        .set('Authorization', `Bearer ${operationsToken}`)
        .send({ reason: 'Should not be allowed' })
        .expect(403);

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/suspend`)
        .set('Authorization', `Bearer ${operationsToken}`)
        .send({ reason: 'Should not be allowed' })
        .expect(403);
    });

    it('blocks customers from admin endpoints and prevents cross-owner access', async () => {
      const first = await registerAndLoginOwner();
      const second = await registerAndLoginOwner();

      await createUser({ mobileNumber: '9876510100', role: 'CUSTOMER' });
      await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber: '9876510100' });
      const customerLogin = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ mobileNumber: '9876510100', otp: '123456' })
        .expect(200);
      const customerToken = accessTokenFromAuthResponse(customerLogin);

      await request(app)
        .get('/api/v1/admin/pharmacies/applications')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);

      await request(app)
        .get(`/api/v1/admin/pharmacies/applications/${first.registerResponse.body.data.application.id}`)
        .set('Authorization', `Bearer ${second.ownerToken}`)
        .expect(403);
    });

    it('enforces operational restrictions for pending, rejected, and suspended pharmacies', async () => {
      const { registerResponse, ownerToken, payload } = await registerAndLoginOwner();
      const pharmacyId = registerResponse.body.data.application.id;

      await request(app)
        .post('/api/v1/pharmacies/operational/probe')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      await createPasswordAccount({ username: 'super_admin_ops', role: 'SUPER_ADMIN' });
      const superAdminToken = await loginWithPassword('super_admin_ops');

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ note: 'Approved for operational probe' })
        .expect(200);

      await request(app)
        .post('/api/v1/pharmacies/operational/probe')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Compliance review in progress' })
        .expect(200);

      await request(app)
        .post('/api/v1/pharmacies/operational/probe')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      const rejectedPayload = buildRegistrationPayload();
      const rejectedRegister = await request(app)
        .post('/api/v1/pharmacies/register')
        .send(rejectedPayload)
        .expect(201);
      const rejectedOwnerToken = await loginWithPassword(rejectedPayload.owner.username);

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${rejectedRegister.body.data.application.id}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Invalid drug licence document' })
        .expect(200);

      await request(app)
        .post('/api/v1/pharmacies/operational/probe')
        .set('Authorization', `Bearer ${rejectedOwnerToken}`)
        .expect(403);

      expect(payload.owner.username).not.toBe(rejectedPayload.owner.username);
    });
  });
});
