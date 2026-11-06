import { Router } from 'express';
import { categoryController } from '../controllers/category.controller.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { validateCategory } from '../middleware/catalogValidators.js';

const router = Router();

// Public Category Endpoints
router.get('/', categoryController.listCategories);
router.get('/:slug', categoryController.getBySlug);

// Admin Category Management
router.post('/', authenticateToken, requireRole('admin'), validateCategory, categoryController.createCategory);
router.put('/:id', authenticateToken, requireRole('admin'), validateCategory, categoryController.updateCategory);

export default router;

