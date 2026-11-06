import { Router } from 'express';
import { vendorController } from '../controllers/vendor.controller.js';
import { orderController } from '../controllers/order.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { validateVendorOnboard, validateKycUpload } from '../middleware/catalogValidators.js';
import { validateUpdateOrderStatus } from '../middleware/orderValidators.js';

const router = Router();

// Vendor Self-Service & KYC Endpoints
router.post('/onboard', authenticateToken, validateVendorOnboard, vendorController.onboard);
router.get('/me', authenticateToken, vendorController.getMyProfile);
router.put('/me', authenticateToken, vendorController.updateMyProfile);
router.post('/me/kyc', authenticateToken, validateKycUpload, vendorController.uploadKycDocument);

// Vendor Order Fulfillment & Management Endpoints (Requires 'vendor' role)
router.get('/orders/mine', authenticateToken, requireRole('vendor'), orderController.listVendorOrders);
router.get('/orders/:id', authenticateToken, requireRole('vendor'), orderController.getVendorOrderDetails);
router.patch('/orders/:id/status', authenticateToken, requireRole('vendor'), validateUpdateOrderStatus, orderController.updateVendorOrderStatus);
router.post('/orders/:id/cancel', authenticateToken, requireRole('vendor'), orderController.cancelByVendor);

export default router;
