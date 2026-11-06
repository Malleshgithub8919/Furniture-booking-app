import Product from '../models/Product.js';

export const cartService = {
  /**
   * Validates product customizations against the product's catalog specifications.
   */
  validateCustomization(product, { selectedColor, selectedMaterial }) {
    if (selectedColor && product.colors && product.colors.length > 0) {
      const match = product.colors.some(
        c => c.name.toLowerCase() === selectedColor.trim().toLowerCase() ||
             (c.hexCode && c.hexCode.toLowerCase() === selectedColor.trim().toLowerCase())
      );
      if (!match) {
        return {
          valid: false,
          message: `Selected color '${selectedColor}' is not an available option for this furniture piece.`
        };
      }
    }

    if (selectedMaterial && product.materials && product.materials.length > 0) {
      const match = product.materials.some(
        m => m.toLowerCase() === selectedMaterial.trim().toLowerCase()
      );
      if (!match) {
        return {
          valid: false,
          message: `Selected material '${selectedMaterial}' is not an available option for this furniture piece.`
        };
      }
    }

    return { valid: true };
  },

  /**
   * Recalculates cart items and monetary totals purely on the backend.
   * All prices are in integer paise (₹1 = 100 paise).
   */
  async calculateCart(cartDoc) {
    if (!cartDoc || !cartDoc.items || cartDoc.items.length === 0) {
      return {
        items: [],
        summary: {
          itemCount: 0,
          totalBasePrice: 0,
          totalDiscount: 0,
          subtotal: 0,
          currency: 'INR',
          isCheckoutEligible: true
        }
      };
    }

    // Extract product IDs and fetch current live database states
    const productIds = cartDoc.items.map(item => item.productId);
    const liveProducts = await Product.find({ _id: { $in: productIds } })
      .populate('vendorId', 'storeName')
      .populate('categoryId', 'name slug')
      .lean();

    const productMap = {};
    for (const p of liveProducts) {
      productMap[p._id.toString()] = p;
    }

    let itemCount = 0;
    let totalBasePrice = 0;
    let totalDiscount = 0;
    let isCheckoutEligible = true;

    const populatedItems = [];

    for (const item of cartDoc.items) {
      const product = productMap[item.productId.toString()];

      if (!product) {
        // Product was deleted from database
        populatedItems.push({
          _id: item._id,
          productId: item.productId,
          quantity: item.quantity,
          isAvailable: false,
          unavailabilityReason: 'PRODUCT_NOT_FOUND',
          message: 'This product is no longer available in the marketplace.'
        });
        isCheckoutEligible = false;
        continue;
      }

      // Rule 8: Recheck product approval status
      if (product.status !== 'approved') {
        populatedItems.push({
          _id: item._id,
          productId: product._id,
          name: product.name,
          sku: product.sku,
          quantity: item.quantity,
          isAvailable: false,
          unavailabilityReason: 'PRODUCT_UNAPPROVED',
          message: 'This product is currently undergoing moderation or has been unlisted.'
        });
        isCheckoutEligible = false;
        continue;
      }

      // Rule 8: Recheck live available stock
      const availableStock = Math.max(0, product.stock - (product.reservedStock || 0));
      const hasStock = availableStock >= item.quantity;
      if (!hasStock) {
        isCheckoutEligible = false;
      }

      // Rule 4 & 7: Calculate price strictly on the backend in integer paise
      const unitBasePrice = product.price; // Integer paise
      const unitSalePrice = product.salePrice ?? null;
      const effectiveUnitPrice = unitSalePrice !== null ? unitSalePrice : unitBasePrice;

      const lineBaseTotal = unitBasePrice * item.quantity;
      const lineEffectiveTotal = effectiveUnitPrice * item.quantity;
      const lineDiscount = lineBaseTotal - lineEffectiveTotal;

      if (hasStock) {
        itemCount += item.quantity;
        totalBasePrice += lineBaseTotal;
        totalDiscount += lineDiscount;
      }

      populatedItems.push({
        _id: item._id,
        product: {
          id: product._id,
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          primaryImage: product.images?.find(img => img.isPrimary)?.url || product.images?.[0]?.url || null,
          vendor: {
            id: product.vendorId?._id || product.vendorId,
            storeName: product.vendorId?.storeName || 'Vendor'
          },
          category: product.categoryId
        },
        customizations: {
          selectedColor: item.selectedColor || null,
          selectedMaterial: item.selectedMaterial || null,
          customNote: item.customNote || null
        },
        quantity: item.quantity,
        availableStock,
        pricing: {
          unitBasePrice,
          unitSalePrice,
          effectiveUnitPrice,
          lineTotal: lineEffectiveTotal,
          lineDiscount
        },
        isAvailable: hasStock,
        unavailabilityReason: hasStock ? null : 'INSUFFICIENT_STOCK',
        message: hasStock ? null : `Only ${availableStock} units currently available in stock.`
      });
    }

    const subtotal = totalBasePrice - totalDiscount;

    return {
      items: populatedItems,
      summary: {
        itemCount,
        totalBasePrice,
        totalDiscount,
        subtotal,
        currency: 'INR',
        isCheckoutEligible: isCheckoutEligible && itemCount > 0
      }
    };
  }
};

