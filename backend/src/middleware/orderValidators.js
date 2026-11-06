import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';

export function handleOrderValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

export const validateCheckout = [
  body('addressId')
    .notEmpty().withMessage('Delivery address ID is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid Address ID format.'),

  body('paymentMethod')
    .optional()
    .isIn(['cod', 'razorpay']).withMessage("Payment method must be 'cod' or 'razorpay'."),

  body('idempotencyKey')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 }).withMessage('Idempotency key cannot exceed 100 characters.'),

  handleOrderValidation
];

export const validateUpdateOrderStatus = [
  body('status')
    .trim()
    .notEmpty().withMessage('Status is required.')
    .isIn(['confirmed', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled'])
    .withMessage('Invalid order status transition.'),

  body('note')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('Status note cannot exceed 300 characters.'),

  handleOrderValidation
];

