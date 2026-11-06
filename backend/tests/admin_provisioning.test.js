import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import RefreshToken from '../src/models/RefreshToken.js';
import { AdminProvisioningError, provisionFirstAdmin } from '../src/services/adminProvisioning.service.js';

const runId = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
const adminEmail = `first_admin_${runId}@example.com`;
const customerEmail = `bootstrap_customer_${runId}@example.com`;
const vendorEmail = `bootstrap_vendor_${runId}@example.com`;
const adminPassword = 'ProvisionedAdminPassword123!';
const customerPassword = 'ProvisioningCustomer123!';
const vendorPassword = 'ProvisioningVendor123!';
const customerName = `Bootstrap customer ${runId}`;
const testDbName = `admin_test_${runId}`;

let server;
let baseUrl;
let adminUser;
let customerUser;
let vendorUser;

function isolatedTestUri() {
  assert.ok(env.mongoUri, 'Safety guard: MONGODB_URI must be configured');
  const uri = new URL(env.mongoUri);
  uri.pathname = `/${testDbName}`;
  uri.searchParams.delete('dbName');
  return uri.toString();
}

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function signIn(email, password) {
  return post('/api/auth/login', { identifier: email, password });
}

before(async () => {
  await mongoose.connect(isolatedTestUri());
  assert.equal(mongoose.connection.name, testDbName, 'Safety guard: must use the dedicated isolated test database');
  await User.init();
  await RefreshToken.init();
  assert.equal(await User.countDocuments({ role: 'admin' }), 0, 'Safety guard: isolated test DB must start without admins');

  customerUser = await User.create({
    name: customerName,
    email: customerEmail,
    passwordHash: await bcrypt.hash(customerPassword, 4),
    role: 'customer',
    status: 'active'
  });
  vendorUser = await User.create({
    name: `Bootstrap vendor ${runId}`,
    email: vendorEmail,
    passwordHash: await bcrypt.hash(vendorPassword, 4),
    role: 'vendor',
    status: 'active'
  });

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      assert.equal(mongoose.connection.name, testDbName, 'Safety check: cleanup is limited to this isolated test DB');
      const userIds = [adminUser?._id, customerUser?._id, vendorUser?._id].filter(Boolean);
      await RefreshToken.deleteMany({ userId: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
      await mongoose.connection.db.collection('admin_provisioning').deleteOne({ _id: 'first-admin' });
      await mongoose.disconnect();
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('Provisioning rejects invalid email and passwords outside the allowed length', async () => {
  await assert.rejects(
    provisionFirstAdmin({ name: 'Admin', email: 'not-an-email', password: adminPassword }),
    error => error instanceof AdminProvisioningError && /valid email/.test(error.message)
  );
  await assert.rejects(
    provisionFirstAdmin({ name: 'Admin', email: adminEmail, password: 'short' }),
    error => error instanceof AdminProvisioningError && /12 to 128/.test(error.message)
  );
  await assert.rejects(
    provisionFirstAdmin({ name: 'Admin', email: adminEmail, password: 'x'.repeat(129) }),
    error => error instanceof AdminProvisioningError && /12 to 128/.test(error.message)
  );
  assert.equal(await User.countDocuments({ role: 'admin' }), 0);
});

test('Duplicate email is rejected without changing the existing customer account', async () => {
  const original = await User.findById(customerUser._id).select('+passwordHash');
  await assert.rejects(
    provisionFirstAdmin({ name: 'Must not replace customer', email: customerEmail, password: adminPassword }),
    error => error instanceof AdminProvisioningError && /already belongs to an account/.test(error.message)
  );
  const unchanged = await User.findById(customerUser._id).select('+passwordHash');
  assert.equal(unchanged.role, 'customer');
  assert.equal(unchanged.name, original.name);
  assert.equal(unchanged.passwordHash, original.passwordHash);
  assert.equal(await User.countDocuments({ role: 'admin' }), 0);
});

test('First admin is provisioned with a bcrypt hash and repeat provisioning is refused', async () => {
  await provisionFirstAdmin({ name: `First Admin ${runId}`, email: adminEmail, password: adminPassword });
  adminUser = await User.findOne({ email: adminEmail }).select('+passwordHash');

  assert.ok(adminUser);
  assert.equal(adminUser.role, 'admin');
  assert.equal(adminUser.status, 'active');
  assert.equal(adminUser.emailVerified, true);
  assert.notEqual(adminUser.passwordHash, adminPassword);
  assert.equal(await bcrypt.compare(adminPassword, adminUser.passwordHash), true);
  await assert.rejects(
    provisionFirstAdmin({ name: 'Second Admin', email: `second_${runId}@example.com`, password: adminPassword }),
    error => error instanceof AdminProvisioningError && /admin account already exists/.test(error.message)
  );
  assert.equal(await User.countDocuments({ role: 'admin' }), 1);
});

test('Provisioned admin login, JWT access, refresh, and logout work; non-admin roles remain denied', async () => {
  const adminLoginResponse = await signIn(adminEmail, adminPassword);
  assert.equal(adminLoginResponse.status, 200);
  const adminLogin = await adminLoginResponse.json();
  assert.equal(adminLogin.user.role, 'admin');
  assert.equal(adminLogin.user.passwordHash, undefined);
  const accessPayload = jwt.verify(adminLogin.accessToken, env.jwtAccessSecret);
  assert.equal(accessPayload.sub, adminUser.id);
  assert.equal(accessPayload.role, 'admin');

  const adminDashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Authorization: `Bearer ${adminLogin.accessToken}` }
  });
  assert.equal(adminDashboard.status, 200);

  const wrongPassword = await signIn(adminEmail, 'IncorrectProvisionedPassword123!');
  assert.equal(wrongPassword.status, 401);

  const customerLoginResponse = await signIn(customerEmail, customerPassword);
  assert.equal(customerLoginResponse.status, 200);
  const customerLogin = await customerLoginResponse.json();
  assert.equal(customerLogin.user.role, 'customer');
  const customerDashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Authorization: `Bearer ${customerLogin.accessToken}` }
  });
  assert.equal(customerDashboard.status, 403);

  const vendorLoginResponse = await signIn(vendorEmail, vendorPassword);
  assert.equal(vendorLoginResponse.status, 200);
  const vendorLogin = await vendorLoginResponse.json();
  assert.equal(vendorLogin.user.role, 'vendor');
  const vendorDashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Authorization: `Bearer ${vendorLogin.accessToken}` }
  });
  assert.equal(vendorDashboard.status, 403);

  const anonymousDashboard = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(anonymousDashboard.status, 401);

  const refreshResponse = await post('/api/auth/refresh', { refreshToken: adminLogin.refreshToken });
  assert.equal(refreshResponse.status, 200);
  const refreshed = await refreshResponse.json();
  assert.equal(refreshed.user.role, 'admin');
  assert.equal(jwt.verify(refreshed.accessToken, env.jwtAccessSecret).sub, adminUser.id);

  const logoutResponse = await post('/api/auth/logout', { refreshToken: refreshed.refreshToken });
  assert.equal(logoutResponse.status, 200);
  const revokedRefreshResponse = await post('/api/auth/refresh', { refreshToken: refreshed.refreshToken });
  assert.equal(revokedRefreshResponse.status, 403);
});
