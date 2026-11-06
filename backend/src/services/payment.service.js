import mongoose from 'mongoose';
import ParentOrder from '../models/ParentOrder.js';
import VendorOrder from '../models/VendorOrder.js';
import Payment from '../models/Payment.js';
import WebhookEvent from '../models/WebhookEvent.js';
import Product from '../models/Product.js';
import { razorpayService } from './razorpay.service.js';
import { env } from '../config/env.js';

export const paymentService = {
  /**
   * 1. Creates a Razorpay payment order for an existing ParentOrder.
   * Requirement 9: Provider API calls are strictly OUTSIDE MongoDB transactions.
   */
  async createOnlineOrder({ orderId, userId }) {
    const parentOrder = await ParentOrder.findOne({ _id: orderId, userId });
    if (!parentOrder) {
      const err = new Error('Order not found or does not belong to this account.');
      err.statusCode = 404;
      throw err;
    }

    if (parentOrder.orderStatus === 'cancelled') {
      const err = new Error('Cannot create payment order: Order is already cancelled.');
      err.statusCode = 400;
      throw err;
    }

    if (parentOrder.paymentStatus === 'captured') {
      const err = new Error('This order is already fully paid.');
      err.statusCode = 400;
      throw err;
    }

    const amountInPaise = parentOrder.pricing.grandTotal;

    // Razorpay API call strictly outside any DB transaction
    const gatewayOrder = await razorpayService.createOrder({
      amount: amountInPaise,
      currency: parentOrder.pricing.currency || 'INR',
      receipt: parentOrder.orderNumber,
      notes: {
        orderId: parentOrder._id.toString(),
        userId: userId.toString(),
        orderNumber: parentOrder.orderNumber
      }
    });

    // Create or update Payment record with pending status
    let payment = await Payment.findOne({ orderId: parentOrder._id, gateway: 'razorpay' });
    if (!payment) {
      payment = new Payment({
        orderId: parentOrder._id,
        userId,
        gateway: 'razorpay',
        gatewayOrderId: gatewayOrder.id,
        amount: amountInPaise,
        currency: gatewayOrder.currency || 'INR',
        status: 'pending',
        method: 'online',
        metadata: {
          receipt: parentOrder.orderNumber,
          isMock: gatewayOrder.isMock || false
        }
      });
    } else {
      payment.gatewayOrderId = gatewayOrder.id;
      payment.amount = amountInPaise;
      payment.status = 'pending';
    }

    await payment.save();

    return {
      orderId: parentOrder._id,
      orderNumber: parentOrder.orderNumber,
      gatewayOrderId: gatewayOrder.id,
      amount: amountInPaise,
      currency: gatewayOrder.currency || 'INR',
      keyId: env.razorpayKeyId,
      isMock: gatewayOrder.isMock || false
    };
  },

  /**
   * 2. Verifies frontend payment callback.
   * Requirement 11: Never trust frontend payment status or amount.
   */
  async verifyClientPayment({ orderId, userId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const parentOrder = await ParentOrder.findOne({ _id: orderId, userId });
    if (!parentOrder) {
      const err = new Error('Order not found or does not belong to this account.');
      err.statusCode = 404;
      throw err;
    }

    if (parentOrder.paymentStatus === 'captured') {
      return { success: true, message: 'Payment already verified and captured.', parentOrder };
    }

    // Cryptographic signature check (when secret is configured or real credentials active)
    const keySecret = process.env.RAZORPAY_KEY_SECRET || env.razorpayKeySecret;
    if (keySecret) {
      const isValid = razorpayService.verifyPaymentSignature({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        secret: keySecret
      });

      if (!isValid) {
        const err = new Error('Invalid payment signature. Verification failed.');
        err.statusCode = 400;
        throw err;
      }
    }

    const payment = await Payment.findOne({
      orderId: parentOrder._id,
      gatewayOrderId: razorpayOrderId
    });

    if (!payment) {
      const err = new Error('Payment record matching gateway order not found.');
      err.statusCode = 404;
      throw err;
    }

    // Verify amount matches integer paise on server
    if (payment.amount !== parentOrder.pricing.grandTotal) {
      const err = new Error('Payment amount mismatch between gateway and order.');
      err.statusCode = 400;
      throw err;
    }

    // Update payment record to captured
    payment.status = 'captured';
    payment.gatewayPaymentId = razorpayPaymentId;
    payment.gatewaySignature = razorpaySignature;
    await payment.save();

    // Update ParentOrder
    parentOrder.paymentStatus = 'captured';
    parentOrder.statusHistory.push({
      status: parentOrder.orderStatus,
      timestamp: new Date(),
      note: `Online payment successfully captured via Razorpay (${razorpayPaymentId}).`
    });
    await parentOrder.save();

    // Advance Vendor sub-orders from placed to confirmed
    await VendorOrder.updateMany(
      { parentOrderId: parentOrder._id, status: 'placed' },
      {
        $set: { status: 'confirmed' },
        $push: {
          statusHistory: {
            status: 'confirmed',
            role: 'system',
            timestamp: new Date(),
            note: 'Payment captured. Vendor sub-order confirmed.'
          }
        }
      }
    );

    return {
      success: true,
      orderNumber: parentOrder.orderNumber,
      paymentStatus: parentOrder.paymentStatus,
      amount: payment.amount
    };
  },

  /**
   * 3. Idempotent Razorpay Webhook Event Processing.
   * Requirement 2 & 4: Official HMAC-SHA256 signature verification & idempotent event handling.
   */
  async processWebhookEvent({ rawBody, signature, eventHeaderId }) {
    // Cryptographic signature verification
    const isValid = razorpayService.verifyWebhookSignature({ rawBody, signature });
    if (!isValid) {
      const err = new Error('Invalid Razorpay webhook signature.');
      err.statusCode = 400;
      throw err;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      const err = new Error('Malformed webhook payload JSON.');
      err.statusCode = 400;
      throw err;
    }

    const eventId = eventHeaderId || payload.id || payload.event_id;
    if (!eventId) {
      const err = new Error('Missing webhook event ID.');
      err.statusCode = 400;
      throw err;
    }

    // Idempotency: Ignore duplicate webhook deliveries from gateway
    const existingEvent = await WebhookEvent.findOne({ eventId });
    if (existingEvent) {
      return { status: 'already_processed', eventId };
    }

    const eventType = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;

    const gatewayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const gatewayPaymentId = paymentEntity?.id;
    const paidAmount = paymentEntity?.amount;

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      if (gatewayOrderId) {
        const payment = await Payment.findOne({ gatewayOrderId });
        if (payment) {
          // Verify amount matches expected integer paise
          if (paidAmount && payment.amount !== paidAmount) {
            payment.errorDetails = {
              code: 'AMOUNT_MISMATCH',
              description: `Expected ${payment.amount} paise but received ${paidAmount} paise.`
            };
            await payment.save();
            const err = new Error('Payment amount mismatch detected in webhook event.');
            err.statusCode = 400;
            throw err;
          }

          payment.status = 'captured';
          payment.gatewayPaymentId = gatewayPaymentId || payment.gatewayPaymentId;
          payment.method = paymentEntity?.method || payment.method;
          await payment.save();

          const parentOrder = await ParentOrder.findById(payment.orderId);
          if (parentOrder && parentOrder.paymentStatus !== 'captured') {
            parentOrder.paymentStatus = 'captured';
            parentOrder.statusHistory.push({
              status: parentOrder.orderStatus,
              timestamp: new Date(),
              note: `Payment confirmed via webhook (${eventType}).`
            });
            await parentOrder.save();

            await VendorOrder.updateMany(
              { parentOrderId: parentOrder._id, status: 'placed' },
              {
                $set: { status: 'confirmed' },
                $push: {
                  statusHistory: {
                    status: 'confirmed',
                    role: 'system',
                    timestamp: new Date(),
                    note: 'Payment confirmed via webhook. Sub-order confirmed.'
                  }
                }
              }
            );
          }
        }
      }
    } else if (eventType === 'payment.failed') {
      if (gatewayOrderId) {
        const payment = await Payment.findOne({ gatewayOrderId });
        if (payment && payment.status !== 'captured') {
          payment.status = 'failed';
          payment.errorDetails = {
            code: paymentEntity?.error_code || 'PAYMENT_FAILED',
            description: paymentEntity?.error_description || 'Payment failed at gateway',
            source: paymentEntity?.error_source,
            step: paymentEntity?.error_step,
            reason: paymentEntity?.error_reason
          };
          await payment.save();

          const parentOrder = await ParentOrder.findById(payment.orderId);
          if (parentOrder && parentOrder.paymentStatus !== 'captured') {
            parentOrder.paymentStatus = 'failed';
            parentOrder.statusHistory.push({
              status: parentOrder.orderStatus,
              timestamp: new Date(),
              note: `Payment failed: ${payment.errorDetails.description}`
            });
            await parentOrder.save();
          }
        }
      }
    }

    // Save processed event for idempotency
    await WebhookEvent.create({
      eventId,
      gateway: 'razorpay',
      event: eventType,
      status: 'processed',
      payload
    });

    return { status: 'processed', eventId, event: eventType };
  },

  /**
   * 4. Cash on Delivery (COD) Payment Confirmation.
   * Requirement 5: Cash on Delivery payment status updates.
   */
  async confirmCodPayment({ orderId, collectedByUserId, role }) {
    const parentOrder = await ParentOrder.findById(orderId);
    if (!parentOrder) {
      const err = new Error('Order not found.');
      err.statusCode = 404;
      throw err;
    }

    if (parentOrder.paymentMethod !== 'cod') {
      const err = new Error('Order is not a Cash on Delivery order.');
      err.statusCode = 400;
      throw err;
    }

    if (parentOrder.paymentStatus === 'captured') {
      return { success: true, message: 'COD payment already collected.', parentOrder };
    }

    // Create or update Payment record
    let payment = await Payment.findOne({ orderId: parentOrder._id, gateway: 'cod' });
    if (!payment) {
      payment = new Payment({
        orderId: parentOrder._id,
        userId: parentOrder.userId,
        gateway: 'cod',
        amount: parentOrder.pricing.grandTotal,
        currency: 'INR',
        status: 'captured',
        method: 'cod',
        metadata: {
          collectedBy: collectedByUserId,
          collectorRole: role,
          collectedAt: new Date()
        }
      });
    } else {
      payment.status = 'captured';
    }
    await payment.save();

    parentOrder.paymentStatus = 'captured';
    parentOrder.statusHistory.push({
      status: parentOrder.orderStatus,
      timestamp: new Date(),
      note: `Cash on Delivery collected by ${role} (${collectedByUserId}).`
    });
    await parentOrder.save();

    return {
      success: true,
      orderNumber: parentOrder.orderNumber,
      paymentStatus: parentOrder.paymentStatus,
      amount: payment.amount
    };
  },

  /**
   * 5. Inventory Reservation Expiry for Unpaid Online Orders.
   * Requirement 8: Safe inventory release strategy for unpaid online orders.
   * NEVER releases stock for a successfully paid order.
   */
  async releaseUnpaidExpiredReservations({ expiryMinutes = env.paymentExpiryMinutes }) {
    const cutoff = new Date(Date.now() - expiryMinutes * 60 * 1000);

    // Find placed online orders that are older than cutoff and unpaid
    const expiredOrders = await ParentOrder.find({
      paymentMethod: 'razorpay',
      paymentStatus: { $in: ['pending', 'failed'] },
      orderStatus: 'placed',
      createdAt: { $lt: cutoff }
    });

    const results = [];

    for (const parentOrder of expiredOrders) {
      // Critical check: Never release stock for captured/authorized orders
      if (['captured', 'authorized'].includes(parentOrder.paymentStatus)) {
        continue;
      }

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const vendorOrders = await VendorOrder.find({
          parentOrderId: parentOrder._id,
          status: { $ne: 'cancelled' }
        }).session(session);

        let totalItemsReleased = 0;

        for (const subOrder of vendorOrders) {
          // Release reserved stock on each product
          for (const item of subOrder.items) {
            await Product.findByIdAndUpdate(
              item.productId,
              { $inc: { reservedStock: -item.quantity } },
              { session }
            );
            totalItemsReleased += item.quantity;
          }

          subOrder.status = 'cancelled';
          subOrder.cancellation = {
            reason: 'Payment window expired (unpaid online order)',
            cancelledAt: new Date()
          };
          subOrder.statusHistory.push({
            status: 'cancelled',
            role: 'system',
            timestamp: new Date(),
            note: 'Sub-order cancelled due to online payment expiry. Reserved inventory released.'
          });
          await subOrder.save({ session });
        }

        // Cancel parent order
        parentOrder.orderStatus = 'cancelled';
        parentOrder.paymentStatus = 'failed';
        parentOrder.statusHistory.push({
          status: 'cancelled',
          timestamp: new Date(),
          note: `Order auto-cancelled after ${expiryMinutes}m payment window elapsed.`
        });
        await parentOrder.save({ session });

        await session.commitTransaction();
        session.endSession();

        results.push({
          orderId: parentOrder._id,
          orderNumber: parentOrder.orderNumber,
          itemsReleased: totalItemsReleased
        });
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
      }
    }

    return {
      expiredCount: results.length,
      orders: results
    };
  }
};
