process.env.NODE_ENV = 'test';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
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

let server;
let baseUrl;

const runId = Date.now().toString().slice(-6);

// Actors
let customerUser, customerToken;
let otherCustomer, otherCustomerToken;
let vendorAUser, vendorAToken, vendorAProfile;
let vendorBUser, vendorBToken, vendorBProfile;
let deliveryAddress;
let testCategory;
let productVendorA;
let productVendorB;

before(async () => {
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  assert.ok(testDbUri.includes('furniture_marketplace_test'), 'Safety guard: Must use test database');

  await mongoose.connect(testDbUri);
  await ParentOrder.init();
  await VendorOrder.init();
  await Product.init();
  await Cart.init();
  await Address.init();

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // 1. Seed Customer
  customerUser = await User.create({
    name: 'Customer Dave',
    email: `dave_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  customerToken = jwt.sign({ sub: customerUser.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 2. Seed Other Customer (for authorization isolation check)
  otherCustomer = await User.create({
    name: 'Customer Eve',
    email: `eve_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  otherCustomerToken = jwt.sign({ sub: otherCustomer.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 3. Seed Delivery Address
  deliveryAddress = await Address.create({
    userId: customerUser._id,
    fullName: 'Dave Johnson',
    phone: '9876543210',
    street: '15 Maple Grove, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    isDefault: true
  });

  // 4. Seed Category
  testCategory = await Category.create({
    name: `Study Room Furniture ${runId}`,
    slug: `study-room-${runId}`
  });

  // 5. Seed Vendor A
  vendorAUser = await User.create({
    name: 'Artisan Wood Craft',
    email: `vendor_a_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active'
  });
  vendorAProfile = await VendorProfile.create({
    userId: vendorAUser._id,
    storeName: `Artisan Wood Craft ${runId}`,
    address: { city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
    status: 'approved',
    commissionRate: 10
  });
  vendorAToken = jwt.sign({ sub: vendorAUser.id, role: 'vendor' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 6. Seed Vendor B
  vendorBUser = await User.create({
    name: 'ErgoComfort Chairs',
    email: `vendor_b_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active'
  });
  vendorBProfile = await VendorProfile.create({
    userId: vendorBUser._id,
    storeName: `ErgoComfort Chairs ${runId}`,
    address: { city: 'Mumbai', state: 'Maharashtra', postalCode: '400001' },
    status: 'approved',
    commissionRate: 12
  });
  vendorBToken = jwt.sign({ sub: vendorBUser.id, role: 'vendor' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 7. Seed Product A (from Vendor A)
  productVendorA = await Product.create({
    name: `Teak Study Desk ${runId}`,
    slug: `teak-study-desk-${runId}`,
    description: 'Solid teak ergonomic desk with cable management.',
    sku: `DESK-TK-${runId}`,
    vendorId: vendorAProfile._id,
    categoryId: testCategory._id,
    price: 2400000,     // ₹24,000.00 in paise
    salePrice: 1999900, // ₹19,999.00 in paise
    stock: 5,
    reservedStock: 0,
    status: 'approved'
  });

  // 8. Seed Product B (from Vendor B)
  productVendorB = await Product.create({
    name: `Mesh Ergonomic Chair ${runId}`,
    slug: `ergo-chair-${runId}`,
    description: 'Adjustable lumbar support office chair.',
    sku: `CHAIR-ERGO-${runId}`,
    vendorId: vendorBProfile._id,
    categoryId: testCategory._id,
    price: 1500000,     // ₹15,000.00
    salePrice: 1299900, // ₹12,999.00
    stock: 10,
    reservedStock: 0,
    status: 'approved'
  });
});

after(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      assert.ok(mongoose.connection.name.includes('test'), 'Safety check: abort cleanup if not test database');
      await User.deleteMany({ email: new RegExp(runId) });
      await VendorProfile.deleteMany({ storeName: new RegExp(runId) });
      await Category.deleteMany({ slug: new RegExp(runId) });
      await Product.deleteMany({ sku: new RegExp(runId) });
      const userIds = [customerUser?._id, otherCustomer?._id].filter(Boolean);
      if (userIds.length > 0) {
        await Cart.deleteMany({ userId: { $in: userIds } });
        await Address.deleteMany({ userId: { $in: userIds } });
        await ParentOrder.deleteMany({ userId: { $in: userIds } });
        await VendorOrder.deleteMany({ customerId: { $in: userIds } });
      }
      await mongoose.disconnect();
    }
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

describe('1. Multi-Vendor Checkout & Atomic Stock Reservation', () => {
  let placedParentOrder;
  let placedSubOrders;
  const idempotencyKey = `idemp_${runId}_1`;

  test('Populates cart with products from two distinct vendors', async () => {
    // Add Product from Vendor A (qty 2)
    const resA = await fetch(`${baseUrl}/api/customer/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ productId: productVendorA._id, quantity: 2 })
    });
    assert.equal(resA.status, 200);

    // Add Product from Vendor B (qty 1)
    const resB = await fetch(`${baseUrl}/api/customer/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ productId: productVendorB._id, quantity: 1 })
    });
    assert.equal(resB.status, 200);
  });

  test('Checkout splits multi-vendor cart into 1 ParentOrder and 2 VendorOrders atomically', async () => {
    const res = await fetch(`${baseUrl}/api/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        addressId: deliveryAddress._id,
        paymentMethod: 'cod',
        idempotencyKey
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    placedParentOrder = data.order;
    placedSubOrders = data.subOrders;

    // Verify 1 Parent Order + 2 Vendor Orders created
    assert.ok(placedParentOrder._id);
    assert.equal(placedParentOrder.vendorOrderIds.length, 2);
    assert.equal(placedSubOrders.length, 2);

    // Verify pricing in integer paise:
    // Vendor A: 2 * 1999900 = 3999800 paise
    // Vendor B: 1 * 1299900 = 1299900 paise
    // Grand total = 3999800 + 1299900 = 5299700 paise (₹52,997.00)
    const expectedGrandTotal = (1999900 * 2) + 1299900;
    assert.equal(placedParentOrder.pricing.grandTotal, expectedGrandTotal);

    // Verify cart is emptied post-checkout
    const cartRes = await fetch(`${baseUrl}/api/customer/cart`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const cartData = await cartRes.json();
    assert.equal(cartData.cart.summary.itemCount, 0);

    // Verify atomic stock reservation in MongoDB
    const pA = await Product.findById(productVendorA._id);
    assert.equal(pA.reservedStock, 2, 'Vendor A product reservedStock must be incremented to 2');

    const pB = await Product.findById(productVendorB._id);
    assert.equal(pB.reservedStock, 1, 'Vendor B product reservedStock must be incremented to 1');
  });

  test('Idempotency check prevents duplicate order creation on retry', async () => {
    const retryRes = await fetch(`${baseUrl}/api/orders/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        addressId: deliveryAddress._id,
        paymentMethod: 'cod',
        idempotencyKey // Re-submitting identical key
      })
    });

    assert.equal(retryRes.status, 200); // 200 OK for duplicate catch
    const data = await retryRes.json();
    assert.equal(data.order._id, placedParentOrder._id);
    assert.ok(data.message.includes('duplicate'));

    // Stock must NOT be reserved twice
    const pA = await Product.findById(productVendorA._id);
    assert.equal(pA.reservedStock, 2);
  });
});

describe('2. Vendor Order Isolation & Fulfillment Transitions', () => {
  let subOrderA;
  let subOrderB;

  before(async () => {
    const orders = await VendorOrder.find({ customerId: customerUser._id });
    subOrderA = orders.find(o => o.vendorId.toString() === vendorAProfile._id.toString());
    subOrderB = orders.find(o => o.vendorId.toString() === vendorBProfile._id.toString());
  });

  test('Vendor A views only Vendor A sub-orders (Rule 10)', async () => {
    const res = await fetch(`${baseUrl}/api/vendors/orders/mine`, {
      headers: { Authorization: `Bearer ${vendorAToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.orders.length, 1);
    assert.equal(data.orders[0]._id, subOrderA._id.toString());
  });

  test('Vendor B CANNOT view or modify Vendor A sub-order (Rule 10: HTTP 403 Forbidden)', async () => {
    // Attempt view
    const viewRes = await fetch(`${baseUrl}/api/vendors/orders/${subOrderA._id}`, {
      headers: { Authorization: `Bearer ${vendorBToken}` }
    });
    assert.equal(viewRes.status, 403);
    const viewData = await viewRes.json();
    assert.equal(viewData.code, 'UNAUTHORIZED_ACCESS');

    // Attempt status update
    const updateRes = await fetch(`${baseUrl}/api/vendors/orders/${subOrderA._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorBToken}`
      },
      body: JSON.stringify({ status: 'confirmed' })
    });
    assert.equal(updateRes.status, 403);
  });

  test('Vendor A successfully advances order status through manufacturing workflow', async () => {
    // 1. Confirm order
    const confirmRes = await fetch(`${baseUrl}/api/vendors/orders/${subOrderA._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({ status: 'confirmed', note: 'Order accepted by workshop.' })
    });
    assert.equal(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.order.status, 'confirmed');

    // 2. Prepare packaging
    const prepRes = await fetch(`${baseUrl}/api/vendors/orders/${subOrderA._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({ status: 'preparing', note: 'Teak desk is being packed in heavy foam.' })
    });
    assert.equal(prepRes.status, 200);
    const prepData = await prepRes.json();
    assert.equal(prepData.order.status, 'preparing');
    assert.equal(prepData.order.statusHistory.length, 3); // placed, confirmed, preparing
  });
});

describe('3. Customer Access & Multi-Vendor Partial Cancellation', () => {
  let masterParentOrder;
  let subOrderA;
  let subOrderB;

  before(async () => {
    masterParentOrder = await ParentOrder.findOne({ userId: customerUser._id });
    const orders = await VendorOrder.find({ parentOrderId: masterParentOrder._id });
    subOrderA = orders.find(o => o.vendorId.toString() === vendorAProfile._id.toString());
    subOrderB = orders.find(o => o.vendorId.toString() === vendorBProfile._id.toString());
  });

  test('Other Customer cannot view Customer Dave order (Rule 11: HTTP 404)', async () => {
    const res = await fetch(`${baseUrl}/api/orders/mine/${masterParentOrder._id}`, {
      headers: { Authorization: `Bearer ${otherCustomerToken}` }
    });
    assert.equal(res.status, 404);
  });

  test('Customer cancels Vendor B sub-order: inventory released, parent becomes partially_cancelled', async () => {
    const cancelRes = await fetch(`${baseUrl}/api/orders/mine/${masterParentOrder._id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        vendorOrderId: subOrderB._id,
        reason: 'Customer chose a different chair color.'
      })
    });

    assert.equal(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.subOrder.status, 'cancelled');
    assert.equal(cancelData.parentOrderStatus, 'partially_cancelled');

    // Verify Product B reserved stock released back to 0
    const pB = await Product.findById(productVendorB._id);
    assert.equal(pB.reservedStock, 0, 'Vendor B reservedStock must be released back to 0');

    // Vendor A reserved stock must remain intact at 2
    const pA = await Product.findById(productVendorA._id);
    assert.equal(pA.reservedStock, 2, 'Vendor A reservedStock must remain reserved');
  });

  test('Cancelling remaining sub-order sets master parent order status to cancelled', async () => {
    const cancelRes = await fetch(`${baseUrl}/api/orders/mine/${masterParentOrder._id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        vendorOrderId: subOrderA._id,
        reason: 'Desk delivery delayed, cancelling remaining.'
      })
    });

    assert.equal(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.equal(cancelData.parentOrderStatus, 'cancelled');

    // Verify all stock is now released
    const pA = await Product.findById(productVendorA._id);
    assert.equal(pA.reservedStock, 0, 'All reserved stock released');
  });
});
