import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiting for login attempts to thwart credential stuffing & brute-force attacks.
 * Allows 5 attempts per 15-minute window per IP.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  }
});

/**
 * Strict rate limiter for sending OTPs to avoid SMS bombing and abuse.
 * Allows 3 OTP generation requests per 10-minute window per IP.
 */
export const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100 : 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many OTP requests. Please wait a few minutes before trying again.'
  }
});

