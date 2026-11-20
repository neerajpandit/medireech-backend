import request from 'supertest';
import app from '../../src/app.js';
import { User } from '../../src/modules/index.js';
import { PharmacyStaff } from '../../src/modules/pharmacy-staff/pharmacyStaff.model.js';
import { AUTH_COOKIES } from '../../src/constants/auth.constants.js';
import { accessTokenFromAuthResponse, getCookieValue } from '../helpers/authCookies.js';
import {
  clearMemoryDb,
  connectMemoryDb,
  createPasswordAccount,
  createPharmacy,
  createUser,
  disconnectMemoryDb,
} from '../helpers/memoryDb.js';

describe('Authentication', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  describe('Customer OTP authentication', () => {
    it('logs in an existing customer and a new customer using OTP', async () => {
      await createUser({ mobileNumber: '9876500100', role: 'CUSTOMER' });

      const existingCustomerResponse = await request(app)
        .post('/api/v1/auth/customer/send-otp')
        .send({ mobileNumber: '+919876500100' })
        .expect(200);

      expect(existingCustomerResponse.body.success).toBe(true);

      const existingLogin = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ mobileNumber: '+919876500100', otp: '123456' })
        .expect(200);

      expect(existingLogin.body.data.user.role).toBe('CUSTOMER');
      expect(existingLogin.body.data.tokens).toBeUndefined();
      expect(getCookieValue(existingLogin, AUTH_COOKIES.ACCESS)).toEqual(expect.any(String));
      expect(getCookieValue(existingLogin, AUTH_COOKIES.REFRESH)).toEqual(expect.any(String));

      await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber: '9876500101' }).expect(200);

      const newCustomerLogin = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ mobileNumber: '9876500101', otp: '123456' })
        .expect(200);

      expect(newCustomerLogin.body.data.user.role).toBe('CUSTOMER');
      expect(newCustomerLogin.body.data.user.mobileNumber).toBe('9876500101');
    });

    it('fails OTP verification for invalid codes', async () => {
      await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber: '9876500102' }).expect(200);

      const response = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ mobileNumber: '9876500102', otp: '000000' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid OTP');
    });

    it('rejects OTP login for non-customer mobile numbers', async () => {
      await createPasswordAccount({
        username: 'pharmacy_owner_otp',
        role: 'PHARMACY_OWNER',
        mobileNumber: '9876500103',
      });

      const response = await request(app)
        .post('/api/v1/auth/customer/send-otp')
        .send({ mobileNumber: '9876500103' })
        .expect(403);

      expect(response.body.message).toMatch(/non-customer account/i);
    });

    it('rejects blocked customers during OTP verification', async () => {
      await createUser({
        mobileNumber: '9876500105',
        role: 'CUSTOMER',
        accountStatus: 'BLOCKED',
      });

      await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber: '9876500105' }).expect(200);

      const response = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({ mobileNumber: '9876500105', otp: '123456' })
        .expect(403);

      expect(response.body.message).toBe('Account is blocked');
    });

    it('rejects customer OTP requests that attempt to choose a role', async () => {
      const response = await request(app)
        .post('/api/v1/auth/customer/verify-otp')
        .send({
          mobileNumber: '9876500104',
          otp: '123456',
          role: 'SUPER_ADMIN',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('Username and password authentication', () => {
    it('does not allow customers to authenticate through the password login endpoint', async () => {
      await createUser({ mobileNumber: '9876500106', role: 'CUSTOMER' });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: '9876500106', password: 'SecurePassword123' })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('logs in pharmacy owner, pharmacy staff, super admin, and operations admin accounts', async () => {
      await createPasswordAccount({
        username: 'pharmacy_owner',
        role: 'PHARMACY_OWNER',
      });

      const ownerResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'pharmacy_owner', password: 'SecurePassword123' })
        .expect(200);

      expect(ownerResponse.body.data.user.role).toBe('PHARMACY_OWNER');
      expect(ownerResponse.body.data.tokens).toBeUndefined();
      expect(getCookieValue(ownerResponse, AUTH_COOKIES.ACCESS)).toEqual(expect.any(String));
      expect(getCookieValue(ownerResponse, AUTH_COOKIES.REFRESH)).toEqual(expect.any(String));

      const staffUser = await createPasswordAccount({
        username: 'pharmacy_staff',
        role: 'PHARMACY_STAFF',
      });
      const owner = await User.findOne({ username: 'pharmacy_owner' });
      const pharmacy = await createPharmacy(owner._id, { pharmacyCode: 'PH-STAFF-AUTH' });

      await PharmacyStaff.create({
        user: staffUser._id,
        pharmacy: pharmacy._id,
        designation: 'Pharmacist',
        employmentStatus: 'ACTIVE',
        invitedBy: owner._id,
      });

      const staffResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'pharmacy_staff', password: 'SecurePassword123' })
        .expect(200);

      expect(staffResponse.body.data.user.role).toBe('PHARMACY_STAFF');

      await createPasswordAccount({
        username: 'super_admin',
        role: 'SUPER_ADMIN',
      });

      const superAdminResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'super_admin', password: 'SecurePassword123' })
        .expect(200);

      expect(superAdminResponse.body.data.user.role).toBe('SUPER_ADMIN');

      await createPasswordAccount({
        username: 'operations_admin',
        role: 'OPERATIONS_ADMIN',
      });

      const operationsResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'operations_admin', password: 'SecurePassword123' })
        .expect(200);

      expect(operationsResponse.body.data.user.role).toBe('OPERATIONS_ADMIN');
    });

    it('rejects incorrect username or password', async () => {
      await createPasswordAccount({
        username: 'wrong_login_user',
        role: 'OPERATIONS_ADMIN',
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'wrong_login_user', password: 'WrongPassword123' })
        .expect(401);

      expect(response.body.message).toBe('Invalid username or password');
    });

    it('rejects email values in the username field', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'admin@example.com', password: 'SecurePassword123' })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'username',
          }),
        ])
      );
    });

    it('logs in with email when the account has an email address', async () => {
      await createPasswordAccount({
        username: 'email_login_admin',
        role: 'OPERATIONS_ADMIN',
        email: 'ops.login@example.com',
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ops.login@example.com', password: 'SecurePassword123' })
        .expect(200);

      expect(response.body.data.user.role).toBe('OPERATIONS_ADMIN');
      expect(response.body.data.user.email).toBe('ops.login@example.com');
      expect(response.body.data.tokens).toBeUndefined();
      expect(getCookieValue(response, AUTH_COOKIES.ACCESS)).toEqual(expect.any(String));
    });

    it('rejects mobile-number-based password login identifiers', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: '9876543210', password: 'SecurePassword123' })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('rejects legacy email and identifier login fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@example.com',
          identifier: 'admin@example.com',
          password: 'SecurePassword123',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation failed');
    });

    it('rejects blocked users during password login', async () => {
      await createPasswordAccount({
        username: 'blocked_admin',
        role: 'OPERATIONS_ADMIN',
        accountStatus: 'BLOCKED',
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'blocked_admin', password: 'SecurePassword123' })
        .expect(403);

      expect(response.body.message).toBe('Account is blocked');
    });

    it('rejects duplicate usernames at the database level', async () => {
      await createPasswordAccount({
        username: 'duplicate_user',
        role: 'OPERATIONS_ADMIN',
      });

      await expect(
        createPasswordAccount({
          username: 'duplicate_user',
          role: 'SUPER_ADMIN',
        })
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('does not expose password hashes in login responses', async () => {
      await createPasswordAccount({
        username: 'safe_response_user',
        role: 'SUPER_ADMIN',
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'safe_response_user', password: 'SecurePassword123' })
        .expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|"password":/i);
    });
  });

  describe('Authenticated auth endpoints', () => {
    it('returns the current user and active sessions', async () => {
      await createPasswordAccount({
        username: 'session_user',
        role: 'SUPER_ADMIN',
      });

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'session_user', password: 'SecurePassword123' })
        .expect(200);

      const accessToken = accessTokenFromAuthResponse(loginResponse);

      const meResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const cookieMeResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', loginResponse.headers['set-cookie'])
        .expect(200);

      expect(cookieMeResponse.body.data.username).toBe('session_user');

      expect(meResponse.body.data.username).toBe('session_user');

      const sessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(sessionsResponse.body.data.sessions).toHaveLength(1);
      expect(sessionsResponse.body.data.sessions[0].isCurrent).toBe(true);
    });
  });
});
