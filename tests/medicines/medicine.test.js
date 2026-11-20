import request from 'supertest';
import app from '../../src/app.js';
import { Medicine } from '../../src/modules/index.js';
import { accessTokenFromAuthResponse } from '../helpers/authCookies.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createMedicine,
  createPasswordAccount,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

const loginWithPassword = async (username, password = 'SecurePassword123') => {
  const response = await request(app).post('/api/v1/auth/login').send({ username, password }).expect(200);
  return accessTokenFromAuthResponse(response);
};

describe('Medicine catalogue APIs', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  it('creates a medicine as super admin', async () => {
    await createPasswordAccount({ username: 'super_med_admin', role: 'SUPER_ADMIN' });
    const token = await loginWithPassword('super_med_admin');

    const response = await request(app)
      .post('/api/v1/admin/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Paracetamol 500mg Tablet',
        genericName: 'Paracetamol',
        brandName: 'Calpol',
        dosageForm: 'TABLET',
        prescriptionType: 'OTC',
        strength: '500mg',
        packSize: '10 tablets',
      })
      .expect(201);

    expect(response.body.data.medicine.name).toBe('Paracetamol 500mg Tablet');
    expect(response.body.data.medicine.isActive).toBe(true);
  });

  it('rejects unauthorized medicine creation', async () => {
    await createPasswordAccount({ username: 'pharmacy_owner_med', role: 'PHARMACY_OWNER' });
    const token = await loginWithPassword('pharmacy_owner_med');

    await request(app)
      .post('/api/v1/admin/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Blocked Medicine',
        dosageForm: 'TABLET',
        prescriptionType: 'OTC',
      })
      .expect(403);
  });

  it('handles duplicate medicine creation', async () => {
    await createPasswordAccount({ username: 'super_dup', role: 'SUPER_ADMIN' });
    const token = await loginWithPassword('super_dup');

    const payload = {
      name: 'Ibuprofen 400mg Tablet',
      dosageForm: 'TABLET',
      prescriptionType: 'OTC',
      strength: '400mg',
      packSize: '10 tablets',
    };

    await request(app)
      .post('/api/v1/admin/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201);

    const duplicateResponse = await request(app)
      .post('/api/v1/admin/medicines')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(duplicateResponse.status).toBeGreaterThanOrEqual(400);
  });

  it('searches medicines by name, generic name and brand name', async () => {
    await createMedicine({
      name: 'Cetirizine 10mg Tablet',
      genericName: 'Cetirizine',
      brandName: 'Zyrtec',
      strength: '10mg',
      dosageForm: 'TABLET',
    });

    const byName = await request(app)
      .get('/api/v1/medicines/search')
      .query({ search: 'Cetirizine' })
      .expect(200);
    expect(byName.body.data.medicines.length).toBeGreaterThanOrEqual(1);

    const byGeneric = await request(app)
      .get('/api/v1/medicines')
      .query({ genericName: 'Cetirizine' })
      .expect(200);
    expect(byGeneric.body.data.medicines[0].genericName).toBe('Cetirizine');

    const byBrand = await request(app)
      .get('/api/v1/medicines')
      .query({ brandName: 'Zyrtec' })
      .expect(200);
    expect(byBrand.body.data.medicines[0].brandName).toBe('Zyrtec');
  });

  it('excludes inactive medicines from public listing', async () => {
    const active = await createMedicine({ name: 'Active Med A', dosageForm: 'TABLET', prescriptionType: 'OTC' });
    const inactive = await createMedicine({
      name: 'Inactive Med B',
      dosageForm: 'TABLET',
      prescriptionType: 'OTC',
      isActive: false,
    });

    const response = await request(app).get('/api/v1/medicines').expect(200);
    const ids = response.body.data.medicines.map((medicine) => medicine.id);

    expect(ids).toContain(active._id.toString());
    expect(ids).not.toContain(inactive._id.toString());
  });

  it('returns a public medicine by id', async () => {
    const medicine = await createMedicine({ name: 'Public Detail Med', dosageForm: 'SYRUP', prescriptionType: 'OTC' });

    const response = await request(app).get(`/api/v1/medicines/${medicine._id}`).expect(200);
    expect(response.body.data.medicine.name).toBe('Public Detail Med');
  });
});
