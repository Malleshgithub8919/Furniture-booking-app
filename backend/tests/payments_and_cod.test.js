process.env.NODE_ENV = 'test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_key_1234567890';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret_key_1234567890';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import VendorProfile from '../src/models/VendorProfile.js';
import Category from '../src/models/Category.js';
import Product from '../src/models/Product.js';
import Cart from '../src/models/Cart.js';
import Address from '../src/models/Address.js';
import ParentOrder from '../src/models/ParentOrder.js';
import VendorOrder from '../src/models/VendorOrder.js';
import Payment from '../src/models/Payment.js';
import WebhookEvent from '../src/models/WebhookEvent.js';
import { orderService } from '../src/services/order.service.js';

let server;
let baseUrl;

const runId = Date.now().toString().slice(-6);

let customerA, tokenCustomerA;
let customerB, tokenCustomerB;
let adminUser, tokenAdmin;
let deliveryUser, tokenDelivery;
let vendorUser, vendorProfile;
let testCategory;
let testProduct;
let testAddress;

before(async () => {
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  assert.ok(testDbUri.includes('furniture_marketplace_test'), 'Safety guard: Must use test database');

  await mongoose.connect(testDbUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 45000
  });
  await ParentOrder.init();
  await VendorOrder.init();
  await Payment.init();
  await WebhookEvent.init();
  await Product.init();
  await Cart.init();
  await Address.init();

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // 1. Seed Customer A & B
  customerA = await User.create({
    name: 'Customer Alice',
    email: `alice_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  tokenCustomerA = jwt.sign({ sub: customerA.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  customerB = await User.create({
    name: 'Customer Bob',
    email: `bob_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  tokenCustomerB = jwt.sign({ sub: customerB.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 2. Seed Admin & Delivery User
  adminUser = await User.create({
    name: 'System Admin',
    email: `admin_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'admin',
    status: 'active',
    emailVerified: true
  });
  tokenAdmin = jwt.sign({ sub: adminUser.id, role: 'admin' }, env.jwtAccessSecret, { expiresIn: '1h' });

  deliveryUser = await User.create({
    name: 'Delivery Agent Ram',
    email: `delivery_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'delivery',
    status: 'active',
    emailVerified: true
  });
  tokenDelivery = jwt.sign({ sub: deliveryUser.id, role: 'delivery' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 3. Seed Vendor & Profile
  vendorUser = await User.create({
    name: 'WoodCraft Vendor',
    email: `woodcraft_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active',
    emailVerified: true
  });
  vendorProfile = await VendorProfile.create({
    userId: vendorUser._id,
    storeName: `WoodCraft-${runId}`,
    storeSlug: `woodcraft-${runId}`,
    description: 'Artisan furniture craft studio',
    businessPhone: '9876543210',
    address: {
      street: '12 Workshop Lane',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001'
    },
    status: 'approved',
    commissionRate: 10
  });

  // 4. Seed Category & Product (Price: ₹45,000.00 = 4,500,000 paise)
  testCategory = await Category.create({
    name: `Living Tables ${runId}`,
    slug: `living-tables-${runId}`
  });

  testProduct = await Product.create({
    vendorId: vendorProfile._id,
    categoryId: testCategory._id,
    name: 'Teak Coffee Table',
    description: 'Solid teak wood coffee table with walnut finish',
    slug: `teak-coffee-table-${runId}`,
    sku: `SKU-TBL-${runId}`,
    price: 4500000, // 45,000.00 in integer paise
    stock: 20,
    reservedStock: 0,
    status: 'approved',
    availableColors: ['Walnut', 'Teak']
  });

  // 5. Seed Customer Address
  testAddress = await Address.create({
    userId: customerA._id,
    fullName: 'Alice Walker',
    phone: '+919876543210',
    street: '742 Evergreen Terrace',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001'
  });
});

after(async () => {
  const userIds = [customerA?._id, customerB?._id, adminUser?._id, deliveryUser?._id, vendorUser?._id].filter(Boolean);
  if (userIds.length > 0) {
    await User.deleteMany({ _id: { $in: userIds } });
  }
  if (vendorProfile?._id) await VendorProfile.deleteOne({ _id: vendorProfile._id });
  if (testCategory?._id) await Category.deleteOne({ _id: testCategory._id });
  if (testProduct?._id) await Product.deleteOne({ _id: testProduct._id });
  if (testAddress?._id) await Address.deleteMany({ userId: { $in: userIds } });
  await Cart.deleteMany({ userId: { $in: userIds } });
  await ParentOrder.deleteMany({ userId: { $in: userIds } });
  await VendorOrder.deleteMany({ customerId: { $in: userIds } });
  await Payment.deleteMany({ userId: { $in: userIds } });
  await WebhookEvent.deleteMany({ gateway: 'razorpay' });

  if (server) server.close();
  await mongoose.disconnect();
});

describe('Phase 6: Payments Integration & Razorpay Architecture', { concurrency: 1 }, () => {
  let createdOnlineOrder;

  // Helper to place an order directly for customerA
  async function placeCustomerOrder(paymentMethod = 'razorpay') {
    await Cart.findOneAndUpdate(
      { userId: customerA._id },
      {
        userId: customerA._id,
        items: [{ productId: testProduct._id, quantity: 1, selectedColor: 'Walnut' }]
      },
      { upsert: true, new: true }
    );

    const { order } = await orderService.checkout({
      userId: customerA._id,
      addressId: testAddress._id,
      paymentMethod,
      idempotencyKey: `IDEM-PAY-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
    });
    return order;
  }

  test('1. Customer initiates Razorpay order creation for a placed order', async () => {
    createdOnlineOrder = await placeCustomerOrder('razorpay');
    assert.equal(createdOnlineOrder.paymentStatus, 'pending');

    const res = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({ orderId: createdOnlineOrder._id.toString() })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.gatewayOrderId.startsWith('order_'), 'Gateway order ID generated');
    assert.equal(body.data.amount, 4500000, 'Amount strictly matches server-side integer paise');
    assert.equal(body.data.currency, 'INR');

    // Verify Payment document in DB
    const payment = await Payment.findOne({ orderId: createdOnlineOrder._id });
    assert.ok(payment, 'Payment document was created');
    assert.equal(payment.status, 'pending');
    assert.equal(payment.amount, 4500000);
    assert.equal(payment.gateway, 'razorpay');
  });

  test('2. Prevents unauthorized customer from creating payment order for another customer', async () => {
    const res = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerB}`
      },
      body: JSON.stringify({ orderId: createdOnlineOrder._id.toString() })
    });

    assert.equal(res.status, 404, 'Returns 404/Forbidden because order does not belong to Customer B');
  });

  test('3. Client payment verification with valid cryptographic signature marks order as captured', async () => {
    const payment = await Payment.findOne({ orderId: createdOnlineOrder._id });
    const razorpayOrderId = payment.gatewayOrderId;
    const razorpayPaymentId = `pay_mock_${crypto.randomBytes(6).toString('hex')}`;

    // Generate valid cryptographic signature using test secret
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const signaturePayload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const validSignature = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');

    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({
        orderId: createdOnlineOrder._id.toString(),
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: validSignature
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.paymentStatus, 'captured');

    // Verify Database Updates
    const updatedPayment = await Payment.findById(payment._id);
    assert.equal(updatedPayment.status, 'captured');
    assert.equal(updatedPayment.gatewayPaymentId, razorpayPaymentId);

    const updatedParent = await ParentOrder.findById(createdOnlineOrder._id);
    assert.equal(updatedParent.paymentStatus, 'captured');

    // Vendor sub-order should transition to confirmed
    const subOrders = await VendorOrder.find({ parentOrderId: createdOnlineOrder._id });
    assert.equal(subOrders[0].status, 'confirmed');
  });

  test('4. Rejects payment verification with invalid signature (HTTP 400)', async () => {
    const unverifiedOrder = await placeCustomerOrder('razorpay');
    await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({ orderId: unverifiedOrder._id.toString() })
    });

    const payment = await Payment.findOne({ orderId: unverifiedOrder._id });

    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({
        orderId: unverifiedOrder._id.toString(),
        razorpayOrderId: payment.gatewayOrderId,
        razorpayPaymentId: 'pay_tampered_123',
        razorpaySignature: 'invalid_forged_signature_hex'
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    const msg = body.message || body.error?.message || '';
    assert.ok(msg.toLowerCase().includes('signature'));
  });

  test('5. Webhook signature verification: valid HMAC-SHA256 processes payment.captured', async () => {
    const webhookOrder = await placeCustomerOrder('razorpay');
    await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({ orderId: webhookOrder._id.toString() })
    });

    const payment = await Payment.findOne({ orderId: webhookOrder._id });
    const eventId = `evt_${runId}_${Date.now()}`;
    const paymentId = `pay_wh_${runId}_${Date.now()}`;

    const webhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: payment.gatewayOrderId,
            amount: 4500000,
            currency: 'INR',
            status: 'captured',
            method: 'upi'
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    });

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const validSignature = crypto.createHmac('sha256', secret).update(webhookPayload).digest('hex');

    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': eventId
      },
      body: webhookPayload
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'processed');

    // Confirm DB updates
    const updatedOrder = await ParentOrder.findById(webhookOrder._id);
    assert.equal(updatedOrder.paymentStatus, 'captured');
  });

  test('6. Webhook rejects forged/invalid signature (HTTP 400)', async () => {
    const webhookPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {}
    });

    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'forged_fake_signature_123',
        'x-razorpay-event-id': `evt_fake_${Date.now()}`
      },
      body: webhookPayload
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    const msg = body.message || body.error?.message || '';
    assert.ok(msg.toLowerCase().includes('signature'));
  });

  test('7. Webhook Idempotency: duplicate webhook event returns already_processed without re-mutation', async () => {
    const duplicateOrder = await placeCustomerOrder('razorpay');
    await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({ orderId: duplicateOrder._id.toString() })
    });

    const payment = await Payment.findOne({ orderId: duplicateOrder._id });
    const eventId = `evt_duplicate_${Date.now()}`;

    const webhookPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${Date.now()}`,
            order_id: payment.gatewayOrderId,
            amount: 4500000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    });

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = crypto.createHmac('sha256', secret).update(webhookPayload).digest('hex');

    // First delivery
    const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: webhookPayload
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.data.status, 'processed');

    // Second duplicate delivery
    const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: webhookPayload
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.data.status, 'already_processed', 'Second delivery recognized as idempotent duplicate');
  });

  test('8. Webhook rejects payment capture on amount mismatch (Rule 11)', async () => {
    const mismatchOrder = await placeCustomerOrder('razorpay');
    await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({ orderId: mismatchOrder._id.toString() })
    });

    const payment = await Payment.findOne({ orderId: mismatchOrder._id });
    const eventId = `evt_mismatch_${Date.now()}`;

    // Payload says 1000 paise (₹10) when order is 4,500,000 paise (₹45,000)
    const webhookPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_mismatch_${Date.now()}`,
            order_id: payment.gatewayOrderId,
            amount: 1000, // Tampered/mismatched amount
            currency: 'INR'
          }
        }
      }
    });

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = crypto.createHmac('sha256', secret).update(webhookPayload).digest('hex');

    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: webhookPayload
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    const msg = body.message || body.error?.message || '';
    assert.ok(msg.toLowerCase().includes('mismatch'));

    // Verify order was NOT marked as captured
    const orderCheck = await ParentOrder.findById(mismatchOrder._id);
    assert.notEqual(orderCheck.paymentStatus, 'captured');
  });

  test('9. Cash on Delivery (COD) Flow & Role-Based Confirmation', async () => {
    const codOrder = await placeCustomerOrder('cod');
    assert.equal(codOrder.paymentMethod, 'cod');
    assert.equal(codOrder.paymentStatus, 'pending');

    // Customer CANNOT confirm their own COD payment (Rule 10: 403 Forbidden)
    const custRes = await fetch(`${baseUrl}/api/payments/confirm-cod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomerA}`
      },
      body: JSON.stringify({ orderId: codOrder._id.toString() })
    });
    assert.equal(custRes.status, 403, 'Customer cannot confirm COD');

    // Delivery agent confirms cash collection
    const delivRes = await fetch(`${baseUrl}/api/payments/confirm-cod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery}`
      },
      body: JSON.stringify({ orderId: codOrder._id.toString() })
    });
    assert.equal(delivRes.status, 200);
    const delivBody = await delivRes.json();
    assert.equal(delivBody.success, true);
    assert.equal(delivBody.data.paymentStatus, 'captured');

    const updatedCodOrder = await ParentOrder.findById(codOrder._id);
    assert.equal(updatedCodOrder.paymentStatus, 'captured');

    const codPayment = await Payment.findOne({ orderId: codOrder._id, gateway: 'cod' });
    assert.ok(codPayment, 'COD payment record created');
    assert.equal(codPayment.status, 'captured');
  });

  test('10. Safe Inventory Reservation Expiry for unpaid online orders (NEVER releases paid orders)', async () => {
    // A. Create an expired unpaid order (backdate createdAt by 45 minutes)
    const unpaidOrder = await placeCustomerOrder('razorpay');
    await ParentOrder.collection.updateOne(
      { _id: unpaidOrder._id },
      { $set: { createdAt: new Date(Date.now() - 45 * 60 * 1000) } }
    );

    // B. Create a successfully paid order (also older than 45 minutes)
    const paidOrder = await placeCustomerOrder('razorpay');
    await ParentOrder.collection.updateOne(
      { _id: paidOrder._id },
      {
        $set: {
          createdAt: new Date(Date.now() - 45 * 60 * 1000),
          paymentStatus: 'captured'
        }
      }
    );

    // Check product stock before expiry run
    const prodBefore = await Product.findById(testProduct._id);
    const initialReservedStock = prodBefore.reservedStock;

    // Trigger reservation expiry with 30 minute threshold via Admin endpoint
    const res = await fetch(`${baseUrl}/api/payments/expire-unpaid?expiryMinutes=30`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenAdmin}`
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.expiredCount >= 1, 'At least 1 unpaid order expired');

    // Verify unpaid order was cancelled and its sub-orders cancelled
    const checkUnpaid = await ParentOrder.findById(unpaidOrder._id);
    assert.equal(checkUnpaid.orderStatus, 'cancelled');
    assert.equal(checkUnpaid.paymentStatus, 'failed');

    // CRITICAL: Successfully paid order MUST REMAIN captured and NOT cancelled!
    const checkPaid = await ParentOrder.findById(paidOrder._id);
    assert.equal(checkPaid.paymentStatus, 'captured');
    assert.notEqual(checkPaid.orderStatus, 'cancelled');

    // Product reservedStock must have decreased for the unpaid order
    const prodAfter = await Product.findById(testProduct._id);
    assert.equal(prodAfter.reservedStock, initialReservedStock - 1, 'Reserved stock released exactly by 1 item');
  });
});
