import mongoose from 'mongoose';

const webhookEventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  gateway: {
    type: String,
    enum: ['razorpay'],
    default: 'razorpay'
  },
  event: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  status: {
    type: String,
    enum: ['processed', 'ignored', 'failed'],
    default: 'processed'
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  processedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

export default mongoose.model('WebhookEvent', webhookEventSchema);

