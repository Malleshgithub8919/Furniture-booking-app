import { Router } from 'express';
import { customerController } from '../controllers/customer.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  validateAddToCart,
  validateUpdateCartItem,
  validateWishlistAction,
  validateAddress,
  validateUpdateAddress
} from '../middleware/customerValidators.js';

const router = Router();

// Protect all customer routes with authentication
router.use(authenticateToken);

// --- Cart Endpoints ---
router.get('/cart', customerController.getCart);
router.post('/cart', validateAddToCart, customerController.addToCart);
router.put('/cart/items/:itemId', validateUpdateCartItem, customerController.updateCartItem);
router.delete('/cart/items/:itemId', customerController.removeCartItem);
router.delete('/cart', customerController.clearCart);

// --- Wishlist Endpoints ---
router.get('/wishlist', customerController.getWishlist);
router.post('/wishlist', validateWishlistAction, customerController.addToWishlist);
router.delete('/wishlist/:productId', customerController.removeFromWishlist);
router.post('/wishlist/move-to-cart', validateWishlistAction, customerController.moveWishlistToCart);

// --- Address Book Endpoints ---
router.get('/addresses', customerController.listAddresses);
router.post('/addresses', validateAddress, customerController.createAddress);
router.put('/addresses/:id', validateUpdateAddress, customerController.updateAddress);
router.delete('/addresses/:id', customerController.deleteAddress);
router.patch('/addresses/:id/default', customerController.setDefaultAddress);

export default router;
