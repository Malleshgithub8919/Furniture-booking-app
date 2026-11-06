import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParentOrder',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  gateway: {
    type: String,
    enum: ['razorpay', 'cod'],
    required: true
  },
  gatewayOrderId: {
    type: String,
    trim: true,
    index: true,
    sparse: true
  },
  gatewayPaymentId: {
    type: String,
    trim: true,
    index: true,
    sparse: true
  },
  gatewaySignature: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isInteger, message: 'Payment amount must be an integer (in paise)' }
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true
  },
  status: {
    type: String,
    enum: ['pending', 'authorized', 'captured', 'failed', 'refunded'],
    default: 'pending',
    index: true
  },
  method: {
    type: String,
    default: 'online'
  },
  errorDetails: {
    code: String,
    description: String,
    source: String,
    step: String,
    reason: String
  },
  refundDetails: {
    refundId: String,
    amount: Number,
    status: String,
    refundedAt: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Payment', paymentSchema);

