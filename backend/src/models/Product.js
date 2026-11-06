import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [200, 'Product name cannot exceed 200 characters']
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true
  },
  sku: {
    type: String,
    required: [true, 'SKU is required'],
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorProfile',
    required: [true, 'Vendor ID is required'],
    index: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category ID is required'],
    index: true
  },
  // Price stored as integer paise (e.g. ₹5,999.00 = 599900 paise)
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
    validate: {
      validator: Number.isInteger,
      message: 'Price must be an integer represented in paise'
    }
  },
  // Discounted/sale price stored in paise (must be <= price)
  salePrice: {
    type: Number,
    min: [0, 'Sale price cannot be negative'],
    validate: [
      {
        validator: function(val) {
          return val === undefined || val === null || Number.isInteger(val);
        },
        message: 'Sale price must be an integer represented in paise'
      },
      {
        validator: function(val) {
          if (val === undefined || val === null) return true;
          return val <= this.price;
        },
        message: 'Sale price cannot be greater than base price'
      }
    ]
  },
  stock: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock cannot be negative'],
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Stock must be an integer quantity'
    }
  },
  reservedStock: {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator: Number.isInteger,
      message: 'Reserved stock must be an integer quantity'
    }
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected', 'inactive'],
    default: 'draft'
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    unit: { type: String, enum: ['cm', 'inch', 'mm'], default: 'cm' }
  },
  weight: {
    value: { type: Number, min: 0 },
    unit: { type: String, enum: ['kg', 'g', 'lbs'], default: 'kg' }
  },
  materials: [{
    type: String,
    trim: true
  }],
  colors: [{
    name: { type: String, trim: true },
    hexCode: { type: String, trim: true }
  }],
  specifications: [{
    key: { type: String, trim: true },
    value: { type: String, trim: true }
  }],
  images: [{
    url: { type: String, required: true },
    altText: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false }
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }]
}, { timestamps: true });

// Compound index for high-performance public marketplace listings
productSchema.index({ status: 1, categoryId: 1, price: 1 });
// Vendor query index
productSchema.index({ vendorId: 1, status: 1 });
// Full text search index
productSchema.index({
  name: 'text',
  description: 'text',
  materials: 'text',
  tags: 'text'
});

export default mongoose.model('Product', productSchema);
