import mongoose from 'mongoose';

const deliveryPartnerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  vehicleType: {
    type: String,
    enum: ['bike', 'scooter', 'van', 'mini_truck', 'truck'],
    required: true
  },
  vehicleNumber: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  licenseNumber: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  identityProof: {
    type: {
      type: String,
      enum: ['aadhaar', 'pan', 'driving_license', 'voter_id'],
      required: true
    },
    documentNumber: {
      type: String,
      required: true,
      trim: true
    },
    documentUrl: {
      type: String,
      trim: true
    }
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
    index: true
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  availabilityStatus: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'offline',
    index: true
  },
  servicePincodes: [{
    type: String,
    trim: true
  }],
  currentLocation: {
    city: { type: String, trim: true },
    state: { type: String, trim: true }
  },
  metrics: {
    totalDeliveries: { type: Number, default: 0 },
    successfulDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 }
  }
}, { timestamps: true });

deliveryPartnerProfileSchema.index({ approvalStatus: 1, availabilityStatus: 1 });

export default mongoose.model('DeliveryPartnerProfile', deliveryPartnerProfileSchema);

