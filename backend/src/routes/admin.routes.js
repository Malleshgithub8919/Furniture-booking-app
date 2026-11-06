import { Router } from 'express';
import { vendorController } from '../controllers/vendor.controller.js';
import { productController } from '../controllers/product.controller.js';
import { adminController } from '../controllers/admin.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

// Protect all admin routes with authentication and 'admin' RBAC
router.use(authenticateToken, requireRole('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/customers', adminController.listCustomers);
router.patch('/customers/:id/status', adminController.updateCustomerStatus);
router.get('/products', adminController.listProducts);
router.get('/orders', adminController.listParentOrders);
router.get('/vendor-orders', adminController.listVendorOrders);
router.get('/payments', adminController.listPayments);

// Vendor Moderation Endpoints
router.get('/vendors', vendorController.adminListVendors);
router.get('/vendors/:id', vendorController.adminGetVendor);
router.patch('/vendors/:id/status', vendorController.adminUpdateStatus);
router.patch('/vendors/:id/kyc/:documentId', adminController.reviewVendorKycDocument);

// Product Moderation Endpoints
router.patch('/products/:id/status', productController.adminReviewProduct);

export default router;
