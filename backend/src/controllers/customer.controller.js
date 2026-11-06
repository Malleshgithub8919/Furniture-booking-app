import Cart from '../models/Cart.js';
import Wishlist from '../models/Wishlist.js';
import Address from '../models/Address.js';
import Product from '../models/Product.js';
import { cartService } from '../services/cart.service.js';

export const customerController = {
  // ==========================================
  // CART OPERATIONS
  // ==========================================

  /**
   * View authenticated customer's cart with server-side price calculation and stock checks.
   */
  async getCart(req, res, next) {
    try {
      let cart = await Cart.findOne({ userId: req.user._id });
      if (!cart) {
        cart = await Cart.create({ userId: req.user._id, items: [] });
      }

      const calculated = await cartService.calculateCart(cart);

      return res.json({
        success: true,
        cart: calculated
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Add item to cart with live product validation and customization checks.
   */
  async addToCart(req, res, next) {
    try {
      const { productId, quantity = 1, selectedColor, selectedMaterial, customNote } = req.body;

      // 1. Live product query - Rule 8: Recheck product approval and stock
      const product = await Product.findById(productId);
      if (!product || product.status !== 'approved') {
        return res.status(404).json({
          success: false,
          code: 'PRODUCT_NOT_AVAILABLE',
          message: 'The requested product is not available for purchase.'
        });
      }

      // Check stock
      const availableStock = Math.max(0, product.stock - (product.reservedStock || 0));
      if (availableStock < quantity) {
        return res.status(400).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `Requested quantity (${quantity}) exceeds currently available stock (${availableStock}).`
        });
      }

      // 2. Validate customization options - Rule 9
      const customCheck = cartService.validateCustomization(product, { selectedColor, selectedMaterial });
      if (!customCheck.valid) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMIZATION',
          message: customCheck.message
        });
      }

      // 3. Find or create user cart
      let cart = await Cart.findOne({ userId: req.user._id });
      if (!cart) {
        cart = new Cart({ userId: req.user._id, items: [] });
      }

      // 4. Check if item with identical customizations already exists in cart
      const existingItemIndex = cart.items.findIndex(item =>
        item.productId.toString() === productId &&
        (item.selectedColor || null) === (selectedColor || null) &&
        (item.selectedMaterial || null) === (selectedMaterial || null)
      );

      if (existingItemIndex > -1) {
        const newTotalQty = cart.items[existingItemIndex].quantity + quantity;
        if (newTotalQty > availableStock) {
          return res.status(400).json({
            success: false,
            code: 'INSUFFICIENT_STOCK',
            message: `Cannot add more units. Total in cart (${newTotalQty}) exceeds available stock (${availableStock}).`
          });
        }
        cart.items[existingItemIndex].quantity = newTotalQty;
        if (customNote) cart.items[existingItemIndex].customNote = customNote;
      } else {
        cart.items.push({
          productId,
          quantity,
          selectedColor: selectedColor || null,
          selectedMaterial: selectedMaterial || null,
          customNote: customNote || null
        });
      }

      await cart.save();

      // Return server-recalculated cart
      const calculated = await cartService.calculateCart(cart);

      return res.status(200).json({
        success: true,
        message: 'Item added to cart successfully.',
        cart: calculated
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update quantity of a specific item in the cart.
   */
  async updateCartItem(req, res, next) {
    try {
      const { itemId } = req.params;
      const { quantity } = req.body;

      const cart = await Cart.findOne({ userId: req.user._id });
      if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found.' });
      }

      const item = cart.items.id(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Item not found in cart.' });
      }

      // Recheck live product stock
      const product = await Product.findById(item.productId);
      if (!product || product.status !== 'approved') {
        return res.status(400).json({
          success: false,
          code: 'PRODUCT_UNAVAILABLE',
          message: 'Product is no longer available.'
        });
      }

      const availableStock = Math.max(0, product.stock - (product.reservedStock || 0));
      if (quantity > availableStock) {
        return res.status(400).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `Requested quantity exceeds available stock (${availableStock}).`
        });
      }

      item.quantity = quantity;
      await cart.save();

      const calculated = await cartService.calculateCart(cart);

      return res.json({
        success: true,
        message: 'Cart quantity updated.',
        cart: calculated
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Remove item from cart.
   */
  async removeCartItem(req, res, next) {
    try {
      const { itemId } = req.params;
      const cart = await Cart.findOne({ userId: req.user._id });
      if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found.' });
      }

      cart.items = cart.items.filter(item => item._id.toString() !== itemId);
      await cart.save();

      const calculated = await cartService.calculateCart(cart);

      return res.json({
        success: true,
        message: 'Item removed from cart.',
        cart: calculated
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Clear all items from cart.
   */
  async clearCart(req, res, next) {
    try {
      const cart = await Cart.findOne({ userId: req.user._id });
      if (cart) {
        cart.items = [];
        await cart.save();
      }

      return res.json({
        success: true,
        message: 'Cart cleared.',
        cart: { items: [], summary: { itemCount: 0, subtotal: 0, currency: 'INR' } }
      });
    } catch (error) {
      next(error);
    }
  },

  // ==========================================
  // WISHLIST OPERATIONS
  // ==========================================

  /**
   * Get authenticated customer's wishlist.
   */
  async getWishlist(req, res, next) {
    try {
      let wishlist = await Wishlist.findOne({ userId: req.user._id })
        .populate({
          path: 'products',
          match: { status: 'approved' },
          select: 'name slug price salePrice stock images categoryId vendorId',
          populate: [
            { path: 'categoryId', select: 'name slug' },
            { path: 'vendorId', select: 'storeName' }
          ]
        });

      if (!wishlist) {
        wishlist = await Wishlist.create({ userId: req.user._id, products: [] });
      }

      return res.json({
        success: true,
        products: wishlist.products || [],
        total: (wishlist.products || []).length
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Add a product to wishlist.
   */
  async addToWishlist(req, res, next) {
    try {
      const { productId } = req.body;

      const product = await Product.findById(productId);
      if (!product || product.status !== 'approved') {
        return res.status(404).json({
          success: false,
          message: 'Product not found or not currently active.'
        });
      }

      let wishlist = await Wishlist.findOne({ userId: req.user._id });
      if (!wishlist) {
        wishlist = new Wishlist({ userId: req.user._id, products: [] });
      }

      const exists = wishlist.products.some(p => p.toString() === productId);
      if (!exists) {
        wishlist.products.push(productId);
        await wishlist.save();
      }

      return res.status(201).json({
        success: true,
        message: 'Product added to wishlist.',
        total: wishlist.products.length
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Remove a product from wishlist.
   */
  async removeFromWishlist(req, res, next) {
    try {
      const { productId } = req.params;

      const wishlist = await Wishlist.findOne({ userId: req.user._id });
      if (wishlist) {
        wishlist.products = wishlist.products.filter(p => p.toString() !== productId);
        await wishlist.save();
      }

      return res.json({
        success: true,
        message: 'Product removed from wishlist.',
        total: wishlist ? wishlist.products.length : 0
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Move item from wishlist to cart.
   */
  async moveWishlistToCart(req, res, next) {
    try {
      const { productId } = req.body;

      // 1. Remove from wishlist
      const wishlist = await Wishlist.findOne({ userId: req.user._id });
      if (wishlist) {
        wishlist.products = wishlist.products.filter(p => p.toString() !== productId);
        await wishlist.save();
      }

      // 2. Delegate to addToCart logic
      req.body.quantity = req.body.quantity || 1;
      return customerController.addToCart(req, res, next);
    } catch (error) {
      next(error);
    }
  },

  // ==========================================
  // ADDRESS BOOK OPERATIONS
  // ==========================================

  /**
   * List all addresses for authenticated customer.
   */
  async listAddresses(req, res, next) {
    try {
      const addresses = await Address.find({ userId: req.user._id })
        .sort({ isDefault: -1, createdAt: -1 });

      return res.json({
        success: true,
        addresses,
        total: addresses.length
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a new delivery address.
   */
  async createAddress(req, res, next) {
    try {
      const existingCount = await Address.countDocuments({ userId: req.user._id });
      const shouldBeDefault = existingCount === 0 || Boolean(req.body.isDefault);

      // If this address is set as default, unset default on other addresses
      if (shouldBeDefault) {
        await Address.updateMany({ userId: req.user._id }, { isDefault: false });
      }

      const address = await Address.create({
        ...req.body,
        userId: req.user._id,
        isDefault: shouldBeDefault
      });

      return res.status(201).json({
        success: true,
        message: 'Address saved successfully.',
        address
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update an existing delivery address.
   * Enforces customer ownership: user can only modify their own addresses.
   */
  async updateAddress(req, res, next) {
    try {
      const address = await Address.findById(req.params.id);
      if (!address) {
        return res.status(404).json({ success: false, message: 'Address not found.' });
      }

      // Rule 6: Customer can access and modify only their own addresses
      if (address.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          code: 'UNAUTHORIZED_ACCESS',
          message: 'Forbidden: You do not have permission to modify this address.'
        });
      }

      if (req.body.isDefault) {
        await Address.updateMany(
          { userId: req.user._id, _id: { $ne: address._id } },
          { isDefault: false }
        );
      }

      Object.assign(address, req.body);
      address.userId = req.user._id; // Ensure userId remains immutable
      await address.save();

      return res.json({
        success: true,
        message: 'Address updated successfully.',
        address
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete an address.
   * Enforces customer ownership.
   */
  async deleteAddress(req, res, next) {
    try {
      const address = await Address.findById(req.params.id);
      if (!address) {
        return res.status(404).json({ success: false, message: 'Address not found.' });
      }

      // Rule 6: Customer can access and modify only their own addresses
      if (address.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          code: 'UNAUTHORIZED_ACCESS',
          message: 'Forbidden: You do not have permission to delete this address.'
        });
      }

      const wasDefault = address.isDefault;
      await Address.findByIdAndDelete(req.params.id);

      // If deleted address was default, promote the newest remaining address to default
      if (wasDefault) {
        const nextAddress = await Address.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
        if (nextAddress) {
          nextAddress.isDefault = true;
          await nextAddress.save();
        }
      }

      return res.json({
        success: true,
        message: 'Address deleted successfully.'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Mark an address as the default delivery address.
   */
  async setDefaultAddress(req, res, next) {
    try {
      const address = await Address.findById(req.params.id);
      if (!address) {
        return res.status(404).json({ success: false, message: 'Address not found.' });
      }

      // Rule 6: Customer ownership check
      if (address.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to modify this address.'
        });
      }

      // Unset default on all other addresses
      await Address.updateMany({ userId: req.user._id }, { isDefault: false });

      address.isDefault = true;
      await address.save();

      return res.json({
        success: true,
        message: 'Default address updated.',
        address
      });
    } catch (error) {
      next(error);
    }
  }
};

