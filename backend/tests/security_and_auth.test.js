process.env.NODE_ENV = 'test';
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import RefreshToken from '../src/models/RefreshToken.js';
import { otpService } from '../src/services/otp.service.js';

let server;
let baseUrl;

const uniqueId = Date.now().toString().slice(-6);
const validTestEmail = `test_security_${uniqueId}@example.com`;
const validTestPhone = `98${uniqueId.padStart(8, '7')}`; // Valid 10-digit Indian mobile starting with 9
const validPassword = 'SecurePassword123!';
const deliveredOtps = new Map();
const originalDeliverOtp = otpService.deliverOtp;

otpService.deliverOtp = async ({ channel, recipient, otp }) => {
  deliveredOtps.set(recipient, otp);
  return { success: true, channel, devMode: true };
};

before(async () => {
  // Enforce separate test database
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  // Verify test database URI safety before connecting
  assert.ok(testDbUri.includes('furniture_marketplace_test'), 'Safety guard: Must use test database');

  await mongoose.connect(testDbUri);
  await User.init();
  await RefreshToken.init();

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  try {
    // Verified safe cleanup: only purge records containing 'test_' in test database
    if (mongoose.connection.readyState === 1) {
      assert.ok(mongoose.connection.name.includes('test'), 'Safety check: abort cleanup if not test database');
      await User.deleteMany({ email: /test_/ });
      await RefreshToken.deleteMany({});
      await mongoose.disconnect();
    }
  } finally {
    otpService.deliverOtp = originalDeliverOtp;
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

describe('1. Input Validation (express-validator)', () => {
  test('Rejects invalid email format', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid Email User',
        email: 'not-an-email-address',
        password: validPassword
      })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    const hasEmailErr = data.errors.some(e => e.field === 'email');
    assert.ok(hasEmailErr, 'Expected validation error on email field');
  });

  test('Rejects invalid Indian phone number (wrong prefix/digits)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid Phone User',
        phone: '1234567890', // Indian mobile must start with 6, 7, 8, or 9
        password: validPassword
      })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    const hasPhoneErr = data.errors.some(e => e.field === 'phone');
    assert.ok(hasPhoneErr, 'Expected validation error on phone field');
  });

  test('Rejects password that is too short (< 8 chars) or too long (> 128 chars)', async () => {
    // Too short
    const shortRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Short Pass User',
        email: `short_${uniqueId}@example.com`,
        password: 'short'
      })
    });
    assert.equal(shortRes.status, 400);

    // Too long
    const longRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Long Pass User',
        email: `long_${uniqueId}@example.com`,
        password: 'A'.repeat(129)
      })
    });
    assert.equal(longRes.status, 400);
  });

  test('Prevents public admin registration by rejecting non-customer role', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Attacker Trying Admin',
        email: `admin_hack_${uniqueId}@example.com`,
        password: validPassword,
        role: 'admin' // Attempting privilege escalation
      })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    const hasRoleErr = data.errors.some(e => e.field === 'role');
    assert.ok(hasRoleErr, 'Expected role tampering rejection');
  });
});

describe('2. Registration, Password Hashing & Duplicate Handling', () => {
  let createdUser;
  let testOtp;

  test('Successfully registers customer with Indian phone and email, returning tokens', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Customer MultiChannel',
        email: validTestEmail,
        phone: validTestPhone,
        password: validPassword
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
    assert.equal(data.user.role, 'customer');
    assert.equal(data.user.emailVerified, false);
    assert.equal(data.user.phoneVerified, false);
    assert.match(data.message, /OTP delivery is simulated/);
    assert.equal(Object.hasOwn(data, '_testOtp'), false);
    assert.equal(Object.hasOwn(data.user, 'passwordHash'), false);

    createdUser = data.user;
    testOtp = deliveredOtps.get(validTestEmail);
    assert.ok(testOtp);

    // Verify bcrypt hash in MongoDB (must never be plaintext)
    const userInDb = await User.findById(data.user.id).select('+passwordHash');
    assert.ok(userInDb.passwordHash.startsWith('$2'));
  });

  test('Safely handles duplicate email/phone registration with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Attempt',
        email: validTestEmail,
        password: validPassword
      })
    });
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.success, false);
  });
});

describe('3. OTP Verification & Access Restrictions', () => {
  let authCustomer;
  let receivedOtp;

  before(async () => {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unverified Customer',
        email: `unverified_${uniqueId}@example.com`,
        password: validPassword
      })
    });
    const regData = await regRes.json();
    authCustomer = regData;
    receivedOtp = deliveredOtps.get(authCustomer.user.email);
    assert.ok(receivedOtp);
    assert.equal(Object.hasOwn(regData, '_testOtp'), false);
  });

  test('Unverified customer is denied access to protected marketplace features (HTTP 403)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/protected-feature`, {
      headers: { Authorization: `Bearer ${authCustomer.accessToken}` }
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.code, 'VERIFICATION_REQUIRED');
  });

  test('Submitting invalid OTP returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        recipient: authCustomer.user.email,
        otp: '000000'
      })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.message, 'Invalid OTP.');
  });

  test('OTP verification enforces attempt limits and expiry without exposing OTPs in API responses', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const invalidRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          recipient: authCustomer.user.email,
          otp: '111111'
        })
      });
      assert.equal(invalidRes.status, 400);
    }

    const limitedRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        recipient: authCustomer.user.email,
        otp: '111111'
      })
    });
    assert.equal(limitedRes.status, 429);

    const resendRes = await fetch(`${baseUrl}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'email', recipient: authCustomer.user.email })
    });
    assert.equal(resendRes.status, 200);
    const resendData = await resendRes.json();
    assert.equal(Object.hasOwn(resendData, '_testOtp'), false);
    assert.match(resendData.message, /OTP delivery is simulated/);
    receivedOtp = deliveredOtps.get(authCustomer.user.email);

    await User.updateOne(
      { email: authCustomer.user.email },
      { $set: { emailOtpExpiresAt: new Date(Date.now() - 1000) } }
    );
    const expiredRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        recipient: authCustomer.user.email,
        otp: receivedOtp
      })
    });
    assert.equal(expiredRes.status, 400);
    assert.equal((await expiredRes.json()).message, 'OTP has expired. Please request a new one.');

    const freshRes = await fetch(`${baseUrl}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'email', recipient: authCustomer.user.email })
    });
    assert.equal(freshRes.status, 200);
    receivedOtp = deliveredOtps.get(authCustomer.user.email);
  });

  test('Submitting correct OTP verifies user and unlocks protected features', async () => {
    const verifyRes = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'email',
        recipient: authCustomer.user.email,
        otp: receivedOtp
      })
    });

    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.success, true);
    assert.equal(verifyData.user.emailVerified, true);
    assert.equal(verifyData.user.status, 'active');

    // Access protected marketplace feature with the verified token
    const featureRes = await fetch(`${baseUrl}/api/auth/protected-feature`, {
      headers: { Authorization: `Bearer ${verifyData.accessToken}` }
    });
    assert.equal(featureRes.status, 200);
    const featureData = await featureRes.json();
    assert.equal(featureData.success, true);
  });
});

describe('4. Refresh Token Rotation & Revocation (RFC 6749)', () => {
  let sessionUser;
  let activeRefreshToken;

  before(async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Refresh Token Customer',
        email: `refresh_test_${uniqueId}@example.com`,
        password: validPassword
      })
    });
    const data = await loginRes.json();
    sessionUser = data.user;
    activeRefreshToken = data.refreshToken;
  });

  test('Refreshes session: returns new access token and rotated refresh token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: activeRefreshToken })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.accessToken);
    assert.ok(data.refreshToken);
    assert.notEqual(data.refreshToken, activeRefreshToken, 'Refresh token must rotate to a new token');

    // Store rotated token
    const previousToken = activeRefreshToken;
    activeRefreshToken = data.refreshToken;

    // Reuse Detection: Attempting to reuse the consumed previous token must trigger alarm & revoke family
    const reuseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: previousToken })
    });
    assert.equal(reuseRes.status, 403);
    const reuseData = await reuseRes.json();
    assert.ok(reuseData.message.includes('reuse detected'));

    // After reuse detection, even the active refresh token of that family is revoked
    const postCompromiseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: activeRefreshToken })
    });
    assert.equal(postCompromiseRes.status, 403);
  });

  test('Logout revokes refresh token', async () => {
    // Generate fresh session
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Logout Customer',
        email: `logout_${uniqueId}@example.com`,
        password: validPassword
      })
    });
    const regData = await regRes.json();

    // Call logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: regData.refreshToken })
    });
    assert.equal(logoutRes.status, 200);

    // Attempting to refresh with logged-out token fails
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: regData.refreshToken })
    });
    assert.equal(refreshRes.status, 403); // Revoked token reuse caught
  });
});

describe('5. Role-Based Access Control (RBAC)', () => {
  let customerToken;
  let vendorToken;
  let adminToken;

  before(async () => {
    // 1. Create Customer
    const cust = await User.create({
      name: 'Test Customer RBAC',
      email: `cust_rbac_${uniqueId}@example.com`,
      passwordHash: 'dummyhash',
      role: 'customer',
      status: 'active',
      emailVerified: true
    });
    customerToken = jwt.sign({ sub: cust.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '15m' });

    // 2. Create Vendor
    const vend = await User.create({
      name: 'Test Vendor RBAC',
      email: `vendor_rbac_${uniqueId}@example.com`,
      passwordHash: 'dummyhash',
      role: 'vendor',
      status: 'active',
      emailVerified: true
    });
    vendorToken = jwt.sign({ sub: vend.id, role: 'vendor' }, env.jwtAccessSecret, { expiresIn: '15m' });

    // 3. Create Admin
    const adm = await User.create({
      name: 'Test Admin RBAC',
      email: `admin_rbac_${uniqueId}@example.com`,
      passwordHash: 'dummyhash',
      role: 'admin',
      status: 'active',
      emailVerified: true
    });
    adminToken = jwt.sign({ sub: adm.id, role: 'admin' }, env.jwtAccessSecret, { expiresIn: '15m' });
  });

  test('Customer cannot access vendor zone or admin zone (HTTP 403)', async () => {
    const vendorRes = await fetch(`${baseUrl}/api/auth/vendor-zone`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(vendorRes.status, 403);

    const adminRes = await fetch(`${baseUrl}/api/auth/admin-zone`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert.equal(adminRes.status, 403);
  });

  test('Vendor can access vendor zone but cannot access admin zone', async () => {
    const vendorRes = await fetch(`${baseUrl}/api/auth/vendor-zone`, {
      headers: { Authorization: `Bearer ${vendorToken}` }
    });
    assert.equal(vendorRes.status, 200);

    const adminRes = await fetch(`${baseUrl}/api/auth/admin-zone`, {
      headers: { Authorization: `Bearer ${vendorToken}` }
    });
    assert.equal(adminRes.status, 403);
  });

  test('Admin can access both vendor zone and admin zone', async () => {
    const vendorRes = await fetch(`${baseUrl}/api/auth/vendor-zone`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(vendorRes.status, 200);

    const adminRes = await fetch(`${baseUrl}/api/auth/admin-zone`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminRes.status, 200);
  });
});

test('Login endpoint enforces its configured rate limit', async () => {
  let limitedAt;
  for (let attempt = 1; attempt <= 101; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'rate-limit-nonexistent@example.com', password: 'InvalidPassword123!' })
    });
    if (response.status === 429) {
      limitedAt = attempt;
      break;
    }
    assert.equal(response.status, 401);
  }
  assert.ok(limitedAt >= 5, 'The login endpoint should enforce its configured per-IP limit.');
});

test('Development OTP simulation never logs the code or recipient', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalConfiguredNodeEnv = env.nodeEnv;
  const originalOtpProvider = env.otpProvider;
  const originalInfo = console.info;
  const logMessages = [];

  try {
    process.env.NODE_ENV = 'development';
    env.nodeEnv = 'development';
    env.otpProvider = 'console';
    console.info = (...values) => logMessages.push(values.join(' '));
    await originalDeliverOtp.call(otpService, {
      channel: 'email',
      recipient: 'private-qa-recipient@example.com',
      otp: '982174'
    });

    const logs = logMessages.join(' ');
    assert.doesNotMatch(logs, /982174|private-qa-recipient@example\.com/);
    assert.match(logs, /simulated in development/);
  } finally {
    console.info = originalInfo;
    env.otpProvider = originalOtpProvider;
    env.nodeEnv = originalConfiguredNodeEnv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
