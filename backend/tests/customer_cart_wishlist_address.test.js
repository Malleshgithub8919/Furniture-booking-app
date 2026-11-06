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
import Wishlist from '../src/models/Wishlist.js';
import Address from '../src/models/Address.js';

let server;
let baseUrl;

const runId = Date.now().toString().slice(-6);

// Actors
let customerA, customerAToken;
let customerB, customerBToken;
let testCategory;
let vendorProfile;
let approvedProduct;
let pendingProduct;

before(async () => {
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  assert.ok(testDbUri.includes('furniture_marketplace_test'), 'Safety guard: Must use test database');

  await mongoose.connect(testDbUri);
  await Cart.init();
  await Wishlist.init();
  await Address.init();
  await Product.init();

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // 1. Seed Customer A
  customerA = await User.create({
    name: 'Customer Alice',
    email: `alice_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  customerAToken = jwt.sign({ sub: customerA.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 2. Seed Customer B
  customerB = await User.create({
    name: 'Customer Bob',
    email: `bob_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  customerBToken = jwt.sign({ sub: customerB.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 3. Seed Vendor & Category
  const vendorUser = await User.create({
    name: 'Vendor John',
    email: `vendor_john_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active'
  });
  vendorProfile = await VendorProfile.create({
    userId: vendorUser._id,
    storeName: `Craft Woodworks ${runId}`,
    address: { city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
    status: 'approved'
  });

  testCategory = await Category.create({
    name: `Dining Tables ${runId}`,
    slug: `dining-tables-${runId}`
  });

  // 4. Seed Approved Product with Sale Price (in integer paise)
  approvedProduct = await Product.create({
    name: `Oak 6-Seater Dining Table ${runId}`,
    slug: `oak-dining-table-${runId}`,
    description: 'Solid European oak dining table.',
    sku: `DT-OAK-${runId}`,
    vendorId: vendorProfile._id,
    categoryId: testCategory._id,
    price: 3500000,     // Base price: ₹35,000.00
    salePrice: 2999900, // Sale price: ₹29,999.00
    stock: 8,
    materials: ['Solid Oak Wood', 'Powder-coated Steel'],
    colors: [
      { name: 'Natural Oak', hexCode: '#C8A279' },
      { name: 'Dark Walnut', hexCode: '#4A3525' }
    ],
    status: 'approved'
  });

  // 5. Seed Pending/Unapproved Product
  pendingProduct = await Product.create({
    name: `Draft Coffee Table ${runId}`,
    slug: `draft-table-${runId}`,
    description: 'Unpublished draft table.',
    sku: `CT-DRAFT-${runId}`,
    vendorId: vendorProfile._id,
    categoryId: testCategory._id,
    price: 1200000,
    stock: 5,
    status: 'pending' // Not yet approved
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
      await Cart.deleteMany({ userId: { $in: [customerA._id, customerB._id] } });
      await Wishlist.deleteMany({ userId: { $in: [customerA._id, customerB._id] } });
      await Address.deleteMany({ userId: { $in: [customerA._id, customerB._id] } });
      await mongoose.disconnect();
    }
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

describe('1. Cart APIs & Server-Side Price Architecture', () => {
  let cartItemId;

  test('Rejects adding unapproved product to cart (Rule 8: HTTP 404/400)', async () => {
    const res = await fetch(`${baseUrl}/api/customer/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({
        productId: pendingProduct._id,
        quantity: 1
      })
    });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.code, 'PRODUCT_NOT_AVAILABLE');
  });

  test('Rejects quantity exceeding available live stock (Rule 8)', async () => {
    const res = await fetch(`${baseUrl}/api/customer/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({
        productId: approvedProduct._id,
        quantity: 20 // Available is only 8
      })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'INSUFFICIENT_STOCK');
  });

  test('Validates customization: rejects invalid color option (Rule 9)', async () => {
    const res = await fetch(`${baseUrl}/api/customer/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({
        productId: approvedProduct._id,
        quantity: 1,
        selectedColor: 'Neon Violet' // Invalid color for Oak table
      })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'INVALID_CUSTOMIZATION');
  });

  test('Calculates price strictly on server: client-tampered price is ignored (Rule 7)', async () => {
    // Client maliciously attempts to send price = ₹1.00 (100 paise)
    const res = await fetch(`${baseUrl}/api/customer/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({
        productId: approvedProduct._id,
        quantity: 2,
        selectedColor: 'Natural Oak',
        selectedMaterial: 'Solid Oak Wood',
        price: 100 // Client attempted price override
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Live salePrice is ₹29,999.00 (2999900 paise)
    const item = data.cart.items[0];
    cartItemId = item._id;

    assert.equal(item.pricing.effectiveUnitPrice, 2999900, 'Effective unit price must match live product sale price');
    assert.equal(item.pricing.lineTotal, 2999900 * 2, 'Line total must be calculated accurately on backend');
    assert.equal(data.cart.summary.subtotal, 2999900 * 2);
    assert.equal(data.cart.summary.totalDiscount, (3500000 - 2999900) * 2);
    assert.equal(data.cart.summary.isCheckoutEligible, true);
  });

  test('Customer B cart is completely isolated from Customer A (Rule 6)', async () => {
    const res = await fetch(`${baseUrl}/api/customer/cart`, {
      headers: { Authorization: `Bearer ${customerBToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // Customer B's cart must be empty
    assert.equal(data.cart.summary.itemCount, 0);
    assert.equal(data.cart.items.length, 0);
  });

  test('Update quantity and remove cart item', async () => {
    // 1. Update quantity to 3
    const updateRes = await fetch(`${baseUrl}/api/customer/cart/items/${cartItemId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({ quantity: 3 })
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.cart.summary.itemCount, 3);
    assert.equal(updateData.cart.summary.subtotal, 2999900 * 3);

    // 2. Remove item from cart
    const removeRes = await fetch(`${baseUrl}/api/customer/cart/items/${cartItemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerAToken}` }
    });
    assert.equal(removeRes.status, 200);
    const removeData = await removeRes.json();
    assert.equal(removeData.cart.summary.itemCount, 0);
  });
});

describe('2. Wishlist APIs & Move to Cart', () => {
  test('Customer adds approved product to wishlist and retrieves it', async () => {
    // Add to wishlist
    const addRes = await fetch(`${baseUrl}/api/customer/wishlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({ productId: approvedProduct._id })
    });
    assert.equal(addRes.status, 201);

    // List wishlist
    const listRes = await fetch(`${baseUrl}/api/customer/wishlist`, {
      headers: { Authorization: `Bearer ${customerAToken}` }
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.total, 1);
    assert.equal(listData.products[0]._id, approvedProduct._id.toString());
  });

  test('Move product from wishlist to cart', async () => {
    const moveRes = await fetch(`${baseUrl}/api/customer/wishlist/move-to-cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({ productId: approvedProduct._id, quantity: 1 })
    });
    assert.equal(moveRes.status, 200);
    const moveData = await moveRes.json();
    assert.equal(moveData.cart.summary.itemCount, 1);

    // Wishlist should now be empty
    const wishRes = await fetch(`${baseUrl}/api/customer/wishlist`, {
      headers: { Authorization: `Bearer ${customerAToken}` }
    });
    const wishData = await wishRes.json();
    assert.equal(wishData.total, 0);
  });
});

describe('3. Address Management & Customer Ownership (Rule 6)', () => {
  let addressA1Id, addressA2Id;

  test('Customer A creates first address; automatically marked as default', async () => {
    const res = await fetch(`${baseUrl}/api/customer/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({
        fullName: 'Alice Walker',
        phone: '9876543210',
        street: '42 Orchid Residency, Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560034',
        addressType: 'home'
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.address.isDefault, true); // First address is auto default
    addressA1Id = data.address._id;
  });

  test('Customer A creates second address with isDefault: true; unsets first address default', async () => {
    const res = await fetch(`${baseUrl}/api/customer/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({
        fullName: 'Alice Walker (Work)',
        phone: '9876543210',
        street: 'Tech Park Tower 3, Whitefield',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560066',
        addressType: 'work',
        isDefault: true
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.address.isDefault, true);
    addressA2Id = data.address._id;

    // Check first address is now isDefault: false
    const addr1 = await Address.findById(addressA1Id);
    assert.equal(addr1.isDefault, false);
  });

  test('Customer B CANNOT modify or delete Customer A address (Rule 6: HTTP 403 Forbidden)', async () => {
    // Attempt update
    const updateRes = await fetch(`${baseUrl}/api/customer/addresses/${addressA1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerBToken}`
      },
      body: JSON.stringify({ street: 'Malicious modification' })
    });
    assert.equal(updateRes.status, 403);
    const updateData = await updateRes.json();
    assert.equal(updateData.code, 'UNAUTHORIZED_ACCESS');

    // Attempt delete
    const deleteRes = await fetch(`${baseUrl}/api/customer/addresses/${addressA1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerBToken}` }
    });
    assert.equal(deleteRes.status, 403);
  });

  test('Customer A updates and deletes their own address', async () => {
    // Update
    const updateRes = await fetch(`${baseUrl}/api/customer/addresses/${addressA1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerAToken}`
      },
      body: JSON.stringify({ landmark: 'Near Wipro Park' })
    });
    assert.equal(updateRes.status, 200);

    // Delete
    const deleteRes = await fetch(`${baseUrl}/api/customer/addresses/${addressA1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerAToken}` }
    });
    assert.equal(deleteRes.status, 200);

    const check = await Address.findById(addressA1Id);
    assert.equal(check, null);
  });
});

