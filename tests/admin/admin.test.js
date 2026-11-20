import request from 'supertest';
import app from '../../src/app.js';
import { PAYMENT_STATUS } from '../../src/constants/payment.constants.js';
import { PLATFORM_AUDIT_ACTIONS } from '../../src/constants/platform.constants.js';
import { AuditLog, Payment, User, UserSession } from '../../src/modules/index.js';
import { accessTokenFromAuthResponse } from '../helpers/authCookies.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createApprovedPharmacy,
  createPasswordAccount,
  createUser,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

const loginWithUsername = async (username, password = 'SecurePassword123') => {
  const response = await request(app).post('/api/v1/auth/login').send({ username, password }).expect(200);
  return accessTokenFromAuthResponse(response);
};

describe('Admin platform (Phase 10)', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  it('returns dashboard overview with captured revenue excluding pending payments', async () => {
    await createPasswordAccount({ username: 'super_dash', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_dash');

    const customer = await createUser({ mobileNumber: '9876530001' });
    const { pharmacy } = await createApprovedPharmacy({ username: 'dash_pharm_owner' });

    await Payment.create([
      {
        paymentCode: 'PAY-DASH-001',
        reservation: '507f1f77bcf86cd799439011',
        customer: customer._id,
        pharmacy: pharmacy._id,
        paymentMethod: 'ONLINE',
        provider: 'RAZORPAY',
        amount: 5000,
        status: PAYMENT_STATUS.CAPTURED,
        capturedAt: new Date(),
        idempotencyKey: 'dash-payment-001',
      },
      {
        paymentCode: 'PAY-DASH-002',
        reservation: '507f1f77bcf86cd799439012',
        customer: customer._id,
        pharmacy: pharmacy._id,
        paymentMethod: 'ONLINE',
        provider: 'RAZORPAY',
        amount: 3000,
        status: PAYMENT_STATUS.PENDING,
        idempotencyKey: 'dash-payment-002',
      },
    ]);

    const response = await request(app)
      .get('/api/v1/admin/dashboard/overview')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);

    expect(response.body.data.customers.totalCustomers).toBeGreaterThanOrEqual(1);
    expect(response.body.data.payments.successfulPayments).toBe(1);
    expect(response.body.data.payments.totalCapturedAmountPaise).toBe(5000);
    expect(response.body.data.payments.pendingPayments).toBeGreaterThanOrEqual(1);
  });

  it('lists, blocks, and unblocks customers with session revocation', async () => {
    await createPasswordAccount({ username: 'super_customer_admin', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_customer_admin');

    const customer = await createUser({ mobileNumber: '9876530002' });
    await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber: '9876530002' }).expect(200);
    await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ mobileNumber: '9876530002', otp: '123456' })
      .expect(200);

    const sessionsBefore = await UserSession.countDocuments({ user: customer._id, isRevoked: false });
    expect(sessionsBefore).toBeGreaterThan(0);

    await request(app)
      .patch(`/api/v1/admin/customers/${customer._id.toString()}/block`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ reason: 'Policy violation in test scenario' })
      .expect(200);

    const sessionsAfterBlock = await UserSession.countDocuments({ user: customer._id, isRevoked: false });
    expect(sessionsAfterBlock).toBe(0);

    const audit = await AuditLog.findOne({ action: PLATFORM_AUDIT_ACTIONS.CUSTOMER_BLOCKED });
    expect(audit).toBeTruthy();

    await request(app)
      .patch(`/api/v1/admin/customers/${customer._id.toString()}/unblock`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ reason: 'Issue resolved' })
      .expect(200);
  });

  it('prevents Operations Admin from suspending pharmacies', async () => {
    await createPasswordAccount({ username: 'super_pharm_admin', role: 'SUPER_ADMIN' });
    await createPasswordAccount({ username: 'ops_pharm_admin', role: 'OPERATIONS_ADMIN' });
    const opsToken = await loginWithUsername('ops_pharm_admin');
    const { pharmacy } = await createApprovedPharmacy({ username: 'suspend_target_owner' });

    await request(app)
      .patch(`/api/v1/admin/pharmacies/${pharmacy._id.toString()}/suspend`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ reason: 'Should not be allowed' })
      .expect(403);
  });

  it('allows Super Admin to manage Operations Admin accounts', async () => {
    await createPasswordAccount({ username: 'super_ops_mgr', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_ops_mgr');

    const createResponse = await request(app)
      .post('/api/v1/admin/operations-admins')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        fullName: 'Ops Admin One',
        username: 'ops_admin_one',
        password: 'SecurePassword123',
        permissions: ['platform:dashboard:read', 'customer:read:platform'],
      })
      .expect(201);

    expect(createResponse.body.data.admin.username).toBe('ops_admin_one');

    await request(app)
      .post('/api/v1/admin/operations-admins')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        fullName: 'Ops Admin Duplicate',
        username: 'ops_admin_one',
        password: 'SecurePassword123',
      })
      .expect(409);

    const adminId = createResponse.body.data.admin.id;

    await request(app)
      .patch(`/api/v1/admin/operations-admins/${adminId}/permissions`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ permissions: ['platform:dashboard:read', 'audit:read'] })
      .expect(200);

    const opsToken = await loginWithUsername('ops_admin_one');
    await request(app)
      .patch(`/api/v1/admin/operations-admins/${adminId}/permissions`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ permissions: ['platform:admin:full'] })
      .expect(403);
  });

  it('rejects unauthorized dashboard access', async () => {
    await request(app).get('/api/v1/admin/dashboard/overview').expect(401);
  });
});
