import crypto from 'crypto';
import { env } from '../config/env.js';

export const razorpayService = {
  /**
   * Creates a Razorpay Order.
   * Requirement 9: Provider API calls MUST be outside MongoDB transactions.
   */
  async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Order amount must be a positive integer in paise.');
    }

    // In production / when credentials are provided, call the live Razorpay Orders API
    if (env.razorpayKeyId && env.razorpayKeySecret) {
      const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`
        },
        body: JSON.stringify({
          amount,
          currency,
          receipt,
          notes
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error?.description || 'Razorpay order creation failed.');
        err.statusCode = response.status;
        err.details = errorData;
        throw err;
      }

      return await response.json();
    }

    // Development & Test Mode: Deterministic mock order ID
    const mockOrderId = `order_mock_${crypto.randomBytes(8).toString('hex')}`;
    return {
      id: mockOrderId,
      entity: 'order',
      amount,
      amount_paid: 0,
      amount_due: amount,
      currency,
      receipt,
      status: 'created',
      attempts: 0,
      notes,
      created_at: Math.floor(Date.now() / 1000),
      isMock: true
    };
  },

  /**
   * Cryptographically verifies the Razorpay Webhook signature using HMAC-SHA256 and constant-time comparison.
   * Prevents timing attacks and payload tampering.
   */
  verifyWebhookSignature({ rawBody, signature, secret }) {
    const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET || env.razorpayWebhookSecret;
    if (!rawBody || !signature || !webhookSecret) {
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(signature, 'utf8');

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  },

  /**
   * Cryptographically verifies the frontend payment signature:
   * HMAC_SHA256(order_id + "|" + payment_id, secret) == signature
   */
  verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature, secret }) {
    const keySecret = secret || process.env.RAZORPAY_KEY_SECRET || env.razorpayKeySecret;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !keySecret) {
      return false;
    }

    try {
      const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(payload)
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(razorpaySignature, 'utf8');

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }
};
