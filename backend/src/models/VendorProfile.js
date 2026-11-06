import mongoose from 'mongoose';

const kycDocumentSchema = new mongoose.Schema({
  documentType: {
    type: String,
    enum: ['pan_card', 'gst_certificate', 'business_proof', 'bank_proof', 'id_proof'],
    required: true
  },
  fileKey: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  sizeBytes: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  rejectionReason: String
}, { _id: true });

const vendorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  storeName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
    index: true
  },
  businessType: {
    type: String,
    enum: ['individual', 'partnership', 'private_limited', 'proprietorship'],
    default: 'individual'
  },
  gstin: {
    type: String,
    sparse: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  pan: {
    type: String,
    sparse: true,
    trim: true,
    uppercase: true
  },
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true, required: true },
    state: { type: String, trim: true, required: true },
    postalCode: { type: String, trim: true, required: true },
    country: { type: String, trim: true, default: 'India' }
  },
  // Bank details are protected with select: false for privacy
  bankDetails: {
    type: {
      accountHolderName: String,
      accountNumber: String,
      ifscCode: String,
      bankName: String
    },
    select: false
  },
  // Private KYC documents - never exposed to public
  kycDocuments: {
    type: [kycDocumentSchema],
    select: false
  },
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected', 'suspended'],
    default: 'pending',
    index: true
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  commissionRate: {
    type: Number,
    default: 10, // Default 10% marketplace commission
    min: 0,
    max: 50
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date
}, { timestamps: true });

vendorProfileSchema.index({ storeName: 'text' });

export default mongoose.model('VendorProfile', vendorProfileSchema);
