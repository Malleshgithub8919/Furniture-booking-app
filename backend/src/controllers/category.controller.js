import Category from '../models/Category.js';

export const categoryController = {
  /**
   * Public: List all active categories in hierarchical tree order.
   */
  async listCategories(req, res, next) {
    try {
      const categories = await Category.find({ isActive: true })
        .sort({ displayOrder: 1, name: 1 })
        .lean();

      // Build hierarchical category tree
      const categoryMap = {};
      const roots = [];

      for (const cat of categories) {
        cat.subcategories = [];
        categoryMap[cat._id.toString()] = cat;
      }

      for (const cat of categories) {
        if (cat.parentId && categoryMap[cat.parentId.toString()]) {
          categoryMap[cat.parentId.toString()].subcategories.push(cat);
        } else {
          roots.push(cat);
        }
      }

      return res.json({
        success: true,
        categories: roots,
        total: categories.length
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Public: Get category by unique slug.
   */
  async getBySlug(req, res, next) {
    try {
      const category = await Category.findOne({ slug: req.params.slug, isActive: true })
        .populate('parentId', 'name slug');

      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found.' });
      }

      // Find direct children subcategories
      const subcategories = await Category.find({ parentId: category._id, isActive: true })
        .sort({ displayOrder: 1, name: 1 });

      return res.json({
        success: true,
        category,
        subcategories
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Admin: Create a new category.
   */
  async createCategory(req, res, next) {
    try {
      const { name, slug, description, parentId, image, displayOrder } = req.body;
      const normalizedSlug = (slug || name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const existing = await Category.findOne({ slug: normalizedSlug });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Category with slug '${normalizedSlug}' already exists.`
        });
      }

      const category = await Category.create({
        name: name.trim(),
        slug: normalizedSlug,
        description,
        parentId: parentId || null,
        image,
        displayOrder: displayOrder || 0
      });

      return res.status(201).json({
        success: true,
        message: 'Category created successfully.',
        category
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Admin: Update an existing category.
   */
  async updateCategory(req, res, next) {
    try {
      const { name, slug, description, parentId, image, isActive, displayOrder } = req.body;
      const category = await Category.findById(req.params.id);

      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found.' });
      }

      if (name) category.name = name.trim();
      if (slug) category.slug = slug.toLowerCase().trim();
      if (description !== undefined) category.description = description;
      if (parentId !== undefined) category.parentId = parentId || null;
      if (image !== undefined) category.image = image;
      if (isActive !== undefined) category.isActive = isActive;
      if (displayOrder !== undefined) category.displayOrder = displayOrder;

      await category.save();

      return res.json({
        success: true,
        message: 'Category updated successfully.',
        category
      });
    } catch (error) {
      next(error);
    }
  }
};

