import crypto from 'crypto';
import mongoose from 'mongoose';
import DeliveryPartnerProfile from '../models/DeliveryPartnerProfile.js';
import DeliveryAssignment from '../models/DeliveryAssignment.js';
import VendorOrder from '../models/VendorOrder.js';
import ParentOrder from '../models/ParentOrder.js';
import VendorProfile from '../models/VendorProfile.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import { otpService } from './otp.service.js';

export const deliveryService = {
  /**
   * 1. Delivery partner profile onboarding.
   */
  async onboardPartner({ userId, phone, vehicleType, vehicleNumber, licenseNumber, identityProof, servicePincodes, currentLocation }) {
    const user = await User.findById(userId);
    if (!user) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    if (user.role !== 'delivery') {
      const err = new Error("Forbidden: User does not have the 'delivery' role.");
      err.statusCode = 403;
      throw err;
    }

    const existing = await DeliveryPartnerProfile.findOne({ userId });
    if (existing) {
      const err = new Error('Delivery partner profile already exists for this account.');
      err.statusCode = 409;
      throw err;
    }

    const profile = new DeliveryPartnerProfile({
      userId,
      phone,
      vehicleType,
      vehicleNumber,
      licenseNumber,
      identityProof,
      servicePincodes: servicePincodes || [],
      currentLocation: currentLocation || {},
      approvalStatus: 'pending',
      availabilityStatus: 'offline'
    });

    return await profile.save();
  },

  /**
   * 2. Partner toggles availability: 'available' | 'busy' | 'offline'.
   */
  async updateAvailability({ userId, availabilityStatus }) {
    const profile = await DeliveryPartnerProfile.findOne({ userId });
    if (!profile) {
      const err = new Error('Delivery partner profile not found.');
      err.statusCode = 404;
      throw err;
    }

    if (profile.approvalStatus !== 'approved') {
      const err = new Error(`Cannot change availability. Profile approval status is '${profile.approvalStatus}'.`);
      err.statusCode = 403;
      throw err;
    }

    profile.availabilityStatus = availabilityStatus;
    return await profile.save();
  },

  /**
   * 3. Admin review: approve, reject, or suspend partner profile.
   */
  async adminReviewPartner({ partnerId, status, rejectionReason }) {
    const profile = await DeliveryPartnerProfile.findById(partnerId);
    if (!profile) {
      const err = new Error('Delivery partner profile not found.');
      err.statusCode = 404;
      throw err;
    }

    profile.approvalStatus = status;
    if (status === 'rejected') {
      profile.rejectionReason = rejectionReason || 'Profile application rejected';
      profile.availabilityStatus = 'offline';
    } else if (status === 'suspended') {
      profile.availabilityStatus = 'offline';
    }

    return await profile.save();
  },

  async adminUpdatePartnerAvailability({ partnerId, availabilityStatus }) {
    const profile = await DeliveryPartnerProfile.findById(partnerId);
    if (!profile) {
      const err = new Error('Delivery partner profile not found.');
      err.statusCode = 404;
      throw err;
    }

    if (availabilityStatus === 'available' && profile.approvalStatus !== 'approved') {
      const err = new Error('Only approved delivery partners can be marked available.');
      err.statusCode = 403;
      throw err;
    }

    const activeAssignment = await DeliveryAssignment.exists({
      deliveryPartnerId: profile._id,
      status: { $nin: ['delivered', 'failed', 'cancelled'] }
    });
    if (activeAssignment) {
      const err = new Error('Availability cannot be changed while the partner has an active delivery assignment.');
      err.statusCode = 409;
      throw err;
    }

    profile.availabilityStatus = availabilityStatus;
    return await profile.save();
  },

  /**
   * 4. Admin assigns an eligible VendorOrder to an approved, available partner.
   * Multi-document transaction handles assignment, state lock, and OTP dispatch.
   */
  async adminAssignDelivery({ vendorOrderId, deliveryPartnerId, adminId }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendorOrder = await VendorOrder.findById(vendorOrderId).session(session);
      if (!vendorOrder) {
        const err = new Error('Vendor sub-order not found.');
        err.statusCode = 404;
        throw err;
      }

      if (['delivered', 'cancelled'].includes(vendorOrder.status)) {
        const err = new Error(`Cannot assign delivery: Sub-order is already in '${vendorOrder.status}' status.`);
        err.statusCode = 400;
        throw err;
      }

      // Check for an existing active assignment for this sub-order FIRST (before partner checks)
      const existingAssignment = await DeliveryAssignment.findOne({
        vendorOrderId,
        status: { $nin: ['cancelled', 'failed'] }
      }).session(session);

      if (existingAssignment) {
        const err = new Error(`This sub-order already has an active delivery assignment (${existingAssignment.assignmentNumber}).`);
        err.statusCode = 409;
        throw err;
      }

      const partner = await DeliveryPartnerProfile.findById(deliveryPartnerId)
        .populate('userId', 'name email phone')
        .session(session);

      if (!partner) {
        const err = new Error('Delivery partner profile not found.');
        err.statusCode = 404;
        throw err;
      }

      if (partner.approvalStatus !== 'approved') {
        const err = new Error(`Cannot assign: Partner profile status is '${partner.approvalStatus}'. Must be 'approved'.`);
        err.statusCode = 400;
        throw err;
      }

      if (partner.availabilityStatus !== 'available') {
        const err = new Error(`Cannot assign: Partner availability is '${partner.availabilityStatus}'. Must be 'available'.`);
        err.statusCode = 400;
        throw err;
      }

      // Fetch Vendor Profile for pickup address
      const vendor = await VendorProfile.findById(vendorOrder.vendorId).session(session);
      if (!vendor) {
        const err = new Error('Associated vendor profile not found.');
        err.statusCode = 404;
        throw err;
      }

      // Fetch ParentOrder for payment details and customer delivery address
      const parentOrder = await ParentOrder.findById(vendorOrder.parentOrderId).session(session);
      if (!parentOrder) {
        const err = new Error('Parent order not found.');
        err.statusCode = 404;
        throw err;
      }

      // Generate 6-digit Pickup and Delivery OTPs
      const rawPickupOtp = otpService.generateOtp();
      const rawDeliveryOtp = otpService.generateOtp();

      const pickupOtpHash = otpService.hashOtp(rawPickupOtp);
      const deliveryOtpHash = otpService.hashOtp(rawDeliveryOtp);

      const otpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hour validity

      const codAmountDue = (parentOrder.paymentMethod === 'cod' && parentOrder.paymentStatus !== 'captured')
        ? vendorOrder.pricing.grandTotal
        : 0;

      const assignmentNumber = `DEL-${vendorOrder.subOrderNumber}`;

      const assignment = new DeliveryAssignment({
        assignmentNumber,
        vendorOrderId: vendorOrder._id,
        parentOrderId: parentOrder._id,
        deliveryPartnerId: partner._id,
        deliveryUserId: partner.userId._id,
        vendorId: vendor._id,
        customerId: parentOrder.userId,
        status: 'assigned',
        pickupAddress: {
          storeName: vendor.storeName,
          phone: vendor.businessPhone || '9876543210',
          street: vendor.address?.street || 'Vendor Workshop',
          city: vendor.address?.city || 'City',
          state: vendor.address?.state || 'State',
          postalCode: vendor.address?.postalCode || '560001'
        },
        deliveryAddress: {
          fullName: parentOrder.shippingAddress.fullName,
          phone: parentOrder.shippingAddress.phone,
          alternatePhone: parentOrder.shippingAddress.alternatePhone,
          street: parentOrder.shippingAddress.street,
          landmark: parentOrder.shippingAddress.landmark,
          city: parentOrder.shippingAddress.city,
          state: parentOrder.shippingAddress.state,
          postalCode: parentOrder.shippingAddress.postalCode
        },
        pickupOtpHash,
        pickupOtpExpiresAt: otpExpiresAt,
        pickupOtpAttempts: 0,
        deliveryOtpHash,
        deliveryOtpExpiresAt: otpExpiresAt,
        deliveryOtpAttempts: 0,
        codAmountDue,
        codCollected: false,
        statusHistory: [{
          status: 'assigned',
          changedBy: adminId,
          role: 'admin',
          timestamp: new Date(),
          note: `Assigned to delivery partner ${partner.userId.name}.`
        }],
        assignmentHistory: [{
          assignedTo: partner._id,
          assignedBy: adminId,
          assignedAt: new Date()
        }]
      });

      await assignment.save({ session });

      // Lock partner availability
      partner.availabilityStatus = 'busy';
      await partner.save({ session });

      // Update vendor sub-order status to ready_for_pickup
      vendorOrder.status = 'ready_for_pickup';
      vendorOrder.statusHistory.push({
        status: 'ready_for_pickup',
        changedBy: adminId,
        role: 'admin',
        timestamp: new Date(),
        note: `Delivery partner assigned (${assignment.assignmentNumber}). Awaiting pickup.`
      });
      await vendorOrder.save({ session });

      await session.commitTransaction();
      session.endSession();

      // Dispatch OTPs (Never return plain OTPs in the API response)
      await otpService.deliverOtp({
        channel: 'phone',
        recipient: vendor.businessPhone || 'vendor',
        otp: rawPickupOtp
      }).catch(() => {});

      await otpService.deliverOtp({
        channel: 'phone',
        recipient: parentOrder.shippingAddress.phone,
        otp: rawDeliveryOtp
      }).catch(() => {});

      // Re-fetch from DB so select:false fields (OTP hashes) are excluded from response
      return await DeliveryAssignment.findById(assignment._id);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  },

  /**
   * 5. Admin reassigns a delivery to a new partner.
   */
  async adminReassignDelivery({ assignmentId, newDeliveryPartnerId, reason, adminId }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const assignment = await DeliveryAssignment.findById(assignmentId).session(session);
      if (!assignment) {
        const err = new Error('Delivery assignment not found.');
        err.statusCode = 404;
        throw err;
      }

      if (['delivered', 'cancelled'].includes(assignment.status)) {
        const err = new Error(`Cannot reassign delivery in '${assignment.status}' status.`);
        err.statusCode = 400;
        throw err;
      }

      const newPartner = await DeliveryPartnerProfile.findById(newDeliveryPartnerId)
        .populate('userId', 'name')
        .session(session);

      if (!newPartner || newPartner.approvalStatus !== 'approved' || newPartner.availabilityStatus !== 'available') {
        const err = new Error('New delivery partner is not eligible or available.');
        err.statusCode = 400;
        throw err;
      }

      // Release old partner
      const oldPartner = await DeliveryPartnerProfile.findById(assignment.deliveryPartnerId).session(session);
      if (oldPartner) {
        oldPartner.availabilityStatus = 'available';
        await oldPartner.save({ session });
      }

      // Close previous assignment history record
      if (assignment.assignmentHistory.length > 0) {
        const lastIndex = assignment.assignmentHistory.length - 1;
        assignment.assignmentHistory[lastIndex].unassignedAt = new Date();
        assignment.assignmentHistory[lastIndex].reason = reason || 'Reassigned by admin';
      }

      // Generate fresh OTPs
      const rawPickupOtp = otpService.generateOtp();
      const rawDeliveryOtp = otpService.generateOtp();

      assignment.pickupOtpHash = otpService.hashOtp(rawPickupOtp);
      assignment.pickupOtpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      assignment.pickupOtpAttempts = 0;

      assignment.deliveryOtpHash = otpService.hashOtp(rawDeliveryOtp);
      assignment.deliveryOtpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      assignment.deliveryOtpAttempts = 0;

      assignment.deliveryPartnerId = newPartner._id;
      assignment.deliveryUserId = newPartner.userId._id;
      assignment.status = 'assigned';

      assignment.assignmentHistory.push({
        assignedTo: newPartner._id,
        assignedBy: adminId,
        assignedAt: new Date(),
        reason: reason || 'Reassignment'
      });

      assignment.statusHistory.push({
        status: 'assigned',
        changedBy: adminId,
        role: 'admin',
        timestamp: new Date(),
        note: `Reassigned to partner ${newPartner.userId.name}. Reason: ${reason || 'N/A'}`
      });

      await assignment.save({ session });

      newPartner.availabilityStatus = 'busy';
      await newPartner.save({ session });

      await session.commitTransaction();
      session.endSession();

      // Re-fetch from DB so select:false fields (OTP hashes) are excluded from response
      return await DeliveryAssignment.findById(assignment._id);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  },

  /**
   * 6. Delivery partner queries own assigned orders.
   */
  async listPartnerAssignments({ userId, status, page = 1, limit = 20 }) {
    const filter = { deliveryUserId: userId };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [assignments, total] = await Promise.all([
      DeliveryAssignment.find(filter)
        .populate('vendorOrderId', 'subOrderNumber items pricing status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      DeliveryAssignment.countDocuments(filter)
    ]);

    return {
      assignments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    };
  },

  /**
   * 7. Detailed view of an assignment with authorization.
   */
  async getAssignmentDetails({ assignmentId, userId, role }) {
    const assignment = await DeliveryAssignment.findById(assignmentId)
      .populate('vendorOrderId')
      .populate('deliveryPartnerId', 'vehicleType vehicleNumber phone')
      .populate('deliveryUserId', 'name phone');

    if (!assignment) {
      const err = new Error('Delivery assignment not found.');
      err.statusCode = 404;
      throw err;
    }

    if (role === 'delivery' && assignment.deliveryUserId._id.toString() !== userId.toString()) {
      const err = new Error('Forbidden: You can only access your own delivery assignments.');
      err.statusCode = 403;
      throw err;
    }

    if (role === 'customer' && assignment.customerId.toString() !== userId.toString()) {
      const err = new Error('Forbidden: You cannot view this delivery.');
      err.statusCode = 403;
      throw err;
    }

    return assignment;
  },

  /**
   * 8. Delivery partner advances status: 'arrived_at_vendor' or 'out_for_delivery'.
   */
  async updateAssignmentStatus({ assignmentId, userId, newStatus, note }) {
    const allowed = ['arrived_at_vendor', 'out_for_delivery'];
    if (!allowed.includes(newStatus)) {
      const err = new Error(`Invalid status transition. Allowed manual transitions: ${allowed.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const assignment = await DeliveryAssignment.findOne({ _id: assignmentId, deliveryUserId: userId });
    if (!assignment) {
      const err = new Error('Assignment not found or does not belong to this delivery partner.');
      err.statusCode = 404;
      throw err;
    }

    if (newStatus === 'arrived_at_vendor' && assignment.status !== 'assigned') {
      const err = new Error(`Cannot transition to 'arrived_at_vendor' from '${assignment.status}'.`);
      err.statusCode = 400;
      throw err;
    }

    if (newStatus === 'out_for_delivery' && assignment.status !== 'picked_up') {
      const err = new Error(`Cannot transition to 'out_for_delivery' before pickup verification is complete (current: '${assignment.status}').`);
      err.statusCode = 400;
      throw err;
    }

    assignment.status = newStatus;
    assignment.statusHistory.push({
      status: newStatus,
      changedBy: userId,
      role: 'delivery',
      timestamp: new Date(),
      note: note || `Status updated to ${newStatus}`
    });

    return await assignment.save();
  },

  /**
   * 9. Secure Pickup OTP Verification.
   * Delivery partner submits the 6-digit OTP received from the Vendor.
   */
  async verifyPickupOtp({ assignmentId, userId, otp }) {
    const assignment = await DeliveryAssignment.findOne({ _id: assignmentId, deliveryUserId: userId })
      .select('+pickupOtpHash +pickupOtpExpiresAt +pickupOtpAttempts');

    if (!assignment) {
      const err = new Error('Assignment not found or does not belong to this delivery partner.');
      err.statusCode = 404;
      throw err;
    }

    if (!['assigned', 'arrived_at_vendor'].includes(assignment.status)) {
      const err = new Error(`Cannot verify pickup: Assignment is already in '${assignment.status}' status.`);
      err.statusCode = 400;
      throw err;
    }

    // Attempt rate-limit
    if (assignment.pickupOtpAttempts >= 5) {
      const err = new Error('Too many failed pickup OTP attempts. Maximum limit reached. Please contact support.');
      err.statusCode = 429;
      throw err;
    }

    // Expiry check
    if (assignment.pickupOtpExpiresAt && new Date() > assignment.pickupOtpExpiresAt) {
      const err = new Error('Pickup OTP has expired. Please request a new assignment OTP.');
      err.statusCode = 400;
      throw err;
    }

    // Verification check
    const isValid = otpService.verifyOtpHash(otp, assignment.pickupOtpHash);
    if (!isValid) {
      assignment.pickupOtpAttempts += 1;
      await assignment.save();
      const err = new Error(`Invalid pickup OTP. Attempts remaining: ${5 - assignment.pickupOtpAttempts}`);
      err.statusCode = 400;
      throw err;
    }

    // Atomic MongoDB Transaction: Update Assignment and VendorOrder
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      assignment.status = 'picked_up';
      assignment.pickupVerifiedAt = new Date();
      assignment.statusHistory.push({
        status: 'picked_up',
        changedBy: userId,
        role: 'delivery',
        timestamp: new Date(),
        note: 'Pickup verified via OTP. Package collected from vendor.'
      });
      await assignment.save({ session });

      const vendorOrder = await VendorOrder.findById(assignment.vendorOrderId).session(session);
      if (vendorOrder) {
        vendorOrder.status = 'shipped';
        vendorOrder.statusHistory.push({
          status: 'shipped',
          changedBy: userId,
          role: 'delivery',
          timestamp: new Date(),
          note: `Package picked up by delivery partner (${assignment.assignmentNumber}). Dispatched.`
        });
        await vendorOrder.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        assignmentNumber: assignment.assignmentNumber,
        status: 'picked_up',
        pickupVerifiedAt: assignment.pickupVerifiedAt
      };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  },

  /**
   * 10. Secure Delivery Handover & OTP Verification.
   * Delivery partner submits the 6-digit OTP received from the Customer upon handover.
   * Multi-document transaction completes sub-order, COD collection, and parent order.
   */
  async verifyDeliveryOtpAndComplete({ assignmentId, userId, otp }) {
    const assignment = await DeliveryAssignment.findOne({ _id: assignmentId, deliveryUserId: userId })
      .select('+deliveryOtpHash +deliveryOtpExpiresAt +deliveryOtpAttempts');

    if (!assignment) {
      const err = new Error('Assignment not found or does not belong to this delivery partner.');
      err.statusCode = 404;
      throw err;
    }

    if (assignment.status === 'delivered') {
      const err = new Error('Duplicate completion prevented: Order is already marked as delivered.');
      err.statusCode = 400;
      throw err;
    }

    if (!['picked_up', 'out_for_delivery'].includes(assignment.status)) {
      const err = new Error(`Cannot complete delivery from '${assignment.status}' status. Package must be picked up first.`);
      err.statusCode = 400;
      throw err;
    }

    // Attempt rate-limit
    if (assignment.deliveryOtpAttempts >= 5) {
      const err = new Error('Too many failed delivery OTP attempts. Maximum limit reached. Please contact support.');
      err.statusCode = 429;
      throw err;
    }

    // Expiry check
    if (assignment.deliveryOtpExpiresAt && new Date() > assignment.deliveryOtpExpiresAt) {
      const err = new Error('Delivery OTP has expired. Please contact support.');
      err.statusCode = 400;
      throw err;
    }

    // Verification check
    const isValid = otpService.verifyOtpHash(otp, assignment.deliveryOtpHash);
    if (!isValid) {
      assignment.deliveryOtpAttempts += 1;
      await assignment.save();
      const err = new Error(`Invalid delivery OTP. Attempts remaining: ${5 - assignment.deliveryOtpAttempts}`);
      err.statusCode = 400;
      throw err;
    }

    // Atomic Transaction: Deliver Assignment, VendorOrder, COD Payment & ParentOrder
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      assignment.status = 'delivered';
      assignment.deliveryVerifiedAt = new Date();

      // Check ParentOrder & Payment eligibility
      const parentOrder = await ParentOrder.findById(assignment.parentOrderId).session(session);
      if (!parentOrder) {
        throw new Error('Parent order record not found.');
      }

      // COD Collection on Handover
      if (parentOrder.paymentMethod === 'cod') {
        assignment.codCollected = true;
        assignment.codCollectedAt = new Date();

        // Create / Capture COD Payment record
        let payment = await Payment.findOne({ orderId: parentOrder._id, gateway: 'cod' }).session(session);
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
              collectedBy: userId,
              collectorRole: 'delivery',
              assignmentNumber: assignment.assignmentNumber,
              collectedAt: new Date()
            }
          });
        } else {
          payment.status = 'captured';
        }
        await payment.save({ session });

        parentOrder.paymentStatus = 'captured';
        parentOrder.statusHistory.push({
          status: parentOrder.orderStatus,
          timestamp: new Date(),
          note: `COD payment of ₹${(parentOrder.pricing.grandTotal / 100).toFixed(2)} collected upon delivery handover.`
        });
      }

      assignment.statusHistory.push({
        status: 'delivered',
        changedBy: userId,
        role: 'delivery',
        timestamp: new Date(),
        note: 'Delivery confirmed via customer OTP. Package handed over successfully.'
      });
      await assignment.save({ session });

      // Update VendorOrder to delivered
      const vendorOrder = await VendorOrder.findById(assignment.vendorOrderId).session(session);
      if (vendorOrder) {
        vendorOrder.status = 'delivered';
        vendorOrder.statusHistory.push({
          status: 'delivered',
          changedBy: userId,
          role: 'delivery',
          timestamp: new Date(),
          note: `Delivered by partner (${assignment.assignmentNumber}).`
        });
        await vendorOrder.save({ session });
      }

      // Check if all sibling vendor orders in this ParentOrder are now delivered
      const allSubOrders = await VendorOrder.find({ parentOrderId: parentOrder._id }).session(session);
      const allDelivered = allSubOrders.every(o => o.status === 'delivered');
      if (allDelivered) {
        parentOrder.orderStatus = 'completed';
        parentOrder.statusHistory.push({
          status: 'completed',
          timestamp: new Date(),
          note: 'All vendor sub-orders delivered. Order completed successfully.'
        });
      }
      await parentOrder.save({ session });

      // Update Delivery Partner Profile metrics and release availability back to 'available'
      const partner = await DeliveryPartnerProfile.findById(assignment.deliveryPartnerId).session(session);
      if (partner) {
        partner.metrics.totalDeliveries += 1;
        partner.metrics.successfulDeliveries += 1;
        partner.availabilityStatus = 'available';
        await partner.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        assignmentNumber: assignment.assignmentNumber,
        status: 'delivered',
        deliveredAt: assignment.deliveryVerifiedAt,
        codCollected: assignment.codCollected
      };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  },

  /**
   * 11. Delivery partner reports failure/exception.
   */
  async reportDeliveryFailure({ assignmentId, userId, reason }) {
    const assignment = await DeliveryAssignment.findOne({ _id: assignmentId, deliveryUserId: userId });
    if (!assignment) {
      const err = new Error('Assignment not found or does not belong to this delivery partner.');
      err.statusCode = 404;
      throw err;
    }

    if (['delivered', 'cancelled'].includes(assignment.status)) {
      const err = new Error(`Cannot report failure for order in '${assignment.status}' status.`);
      err.statusCode = 400;
      throw err;
    }

    assignment.status = 'failed';
    assignment.failureDetails = {
      reason: reason || 'Customer unreachable / Delivery failed',
      reportedAt: new Date(),
      reportedBy: userId
    };
    assignment.statusHistory.push({
      status: 'failed',
      changedBy: userId,
      role: 'delivery',
      timestamp: new Date(),
      note: `Delivery failed: ${reason || 'Unspecified reason'}`
    });
    await assignment.save();

    // Release partner back to available & increment failed metrics
    const partner = await DeliveryPartnerProfile.findById(assignment.deliveryPartnerId);
    if (partner) {
      partner.metrics.failedDeliveries += 1;
      partner.availabilityStatus = 'available';
      await partner.save();
    }

    return {
      success: true,
      assignmentNumber: assignment.assignmentNumber,
      status: 'failed',
      failureDetails: assignment.failureDetails
    };
  },

  /**
   * 12. Customer checks delivery tracking & partner contact info.
   */
  async getCustomerDeliveryTracking({ parentOrderId, userId }) {
    const parentOrder = await ParentOrder.findOne({ _id: parentOrderId, userId });
    if (!parentOrder) {
      const err = new Error('Order not found or does not belong to this customer account.');
      err.statusCode = 404;
      throw err;
    }

    const assignments = await DeliveryAssignment.find({ parentOrderId })
      .populate('deliveryPartnerId', 'vehicleType vehicleNumber phone')
      .populate('deliveryUserId', 'name phone')
      .populate('vendorId', 'storeName');

    return {
      orderNumber: parentOrder.orderNumber,
      orderStatus: parentOrder.orderStatus,
      paymentStatus: parentOrder.paymentStatus,
      deliveries: assignments.map(a => ({
        assignmentNumber: a.assignmentNumber,
        status: a.status,
        vendorStore: a.vendorId?.storeName || 'Vendor',
        deliveryPartner: {
          name: a.deliveryUserId?.name || 'Assigned Driver',
          phone: a.deliveryPartnerId?.phone || a.deliveryUserId?.phone || '',
          vehicleType: a.deliveryPartnerId?.vehicleType || '',
          vehicleNumber: a.deliveryPartnerId?.vehicleNumber || ''
        },
        pickupVerifiedAt: a.pickupVerifiedAt,
        deliveryVerifiedAt: a.deliveryVerifiedAt,
        statusHistory: a.statusHistory
      }))
    };
  }
};
