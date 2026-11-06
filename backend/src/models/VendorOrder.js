import mongoose from 'mongoose';

const orderItemSnapshotSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: { type: String, required: true },
  sku: { type: String, required: true },
  primaryImage: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isInteger, message: 'Quantity must be an integer' }
  },
  unitBasePrice: {
    type: Number,
    required: true,
    validate: { validator: Number.isInteger, message: 'Base price must be integer paise' }
  },
  unitSalePrice: {
    type: Number,
    validate: {
      validator: function(v) {
        return v === null || v === undefined || Number.isInteger(v);
      },
      message: 'Sale price must be integer paise'
    }
  },
  effectiveUnitPrice: {
    type: Number,
    required: true,
    validate: { validator: Number.isInteger, message: 'Effective price must be integer paise' }
  },
  lineTotal: {
    type: Number,
    required: true,
    validate: { validator: Number.isInteger, message: 'Line total must be integer paise' }
  },
  customizations: {
    selectedColor: String,
    selectedMaterial: String,
    customNote: String
  }
}, { _id: true });

const vendorOrderStatusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: { type: String, enum: ['customer', 'vendor', 'admin', 'delivery', 'system'] },
  timestamp: { type: Date, default: Date.now },
  note: String
}, { _id: false });

const vendorOrderSchema = new mongoose.Schema({
  subOrderNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  parentOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParentOrder',
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
  items: [orderItemSnapshotSchema],
  pricing: {
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Subtotal must be integer paise' }
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Commission amount must be integer paise' }
    },
    vendorPayout: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Vendor payout must be integer paise' }
    },
    shippingFee: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Shipping fee must be integer paise' }
    },
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Grand total must be integer paise' }
    }
  },
  status: {
    type: String,
    enum: ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled'],
    default: 'placed',
    index: true
  },
  statusHistory: [vendorOrderStatusHistorySchema],
  cancellation: {
    reason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date
  }
}, { timestamps: true });

vendorOrderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
vendorOrderSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model('VendorOrder', vendorOrderSchema);

