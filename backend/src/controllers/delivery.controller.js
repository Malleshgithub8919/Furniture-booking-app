import { deliveryService } from '../services/delivery.service.js';
import DeliveryPartnerProfile from '../models/DeliveryPartnerProfile.js';
import DeliveryAssignment from '../models/DeliveryAssignment.js';
import User from '../models/User.js';
import VendorOrder from '../models/VendorOrder.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const adminPartnerFields = 'userId phone vehicleType vehicleNumber approvalStatus rejectionReason availabilityStatus servicePincodes currentLocation metrics createdAt';

function sanitizeAdminPartner(profile) {
  const data = profile.toObject();
  delete data.licenseNumber;
  delete data.identityProof;
  return data;
}

export const deliveryController = {
  /**
   * POST /api/delivery/onboard
   */
  async onboard(req, res, next) {
    try {
      const profile = await deliveryService.onboardPartner({
        userId: req.user._id,
        ...req.body
      });
      res.status(201).json({
        success: true,
        message: 'Delivery partner onboarding submitted. Status: pending.',
        data: profile
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/delivery/profile/me
   */
  async getProfile(req, res, next) {
    try {
      const profile = await DeliveryPartnerProfile.findOne({ userId: req.user._id })
        .populate('userId', 'name email phone status');
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: { code: 'PROFILE_NOT_FOUND', message: 'Delivery partner profile not found.' }
        });
      }
      res.status(200).json({
        success: true,
        data: profile
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/delivery/availability
   */
  async updateAvailability(req, res, next) {
    try {
      const { availabilityStatus } = req.body;
      const profile = await deliveryService.updateAvailability({
        userId: req.user._id,
        availabilityStatus
      });
      res.status(200).json({
        success: true,
        message: `Availability updated to '${availabilityStatus}'.`,
        data: profile
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/delivery/assignments/mine
   */
  async listMyAssignments(req, res, next) {
    try {
      const { status, page, limit } = req.query;
      const result = await deliveryService.listPartnerAssignments({
        userId: req.user._id,
        status,
        page,
        limit
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
   * GET /api/delivery/assignments/:id
   */
  async getAssignmentDetails(req, res, next) {
    try {
      const assignment = await deliveryService.getAssignmentDetails({
        assignmentId: req.params.id,
        userId: req.user._id,
        role: req.user.role
      });
      res.status(200).json({
        success: true,
        data: assignment
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/delivery/assignments/:id/status
   */
  async updateStatus(req, res, next) {
    try {
      const { status, note } = req.body;
      const assignment = await deliveryService.updateAssignmentStatus({
        assignmentId: req.params.id,
        userId: req.user._id,
        newStatus: status,
        note
      });
      res.status(200).json({
        success: true,
        message: `Delivery assignment updated to '${status}'.`,
        data: assignment
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/delivery/assignments/:id/verify-pickup
   */
  async verifyPickup(req, res, next) {
    try {
      const { otp } = req.body;
      const result = await deliveryService.verifyPickupOtp({
        assignmentId: req.params.id,
        userId: req.user._id,
        otp
      });
      res.status(200).json({
        success: true,
        message: 'Pickup verified successfully. Sub-order is now in transit.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/delivery/assignments/:id/verify-delivery
   */
  async verifyDelivery(req, res, next) {
    try {
      const { otp } = req.body;
      const result = await deliveryService.verifyDeliveryOtpAndComplete({
        assignmentId: req.params.id,
        userId: req.user._id,
        otp
      });
      res.status(200).json({
        success: true,
        message: 'Delivery confirmed successfully. Package handed over to customer.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/delivery/assignments/:id/report-failure
   */
  async reportFailure(req, res, next) {
    try {
      const { reason } = req.body;
      const result = await deliveryService.reportDeliveryFailure({
        assignmentId: req.params.id,
        userId: req.user._id,
        reason
      });
      res.status(200).json({
        success: true,
        message: 'Delivery failure/exception logged.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/customer/orders/:id/delivery-status
   */
  async getCustomerTracking(req, res, next) {
    try {
      const result = await deliveryService.getCustomerDeliveryTracking({
        parentOrderId: req.params.id,
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

  // ================= ADMIN ENDPOINTS ================= //

  /**
   * GET /api/admin/delivery/partners
   */
  async adminListPartners(req, res, next) {
    try {
      const { approvalStatus, availabilityStatus, search, page = 1, limit = 20 } = req.query;
      const filter = {};
      if (approvalStatus) filter.approvalStatus = approvalStatus;
      if (availabilityStatus) filter.availabilityStatus = availabilityStatus;

      if (search?.trim()) {
        const searchTerm = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
        const userIds = await User.find({
          role: 'delivery',
          $or: [{ name: searchTerm }, { email: searchTerm }, { phone: searchTerm }]
        }).distinct('_id');
        filter.$or = [
          { userId: { $in: userIds } },
          { vehicleNumber: searchTerm },
          { licenseNumber: searchTerm }
        ];
      }

      const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * limitNum;
      const [partners, total] = await Promise.all([
        DeliveryPartnerProfile.find(filter)
          .populate('userId', 'name email phone status')
          .select(adminPartnerFields)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        DeliveryPartnerProfile.countDocuments(filter)
      ]);

      res.status(200).json({
        success: true,
        data: {
          partners,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum)
          }
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/admin/delivery/partners/:id
   */
  async adminGetPartner(req, res, next) {
    try {
      const partner = await DeliveryPartnerProfile.findById(req.params.id)
        .populate('userId', 'name email phone status')
        .select(adminPartnerFields);
      if (!partner) {
        return res.status(404).json({
          success: false,
          error: { code: 'PARTNER_NOT_FOUND', message: 'Delivery partner profile not found.' }
        });
      }
      res.status(200).json({
        success: true,
        data: sanitizeAdminPartner(partner)
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/admin/delivery/partners/:id/status
   */
  async adminReviewPartner(req, res, next) {
    try {
      const { status, rejectionReason } = req.body;
      const profile = await deliveryService.adminReviewPartner({
        partnerId: req.params.id,
        status,
        rejectionReason
      });
      res.status(200).json({
        success: true,
        message: `Delivery partner profile status updated to '${status}'.`,
        data: sanitizeAdminPartner(profile)
      });
    } catch (err) {
      next(err);
    }
  },

  async adminUpdatePartnerAvailability(req, res, next) {
    try {
      const { availabilityStatus } = req.body;
      const profile = await deliveryService.adminUpdatePartnerAvailability({
        partnerId: req.params.id,
        availabilityStatus
      });
      res.status(200).json({
        success: true,
        message: `Delivery partner availability updated to '${availabilityStatus}'.`,
        data: sanitizeAdminPartner(profile)
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/admin/delivery/assign
   */
  async adminAssign(req, res, next) {
    try {
      const { vendorOrderId, deliveryPartnerId } = req.body;
      const assignment = await deliveryService.adminAssignDelivery({
        vendorOrderId,
        deliveryPartnerId,
        adminId: req.user._id
      });
      res.status(201).json({
        success: true,
        message: 'Delivery assigned successfully.',
        data: assignment
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/admin/delivery/assignments/:id/reassign
   */
  async adminReassign(req, res, next) {
    try {
      const { newDeliveryPartnerId, reason } = req.body;
      const assignment = await deliveryService.adminReassignDelivery({
        assignmentId: req.params.id,
        newDeliveryPartnerId,
        reason,
        adminId: req.user._id
      });
      res.status(200).json({
        success: true,
        message: 'Delivery reassigned successfully.',
        data: assignment
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/admin/delivery/assignments
   */
  async adminListAssignments(req, res, next) {
    try {
      const { status, search, page = 1, limit = 20 } = req.query;
      const filter = {};
      if (status) filter.status = status;

      if (search?.trim()) {
        const searchTerm = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
        const vendorOrderIds = await VendorOrder.find({ subOrderNumber: searchTerm }).distinct('_id');
        const deliveryUserIds = await User.find({
          role: 'delivery',
          $or: [{ name: searchTerm }, { phone: searchTerm }]
        }).distinct('_id');
        filter.$or = [
          { vendorOrderId: { $in: vendorOrderIds } },
          { deliveryUserId: { $in: deliveryUserIds } },
          { assignmentNumber: searchTerm }
        ];
      }

      const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * limitNum;
      const [assignments, total] = await Promise.all([
        DeliveryAssignment.find(filter)
          .populate('vendorOrderId', 'subOrderNumber items pricing status')
          .populate('deliveryPartnerId', 'vehicleType vehicleNumber')
          .populate('deliveryUserId', 'name phone')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        DeliveryAssignment.countDocuments(filter)
      ]);

      res.status(200).json({
        success: true,
        data: {
          assignments,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum)
          }
        }
      });
    } catch (err) {
      next(err);
    }
  }
};
