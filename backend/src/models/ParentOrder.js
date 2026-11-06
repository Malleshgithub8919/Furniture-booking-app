import mongoose from 'mongoose';

const statusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    required: true
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

const parentOrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vendorOrderIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorOrder'
  }],
  // Immutable shipping address snapshot
  shippingAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    alternatePhone: String,
    street: { type: String, required: true },
    landmark: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    addressType: { type: String, default: 'home' },
    deliveryInstructions: String
  },
  // All monetary values in integer paise
  pricing: {
    itemsSubtotal: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Subtotal must be integer paise' }
    },
    totalDiscount: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Discount must be integer paise' }
    },
    shippingFee: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Shipping fee must be integer paise' }
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Tax must be integer paise' }
    },
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Grand total must be integer paise' }
    },
    currency: {
      type: String,
      default: 'INR'
    }
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'razorpay'],
    default: 'cod'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'authorized', 'captured', 'failed', 'refunded'],
    default: 'pending'
  },
  orderStatus: {
    type: String,
    enum: ['placed', 'partially_cancelled', 'cancelled', 'completed'],
    default: 'placed',
    index: true
  },
  statusHistory: [statusHistorySchema],
  idempotencyKey: {
    type: String,
    sparse: true,
    unique: true
  }
}, { timestamps: true });

parentOrderSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('ParentOrder', parentOrderSchema);

