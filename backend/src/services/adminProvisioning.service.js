import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lockId = 'first-admin';

export class AdminProvisioningError extends Error {}

export function validateAdminIdentity(name, email) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw new AdminProvisioningError('Name must contain 1 to 100 characters.');
  }

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalizedEmail.length > 254 || !emailPattern.test(normalizedEmail)) {
    throw new AdminProvisioningError('Enter a valid email address.');
  }

  return { name: name.trim(), email: normalizedEmail };
}

export function validateAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new AdminProvisioningError('Password must contain 12 to 128 characters.');
  }
  return password;
}

function validateInput({ name, email, password } = {}) {
  const identity = validateAdminIdentity(name, email);
  validateAdminPassword(password);
  return { ...identity, password };
}

async function completeProvisioning(collection) {
  const result = await collection.updateOne(
    { _id: lockId, state: 'locked' },
    { $set: { state: 'completed', completedAt: new Date() } }
  );
  if (result.matchedCount !== 1) {
    throw new AdminProvisioningError('Could not finalize the provisioning lock; check the database before retrying.');
  }
}

async function acquireProvisioningLock(collection) {
  try {
    const result = await collection.updateOne(
      { _id: lockId, state: 'available' },
      { $set: { state: 'locked', lockedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    if (result.matchedCount !== 1 && result.upsertedCount !== 1) {
      throw new AdminProvisioningError('First-admin provisioning is already completed or in progress.');
    }
  } catch (error) {
    if (error.code === 11000) {
      throw new AdminProvisioningError('First-admin provisioning is already completed or in progress.');
    }
    throw error;
  }
}

export async function provisionFirstAdmin(input) {
  const { name, email, password } = validateInput(input);
  if (mongoose.connection.readyState !== 1) {
    throw new AdminProvisioningError('Connect to the configured MongoDB database before provisioning.');
  }

  const collection = mongoose.connection.db.collection('admin_provisioning');
  let lockAcquired = false;

  try {
    if (await User.exists({ role: 'admin' })) {
      throw new AdminProvisioningError('An admin account already exists; no account was changed.');
    }

    await acquireProvisioningLock(collection);
    lockAcquired = true;

    if (await User.exists({ role: 'admin' })) {
      await completeProvisioning(collection);
      lockAcquired = false;
      throw new AdminProvisioningError('An admin account already exists; no account was changed.');
    }

    if (await User.exists({ email })) {
      throw new AdminProvisioningError('That email already belongs to an account; no account was changed.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({
      name,
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
      emailVerified: true
    });

    await completeProvisioning(collection);
    lockAcquired = false;
  } catch (error) {
    if (error.code === 11000 && (error.keyPattern?.email || error.keyValue?.email)) {
      throw new AdminProvisioningError('That email already belongs to an account; no account was changed.');
    }
    throw error;
  } finally {
    if (lockAcquired && mongoose.connection.readyState === 1) {
      try {
        await collection.updateOne(
          { _id: lockId, state: 'locked' },
          { $set: { state: 'available' }, $unset: { lockedAt: '' } }
        );
      } catch {
        throw new AdminProvisioningError('Could not release the provisioning lock; check the database before retrying.');
      }
    }
  }
}
