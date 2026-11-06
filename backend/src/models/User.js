import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    unique: true
  },
  phone: {
    type: String,
    trim: true,
    sparse: true,
    unique: true
  },
  passwordHash: {
    type: String,
    required: true,
    select: false
  },
  role: {
    type: String,
    enum: ['customer', 'vendor', 'delivery', 'admin'],
    default: 'customer',
    immutable: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked', 'pending_verification'],
    default: 'pending_verification'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  // OTP fields protected with select: false
  emailOtpHash: {
    type: String,
    select: false
  },
  emailOtpExpiresAt: {
    type: Date,
    select: false
  },
  emailOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  phoneOtpHash: {
    type: String,
    select: false
  },
  phoneOtpExpiresAt: {
    type: Date,
    select: false
  },
  phoneOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  lastLoginAt: Date
}, { timestamps: true });

export default mongoose.model('User', userSchema);
