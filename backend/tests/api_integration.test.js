import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';

let server;
let baseUrl;
const testSuffix = Date.now().toString().slice(-6);
const syntheticEmail = `test_customer_${testSuffix}@example.com`;
const syntheticPassword = 'Password123!';
const syntheticName = 'Test Automated Customer';

before(async () => {
  // Use isolated test database to protect production/development data
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  if (testDbUri) {
    await mongoose.connect(testDbUri);
    await User.init();
  }

  // Start server on an ephemeral port
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  try {
    // Clean up test customer from test database
    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({ email: syntheticEmail });
      await mongoose.disconnect();
    }
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test('GET /api/health returns 200 with service status', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'furniture-marketplace-api');
});

test('GET /api/ready reports database connectivity', async () => {
  const res = await fetch(`${baseUrl}/api/ready`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.api, 'ready');
  assert.equal(data.database, 'connected');
});

test('POST /api/auth/register validates required fields and password length', async () => {
  // Missing all fields
  const emptyRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(emptyRes.status, 400);
  const emptyData = await emptyRes.json();
  assert.equal(emptyData.success, false);

  // Password too short (< 8 chars)
  const shortPassRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: syntheticName,
      email: syntheticEmail,
      password: 'short'
    })
  });
  assert.equal(shortPassRes.status, 400);
  const shortPassData = await shortPassRes.json();
  assert.equal(shortPassData.success, false);
});

test('POST /api/auth/register successfully registers new customer with hashed password', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: syntheticName,
      email: syntheticEmail,
      password: syntheticPassword
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.user.name, syntheticName);
  assert.equal(data.user.email, syntheticEmail);
  assert.equal(data.user.role, 'customer');

  // Verify in MongoDB that password is encrypted and not stored as plaintext
  const dbUser = await User.findOne({ email: syntheticEmail }).select('+passwordHash');
  assert.ok(dbUser);
  assert.notEqual(dbUser.passwordHash, syntheticPassword);
  assert.ok(dbUser.passwordHash.startsWith('$2')); // bcrypt hash signature
});

test('POST /api/auth/register rejects duplicate email with 409 Conflict', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: syntheticName,
      email: syntheticEmail,
      password: syntheticPassword
    })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('POST /api/auth/login validates credentials and issues signed JWT', async () => {
  // Invalid password
  const badPassRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: syntheticEmail,
      password: 'WrongPassword999!'
    })
  });
  assert.equal(badPassRes.status, 401);

  // Valid credentials
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: syntheticEmail,
      password: syntheticPassword
    })
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.equal(loginData.success, true);
  assert.ok(loginData.accessToken);
  assert.equal(loginData.user.email, syntheticEmail);

  // Verify JWT signature and payload
  const decoded = jwt.verify(loginData.accessToken, env.jwtAccessSecret);
  assert.equal(decoded.sub, loginData.user.id);
  assert.equal(decoded.role, 'customer');
});

