import mongoose from 'mongoose';
import ParentOrder from '../models/ParentOrder.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import VendorOrder from '../models/VendorOrder.js';
import VendorProfile from '../models/VendorProfile.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function getPagination(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
    return null;
  }
  const pageSize = Math.min(limit, 100);
  return { page, limit: pageSize, skip: (page - 1) * pageSize };
}

function invalidPagination(res) {
  return res.status(400).json({ success: false, message: 'Page and limit must be positive integers.' });
}

function sendList(res, key, items, total, pagination) {
  return res.json({
    success: true,
    data: {
      [key]: items,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit)
      }
    }
  });
}

export const adminController = {
  async getDashboard(req, res, next) {
    try {
      const [customers, vendors, products, orders, pendingVendors, pendingProducts, paymentStats] = await Promise.all([
        User.countDocuments({ role: 'customer' }),
        VendorProfile.countDocuments(),
        Product.countDocuments(),
        ParentOrder.countDocuments(),
        VendorProfile.countDocuments({ status: { $in: ['pending', 'under_review'] } }),
        Product.countDocuments({ status: 'pending' }),
        Payment.aggregate([
          {
            $group: {
              _id: { gateway: '$gateway', status: '$status' },
              count: { $sum: 1 },
              amount: { $sum: '$amount' }
            }
          },
          { $sort: { '_id.gateway': 1, '_id.status': 1 } }
        ])
      ]);

      return res.json({
        success: true,
        data: {
          totals: { customers, vendors, products, orders },
          reviewQueue: { pendingVendors, pendingProducts },
          paymentStats: paymentStats.map(({ _id, count, amount }) => ({
            gateway: _id.gateway,
            status: _id.status,
            count,
            amount
          }))
        }
      });
    } catch (error) {
      next(error);
    }
  },

  async listCustomers(req, res, next) {
    try {
      const pagination = getPagination(req.query);
      if (!pagination) return invalidPagination(res);

      const filter = { role: 'customer' };
      if (req.query.status) filter.status = req.query.status;
      if (req.query.search?.trim()) {
        const search = new RegExp(escapeRegex(req.query.search.trim().slice(0, 100)), 'i');
        filter.$or = [{ name: search }, { email: search }, { phone: search }];
      }

      const [customers, total] = await Promise.all([
        User.find(filter)
          .select('name email phone role status emailVerified phoneVerified createdAt lastLoginAt')
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        User.countDocuments(filter)
      ]);

      return sendList(res, 'customers', customers, total, pagination);
    } catch (error) {
      next(error);
    }
  },

  async updateCustomerStatus(req, res, next) {
    try {
      const { status } = req.body;
      if (!['active', 'inactive', 'blocked', 'pending_verification'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid customer status.' });
      }
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({ success: false, message: 'Customer not found.' });
      }

      const customer = await User.findOneAndUpdate(
        { _id: req.params.id, role: 'customer' },
        { $set: { status } },
        { new: true, runValidators: true, projection: 'name email phone role status' }
      );
      if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

      return res.json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  },

  async listProducts(req, res, next) {
    try {
      const pagination = getPagination(req.query);
      if (!pagination) return invalidPagination(res);

      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.search?.trim()) {
        const search = new RegExp(escapeRegex(req.query.search.trim().slice(0, 100)), 'i');
        filter.$or = [{ name: search }, { sku: search }];
      }
      const [products, total] = await Promise.all([
        Product.find(filter)
          .populate('vendorId', 'storeName status')
          .populate('categoryId', 'name')
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        Product.countDocuments(filter)
      ]);
      return sendList(res, 'products', products, total, pagination);
    } catch (error) {
      next(error);
    }
  },

  async listParentOrders(req, res, next) {
    try {
      const pagination = getPagination(req.query);
      if (!pagination) return invalidPagination(res);

      const filter = {};
      if (req.query.status) filter.orderStatus = req.query.status;
      if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
      if (req.query.search?.trim()) {
        const searchText = req.query.search.trim().slice(0, 100);
        const search = new RegExp(escapeRegex(searchText), 'i');
        const customerIds = await User.find({
          role: 'customer',
          $or: [{ name: search }, { email: search }, { phone: search }]
        }).distinct('_id');
        filter.$or = [{ orderNumber: search }, { userId: { $in: customerIds } }];
      }

      const [orders, total] = await Promise.all([
        ParentOrder.find(filter)
          .populate('userId', 'name email phone')
          .populate('vendorOrderIds', 'subOrderNumber status pricing.grandTotal')
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        ParentOrder.countDocuments(filter)
      ]);
      return sendList(res, 'orders', orders, total, pagination);
    } catch (error) {
      next(error);
    }
  },

  async listVendorOrders(req, res, next) {
    try {
      const pagination = getPagination(req.query);
      if (!pagination) return invalidPagination(res);

      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.search?.trim()) {
        const searchText = req.query.search.trim().slice(0, 100);
        const search = new RegExp(escapeRegex(searchText), 'i');
        const [customerIds, vendorIds] = await Promise.all([
          User.find({
            role: 'customer',
            $or: [{ name: search }, { email: search }, { phone: search }]
          }).distinct('_id'),
          VendorProfile.find({ storeName: search }).distinct('_id')
        ]);
        filter.$or = [
          { subOrderNumber: search },
          { customerId: { $in: customerIds } },
          { vendorId: { $in: vendorIds } }
        ];
      }

      const [vendorOrders, total] = await Promise.all([
        VendorOrder.find(filter)
          .populate('customerId', 'name email')
          .populate('vendorId', 'storeName')
          .populate('parentOrderId', 'orderNumber orderStatus paymentStatus')
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        VendorOrder.countDocuments(filter)
      ]);
      return sendList(res, 'vendorOrders', vendorOrders, total, pagination);
    } catch (error) {
      next(error);
    }
  },

  async listPayments(req, res, next) {
    try {
      const pagination = getPagination(req.query);
      if (!pagination) return invalidPagination(res);
      const filter = {};
      if (req.query.gateway) filter.gateway = req.query.gateway;
      if (req.query.status) filter.status = req.query.status;
      if (req.query.search?.trim()) {
        const searchText = req.query.search.trim().slice(0, 100);
        const search = new RegExp(escapeRegex(searchText), 'i');
        const orderIds = await ParentOrder.find({ orderNumber: search }).distinct('_id');
        filter.$or = [
          { gatewayOrderId: search },
          { gatewayPaymentId: search },
          { orderId: { $in: orderIds } }
        ];
      }

      const [payments, total] = await Promise.all([
        Payment.find(filter)
          .select('-gatewaySignature -metadata')
          .populate('orderId', 'orderNumber paymentMethod paymentStatus')
          .populate('userId', 'name email')
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        Payment.countDocuments(filter)
      ]);
      return sendList(res, 'payments', payments, total, pagination);
    } catch (error) {
      next(error);
    }
  },

  async reviewVendorKycDocument(req, res, next) {
    try {
      const { status, rejectionReason } = req.body;
      if (!['verified', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Document status must be verified or rejected.' });
      }
      if (status === 'rejected' && !rejectionReason?.trim()) {
        return res.status(400).json({ success: false, message: 'A rejection reason is required.' });
      }
      if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.documentId)) {
        return res.status(404).json({ success: false, message: 'Vendor or KYC document not found.' });
      }

      const vendor = await VendorProfile.findById(req.params.id).select('+kycDocuments');
      if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found.' });
      const document = vendor.kycDocuments.id(req.params.documentId);
      if (!document) return res.status(404).json({ success: false, message: 'KYC document not found.' });

      document.status = status;
      document.rejectionReason = status === 'rejected' ? rejectionReason.trim() : undefined;
      await vendor.save();
      return res.json({
        success: true,
        data: {
          vendorId: vendor._id,
          document: {
            _id: document._id,
            documentType: document.documentType,
            status: document.status,
            rejectionReason: document.rejectionReason
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },
};
