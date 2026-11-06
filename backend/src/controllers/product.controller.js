import crypto from 'crypto';
import Product from '../models/Product.js';
import VendorProfile from '../models/VendorProfile.js';
import Category from '../models/Category.js';

export const productController = {
  /**
   * Vendor: Create a new product.
   * Enforces that only 'approved' vendors can list products.
   */
  async createProduct(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({
          success: false,
          message: 'Vendor profile not found. Please complete vendor onboarding first.'
        });
      }

      // Rule 5: Only approved vendors can publish products
      if (vendor.status !== 'approved') {
        return res.status(403).json({
          success: false,
          code: 'VENDOR_NOT_APPROVED',
          message: `Only approved vendors can create or publish products. Your current status is '${vendor.status}'.`
        });
      }

      const {
        name,
        description,
        sku,
        categoryId,
        price,
        salePrice,
        stock,
        dimensions,
        weight,
        materials,
        colors,
        specifications,
        images,
        tags
      } = req.body;

      // Verify category existence
      const category = await Category.findById(categoryId);
      if (!category || !category.isActive) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive category.' });
      }

      // Check unique SKU
      const existingSku = await Product.findOne({ sku: sku.trim().toUpperCase() });
      if (existingSku) {
        return res.status(409).json({
          success: false,
          message: `Product with SKU '${sku}' already exists.`
        });
      }

      // Auto-generate slug
      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const uniqueSuffix = crypto.randomBytes(3).toString('hex');
      const slug = `${baseSlug}-${uniqueSuffix}`;

      const product = await Product.create({
        name: name.trim(),
        slug,
        description: description.trim(),
        sku: sku.trim().toUpperCase(),
        vendorId: vendor._id,
        categoryId,
        price,
        salePrice: salePrice ?? null,
        stock,
        dimensions,
        weight,
        materials: materials || [],
        colors: colors || [],
        specifications: specifications || [],
        images: images || [],
        tags: tags || [],
        status: 'pending' // Submitted for admin moderation
      });

      return res.status(201).json({
        success: true,
        message: 'Product submitted successfully for catalog moderation.',
        product
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Public: List approved furniture products with search, filtering, and pagination.
   */
  async getPublicProducts(req, res, next) {
    try {
      const {
        q,
        category,
        minPrice,
        maxPrice,
        material,
        sort = 'newest',
        page = 1,
        limit = 12
      } = req.query;

      // Rule 7: Only approved products appear in public marketplace listings
      const filter = { status: 'approved' };

      // Search filter
      if (q && q.trim()) {
        filter.$text = { $search: q.trim() };
      }

      // Category filter (slug or ID)
      if (category) {
        const catDoc = await Category.findOne({
          $or: [{ slug: category }, { _id: category.match(/^[0-9a-fA-F]{24}$/) ? category : null }]
        });
        if (catDoc) {
          // Include subcategories in filtering
          const subcats = await Category.find({ parentId: catDoc._id });
          const catIds = [catDoc._id, ...subcats.map(s => s._id)];
          filter.categoryId = { $in: catIds };
        }
      }

      // Price filter (integer paise)
      if (minPrice !== undefined || maxPrice !== undefined) {
        filter.price = {};
        if (minPrice !== undefined) filter.price.$gte = parseInt(minPrice, 10);
        if (maxPrice !== undefined) filter.price.$lte = parseInt(maxPrice, 10);
      }

      // Material filter
      if (material) {
        filter.materials = { $regex: new RegExp(material, 'i') };
      }

      // Sorting
      let sortOptions = { createdAt: -1 };
      if (sort === 'price_asc') sortOptions = { price: 1 };
      else if (sort === 'price_desc') sortOptions = { price: -1 };
      else if (sort === 'popular') sortOptions = { stock: -1 };

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [products, total] = await Promise.all([
        Product.find(filter)
          .select('-reservedStock')
          .populate('categoryId', 'name slug')
          .populate('vendorId', 'storeName')
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Product.countDocuments(filter)
      ]);

      return res.json({
        success: true,
        products,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Public: Get approved product details by slug or ID.
   */
  async getPublicProductDetails(req, res, next) {
    try {
      const { slugOrId } = req.params;
      const query = slugOrId.match(/^[0-9a-fA-F]{24}$/)
        ? { _id: slugOrId, status: 'approved' }
        : { slug: slugOrId, status: 'approved' };

      const product = await Product.findOne(query)
        .populate('categoryId', 'name slug description')
        .populate('vendorId', 'storeName address');

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found or not currently available.'
        });
      }

      return res.json({
        success: true,
        product
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Vendor: View all products belonging strictly to the authenticated vendor.
   */
  async getVendorProducts(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({ success: false, message: 'Vendor profile not found.' });
      }

      const products = await Product.find({ vendorId: vendor._id })
        .populate('categoryId', 'name slug')
        .sort({ updatedAt: -1 });

      return res.json({
        success: true,
        products,
        total: products.length
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Vendor: Update product owned by the authenticated vendor.
   * Prevents vendors from modifying other vendors' products.
   */
  async updateProduct(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({ success: false, message: 'Vendor profile not found.' });
      }

      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }

      // Rule 9: Prevent vendors from modifying another vendor's products
      if (product.vendorId.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          code: 'UNAUTHORIZED_VENDOR',
          message: "Forbidden: You are not authorized to modify another vendor's products."
        });
      }

      const {
        name,
        description,
        price,
        salePrice,
        stock,
        dimensions,
        weight,
        materials,
        colors,
        specifications,
        images,
        tags
      } = req.body;

      if (name) product.name = name.trim();
      if (description) product.description = description.trim();
      if (price !== undefined) product.price = price;
      if (salePrice !== undefined) product.salePrice = salePrice;
      if (stock !== undefined) product.stock = stock;
      if (dimensions) product.dimensions = dimensions;
      if (weight) product.weight = weight;
      if (materials) product.materials = materials;
      if (colors) product.colors = colors;
      if (specifications) product.specifications = specifications;
      if (images) product.images = images;
      if (tags) product.tags = tags;

      // If price was modified on an approved product, flag for re-moderation
      if (product.status === 'approved' && price !== undefined) {
        product.status = 'pending';
      }

      await product.save();

      return res.json({
        success: true,
        message: 'Product updated successfully.',
        product
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Vendor: Delete (deactivate) an owned product.
   */
  async deleteProduct(req, res, next) {
    try {
      const vendor = await VendorProfile.findOne({ userId: req.user._id });
      if (!vendor) {
        return res.status(403).json({ success: false, message: 'Vendor profile not found.' });
      }

      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }

      // Ownership enforcement
      if (product.vendorId.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You cannot delete another vendor's product."
        });
      }

      product.status = 'inactive';
      await product.save();

      return res.json({
        success: true,
        message: 'Product status set to inactive.'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Admin: Moderate / Review product catalog status (approved, rejected).
   */
  async adminReviewProduct(req, res, next) {
    try {
      const { status, rejectionReason } = req.body;
      const allowed = ['approved', 'rejected', 'inactive', 'pending'];

      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Status must be one of: ${allowed.join(', ')}`
        });
      }

      if (status === 'rejected' && !rejectionReason) {
        return res.status(400).json({
          success: false,
          message: 'A rejection reason is required when rejecting a product listing.'
        });
      }

      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }

      product.status = status;
      if (rejectionReason) product.rejectionReason = rejectionReason;
      await product.save();

      return res.json({
        success: true,
        message: `Product status updated to '${status}'.`,
        product
      });
    } catch (error) {
      next(error);
    }
  }
};

