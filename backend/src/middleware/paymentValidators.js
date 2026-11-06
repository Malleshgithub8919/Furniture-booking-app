import { body, query, validationResult } from 'express-validator';
import mongoose from 'mongoose';

export function handlePaymentValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: errors.array().map(e => ({ field: e.path, message: e.msg }))
      }
    });
  }
  next();
}

export const validateCreatePaymentOrder = [
  body('orderId')
    .notEmpty().withMessage('orderId is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid orderId format.'),
  handlePaymentValidation
];

export const validateVerifyPayment = [
  body('orderId')
    .notEmpty().withMessage('orderId is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid orderId format.'),
  body('razorpayOrderId')
    .trim()
    .notEmpty().withMessage('razorpayOrderId is required.'),
  body('razorpayPaymentId')
    .trim()
    .notEmpty().withMessage('razorpayPaymentId is required.'),
  body('razorpaySignature')
    .trim()
    .notEmpty().withMessage('razorpaySignature is required.'),
  handlePaymentValidation
];

export const validateConfirmCod = [
  body('orderId')
    .notEmpty().withMessage('orderId is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid orderId format.'),
  handlePaymentValidation
];

export const validateExpireReservations = [
  query('expiryMinutes')
    .optional()
    .isInt({ min: 1 }).withMessage('expiryMinutes must be a positive integer.'),
  handlePaymentValidation
];
