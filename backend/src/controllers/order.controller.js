import ParentOrder from '../models/ParentOrder.js';
import VendorOrder from '../models/VendorOrder.js';
import VendorProfile from '../models/VendorProfile.js';
import { orderService } from '../services/order.service.js';

export const orderController = {
  // ==========================================
  // CUSTOMER ORDER CONTROLLERS
  // ==========================================

  /**
   * Customer Checkout: Atomically places parent & vendor sub-orders from cart.
   */
  async checkout(req, res, next) {
    try {
      const { addressId, paymentMethod = 'cod' } = req.body;
      const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;

      const result = await orderService.checkout({
        userId: req.user._id,
        addressId,
        paymentMethod,
        idempotencyKey
      });

      return res.status(result.isDuplicate ? 200 : 201).json({
        success: true,
        message: result.isDuplicate
          ? 'Order already submitted (duplicate request caught).'
          : 'Order placed successfully. Inventory reserved.',
        order: result.order,
        subOrders: result.vendorOrders
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Customer: List past orders with pagination.
   */
  async listCustomerOrders(req, res, next) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [orders, total] = await Promise.all([
        ParentOrder.find({ userId: req.user._id })
          .populate({
            path: 'vendorOrderIds',
            populate: { path: 'vendorId', select: 'storeName' }
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        ParentOrder.countDocuments({ userId: req.user._id })
      ]);

      return res.json({
        success: true,
        orders,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Customer: View detailed order by ID or orderNumber.
   */
  async getCustomerOrderDetails(req, res, next) {
    try {
      const { idOrNumber } = req.params;
      const query = idOrNumber.match(/^[0-9a-fA-F]{24}$/)
        ? { _id: idOrNumber, userId: req.user._id }
        : { orderNumber: idOrNumber, userId: req.user._id };

      const order = await ParentOrder.findOne(query)
        .populate({
          path: 'vendorOrderIds',
          populate: { path: 'vendorId', select: 'storeName address' }
        });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found or does not belong to this account.'
        });
      }

      return res.json({
        success: true,
        order
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Customer: Cancel an order and release reserved stock.
   */
  async cancelCustomerOrder(req, res, next) {
    try {
      const { id } = req.params;
      const { reason, vendorOrderId } = req.body;

      if (vendorOrderId) {
        // Cancel single vendor sub-order
        const result = await orderService.cancelVendorSubOrder({
          vendorOrderId,
          userId: req.user._id,
          role: 'customer',
          reason
        });

        return res.json({
          success: true,
          message: 'Sub-order cancelled successfully and inventory released.',
          subOrder: result.vendorOrder,
          parentOrderStatus: result.parentOrderStatus
        });
      } else {
        // Cancel entire parent order
        const updatedOrder = await orderService.cancelEntireParentOrder({
          parentOrderId: id,
          customerId: req.user._id,
          reason
        });

        return res.json({
          success: true,
          message: 'Order cancelled successfully and inventory released.',
          order: updatedOrder
        });
      }
    } catch (error) {
      next(error);
    }
  },

  // ==========================================
  // VENDOR ORDER CONTROLLERS
  // ==========================================

  /**
   * Vendor: List all sub-orders assigned to the authenticated vendor.
   */
  async listVendorOrders(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({ success: false, message: 'Vendor profile not found.' });
      }

      const { status, page = 1, limit = 15 } = req.query;
      const filter = { vendorId: vendor._id };
      if (status) filter.status = status;

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [orders, total] = await Promise.all([
        VendorOrder.find(filter)
          .populate('customerId', 'name email phone')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        VendorOrder.countDocuments(filter)
      ]);

      return res.json({
        success: true,
        orders,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Vendor: View specific sub-order details (enforces vendor ownership).
   */
  async getVendorOrderDetails(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({ success: false, message: 'Vendor profile not found.' });
      }

      const order = await VendorOrder.findById(req.params.id)
        .populate('customerId', 'name email phone');

      if (!order) {
        return res.status(404).json({ success: false, message: 'Sub-order not found.' });
      }

      // Rule 10: Vendor can view only their own sub-orders
      if (order.vendorId.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          code: 'UNAUTHORIZED_ACCESS',
          message: 'Forbidden: You do not have permission to view another vendor’s order.'
        });
      }

      return res.json({
        success: true,
        order
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Vendor: Update order fulfillment status (confirmed, preparing, ready_for_pickup, shipped, delivered).
   */
  async updateVendorOrderStatus(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({ success: false, message: 'Vendor profile not found.' });
      }

      const order = await VendorOrder.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Sub-order not found.' });
      }

      // Rule 10: Vendor ownership check
      if (order.vendorId.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          code: 'UNAUTHORIZED_ACCESS',
          message: 'Forbidden: You cannot modify another vendor’s order.'
        });
      }

      const { status, note } = req.body;
      const allowedTransitions = ['confirmed', 'preparing', 'ready_for_pickup', 'shipped', 'delivered'];

      if (!allowedTransitions.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed transitions: ${allowedTransitions.join(', ')}`
        });
      }

      if (order.status === 'cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Cannot update status of a cancelled sub-order.'
        });
      }

      order.status = status;
      order.statusHistory.push({
        status,
        changedBy: req.user._id,
        role: 'vendor',
        timestamp: new Date(),
        note: note || `Status updated to ${status} by vendor.`
      });

      await order.save();

      return res.json({
        success: true,
        message: `Order status updated to '${status}'.`,
        order
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Vendor: Cancel sub-order and release stock.
   */
  async cancelByVendor(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const result = await orderService.cancelVendorSubOrder({
        vendorOrderId: id,
        userId: req.user._id,
        role: 'vendor',
        reason
      });

      return res.json({
        success: true,
        message: 'Sub-order cancelled and inventory released.',
        order: result.vendorOrder
      });
    } catch (error) {
      next(error);
    }
  }
};

