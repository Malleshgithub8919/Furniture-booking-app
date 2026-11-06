process.env.NODE_ENV = 'test';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import RefreshToken from '../src/models/RefreshToken.js';
import VendorProfile from '../src/models/VendorProfile.js';
import Category from '../src/models/Category.js';
import Product from '../src/models/Product.js';

let server;
let baseUrl;

const runId = Date.now().toString().slice(-6);

// Test actors
let adminUser, adminToken;
let customerUser;
let vendorAUser, vendorAToken, vendorAProfile;
let vendorBUser, vendorBToken, vendorBProfile;
let testCategory;

before(async () => {
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  assert.ok(testDbUri.includes('furniture_marketplace_test'), 'Safety guard: Must use test database');

  await mongoose.connect(testDbUri);
  await VendorProfile.init();
  await Category.init();
  await Product.init();

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // 1. Seed Admin
  adminUser = await User.create({
    name: 'Catalog Admin',
    email: `admin_cat_${runId}@example.com`,
    passwordHash: await bcrypt.hash('CatalogAdminPassword123!', 4),
    role: 'admin',
    status: 'active',
    emailVerified: true
  });
  adminToken = jwt.sign({ sub: adminUser.id, role: 'admin' }, env.jwtAccessSecret, { expiresIn: '1h' });
  customerUser = await User.create({
    name: 'Marketplace Customer',
    email: `customer_cat_${runId}@example.com`,
    passwordHash: await bcrypt.hash('CatalogCustomerPassword123!', 4),
    role: 'customer',
    status: 'active'
  });

  // 2. Seed Vendor A User
  vendorAUser = await User.create({
    name: 'Vendor Alpha Owner',
    email: `vendor_a_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active',
    emailVerified: true
  });
  vendorAToken = jwt.sign({ sub: vendorAUser.id, role: 'vendor' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 3. Seed Vendor B User
  vendorBUser = await User.create({
    name: 'Vendor Beta Owner',
    email: `vendor_b_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active',
    emailVerified: true
  });
  vendorBToken = jwt.sign({ sub: vendorBUser.id, role: 'vendor' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 4. Seed Category
  testCategory = await Category.create({
    name: `Living Room Furniture ${runId}`,
    slug: `living-room-${runId}`,
    description: 'Sofas, coffee tables and lounge chairs.'
  });

  // 5. Seed Vendor B Profile with pending (unapproved) status
  vendorBProfile = await VendorProfile.create({
    userId: vendorBUser._id,
    storeName: `Modern Living ${runId}`,
    address: { city: 'Mumbai', state: 'Maharashtra', postalCode: '400001' },
    status: 'pending'
  });
});

after(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      assert.ok(mongoose.connection.name.includes('test'), 'Safety check: abort cleanup if not test database');
      await RefreshToken.deleteMany({ userId: { $in: [adminUser?._id, customerUser?._id].filter(Boolean) } });
      await User.deleteMany({ email: new RegExp(runId) });
      await VendorProfile.deleteMany({ storeName: new RegExp(runId) });
      await Category.deleteMany({ slug: new RegExp(runId) });
      await Product.deleteMany({ sku: new RegExp(runId) });
      await mongoose.disconnect();
    }
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

describe('Phase 3A — Vendor Management & KYC', () => {
  test('Vendor A successfully submits onboarding profile with status: pending', async () => {
    const res = await fetch(`${baseUrl}/api/vendors/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        storeName: `Teak Kraft Studio ${runId}`,
        businessType: 'proprietorship',
        gstin: '29AAAAA0000A1Z5',
        pan: 'ABCDE1234F',
        address: {
          street: '124 Industrial Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001'
        },
        bankDetails: {
          accountHolderName: 'Teak Kraft Studio',
          accountNumber: '123456789012',
          ifscCode: 'HDFC0001234',
          bankName: 'HDFC Bank'
        }
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.vendor.status, 'pending');
    assert.equal(data.vendor.storeName, `Teak Kraft Studio ${runId}`);
    vendorAProfile = data.vendor;
  });

  test('Prevents duplicate vendor onboarding for the same user (HTTP 409)', async () => {
    const res = await fetch(`${baseUrl}/api/vendors/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        storeName: `Duplicate Store ${runId}`,
        address: { city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' }
      })
    });
    assert.equal(res.status, 409);
  });

  test('Vendor A uploads KYC document metadata; status updates to under_review', async () => {
    const res = await fetch(`${baseUrl}/api/vendors/me/kyc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        documentType: 'gst_certificate',
        originalName: 'gst_cert_2026.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 154200
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.vendorStatus, 'under_review');
    assert.equal(data.document.documentType, 'gst_certificate');
  });

  test('Public and unauthorized users CANNOT access private KYC documents or bank data', async () => {
    // 1. Fetching without auth
    const anonRes = await fetch(`${baseUrl}/api/vendors/me`);
    assert.equal(anonRes.status, 401);

    // 2. Check vendor in DB without explicit select - kycDocuments & bankDetails must be undefined
    const dbVendor = await VendorProfile.findById(vendorAProfile._id);
    assert.equal(dbVendor.kycDocuments, undefined);
    assert.equal(dbVendor.bankDetails, undefined);
  });

  test('Non-admin user cannot access admin vendor review endpoints (HTTP 403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/vendors`, {
      headers: { Authorization: `Bearer ${vendorAToken}` }
    });
    assert.equal(res.status, 403);
  });

  test('Admin can sign in with a valid password', async () => {
    const anonRes = await fetch(`${baseUrl}/api/admin/dashboard`);
    assert.equal(anonRes.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminUser.email, password: 'CatalogAdminPassword123!' })
    });
    assert.equal(loginRes.status, 200);
    const login = await loginRes.json();
    assert.equal(login.user.role, 'admin');
    assert.ok(login.accessToken);
    assert.ok(login.refreshToken);

    const dashboardRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${login.accessToken}` }
    });
    assert.equal(dashboardRes.status, 200);
    const dashboard = await dashboardRes.json();
    assert.ok(dashboard.data.totals.vendors >= 1);
    assert.ok(dashboard.data.reviewQueue);
    assert.ok(Array.isArray(dashboard.data.paymentStats));

  });

  test('Admin login rejects an incorrect password', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: adminUser.email, password: 'DefinitelyIncorrect123!' })
    });
    assert.equal(response.status, 401);
    const result = await response.json();
    assert.equal(result.message, 'Invalid credentials. Please check your email/mobile and password.');
  });

  test('Non-admin can authenticate but is denied admin API access', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: customerUser.email, password: 'CatalogCustomerPassword123!' })
    });
    assert.equal(loginRes.status, 200);
    const login = await loginRes.json();
    assert.equal(login.user.role, 'customer');

    const dashboardRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${login.accessToken}` }
    });
    assert.equal(dashboardRes.status, 403);
  });

  test('Admin overview endpoints enforce role access and customer details omit hashes', async () => {
    const anonRes = await fetch(`${baseUrl}/api/admin/dashboard`);
    assert.equal(anonRes.status, 401);

    const customerRes = await fetch(`${baseUrl}/api/admin/customers?search=${encodeURIComponent(customerUser.email)}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(customerRes.status, 200);
    const customers = await customerRes.json();
    assert.equal(customers.data.customers[0].email, customerUser.email);
    assert.equal(customers.data.customers[0].passwordHash, undefined);

    const blockRes = await fetch(`${baseUrl}/api/admin/customers/${customerUser._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'blocked' })
    });
    assert.equal(blockRes.status, 200);
    assert.equal((await blockRes.json()).data.status, 'blocked');

    const restoreRes = await fetch(`${baseUrl}/api/admin/customers/${customerUser._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'active' })
    });
    assert.equal(restoreRes.status, 200);
  });

  test('Admin lists vendors and approves Vendor A profile', async () => {
    // List vendors
    const listRes = await fetch(`${baseUrl}/api/admin/vendors?status=under_review&search=${encodeURIComponent(vendorAProfile.storeName)}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.vendors.length >= 1);

    const detailRes = await fetch(`${baseUrl}/api/admin/vendors/${vendorAProfile._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.vendor.kycDocuments.length, 1);
    assert.equal(detail.vendor.kycDocuments[0].fileKey, undefined);
    assert.equal(detail.vendor.bankDetails, undefined);

    const document = detail.vendor.kycDocuments[0];
    const kycReviewRes = await fetch(`${baseUrl}/api/admin/vendors/${vendorAProfile._id}/kyc/${document._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'verified' })
    });
    assert.equal(kycReviewRes.status, 200);
    assert.equal((await kycReviewRes.json()).data.document.status, 'verified');

    // Approve vendor
    const approveRes = await fetch(`${baseUrl}/api/admin/vendors/${vendorAProfile._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'approved', commissionRate: 8 })
    });
    assert.equal(approveRes.status, 200);
    const approveData = await approveRes.json();
    assert.equal(approveData.vendor.status, 'approved');
    assert.equal(approveData.vendor.commissionRate, 8);
  });
});

describe('Phase 3B — Product Catalog & Pricing Architecture', () => {
  let createdProduct;

  test('Unapproved Vendor B CANNOT create products (Rule 5: HTTP 403)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorBToken}`
      },
      body: JSON.stringify({
        name: `Teak Armchair ${runId}`,
        description: 'Solid wood armchair.',
        sku: `ARM-${runId}`,
        categoryId: testCategory._id,
        price: 1500000, // ₹15,000.00
        stock: 5
      })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.code, 'VENDOR_NOT_APPROVED');
  });

  test('Validates integer paise prices and salePrice <= price', async () => {
    // 1. Rejects float price (not integer paise)
    const floatPriceRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        name: `Invalid Price Chair ${runId}`,
        description: 'Test chair.',
        sku: `SKU-FLOAT-${runId}`,
        categoryId: testCategory._id,
        price: 1500.50, // Invalid: must be integer paise
        stock: 10
      })
    });
    assert.equal(floatPriceRes.status, 400);

    // 2. Rejects salePrice greater than base price
    const highSaleRes = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        name: `High Sale Chair ${runId}`,
        description: 'Test chair.',
        sku: `SKU-HIGHSALE-${runId}`,
        categoryId: testCategory._id,
        price: 100000,     // ₹1,000
        salePrice: 150000, // ₹1,500 (Invalid: > price)
        stock: 10
      })
    });
    assert.equal(highSaleRes.status, 400);
  });

  test('Approved Vendor A successfully creates a furniture product (starts in pending moderation)', async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        name: `Royal Teak 3-Seater Sofa ${runId}`,
        description: 'Handcrafted solid teak sofa with water-resistant upholstery.',
        sku: `SOFA-TK-${runId}`,
        categoryId: testCategory._id,
        price: 4999900,     // ₹49,999.00 in paise
        salePrice: 4499900, // ₹44,999.00 in paise
        stock: 15,
        dimensions: { length: 210, width: 85, height: 90, unit: 'cm' },
        weight: { value: 48, unit: 'kg' },
        materials: ['Solid Teak Wood', 'High-Density Foam', 'Linen Blend Fabric'],
        colors: [{ name: 'Forest Green', hexCode: '#2D5A27' }],
        specifications: [
          { key: 'Seating Capacity', value: '3 Persons' },
          { key: 'Warranty', value: '5 Years Manufacturer Warranty' }
        ],
        images: [
          { url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc', isPrimary: true }
        ],
        tags: ['sofa', 'living room', 'teak', 'wooden']
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.product.status, 'pending');
    assert.equal(data.product.price, 4999900);
    assert.equal(data.product.salePrice, 4499900);
    createdProduct = data.product;
  });

  test('Unapproved products DO NOT appear in public listings (Rule 7)', async () => {
    const res = await fetch(`${baseUrl}/api/products`);
    assert.equal(res.status, 200);
    const data = await res.json();
    // Newly created product has status 'pending', so it must NOT be in public results
    const found = data.products.some(p => p._id === createdProduct._id);
    assert.equal(found, false, 'Pending products must not appear in public catalog');
  });

  test('Admin listing APIs return product, order, vendor-order, and payment collections', async () => {
    const paths = [
      ['/api/admin/products?search=' + encodeURIComponent(createdProduct.sku), 'products'],
      ['/api/admin/orders', 'orders'],
      ['/api/admin/vendor-orders', 'vendorOrders'],
      ['/api/admin/payments', 'payments']
    ];
    for (const [path, key] of paths) {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.equal(res.status, 200, path);
      const result = await res.json();
      assert.ok(Array.isArray(result.data[key]), `${key} should be an array`);
      assert.ok(result.data.pagination);
      if (key === 'products') assert.equal(result.data.products[0].sku, createdProduct.sku);
    }
  });

  test('Admin approves product; product now appears in public marketplace listings', async () => {
    // Admin approves product
    const reviewRes = await fetch(`${baseUrl}/api/admin/products/${createdProduct._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(reviewRes.status, 200);

    // Public listing query
    const publicRes = await fetch(`${baseUrl}/api/products?q=Teak`);
    assert.equal(publicRes.status, 200);
    const publicData = await publicRes.json();
    const found = publicData.products.some(p => p._id === createdProduct._id);
    assert.equal(found, true, 'Approved product must now appear in public catalog');
  });

  test('Vendor B CANNOT update or delete Vendor A product (Rule 9: HTTP 403 Forbidden)', async () => {
    // Vendor B attempts to update Vendor A product
    const updateRes = await fetch(`${baseUrl}/api/products/${createdProduct._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorBToken}`
      },
      body: JSON.stringify({ price: 100000 })
    });
    assert.equal(updateRes.status, 403);
    const updateData = await updateRes.json();
    assert.equal(updateData.code, 'UNAUTHORIZED_VENDOR');

    // Vendor B attempts to delete Vendor A product
    const deleteRes = await fetch(`${baseUrl}/api/products/${createdProduct._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${vendorBToken}` }
    });
    assert.equal(deleteRes.status, 403);
  });

  test('Vendor A successfully updates their own product and price', async () => {
    const res = await fetch(`${baseUrl}/api/products/${createdProduct._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vendorAToken}`
      },
      body: JSON.stringify({
        stock: 25,
        description: 'Updated luxury teak wood sofa with premium finish.'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.product.stock, 25);
  });
});
