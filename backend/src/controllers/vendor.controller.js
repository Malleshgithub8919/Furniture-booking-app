import VendorProfile from '../models/VendorProfile.js';
import User from '../models/User.js';
import { storageService } from '../services/storage.service.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const vendorController = {
  /**
   * Onboards an authenticated user as a vendor.
   */
  async onboard(req, res, next) {
    try {
      const existing = await VendorProfile.findOne({ userId: req.user._id });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'You have already submitted a vendor profile.',
          vendor: existing
        });
      }

      const { storeName, businessType, gstin, pan, address, bankDetails } = req.body;

      const profile = await VendorProfile.create({
        userId: req.user._id,
        storeName: storeName.trim(),
        businessType: businessType || 'individual',
        gstin,
        pan,
        address,
        bankDetails,
        status: 'pending'
      });

      // Update User role to 'vendor' if not already
      if (req.user.role === 'customer') {
        await User.findByIdAndUpdate(req.user._id, { role: 'vendor' });
      }

      return res.status(201).json({
        success: true,
        message: 'Vendor application submitted. Please upload KYC documents to start the review process.',
        vendor: profile
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Fetches the authenticated vendor's own profile.
   */
  async getMyProfile(req, res, next) {
    try {
      const profile = await VendorProfile.findOne({ userId: req.user._id })
        .select('+kycDocuments +bankDetails');

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'No vendor profile found for this account.'
        });
      }

      return res.json({
        success: true,
        vendor: profile
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Updates authenticated vendor's own profile (excluding review/commission fields).
   */
  async updateMyProfile(req, res, next) {
    try {
      const profile = await VendorProfile.findOne({ userId: req.user._id });
      if (!profile) {
        return res.status(404).json({ success: false, message: 'Vendor profile not found.' });
      }

      const { storeName, businessType, gstin, pan, address, bankDetails } = req.body;

      if (storeName) profile.storeName = storeName.trim();
      if (businessType) profile.businessType = businessType;
      if (gstin !== undefined) profile.gstin = gstin;
      if (pan !== undefined) profile.pan = pan;
      if (address) profile.address = { ...profile.address, ...address };
      if (bankDetails) profile.bankDetails = bankDetails;

      await profile.save();

      return res.json({
        success: true,
        message: 'Vendor profile updated successfully.',
        vendor: profile
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Uploads KYC document metadata and advances status to 'under_review'.
   */
  async uploadKycDocument(req, res, next) {
    try {
      const profile = await VendorProfile.findOne({ userId: req.user._id })
        .select('+kycDocuments');

      if (!profile) {
        return res.status(404).json({ success: false, message: 'Vendor profile not found.' });
      }

      const { documentType, originalName, mimeType, sizeBytes } = req.body;

      // Validate metadata using storage service
      const metaCheck = storageService.validateDocumentMetadata({ originalName, mimeType, sizeBytes });
      if (!metaCheck.valid) {
        return res.status(400).json({ success: false, message: metaCheck.message });
      }

      const fileKey = storageService.generateDocumentKey({
        vendorId: profile._id,
        documentType,
        originalName
      });

      profile.kycDocuments.push({
        documentType,
        fileKey,
        originalName,
        mimeType,
        sizeBytes,
        status: 'pending',
        uploadedAt: new Date()
      });

      // Advance vendor status to under_review
      if (profile.status === 'pending' || profile.status === 'rejected') {
        profile.status = 'under_review';
      }

      await profile.save();

      return res.status(201).json({
        success: true,
        message: 'KYC document registered successfully. Your profile is now under review.',
        document: profile.kycDocuments[profile.kycDocuments.length - 1],
        vendorStatus: profile.status
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Admin: List all vendors with status filter and pagination.
   */
  async adminListVendors(req, res, next) {
    try {
      const { status, search, page = 1, limit = 20 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (search?.trim()) {
        const searchTerm = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
        const userIds = await User.find({
          $or: [{ name: searchTerm }, { email: searchTerm }, { phone: searchTerm }]
        }).distinct('_id');
        filter.$or = [
          { storeName: searchTerm },
          { gstin: searchTerm },
          { pan: searchTerm },
          { userId: { $in: userIds } }
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [vendors, total] = await Promise.all([
        VendorProfile.find(filter)
          .populate('userId', 'name email phone')
          .select('storeName businessType status commissionRate address.city address.state userId createdAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        VendorProfile.countDocuments(filter)
      ]);

      return res.json({
        success: true,
        vendors,
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
   * Admin: Fetch a vendor profile including private KYC documents and bank details.
   */
  async adminGetVendor(req, res, next) {
    try {
      const vendor = await VendorProfile.findById(req.params.id)
        .populate('userId', 'name email phone role status')
        .populate('reviewedBy', 'name email')
        .select('+kycDocuments');

      if (!vendor) {
        return res.status(404).json({ success: false, message: 'Vendor not found.' });
      }

      const vendorData = vendor.toObject();
      vendorData.kycDocuments = vendorData.kycDocuments.map(({ fileKey, ...document }) => document);
      return res.json({
        success: true,
        vendor: vendorData
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Admin: Approve, reject, or suspend a vendor profile.
   */
  async adminUpdateStatus(req, res, next) {
    try {
      const { status, rejectionReason, commissionRate } = req.body;
      const allowedStatuses = ['approved', 'rejected', 'suspended', 'under_review'];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Status must be one of: ${allowedStatuses.join(', ')}`
        });
      }

      if (status === 'rejected' && !rejectionReason) {
        return res.status(400).json({
          success: false,
          message: 'A rejection reason is required when rejecting a vendor application.'
        });
      }

      const vendor = await VendorProfile.findById(req.params.id);
      if (!vendor) {
        return res.status(404).json({ success: false, message: 'Vendor not found.' });
      }

      vendor.status = status;
      if (rejectionReason) vendor.rejectionReason = rejectionReason;
      if (commissionRate !== undefined) vendor.commissionRate = commissionRate;
      vendor.reviewedBy = req.user._id;
      vendor.reviewedAt = new Date();

      await vendor.save();

      return res.json({
        success: true,
        message: `Vendor status updated to '${status}'.`,
        vendor
      });
    } catch (error) {
      next(error);
    }
  }
};
