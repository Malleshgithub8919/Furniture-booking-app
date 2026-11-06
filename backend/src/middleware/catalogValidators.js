import { body, query, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { ALLOWED_KYC_MIME_TYPES, MAX_KYC_FILE_SIZE } from '../services/storage.service.js';

export function handleCatalogValidation(req, res, next) {
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

export const validateVendorOnboard = [
  body('storeName')
    .trim()
    .notEmpty().withMessage('Store name is required.')
    .isLength({ max: 120 }).withMessage('Store name cannot exceed 120 characters.'),

  body('businessType')
    .optional()
    .isIn(['individual', 'partnership', 'private_limited', 'proprietorship'])
    .withMessage('Invalid business type.'),

  body('gstin')
    .optional({ checkFalsy: true })
    .trim()
    .toUpperCase()
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .withMessage('Invalid Indian GSTIN format (e.g. 29AAAAA0000A1Z5).'),

  body('pan')
    .optional({ checkFalsy: true })
    .trim()
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage('Invalid Indian PAN format (e.g. ABCDE1234F).'),

  body('address.city')
    .trim()
    .notEmpty().withMessage('City is required.'),

  body('address.state')
    .trim()
    .notEmpty().withMessage('State is required.'),

  body('address.postalCode')
    .trim()
    .notEmpty().withMessage('Postal code is required.'),

  handleCatalogValidation
];

export const validateKycUpload = [
  body('documentType')
    .isIn(['pan_card', 'gst_certificate', 'business_proof', 'bank_proof', 'id_proof'])
    .withMessage('Invalid KYC document type.'),

  body('originalName')
    .trim()
    .notEmpty().withMessage('Original file name is required.'),

  body('mimeType')
    .isIn(ALLOWED_KYC_MIME_TYPES)
    .withMessage('Invalid file format. Only PDF, JPEG, PNG, and WEBP are allowed.'),

  body('sizeBytes')
    .isInt({ min: 1, max: MAX_KYC_FILE_SIZE })
    .withMessage('File size must be an integer between 1 byte and 5 MB.'),

  handleCatalogValidation
];

export const validateCategory = [
  body('name')
    .trim()
    .notEmpty().withMessage('Category name is required.')
    .isLength({ max: 100 }).withMessage('Category name cannot exceed 100 characters.'),

  body('parentId')
    .optional({ checkFalsy: true })
    .custom(val => mongoose.isValidObjectId(val))
    .withMessage('Invalid parent category ID.'),

  handleCatalogValidation
];

export const validateProduct = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required.')
    .isLength({ max: 200 }).withMessage('Product name cannot exceed 200 characters.'),

  body('description')
    .trim()
    .notEmpty().withMessage('Product description is required.'),

  body('sku')
    .trim()
    .notEmpty().withMessage('SKU is required.')
    .isLength({ min: 3, max: 40 }).withMessage('SKU must be between 3 and 40 characters.')
    .toUpperCase(),

  body('categoryId')
    .notEmpty().withMessage('Category ID is required.')
    .custom(val => mongoose.isValidObjectId(val)).withMessage('Invalid Category ID format.'),

  // Price must be an integer in paise (e.g. ₹100 = 10000 paise)
  body('price')
    .isInt({ min: 0 }).withMessage('Price must be an integer represented in paise (cannot be negative).'),

  body('salePrice')
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage('Sale price must be an integer represented in paise.')
    .custom((val, { req }) => {
      if (val !== undefined && val !== null && val > req.body.price) {
        throw new Error('Sale price cannot be greater than base price.');
      }
      return true;
    }),

  body('stock')
    .isInt({ min: 0 }).withMessage('Stock must be an integer greater than or equal to 0.'),

  body('dimensions.length')
    .optional()
    .isFloat({ min: 0 }).withMessage('Length cannot be negative.'),

  body('dimensions.width')
    .optional()
    .isFloat({ min: 0 }).withMessage('Width cannot be negative.'),

  body('dimensions.height')
    .optional()
    .isFloat({ min: 0 }).withMessage('Height cannot be negative.'),

  handleCatalogValidation
];

export const validateProductQuery = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('minPrice').optional().isInt({ min: 0 }).toInt(),
  query('maxPrice').optional().isInt({ min: 0 }).toInt(),
  handleCatalogValidation
];

