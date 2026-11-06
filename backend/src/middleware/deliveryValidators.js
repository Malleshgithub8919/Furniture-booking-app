import { body, query, validationResult } from 'express-validator';
import mongoose from 'mongoose';

export function handleDeliveryValidation(req, res, next) {
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

export const validateOnboardPartner = [
  body('phone')
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Valid 10-digit Indian mobile number starting with 6-9 is required.'),
  body('vehicleType')
    .isIn(['bike', 'scooter', 'van', 'mini_truck', 'truck'])
    .withMessage("vehicleType must be 'bike', 'scooter', 'van', 'mini_truck', or 'truck'."),
  body('vehicleNumber')
    .trim()
    .notEmpty()
    .withMessage('vehicleNumber is required.'),
  body('licenseNumber')
    .trim()
    .notEmpty()
    .withMessage('licenseNumber is required.'),
  body('identityProof.type')
    .isIn(['aadhaar', 'pan', 'driving_license', 'voter_id'])
    .withMessage("identityProof.type must be 'aadhaar', 'pan', 'driving_license', or 'voter_id'."),
  body('identityProof.documentNumber')
    .trim()
    .notEmpty()
    .withMessage('identityProof.documentNumber is required.'),
  handleDeliveryValidation
];

export const validateAvailability = [
  body('availabilityStatus')
    .isIn(['available', 'busy', 'offline'])
    .withMessage("availabilityStatus must be 'available', 'busy', or 'offline'."),
  handleDeliveryValidation
];

export const validateAdminReview = [
  body('status')
    .isIn(['approved', 'rejected', 'suspended'])
    .withMessage("status must be 'approved', 'rejected', or 'suspended'."),
  body('rejectionReason')
    .optional()
    .trim(),
  handleDeliveryValidation
];

export const validateAdminAvailability = [
  body('availabilityStatus')
    .isIn(['available', 'offline'])
    .withMessage("availabilityStatus must be 'available' or 'offline'."),
  handleDeliveryValidation
];

export const validateAssignDelivery = [
  body('vendorOrderId')
    .custom(val => mongoose.isValidObjectId(val))
    .withMessage('A valid vendorOrderId is required.'),
  body('deliveryPartnerId')
    .custom(val => mongoose.isValidObjectId(val))
    .withMessage('A valid deliveryPartnerId is required.'),
  handleDeliveryValidation
];

export const validateReassignDelivery = [
  body('newDeliveryPartnerId')
    .custom(val => mongoose.isValidObjectId(val))
    .withMessage('A valid newDeliveryPartnerId is required.'),
  body('reason')
    .trim()
    .isLength({ min: 5 })
    .withMessage('Reason must be at least 5 characters.'),
  handleDeliveryValidation
];

export const validateVerifyOtp = [
  body('otp')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('A 6-digit numeric OTP is required.'),
  handleDeliveryValidation
];

export const validateReportFailure = [
  body('reason')
    .trim()
    .isLength({ min: 5 })
    .withMessage('A failure reason of at least 5 characters is required.'),
  handleDeliveryValidation
];
