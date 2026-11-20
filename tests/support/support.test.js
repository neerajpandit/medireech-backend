import request from 'supertest';
import app from '../../src/app.js';
import { PAYMENT_STATUS } from '../../src/constants/payment.constants.js';
import { NOTIFICATION_EVENT_TYPES } from '../../src/constants/notification.types.js';
import { SUPPORT_AUDIT_ACTIONS, SUPPORT_TICKET_STATUSES } from '../../src/constants/support.constants.js';
import {
  AuditLog,
  NotificationOutbox,
  Payment,
  SupportTicket,
  User,
} from '../../src/modules/index.js';
import { generateUniqueSupportTicketNumber } from '../../src/utils/supportTicketNumber.js';
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

const loginCustomer = async (mobileNumber) => {
  await request(app).post('/api/v1/auth/customer/send-otp').send({ mobileNumber }).expect(200);
  const response = await request(app)
    .post('/api/v1/auth/customer/verify-otp')
    .send({ mobileNumber, otp: '123456' })
    .expect(200);
  return accessTokenFromAuthResponse(response);
};

const ticketPayload = (overrides = {}) => ({
  category: 'ORDER_ISSUE',
  subject: 'Missing item in pickup',
  description: 'I reserved medicine but one item was missing when I visited the pharmacy.',
  ...overrides,
});

describe('Support tickets (Phase 11)', () => {
  beforeAll(async () => {
    await connectMemoryDb();
  }, 120000);

  afterEach(async () => {
    await clearMemoryDb();
  });

  afterAll(async () => {
    await disconnectMemoryDb();
  });

  it('allows a customer to create and list tickets', async () => {
    await createPasswordAccount({ username: 'super_notify', role: 'SUPER_ADMIN' });
    const token = await loginCustomer('9876511001');

    const createResponse = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send(ticketPayload())
      .expect(201);

    expect(createResponse.body.data.ticket.ticketNumber).toMatch(/^ST-/);
    expect(createResponse.body.data.ticket.status).toBe(SUPPORT_TICKET_STATUSES.OPEN);

    const listResponse = await request(app)
      .get('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listResponse.body.data.tickets).toHaveLength(1);
    expect(listResponse.body.meta.total).toBe(1);

    const audit = await AuditLog.findOne({ action: SUPPORT_AUDIT_ACTIONS.TICKET_CREATED });
    expect(audit).toBeTruthy();

    const outbox = await NotificationOutbox.find({
      eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_CREATED,
    });
    expect(outbox.length).toBeGreaterThan(0);
  });

  it('allows a pharmacy owner to create a ticket', async () => {
    await createApprovedPharmacy({ username: 'support_pharm_owner' });
    const token = await loginWithUsername('support_pharm_owner');

    const response = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send(ticketPayload({ category: 'PHARMACY_ISSUE' }))
      .expect(201);

    expect(response.body.data.ticket.creatorRole).toBe('PHARMACY_OWNER');
  });

  it('rejects ticket creation for unauthorized roles', async () => {
    await createPasswordAccount({ username: 'support_ops', role: 'OPERATIONS_ADMIN' });
    const token = await loginWithUsername('support_ops');

    await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send(ticketPayload())
      .expect(403);
  });

  it('prevents access to another user ticket', async () => {
    const tokenA = await loginCustomer('9876511002');
    const tokenB = await loginCustomer('9876511003');

    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(ticketPayload())
      .expect(201);

    const ticketId = created.body.data.ticket.id;

    await request(app)
      .get(`/api/v1/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('validates payment ownership when linking a ticket', async () => {
    const customerA = await createUser({ mobileNumber: '9876511004' });
    const tokenA = await loginCustomer('9876511004');
    const tokenB = await loginCustomer('9876511005');
    const { pharmacy } = await createApprovedPharmacy({ username: 'pay_link_owner' });

    const payment = await Payment.create({
      paymentCode: 'PAY-SUPPORT-001',
      reservation: '507f1f77bcf86cd799439011',
      customer: customerA._id,
      pharmacy: pharmacy._id,
      paymentMethod: 'ONLINE',
      provider: 'RAZORPAY',
      amount: 2500,
      status: PAYMENT_STATUS.CAPTURED,
      capturedAt: new Date(),
      idempotencyKey: 'support-payment-001',
    });

    await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(ticketPayload({ relatedPayment: payment._id.toString(), category: 'PAYMENT_ISSUE' }))
      .expect(403);

    await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(ticketPayload({ relatedPayment: payment._id.toString(), category: 'PAYMENT_ISSUE' }))
      .expect(201);
  });

  it('supports ticket filtering and pagination', async () => {
    const token = await loginCustomer('9876511006');

    await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send(ticketPayload({ category: 'ORDER_ISSUE', priority: 'HIGH' }))
      .expect(201);

    await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send(ticketPayload({ category: 'ACCOUNT_ISSUE', priority: 'LOW' }))
      .expect(201);

    const filtered = await request(app)
      .get('/api/v1/support/tickets?category=ACCOUNT_ISSUE&limit=1&page=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(filtered.body.data.tickets).toHaveLength(1);
    expect(filtered.body.data.tickets[0].category).toBe('ACCOUNT_ISSUE');
    expect(filtered.body.meta.total).toBe(1);
  });

  it('enforces admin assignment permissions and operations admin restrictions', async () => {
    await createPasswordAccount({ username: 'super_support', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_support');

    const ops = await createPasswordAccount({
      username: 'ops_support',
      role: 'OPERATIONS_ADMIN',
    });
    await User.updateOne(
      { _id: ops._id },
      { $set: { operationsPermissions: ['support:tickets:read', 'support:tickets:manage'] } }
    );
    const opsToken = await loginWithUsername('ops_support');

    const customerToken = await loginCustomer('9876511007');
    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(ticketPayload())
      .expect(201);

    const ticketId = created.body.data.ticket.id;

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ assigneeId: ops._id.toString() })
      .expect(403);

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ assigneeId: ops._id.toString() })
      .expect(200);

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: SUPPORT_TICKET_STATUSES.IN_PROGRESS })
      .expect(200);

    const otherOps = await createPasswordAccount({
      username: 'ops_other',
      role: 'OPERATIONS_ADMIN',
    });
    await User.updateOne(
      { _id: otherOps._id },
      { $set: { operationsPermissions: ['support:tickets:read', 'support:tickets:manage'] } }
    );
    const otherOpsToken = await loginWithUsername('ops_other');

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/priority`)
      .set('Authorization', `Bearer ${otherOpsToken}`)
      .send({ priority: 'CRITICAL' })
      .expect(403);
  });

  it('rejects invalid status transitions and hides internal notes from customers', async () => {
    await createPasswordAccount({ username: 'super_support2', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_support2');

    const ops = await createPasswordAccount({
      username: 'ops_support2',
      role: 'OPERATIONS_ADMIN',
    });
    await User.updateOne(
      { _id: ops._id },
      { $set: { operationsPermissions: ['support:tickets:read', 'support:tickets:manage'] } }
    );
    const opsToken = await loginWithUsername('ops_support2');

    const customerToken = await loginCustomer('9876511008');
    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(ticketPayload())
      .expect(201);

    const ticketId = created.body.data.ticket.id;

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ assigneeId: ops._id.toString() })
      .expect(200);

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ status: SUPPORT_TICKET_STATUSES.CLOSED })
      .expect(200);

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ status: SUPPORT_TICKET_STATUSES.IN_PROGRESS })
      .expect(400);

    await SupportTicket.updateOne({ _id: ticketId }, { status: SUPPORT_TICKET_STATUSES.IN_PROGRESS, closedAt: null });

    await request(app)
      .post(`/api/v1/admin/support/tickets/${ticketId}/notes`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ message: 'Internal escalation note for ops only' })
      .expect(201);

    const customerView = await request(app)
      .get(`/api/v1/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(customerView.body.data.messages).toHaveLength(0);

    const adminView = await request(app)
      .get(`/api/v1/admin/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${opsToken}`)
      .expect(200);

    expect(adminView.body.data.messages.some((message) => message.isInternalNote)).toBe(true);
  });

  it('rejects replies to closed tickets and allows reopening resolved tickets', async () => {
    await createPasswordAccount({ username: 'super_support3', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_support3');

    const customerToken = await loginCustomer('9876511009');
    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(ticketPayload())
      .expect(201);

    const ticketId = created.body.data.ticket.id;

    await SupportTicket.updateOne(
      { _id: ticketId },
      { status: SUPPORT_TICKET_STATUSES.CLOSED, closedAt: new Date() }
    );

    await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ message: 'Trying to reply after close' })
      .expect(400);

    await SupportTicket.updateOne(
      { _id: ticketId },
      { status: SUPPORT_TICKET_STATUSES.RESOLVED, closedAt: null, resolvedAt: new Date() }
    );

    const reopened = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/reopen`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(reopened.body.data.ticket.status).toBe(SUPPORT_TICKET_STATUSES.OPEN);

    await request(app)
      .post(`/api/v1/admin/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ message: 'We are looking into this again.' })
      .expect(201);

    const outbox = await NotificationOutbox.findOne({
      eventType: NOTIFICATION_EVENT_TYPES.SUPPORT_TICKET_ADMIN_REPLY,
    });
    expect(outbox).toBeTruthy();
  });

  it('generates unique ticket numbers under concurrent creation', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => generateUniqueSupportTicketNumber())
    );

    expect(new Set(numbers).size).toBe(numbers.length);

    const customer = await createUser({ mobileNumber: '9876511010' });
    const token = await loginCustomer('9876511010');

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post('/api/v1/support/tickets')
          .set('Authorization', `Bearer ${token}`)
          .send(ticketPayload({ subject: 'Concurrent ticket subject line' }))
      )
    );

    responses.forEach((response) => expect(response.status).toBe(201));

    const ticketNumbers = responses.map((response) => response.body.data.ticket.ticketNumber);
    expect(new Set(ticketNumbers).size).toBe(ticketNumbers.length);
  });

  it('records ticket history via audit logs', async () => {
    await createPasswordAccount({ username: 'super_support4', role: 'SUPER_ADMIN' });
    const superToken = await loginWithUsername('super_support4');

    const ops = await createPasswordAccount({
      username: 'ops_support4',
      role: 'OPERATIONS_ADMIN',
    });
    await User.updateOne(
      { _id: ops._id },
      { $set: { operationsPermissions: ['support:tickets:read', 'support:tickets:manage'] } }
    );

    const customerToken = await loginCustomer('9876511011');
    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(ticketPayload())
      .expect(201);

    const ticketId = created.body.data.ticket.id;

    await request(app)
      .patch(`/api/v1/admin/support/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ assigneeId: ops._id.toString() })
      .expect(200);

    const history = await request(app)
      .get(`/api/v1/admin/support/tickets/${ticketId}/history`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);

    const actions = history.body.data.history.map((entry) => entry.action);
    expect(actions).toContain(SUPPORT_AUDIT_ACTIONS.TICKET_CREATED);
    expect(actions).toContain(SUPPORT_AUDIT_ACTIONS.TICKET_ASSIGNED);
  });
});
