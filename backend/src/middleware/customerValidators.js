import { body, param, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { INDIAN_PHONE_REGEX } from './validators.js';

export const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;

export function handleCustomerValidation(req, res, next) {
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

export const validateAddToCart = [
  body('productId')
    .notEmpty().withMessage('Product ID is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid Product ID format.'),

  body('quantity')
    .optional()
    .isInt({ min: 1, max: 20 }).withMessage('Quantity must be an integer between 1 and 20.'),

  body('selectedColor')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 50 }).withMessage('Color selection cannot exceed 50 characters.')
    .escape(),

  body('selectedMaterial')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 50 }).withMessage('Material selection cannot exceed 50 characters.')
    .escape(),

  body('customNote')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 250 }).withMessage('Customization note cannot exceed 250 characters.')
    .escape(),

  handleCustomerValidation
];

export const validateUpdateCartItem = [
  body('quantity')
    .notEmpty().withMessage('Quantity is required.')
    .isInt({ min: 1, max: 20 }).withMessage('Quantity must be an integer between 1 and 20.'),

  handleCustomerValidation
];

export const validateWishlistAction = [
  body('productId')
    .notEmpty().withMessage('Product ID is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid Product ID format.'),

  handleCustomerValidation
];

export const validateAddress = [
  body('fullName')
    .trim()
    .notEmpty().withMessage('Full name is required.')
    .isLength({ max: 100 }).withMessage('Full name cannot exceed 100 characters.')
    .escape(),

  body('phone')
    .trim()
    .notEmpty().withMessage('Mobile number is required.')
    .matches(INDIAN_PHONE_REGEX).withMessage('Invalid 10-digit Indian mobile number.'),

  body('alternatePhone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(INDIAN_PHONE_REGEX).withMessage('Invalid alternate 10-digit Indian mobile number.'),

  body('street')
    .trim()
    .notEmpty().withMessage('Street address is required.')
    .isLength({ max: 250 }).withMessage('Street address cannot exceed 250 characters.')
    .escape(),

  body('city')
    .trim()
    .notEmpty().withMessage('City is required.')
    .isLength({ max: 80 }).withMessage('City cannot exceed 80 characters.')
    .escape(),

  body('state')
    .trim()
    .notEmpty().withMessage('State is required.')
    .isLength({ max: 80 }).withMessage('State cannot exceed 80 characters.')
    .escape(),

  body('postalCode')
    .trim()
    .notEmpty().withMessage('Postal PIN code is required.')
    .matches(INDIAN_PINCODE_REGEX).withMessage('Postal code must be a valid 6-digit Indian PIN code (e.g. 560001).'),

  body('addressType')
    .optional()
    .isIn(['home', 'work', 'other']).withMessage("Address type must be 'home', 'work', or 'other'."),

  body('isDefault')
    .optional()
    .isBoolean().withMessage('isDefault must be a boolean value.'),

  handleCustomerValidation
];

export const validateUpdateAddress = [
  body('fullName')
    .optional()
    .trim()
    .notEmpty().withMessage('Full name cannot be empty.')
    .isLength({ max: 100 }).withMessage('Full name cannot exceed 100 characters.')
    .escape(),

  body('phone')
    .optional()
    .trim()
    .matches(INDIAN_PHONE_REGEX).withMessage('Invalid 10-digit Indian mobile number.'),

  body('alternatePhone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(INDIAN_PHONE_REGEX).withMessage('Invalid alternate 10-digit Indian mobile number.'),

  body('street')
    .optional()
    .trim()
    .notEmpty().withMessage('Street address cannot be empty.')
    .isLength({ max: 250 }).withMessage('Street address cannot exceed 250 characters.')
    .escape(),

  body('city')
    .optional()
    .trim()
    .notEmpty().withMessage('City cannot be empty.')
    .isLength({ max: 80 }).withMessage('City cannot exceed 80 characters.')
    .escape(),

  body('state')
    .optional()
    .trim()
    .notEmpty().withMessage('State cannot be empty.')
    .isLength({ max: 80 }).withMessage('State cannot exceed 80 characters.')
    .escape(),

  body('postalCode')
    .optional()
    .trim()
    .matches(INDIAN_PINCODE_REGEX).withMessage('Postal code must be a valid 6-digit Indian PIN code.'),

  body('addressType')
    .optional()
    .isIn(['home', 'work', 'other']).withMessage("Address type must be 'home', 'work', or 'other'."),

  body('isDefault')
    .optional()
    .isBoolean().withMessage('isDefault must be a boolean value.'),

  handleCustomerValidation
];
