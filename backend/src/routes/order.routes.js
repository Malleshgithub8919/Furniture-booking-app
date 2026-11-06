import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateCheckout } from '../middleware/orderValidators.js';

const router = Router();

// Protect all customer order operations with authentication
router.use(authenticateToken);

router.post('/checkout', validateCheckout, orderController.checkout);
router.get('/mine', orderController.listCustomerOrders);
router.get('/mine/:idOrNumber', orderController.getCustomerOrderDetails);
router.post('/mine/:id/cancel', orderController.cancelCustomerOrder);

export default router;

