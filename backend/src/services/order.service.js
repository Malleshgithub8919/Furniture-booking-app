import crypto from 'crypto';
import mongoose from 'mongoose';
import ParentOrder from '../models/ParentOrder.js';
import VendorOrder from '../models/VendorOrder.js';
import Cart from '../models/Cart.js';
import Address from '../models/Address.js';
import Product from '../models/Product.js';
import VendorProfile from '../models/VendorProfile.js';

export const orderService = {
  /**
   * Generates a unique, URL-safe human-readable order number.
   */
  generateOrderNumber(prefix = 'ORD') {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${dateStr}-${randomHex}`;
  },

  /**
   * Atomic Checkout using MongoDB Multi-Document Transactions.
   * Recalculates all prices, reserves stock atomically, and creates Parent & Vendor orders.
   */
  async checkout({ userId, addressId, paymentMethod = 'cod', idempotencyKey }) {
    // 1. Idempotency Check (protects against network retries creating duplicate orders)
    if (idempotencyKey) {
      const existing = await ParentOrder.findOne({ idempotencyKey })
        .populate('vendorOrderIds');
      if (existing) {
        return { order: existing, isDuplicate: true };
      }
    }

    // 2. Validate Address ownership & create immutable snapshot
    const addressDoc = await Address.findOne({ _id: addressId, userId });
    if (!addressDoc) {
      throw new Error('Delivery address not found or does not belong to this account.');
    }

    const shippingAddressSnapshot = {
      fullName: addressDoc.fullName,
      phone: addressDoc.phone,
      alternatePhone: addressDoc.alternatePhone,
      street: addressDoc.street,
      landmark: addressDoc.landmark,
      city: addressDoc.city,
      state: addressDoc.state,
      postalCode: addressDoc.postalCode,
      addressType: addressDoc.addressType,
      deliveryInstructions: addressDoc.deliveryInstructions
    };

    // 3. Retrieve customer cart
    const cart = await Cart.findOne({ userId });
    if (!cart || !cart.items || cart.items.length === 0) {
      throw new Error('Your cart is empty. Please add items before checking out.');
    }

    // 4. Start MongoDB Transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const masterOrderNumber = this.generateOrderNumber('ORD');
      const reservedItems = [];
      const vendorGroups = {}; // Key: vendorId string

      // 5. Recheck each product and atomically reserve stock in MongoDB
      for (const cartItem of cart.items) {
        // Atomically increment reservedStock if and only if (stock - reservedStock) >= requested
        const product = await Product.findOneAndUpdate(
          {
            _id: cartItem.productId,
            status: 'approved',
            $expr: {
              $gte: [{ $subtract: ['$stock', '$reservedStock'] }, cartItem.quantity]
            }
          },
          {
            $inc: { reservedStock: cartItem.quantity }
          },
          { session, new: true }
        ).populate('vendorId', 'storeName commissionRate');

        if (!product) {
          throw new Error(
            `Unable to reserve stock for item (${cartItem.productId}). Either stock is insufficient or the product is no longer approved.`
          );
        }

        reservedItems.push({
          productId: product._id,
          quantity: cartItem.quantity
        });

        // Pricing strictly computed on backend in integer paise
        const unitBasePrice = product.price;
        const unitSalePrice = product.salePrice ?? null;
        const effectiveUnitPrice = unitSalePrice !== null ? unitSalePrice : unitBasePrice;
        const lineTotal = effectiveUnitPrice * cartItem.quantity;
        const lineBaseTotal = unitBasePrice * cartItem.quantity;
        const lineDiscount = lineBaseTotal - lineTotal;

        const vendorIdStr = product.vendorId._id ? product.vendorId._id.toString() : product.vendorId.toString();

        if (!vendorGroups[vendorIdStr]) {
          vendorGroups[vendorIdStr] = {
            vendorId: product.vendorId._id || product.vendorId,
            commissionRate: product.vendorId.commissionRate ?? 10,
            items: [],
            subtotal: 0,
            totalDiscount: 0
          };
        }

        vendorGroups[vendorIdStr].items.push({
          productId: product._id,
          name: product.name,
          sku: product.sku,
          primaryImage: product.images?.find(img => img.isPrimary)?.url || product.images?.[0]?.url || '',
          quantity: cartItem.quantity,
          unitBasePrice,
          unitSalePrice: Number.isInteger(unitSalePrice) ? unitSalePrice : undefined,
          effectiveUnitPrice,
          lineTotal,
          customizations: {
            selectedColor: cartItem.selectedColor || null,
            selectedMaterial: cartItem.selectedMaterial || null,
            customNote: cartItem.customNote || null
          }
        });

        vendorGroups[vendorIdStr].subtotal += lineTotal;
        vendorGroups[vendorIdStr].totalDiscount += lineDiscount;
      }

      // 6. Create ParentOrder shell to link sub-orders
      const parentOrder = new ParentOrder({
        orderNumber: masterOrderNumber,
        userId,
        shippingAddress: shippingAddressSnapshot,
        pricing: {
          itemsSubtotal: 0,
          totalDiscount: 0,
          shippingFee: 0,
          tax: 0,
          grandTotal: 0,
          currency: 'INR'
        },
        paymentMethod,
        paymentStatus: 'pending',
        orderStatus: 'placed',
        idempotencyKey: idempotencyKey || null,
        statusHistory: [{
          status: 'placed',
          timestamp: new Date(),
          note: `Checkout completed successfully via ${paymentMethod.toUpperCase()}`
        }]
      });

      let masterSubtotal = 0;
      let masterDiscount = 0;
      let masterShipping = 0;
      const createdVendorOrders = [];

      // 7. Create VendorOrder sub-order for each vendor
      let vendorIndex = 1;
      for (const vendorIdStr of Object.keys(vendorGroups)) {
        const group = vendorGroups[vendorIdStr];
        const subOrderNumber = `${masterOrderNumber}-V${vendorIndex++}`;

        const commissionRate = group.commissionRate;
        const commissionAmount = Math.round((group.subtotal * commissionRate) / 100);
        const vendorPayout = group.subtotal - commissionAmount;
        const shippingFee = 0; // Flat free shipping for starter
        const grandTotal = group.subtotal + shippingFee;

        masterSubtotal += group.subtotal;
        masterDiscount += group.totalDiscount;
        masterShipping += shippingFee;

        const vendorOrder = new VendorOrder({
          subOrderNumber,
          parentOrderId: parentOrder._id,
          vendorId: group.vendorId,
          customerId: userId,
          shippingAddress: shippingAddressSnapshot,
          items: group.items,
          pricing: {
            subtotal: group.subtotal,
            commissionRate,
            commissionAmount,
            vendorPayout,
            shippingFee,
            grandTotal
          },
          status: 'placed',
          statusHistory: [{
            status: 'placed',
            changedBy: userId,
            role: 'customer',
            timestamp: new Date(),
            note: 'Order placed by customer.'
          }]
        });

        await vendorOrder.save({ session });
        createdVendorOrders.push(vendorOrder);
        parentOrder.vendorOrderIds.push(vendorOrder._id);
      }

      // 8. Finalize ParentOrder pricing in integer paise
      parentOrder.pricing.itemsSubtotal = masterSubtotal + masterDiscount;
      parentOrder.pricing.totalDiscount = masterDiscount;
      parentOrder.pricing.shippingFee = masterShipping;
      parentOrder.pricing.grandTotal = masterSubtotal + masterShipping;

      await parentOrder.save({ session });

      // 9. Clear customer's cart
      cart.items = [];
      await cart.save({ session });

      // Commit the transaction atomically
      await session.commitTransaction();
      session.endSession();

      return {
        order: parentOrder,
        vendorOrders: createdVendorOrders,
        isDuplicate: false
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  },

  /**
   * Cancels a single vendor's sub-order, safely releases inventory, and recalculates parent status.
   */
  async cancelVendorSubOrder({ vendorOrderId, userId, role, reason }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendorOrder = await VendorOrder.findById(vendorOrderId).session(session);
      if (!vendorOrder) {
        throw new Error('Vendor sub-order not found.');
      }

      // Authorization & status checks
      if (role === 'customer') {
        if (vendorOrder.customerId.toString() !== userId.toString()) {
          const err = new Error('Forbidden: You do not have permission to cancel this order.');
          err.statusCode = 403;
          throw err;
        }
        if (!['placed', 'confirmed', 'preparing'].includes(vendorOrder.status)) {
          const err = new Error(`Cannot cancel sub-order in status '${vendorOrder.status}'. It has already been processed for dispatch.`);
          err.statusCode = 400;
          throw err;
        }
      } else if (role === 'vendor') {
        const vendor = await VendorProfile.findOne({ userId }).session(session);
        if (!vendor || vendorOrder.vendorId.toString() !== vendor._id.toString()) {
          const err = new Error('Forbidden: You can cancel only your own sub-orders.');
          err.statusCode = 403;
          throw err;
        }
        if (['shipped', 'delivered', 'cancelled'].includes(vendorOrder.status)) {
          const err = new Error(`Cannot cancel sub-order in '${vendorOrder.status}' status.`);
          err.statusCode = 400;
          throw err;
        }
      }

      if (vendorOrder.status === 'cancelled') {
        const err = new Error('This sub-order is already cancelled.');
        err.statusCode = 400;
        throw err;
      }

      // 1. Release reserved stock for items in this sub-order
      for (const item of vendorOrder.items) {
        await Product.findByIdAndUpdate(
          item.productId,
          { $inc: { reservedStock: -item.quantity } },
          { session }
        );
      }

      // 2. Mark sub-order as cancelled
      vendorOrder.status = 'cancelled';
      vendorOrder.cancellation = {
        reason: reason || 'Cancelled by user',
        cancelledBy: userId,
        cancelledAt: new Date()
      };
      vendorOrder.statusHistory.push({
        status: 'cancelled',
        changedBy: userId,
        role,
        timestamp: new Date(),
        note: reason || 'Sub-order cancelled.'
      });
      await vendorOrder.save({ session });

      // 3. Update ParentOrder status based on all sibling sub-orders
      const siblingOrders = await VendorOrder.find({
        parentOrderId: vendorOrder.parentOrderId
      }).session(session);

      const allCancelled = siblingOrders.every(o => o.status === 'cancelled');
      const anyActive = siblingOrders.some(o => o.status !== 'cancelled');

      const parentOrder = await ParentOrder.findById(vendorOrder.parentOrderId).session(session);
      if (parentOrder) {
        if (allCancelled) {
          parentOrder.orderStatus = 'cancelled';
          parentOrder.statusHistory.push({
            status: 'cancelled',
            timestamp: new Date(),
            note: 'All vendor sub-orders have been cancelled.'
          });
        } else if (anyActive) {
          parentOrder.orderStatus = 'partially_cancelled';
          parentOrder.statusHistory.push({
            status: 'partially_cancelled',
            timestamp: new Date(),
            note: `Sub-order ${vendorOrder.subOrderNumber} was cancelled.`
          });
        }
        await parentOrder.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      return {
        vendorOrder,
        parentOrderStatus: parentOrder ? parentOrder.orderStatus : null
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  },

  /**
   * Customer-level order cancellation (cancels all sub-orders of a ParentOrder).
   */
  async cancelEntireParentOrder({ parentOrderId, customerId, reason }) {
    const parent = await ParentOrder.findOne({ _id: parentOrderId, userId: customerId });
    if (!parent) {
      throw new Error('Order not found or does not belong to this account.');
    }

    if (['cancelled', 'completed'].includes(parent.orderStatus)) {
      throw new Error(`Cannot cancel order in status '${parent.orderStatus}'.`);
    }

    const subOrders = await VendorOrder.find({ parentOrderId: parent._id });
    const results = [];

    for (const subOrder of subOrders) {
      if (subOrder.status !== 'cancelled') {
        const res = await this.cancelVendorSubOrder({
          vendorOrderId: subOrder._id,
          userId: customerId,
          role: 'customer',
          reason
        });
        results.push(res);
      }
    }

    return await ParentOrder.findById(parent._id).populate('vendorOrderIds');
  }
};
