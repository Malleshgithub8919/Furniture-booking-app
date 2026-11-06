import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import {
  validateRegister,
  validateLogin,
  validateOtpRequest,
  validateOtpVerification
} from '../middleware/validators.js';
import { loginLimiter, otpRequestLimiter } from '../middleware/rateLimiters.js';
import {
  authenticateToken,
  requireRole,
  requireVerified
} from '../middleware/auth.js';

const router = Router();

// Public Authentication Endpoints
router.post('/register', validateRegister, authController.register);
router.post('/login', loginLimiter, validateLogin, authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);

// OTP Verification Endpoints
router.post('/otp/send', otpRequestLimiter, validateOtpRequest, authController.requestOtp);
router.post('/otp/verify', validateOtpVerification, authController.verifyOtp);

// Authenticated User Profile
router.get('/me', authenticateToken, authController.getProfile);

// RBAC & Verification Protected Verification Endpoints (Verification & Role demonstration)
router.get('/protected-feature', authenticateToken, requireVerified, (req, res) => {
  res.json({
    success: true,
    message: 'Authorized: You have accessed a protected marketplace feature.',
    user: { id: req.user.id, role: req.user.role }
  });
});

router.get('/vendor-zone', authenticateToken, requireRole('vendor', 'admin'), (req, res) => {
  res.json({
    success: true,
    message: 'Authorized: Vendor area accessed.',
    role: req.user.role
  });
});

router.get('/admin-zone', authenticateToken, requireRole('admin'), (req, res) => {
  res.json({
    success: true,
    message: 'Authorized: Admin control plane accessed.',
    role: req.user.role
  });
});

export default router;
