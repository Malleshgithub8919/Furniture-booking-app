import { Router } from 'express';
import { productController } from '../controllers/product.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { validateProduct, validateProductQuery } from '../middleware/catalogValidators.js';

const router = Router();

// 1. Vendor specific products listing (must come before /:slugOrId to avoid path collision)
router.get('/vendor/mine', authenticateToken, requireRole('vendor'), productController.getVendorProducts);

// 2. Public product catalog queries
router.get('/', validateProductQuery, productController.getPublicProducts);
router.get('/:slugOrId', productController.getPublicProductDetails);

// 3. Vendor Product Management
router.post('/', authenticateToken, requireRole('vendor'), validateProduct, productController.createProduct);
router.put('/:id', authenticateToken, requireRole('vendor'), productController.updateProduct);
router.delete('/:id', authenticateToken, requireRole('vendor'), productController.deleteProduct);

export default router;

