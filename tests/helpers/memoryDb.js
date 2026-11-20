import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  AuditLog,
  Inventory,
  Medicine,
  Otp,
  Pharmacy,
  PharmacyStaff,
  Prescription,
  Reservation,
  User,
  UserSession,
  StockMovement,
  NotificationOutbox,
  Notification,
  DeviceToken,
  NotificationPreference,
  Payment,
  Refund,
  PaymentWebhookEvent,
  SupportTicket,
  SupportTicketMessage,
} from '../../src/modules/index.js';

let memoryServer;

export const connectMemoryDb = async () => {
  memoryServer = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  await memoryServer.waitUntilRunning();
  const uri = memoryServer.getUri();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(uri, {
    autoIndex: true,
  });

  await Promise.all([
    User.syncIndexes(),
    Pharmacy.syncIndexes(),
    PharmacyStaff.syncIndexes(),
    Medicine.syncIndexes(),
    Inventory.syncIndexes(),
    Reservation.syncIndexes(),
    Prescription.syncIndexes(),
    AuditLog.syncIndexes(),
    Otp.syncIndexes(),
    UserSession.syncIndexes(),
    StockMovement.syncIndexes(),
    NotificationOutbox.syncIndexes(),
    Notification.syncIndexes(),
    DeviceToken.syncIndexes(),
    NotificationPreference.syncIndexes(),
    Payment.syncIndexes(),
    Refund.syncIndexes(),
    PaymentWebhookEvent.syncIndexes(),
    SupportTicket.syncIndexes(),
    SupportTicketMessage.syncIndexes(),
  ]);
};

export const clearMemoryDb = async () => {
  const collections = mongoose.connection.collections;

  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
};

export const disconnectMemoryDb = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }

  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
};

export const createUser = async (overrides = {}) => {
  const role = overrides.role || 'CUSTOMER';
  const payload = {
    fullName: overrides.fullName || 'Test User',
    role,
    accountStatus: overrides.accountStatus || 'ACTIVE',
    ...overrides,
  };

  if (role === 'CUSTOMER') {
    payload.mobileNumber = overrides.mobileNumber || '9876543210';
    delete payload.username;
    delete payload.passwordHash;
    delete payload.plainPassword;
    return User.create(payload);
  }

  payload.username =
    overrides.username || `user_${Math.random().toString(36).slice(2, 10).toLowerCase()}`;
  payload.passwordHash =
    overrides.passwordHash ||
    (await bcrypt.hash(overrides.plainPassword || 'SecurePassword123', 4));
  delete payload.plainPassword;

  return User.create(payload);
};

export const createPasswordAccount = async ({
  username,
  password = 'SecurePassword123',
  role,
  fullName = 'Account User',
  accountStatus = 'ACTIVE',
  mobileNumber,
  email,
}) =>
  createUser({
    username,
    plainPassword: password,
    role,
    fullName,
    accountStatus,
    mobileNumber,
    email,
  });

export const createPharmacy = async (ownerId, overrides = {}) =>
  Pharmacy.create({
    pharmacyName: 'MediReech Pharmacy',
    owner: ownerId,
    pharmacyCode: 'PH-TEST-001',
    registrationNumber: 'REG-001',
    drugLicenseNumber: 'DL-001',
    phone: '9876543211',
    email: 'pharmacy@example.com',
    address: {
      addressLine: '12 MG Road',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      pincode: '560001',
      country: 'India',
    },
    location: {
      type: 'Point',
      coordinates: [77.5946, 12.9716],
    },
    ...overrides,
  });

export const createMedicine = (overrides = {}) =>
  Medicine.create({
    name: 'Paracetamol 500mg Tablet',
    dosageForm: 'TABLET',
    prescriptionType: 'OTC',
    strength: '500mg',
    packSize: '10 tablets',
    ...overrides,
  });

export const createApprovedPharmacy = async ({
  username,
  password = 'SecurePassword123',
  mobileNumber,
  ...pharmacyOverrides
} = {}) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const owner = await createPasswordAccount({
    username: username || `owner_${suffix}`,
    password,
    role: 'PHARMACY_OWNER',
    mobileNumber: mobileNumber || `98765${String(suffix).slice(-5)}`,
  });

  const pharmacy = await createPharmacy(owner._id, {
    pharmacyCode: `PH-APP-${suffix}`,
    registrationNumber: `REG-APP-${suffix}`,
    drugLicenseNumber: `DL-APP-${suffix}`,
    verificationStatus: 'APPROVED',
    operationalStatus: 'ACTIVE',
    ...pharmacyOverrides,
  });

  return { owner, pharmacy, password };
};
