import mongoose from 'mongoose';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { env } from '../src/config/env.js';
import {
  AdminProvisioningError,
  provisionFirstAdmin,
  validateAdminIdentity
} from '../src/services/adminProvisioning.service.js';

let rl;

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new AdminProvisioningError('Admin provisioning requires an interactive terminal.');
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = chunk => {
      const input = chunk.toString('utf8');
      for (const character of input) {
        if (character === '\u0003') {
          cleanup();
          reject(new AdminProvisioningError('Admin provisioning cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  if (process.env.ALLOW_ADMIN_BOOTSTRAP !== 'true') {
    throw new AdminProvisioningError('Set ALLOW_ADMIN_BOOTSTRAP=true for this one-time command.');
  }
  if (env.nodeEnv === 'test' || !env.mongoUri) {
    throw new AdminProvisioningError('Provisioning requires a configured non-test MongoDB database.');
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new AdminProvisioningError('Admin provisioning requires an interactive terminal.');
  }

  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
  if (/test/i.test(mongoose.connection.name)) {
    throw new AdminProvisioningError('Provisioning is not allowed against a test database.');
  }

  rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write('This command can create only the first admin in the currently configured MongoDB database.\n');
  stdout.write('It will not modify an existing account. Confirm that this is the intended database.\n\n');

  const identity = validateAdminIdentity(
    await rl.question('Administrator name: '),
    await rl.question('Administrator email: ')
  );
  rl.close();
  rl = null;

  const password = await readHidden('New password (minimum 12 characters): ');
  const confirmation = await readHidden('Confirm new password: ');
  if (password !== confirmation) throw new AdminProvisioningError('Passwords do not match.');

  await provisionFirstAdmin({ ...identity, password });
  stdout.write('First admin account created. Sign in through the admin panel.\n');
}

try {
  await main();
} catch (error) {
  if (error instanceof AdminProvisioningError) {
    stdout.write(`${error.message}\n`);
  } else {
    stdout.write(`Admin provisioning failed (${error?.name || 'unknown error'}). Check database connectivity and permissions.\n`);
  }
  process.exitCode = 1;
} finally {
  rl?.close();
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
    } catch (error) {
      stdout.write(`Could not close the MongoDB connection (${error?.name || 'unknown error'}).\n`);
      process.exitCode = 1;
    }
  }
}
