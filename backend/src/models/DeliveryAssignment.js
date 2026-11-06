import mongoose from 'mongoose';

const deliveryStatusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  role: {
    type: String,
    enum: ['delivery', 'admin', 'system']
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  note: {
    type: String,
    trim: true
  }
}, { _id: false });

const assignmentHistorySchema = new mongoose.Schema({
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPartnerProfile',
    required: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  unassignedAt: Date,
  reason: {
    type: String,
    trim: true
  }
}, { _id: false });

const deliveryAssignmentSchema = new mongoose.Schema({
  assignmentNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  vendorOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorOrder',
    required: true,
    index: true
  },
  parentOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParentOrder',
    required: true,
    index: true
  },
  deliveryPartnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPartnerProfile',
    required: true,
    index: true
  },
  deliveryUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorProfile',
    required: true,
    index: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['assigned', 'arrived_at_vendor', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled'],
    default: 'assigned',
    index: true
  },
  pickupAddress: {
    storeName: { type: String, required: true },
    phone: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true }
  },
  deliveryAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    alternatePhone: String,
    street: { type: String, required: true },
    landmark: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true }
  },
  // Secure OTP metadata (Plain OTPs must NEVER be stored or selected)
  pickupOtpHash: {
    type: String,
    select: false
  },
  pickupOtpExpiresAt: {
    type: Date,
    select: false
  },
  pickupOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  pickupVerifiedAt: Date,

  deliveryOtpHash: {
    type: String,
    select: false
  },
  deliveryOtpExpiresAt: {
    type: Date,
    select: false
  },
  deliveryOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  deliveryVerifiedAt: Date,

  codAmountDue: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isInteger, message: 'COD amount must be in integer paise' }
  },
  codCollected: {
    type: Boolean,
    default: false
  },
  codCollectedAt: Date,

  failureDetails: {
    reason: String,
    reportedAt: Date,
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  statusHistory: [deliveryStatusHistorySchema],
  assignmentHistory: [assignmentHistorySchema]
}, { timestamps: true });

deliveryAssignmentSchema.index({ deliveryUserId: 1, status: 1 });
deliveryAssignmentSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('DeliveryAssignment', deliveryAssignmentSchema);

