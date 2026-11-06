import { paymentService } from '../services/payment.service.js';
import Payment from '../models/Payment.js';
import ParentOrder from '../models/ParentOrder.js';

export const paymentController = {
  /**
   * POST /api/payments/create-order
   * Customer initiates Razorpay order creation for a placed ParentOrder.
   */
  async createOnlineOrder(req, res, next) {
    try {
      const { orderId } = req.body;
      const result = await paymentService.createOnlineOrder({
        orderId,
        userId: req.user._id
      });
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/payments/verify
   * Customer submits payment confirmation received from Razorpay Checkout.
   */
  async verifyPayment(req, res, next) {
    try {
      const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
      const result = await paymentService.verifyClientPayment({
        orderId,
        userId: req.user._id,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      });
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/payments/webhook
   * Public webhook endpoint called by Razorpay.
   * Cryptographically verifies HMAC-SHA256 signature using raw request body.
   */
  async handleWebhook(req, res, next) {
    try {
      const signature = req.headers['x-razorpay-signature'];
      const eventHeaderId = req.headers['x-razorpay-event-id'];
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

      const result = await paymentService.processWebhookEvent({
        rawBody,
        signature,
        eventHeaderId
      });

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/payments/confirm-cod
   * Admin / Delivery partner confirms Cash on Delivery collection upon handover.
   */
  async confirmCod(req, res, next) {
    try {
      const { orderId } = req.body;
      const result = await paymentService.confirmCodPayment({
        orderId,
        collectedByUserId: req.user._id,
        role: req.user.role
      });
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/payments/order/:orderId
   * Retrieves payment records and gateway transaction details for an order.
   */
  async getPaymentByOrder(req, res, next) {
    try {
      const { orderId } = req.params;
      const parentOrder = await ParentOrder.findById(orderId);
      if (!parentOrder) {
        return res.status(404).json({
          success: false,
          error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
        });
      }

      // Customer can view only own order payment; admin can view any
      if (req.user.role !== 'admin' && parentOrder.userId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          error: { code: 'UNAUTHORIZED_ACCESS', message: 'Forbidden: Access to this order payment is restricted.' }
        });
      }

      const payments = await Payment.find({ orderId }).sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        data: {
          orderNumber: parentOrder.orderNumber,
          paymentMethod: parentOrder.paymentMethod,
          paymentStatus: parentOrder.paymentStatus,
          grandTotal: parentOrder.pricing.grandTotal,
          payments
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/payments/expire-unpaid
   * Admin or cron endpoint to release reserved stock for unpaid expired online orders.
   */
  async expireUnpaid(req, res, next) {
    try {
      const expiryMinutes = req.query.expiryMinutes ? Number(req.query.expiryMinutes) : undefined;
      const result = await paymentService.releaseUnpaidExpiredReservations({ expiryMinutes });
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
};

