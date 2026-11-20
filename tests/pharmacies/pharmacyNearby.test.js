import request from 'supertest';
import app from '../../src/app.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createPharmacy,
  createUser,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

const seedPharmacy = async ({
  suffix,
  mobileNumber,
  coordinates,
  pharmacyName,
  verificationStatus = 'APPROVED',
  operationalStatus = 'ACTIVE',
  acceptsReservations = true,
}) => {
  const owner = await createUser({
    role: 'PHARMACY_OWNER',
    mobileNumber,
  });

  return createPharmacy(owner._id, {
    pharmacyCode: `PH-NBY-${suffix}`,
    registrationNumber: `REG-NBY-${suffix}`,
    drugLicenseNumber: `DL-NBY-${suffix}`,
    gstNumber: '29ABCDE1234F1Z5',
    pharmacyName: pharmacyName || `Nearby Pharmacy ${suffix}`,
    verificationStatus,
    operationalStatus,
    acceptsReservations,
    location: { type: 'Point', coordinates },
  });
};

describe('GET /api/v1/pharmacies/nearby', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  it('returns nearby approved active pharmacies for valid coordinates without authentication', async () => {
    await seedPharmacy({
      suffix: '001',
      mobileNumber: '9876512001',
      coordinates: [77.5946, 12.9716],
    });

    const response = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946 })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Nearby pharmacies fetched successfully');
    expect(response.body.data.pharmacies).toHaveLength(1);
    expect(response.body.data.pharmacies[0].distanceKm).toBeGreaterThanOrEqual(0);
    expect(response.body.meta.page).toBe(1);
    expect(response.body.meta.limit).toBe(20);
    expect(response.body.meta.total).toBe(1);
  });

  it('rejects missing coordinates', async () => {
    const response = await request(app).get('/api/v1/pharmacies/nearby').query({ latitude: 12.9716 }).expect(400);

    expect(response.body.success).toBe(false);
  });

  it('rejects invalid coordinates', async () => {
    await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 120, longitude: 77.5946 })
      .expect(400);

    await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 200 })
      .expect(400);
  });

  it('uses default radius and supports maximum radius', async () => {
    await seedPharmacy({
      suffix: '002',
      mobileNumber: '9876512002',
      coordinates: [77.5946, 12.9716],
    });

    const defaultRadius = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946 })
      .expect(200);

    expect(defaultRadius.body.data.pharmacies).toHaveLength(1);

    await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946, radiusKm: 101 })
      .expect(400);

    const maxRadius = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946, radiusKm: 100 })
      .expect(200);

    expect(maxRadius.body.data.pharmacies).toHaveLength(1);
  });

  it('paginates results', async () => {
    await seedPharmacy({
      suffix: '003',
      mobileNumber: '9876512003',
      coordinates: [77.5946, 12.9716],
      pharmacyName: 'Alpha Pharmacy',
    });
    await seedPharmacy({
      suffix: '004',
      mobileNumber: '9876512004',
      coordinates: [77.5956, 12.9726],
      pharmacyName: 'Beta Pharmacy',
    });

    const pageOne = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946, limit: 1, page: 1 })
      .expect(200);

    expect(pageOne.body.data.pharmacies).toHaveLength(1);
    expect(pageOne.body.meta.total).toBe(2);
    expect(pageOne.body.meta.totalPages).toBe(2);

    const pageTwo = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946, limit: 1, page: 2 })
      .expect(200);

    expect(pageTwo.body.data.pharmacies).toHaveLength(1);
    expect(pageOne.body.data.pharmacies[0].pharmacyId).not.toBe(
      pageTwo.body.data.pharmacies[0].pharmacyId
    );
  });

  it('sorts by distance and by name', async () => {
    const near = await seedPharmacy({
      suffix: '005',
      mobileNumber: '9876512005',
      coordinates: [77.5946, 12.9716],
      pharmacyName: 'Zulu Pharmacy',
    });
    const far = await seedPharmacy({
      suffix: '006',
      mobileNumber: '9876512006',
      coordinates: [77.7046, 13.0716],
      pharmacyName: 'Alpha Pharmacy',
    });

    const byDistance = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946, sortBy: 'distance', radiusKm: 50 })
      .expect(200);

    expect(byDistance.body.data.pharmacies[0].pharmacyId).toBe(near._id.toString());
    expect(byDistance.body.data.pharmacies[1].pharmacyId).toBe(far._id.toString());

    const byName = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946, sortBy: 'name', radiusKm: 50 })
      .expect(200);

    expect(byName.body.data.pharmacies[0].pharmacyName).toBe('Alpha Pharmacy');
    expect(byName.body.data.pharmacies[1].pharmacyName).toBe('Zulu Pharmacy');
  });

  it('excludes unapproved, inactive, and suspended pharmacies', async () => {
    await seedPharmacy({
      suffix: '007',
      mobileNumber: '9876512007',
      coordinates: [77.5946, 12.9716],
      verificationStatus: 'PENDING',
    });
    await seedPharmacy({
      suffix: '008',
      mobileNumber: '9876512008',
      coordinates: [77.5946, 12.9716],
      operationalStatus: 'INACTIVE',
    });
    await seedPharmacy({
      suffix: '009',
      mobileNumber: '9876512009',
      coordinates: [77.5946, 12.9716],
      operationalStatus: 'SUSPENDED',
    });
    await seedPharmacy({
      suffix: '010',
      mobileNumber: '9876512010',
      coordinates: [77.5946, 12.9716],
      verificationStatus: 'APPROVED',
      operationalStatus: 'ACTIVE',
    });

    const response = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946 })
      .expect(200);

    expect(response.body.data.pharmacies).toHaveLength(1);
    expect(response.body.data.pharmacies[0].verificationStatus).toBe('APPROVED');
    expect(response.body.data.pharmacies[0].operationalStatus).toBe('ACTIVE');
  });

  it('returns empty results when no pharmacies are within radius', async () => {
    await seedPharmacy({
      suffix: '011',
      mobileNumber: '9876512011',
      coordinates: [77.5946, 12.9716],
    });

    const response = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 28.6139, longitude: 77.209, radiusKm: 1 })
      .expect(200);

    expect(response.body.data.pharmacies).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  it('does not expose sensitive pharmacy fields', async () => {
    const pharmacy = await seedPharmacy({
      suffix: '012',
      mobileNumber: '9876512012',
      coordinates: [77.5946, 12.9716],
    });

    const response = await request(app)
      .get('/api/v1/pharmacies/nearby')
      .query({ latitude: 12.9716, longitude: 77.5946 })
      .expect(200);

    const payload = JSON.stringify(response.body);
    expect(payload).not.toMatch(/drugLicense|registrationNumber|gstNumber|owner|verificationDocuments|private\//i);
    expect(response.body.data.pharmacies[0]).toMatchObject({
      pharmacyId: pharmacy._id.toString(),
      acceptsReservations: true,
      location: {
        latitude: 12.9716,
        longitude: 77.5946,
      },
    });
  });

  it('returns acceptsReservations on public pharmacy profile', async () => {
    const pharmacy = await seedPharmacy({
      suffix: '013',
      mobileNumber: '9876512013',
      coordinates: [77.5946, 12.9716],
      acceptsReservations: false,
    });

    const response = await request(app)
      .get(`/api/v1/pharmacies/${pharmacy._id.toString()}/public`)
      .expect(200);

    expect(response.body.data.pharmacy.acceptsReservations).toBe(false);
  });
});
