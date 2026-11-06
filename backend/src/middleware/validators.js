import { body, validationResult } from 'express-validator';

/**
 * Standard Indian Mobile Number Validator (10 digits starting with 6, 7, 8, or 9, optional +91 prefix).
 */
export const INDIAN_PHONE_REGEX = /^(?:\+91|91)?[6-9]\d{9}$/;

export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
}

export const validateRegister = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required.')
    .isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters.')
    .escape(),

  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail().withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(INDIAN_PHONE_REGEX).withMessage('Please provide a valid 10-digit Indian mobile number (e.g., 9876543210 or +919876543210).'),

  body('password')
    .isString().withMessage('Password must be a string.')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be between 8 and 128 characters long.'),

  // Custom validation rule: At least one of email or phone must be provided
  body().custom((value, { req }) => {
    const hasEmail = Boolean(req.body.email && req.body.email.trim());
    const hasPhone = Boolean(req.body.phone && req.body.phone.trim());
    if (!hasEmail && !hasPhone) {
      throw new Error('Either email or phone number is required to register.');
    }
    return true;
  }),

  // Disallow role tampering
  body('role').custom((role) => {
    if (role && role !== 'customer') {
      throw new Error('Public registration is permitted for customer accounts only.');
    }
    return true;
  }),

  handleValidationErrors
];

export const validateLogin = [
  body('identifier')
    .trim()
    .notEmpty().withMessage('Identifier (email or mobile number) is required.')
    .isLength({ max: 128 }).withMessage('Identifier is too long.'),

  body('password')
    .isString().withMessage('Password must be provided.')
    .notEmpty().withMessage('Password cannot be empty.')
    .isLength({ max: 128 }).withMessage('Password exceeds maximum length.'),

  handleValidationErrors
];

export const validateOtpRequest = [
  body('channel')
    .isIn(['email', 'phone']).withMessage("Channel must be either 'email' or 'phone'."),

  body('recipient')
    .trim()
    .notEmpty().withMessage('Recipient is required.')
    .custom((val, { req }) => {
      if (req.body.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        throw new Error('Please provide a valid email recipient.');
      }
      if (req.body.channel === 'phone' && !INDIAN_PHONE_REGEX.test(val)) {
        throw new Error('Please provide a valid Indian phone recipient.');
      }
      return true;
    }),

  handleValidationErrors
];

export const validateOtpVerification = [
  body('channel')
    .isIn(['email', 'phone']).withMessage("Channel must be either 'email' or 'phone'."),

  body('recipient')
    .trim()
    .notEmpty().withMessage('Recipient is required.'),

  body('otp')
    .trim()
    .matches(/^\d{6}$/).withMessage('OTP must be a 6-digit numeric code.'),

  handleValidationErrors
];

