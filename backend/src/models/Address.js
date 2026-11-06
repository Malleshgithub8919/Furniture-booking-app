import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: 100
  },
  phone: {
    type: String,
    required: [true, 'Mobile number is required'],
    trim: true
  },
  alternatePhone: {
    type: String,
    trim: true
  },
  street: {
    type: String,
    required: [true, 'Street address is required'],
    trim: true,
    maxlength: 250
  },
  landmark: {
    type: String,
    trim: true,
    maxlength: 120
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true
  },
  postalCode: {
    type: String,
    required: [true, 'Postal code is required'],
    trim: true
  },
  addressType: {
    type: String,
    enum: ['home', 'work', 'other'],
    default: 'home'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  deliveryInstructions: {
    type: String,
    trim: true,
    maxlength: 300
  }
}, { timestamps: true });

addressSchema.index({ userId: 1, isDefault: -1 });

export default mongoose.model('Address', addressSchema);

