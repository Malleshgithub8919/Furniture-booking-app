import express from 'express';
import rateLimit from 'express-rate-limit';
import { paymentController } from '../controllers/payment.controller.js';
import { authenticateToken, requireRole, requireVerified } from '../middleware/auth.js';
import {
  validateCreatePaymentOrder,
  validateVerifyPayment,
  validateConfirmCod,
  validateExpireReservations
} from '../middleware/paymentValidators.js';

const router = express.Router();

// Rate limiter for payment creation & client verification (max 30 requests per 15 minutes)
const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many payment requests. Please try again later.'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

// 1. Webhook endpoint called by Razorpay servers (must NOT have JWT auth, verified cryptographically via HMAC)
router.post('/webhook', paymentController.handleWebhook);

// 2. Customer payment endpoints (Authenticated & Verified)
router.post(
  '/create-order',
  authenticateToken,
  requireVerified,
  paymentRateLimiter,
  validateCreatePaymentOrder,
  paymentController.createOnlineOrder
);

router.post(
  '/verify',
  authenticateToken,
  requireVerified,
  paymentRateLimiter,
  validateVerifyPayment,
  paymentController.verifyPayment
);

router.get(
  '/order/:orderId',
  authenticateToken,
  paymentController.getPaymentByOrder
);

// 3. Cash on Delivery confirmation (Admin or Delivery roles)
router.post(
  '/confirm-cod',
  authenticateToken,
  requireRole('admin', 'delivery'),
  validateConfirmCod,
  paymentController.confirmCod
);

// 4. Expiry / Inventory Release for unpaid online orders (Admin or Cron)
router.post(
  '/expire-unpaid',
  authenticateToken,
  requireRole('admin'),
  validateExpireReservations,
  paymentController.expireUnpaid
);

export default router;
