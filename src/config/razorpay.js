import crypto from 'node:crypto';
import { env } from './env.js';

let razorpayClient = null;

export const isRazorpayConfigured = () =>
  Boolean(env.razorpayKeyId && env.razorpayKeySecret);

export const assertRazorpayConfigured = () => {
  if (!isRazorpayConfigured()) {
    throw new Error('Razorpay credentials are not configured');
  }
};

export const getRazorpayClient = async () => {
  assertRazorpayConfigured();

  if (razorpayClient) {
    return razorpayClient;
  }

  const Razorpay = (await import('razorpay')).default;
  razorpayClient = new Razorpay({
    key_id: env.razorpayKeyId,
    key_secret: env.razorpayKeySecret,
  });

  return razorpayClient;
};

export const createRazorpayOrder = async ({ amountPaise, receipt, notes = {} }) => {
  if (env.isTest && !isRazorpayConfigured()) {
    const id = `order_test_${crypto.randomBytes(8).toString('hex')}`;
    return {
      id,
      amount: amountPaise,
      currency: env.razorpayCurrency,
      receipt,
      status: 'created',
    };
  }

  const client = await getRazorpayClient();
  return client.orders.create({
    amount: amountPaise,
    currency: env.razorpayCurrency,
    receipt,
    notes,
    payment_capture: 1,
  });
};

export const fetchRazorpayPayment = async (paymentId, { orderId } = {}) => {
  if (env.isTest && !isRazorpayConfigured()) {
    return {
      id: paymentId,
      status: 'captured',
      order_id: orderId,
      amount: 0,
      currency: env.razorpayCurrency,
    };
  }

  const client = await getRazorpayClient();
  return client.payments.fetch(paymentId);
};

export const createRazorpayRefund = async ({ razorpayPaymentId, amountPaise, notes = {} }) => {
  if (env.isTest && !isRazorpayConfigured()) {
    return {
      id: `rfnd_test_${crypto.randomBytes(6).toString('hex')}`,
      entity: 'refund',
      amount: amountPaise,
      currency: env.razorpayCurrency,
      payment_id: razorpayPaymentId,
      status: 'processed',
    };
  }

  const client = await getRazorpayClient();
  return client.payments.refund(razorpayPaymentId, {
    amount: amountPaise,
    notes,
  });
};

export const verifyRazorpayPaymentSignature = ({ orderId, paymentId, signature }) => {
  try {
    if (!orderId || !paymentId || !signature) {
      return false;
    }

    const secret =
      env.isTest && !isRazorpayConfigured() ? 'test_razorpay_secret' : env.razorpayKeySecret;

    if (!secret) {
      return false;
    }

    const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    if (expected.length !== signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
};

export const verifyRazorpayWebhookSignature = (rawBody, signatureHeader) => {
  if (!signatureHeader) {
    return false;
  }

  if (env.isTest && !env.razorpayWebhookSecret) {
    const expected = crypto.createHmac('sha256', 'test_webhook_secret').update(rawBody).digest('hex');
    if (expected.length !== signatureHeader.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  }

  if (!env.razorpayWebhookSecret) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', env.razorpayWebhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expected.length !== signatureHeader.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
};
