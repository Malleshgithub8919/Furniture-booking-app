import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { otpService } from '../src/services/otp.service.js';

const originalSettings = {
  otpProvider: env.otpProvider,
  smtpHost: env.smtpHost,
  smtpPort: env.smtpPort,
  smtpSecure: env.smtpSecure,
  smtpUser: env.smtpUser,
  smtpPass: env.smtpPass,
  smtpFrom: env.smtpFrom,
  smtpTimeoutMs: env.smtpTimeoutMs
};
const originalCreateTransport = otpService._createSmtpTransport;

function configureSmtp() {
  env.otpProvider = 'smtp';
  env.smtpHost = 'smtp.example.test';
  env.smtpPort = 465;
  env.smtpSecure = true;
  env.smtpUser = 'sender@example.test';
  env.smtpPass = 'test-secret';
  env.smtpFrom = 'Furniture Marketplace <sender@example.test>';
}

test('sends email OTP through configured SMTP without exposing delivery secrets', async () => {
  configureSmtp();
  let email;
  let closed = false;
  otpService._createSmtpTransport = () => ({
    async sendMail(message) {
      email = message;
      return { accepted: [message.to] };
    },
    close() {
      closed = true;
    }
  });

  try {
    const result = await otpService._sendEmailViaProvider(
      'customer@example.test',
      '123456'
    );

    assert.deepEqual(result, { success: true, provider: 'smtp' });
    assert.equal(email.to, 'customer@example.test');
    assert.equal(email.from, env.smtpFrom);
    assert.match(email.text, /123456/);
    assert.match(email.html, /123456/);
    assert.equal(closed, true);
  } finally {
    otpService._createSmtpTransport = originalCreateTransport;
  }
});

test('does not report success when SMTP delivery fails', async () => {
  configureSmtp();
  otpService._createSmtpTransport = () => ({
    async sendMail() {
      const error = new Error('SMTP credentials must not appear in reports.');
      error.code = 'EAUTH';
      throw error;
    },
    close() {}
  });
  const originalError = console.error;
  const logged = [];
  console.error = (...values) => logged.push(values.join(' '));

  try {
    await assert.rejects(
      otpService._sendEmailViaProvider('customer@example.test', '654321'),
      error => error.statusCode === 503 &&
        error.message === 'OTP email could not be delivered. Check the SMTP configuration and try again.'
    );
    assert.match(logged.join(' '), /EAUTH/);
    assert.doesNotMatch(logged.join(' '), /customer@example\.test|654321|test-secret/);
  } finally {
    otpService._createSmtpTransport = originalCreateTransport;
    console.error = originalError;
  }
});

test('requires SMTP settings before attempting email delivery', async () => {
  configureSmtp();
  env.smtpPass = '';

  await assert.rejects(
    otpService._sendEmailViaProvider('customer@example.test', '111111'),
    /SMTP is selected but its required settings are incomplete/
  );
});

test('returns a safe service-unavailable response when OTP delivery fails', () => {
  let statusCode;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    }
  };

  errorHandler(
    Object.assign(new Error('SMTP settings need attention.'), {
      name: 'OtpDeliveryError',
      statusCode: 503
    }),
    {},
    response,
    () => {}
  );

  assert.equal(statusCode, 503);
  assert.deepEqual(body, {
    success: false,
    code: 'OTP_DELIVERY_FAILED',
    message: 'SMTP settings need attention.'
  });
});

test.after(() => {
  Object.assign(env, originalSettings);
  otpService._createSmtpTransport = originalCreateTransport;
});
