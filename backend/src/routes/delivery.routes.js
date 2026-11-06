import express from 'express';
import rateLimit from 'express-rate-limit';
import { deliveryController } from '../controllers/delivery.controller.js';
import { authenticateToken, requireRole, requireVerified } from '../middleware/auth.js';
import {
  validateOnboardPartner,
  validateAvailability,
  validateAdminReview,
  validateAdminAvailability,
  validateAssignDelivery,
  validateReassignDelivery,
  validateVerifyOtp,
  validateReportFailure
} from '../middleware/deliveryValidators.js';

const router = express.Router();

// Rate limiter for sensitive OTP verifications (max 20 requests per 10 minutes)
const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many OTP verification attempts. Please wait before retrying.'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

// ================= DELIVERY PARTNER PORTAL ================= //

router.post(
  '/onboard',
  authenticateToken,
  requireVerified,
  validateOnboardPartner,
  deliveryController.onboard
);

router.get(
  '/profile/me',
  authenticateToken,
  requireRole('delivery', 'admin'),
  deliveryController.getProfile
);

router.patch(
  '/availability',
  authenticateToken,
  requireRole('delivery'),
  validateAvailability,
  deliveryController.updateAvailability
);

router.get(
  '/assignments/mine',
  authenticateToken,
  requireRole('delivery'),
  deliveryController.listMyAssignments
);

router.get(
  '/assignments/:id',
  authenticateToken,
  requireRole('delivery', 'admin'),
  deliveryController.getAssignmentDetails
);

router.patch(
  '/assignments/:id/status',
  authenticateToken,
  requireRole('delivery'),
  deliveryController.updateStatus
);

router.post(
  '/assignments/:id/verify-pickup',
  authenticateToken,
  requireRole('delivery'),
  otpRateLimiter,
  validateVerifyOtp,
  deliveryController.verifyPickup
);

router.post(
  '/assignments/:id/verify-delivery',
  authenticateToken,
  requireRole('delivery'),
  otpRateLimiter,
  validateVerifyOtp,
  deliveryController.verifyDelivery
);

router.post(
  '/assignments/:id/report-failure',
  authenticateToken,
  requireRole('delivery'),
  validateReportFailure,
  deliveryController.reportFailure
);

// ================= CUSTOMER DELIVERY TRACKING ================= //

router.get(
  '/track/order/:id',
  authenticateToken,
  deliveryController.getCustomerTracking
);

// ================= ADMIN DISPATCH & MANAGEMENT ================= //

router.get(
  '/admin/partners',
  authenticateToken,
  requireRole('admin'),
  deliveryController.adminListPartners
);

router.get(
  '/admin/partners/:id',
  authenticateToken,
  requireRole('admin'),
  deliveryController.adminGetPartner
);

router.patch(
  '/admin/partners/:id/status',
  authenticateToken,
  requireRole('admin'),
  validateAdminReview,
  deliveryController.adminReviewPartner
);

router.patch(
  '/admin/partners/:id/availability',
  authenticateToken,
  requireRole('admin'),
  validateAdminAvailability,
  deliveryController.adminUpdatePartnerAvailability
);

router.post(
  '/admin/assign',
  authenticateToken,
  requireRole('admin'),
  validateAssignDelivery,
  deliveryController.adminAssign
);

router.post(
  '/admin/assignments/:id/reassign',
  authenticateToken,
  requireRole('admin'),
  validateReassignDelivery,
  deliveryController.adminReassign
);

router.get(
  '/admin/assignments',
  authenticateToken,
  requireRole('admin'),
  deliveryController.adminListAssignments
);

export default router;
