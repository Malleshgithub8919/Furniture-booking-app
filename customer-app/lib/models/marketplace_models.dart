typedef JsonMap = Map<String, dynamic>;

JsonMap jsonMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, value) => MapEntry('$key', value));
  return <String, dynamic>{};
}

String? stringValue(Object? value) {
  if (value == null) return null;
  final result = value.toString();
  return result.isEmpty ? null : result;
}

int intValue(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse('$value') ?? fallback;
}

class CustomerUser {
  const CustomerUser({
    required this.id,
    required this.name,
    required this.role,
    this.email,
    this.phone,
    this.emailVerified = false,
    this.phoneVerified = false,
    this.status,
  });

  final String id;
  final String name;
  final String role;
  final String? email;
  final String? phone;
  final bool emailVerified;
  final bool phoneVerified;
  final String? status;

  bool get isVerified => emailVerified || phoneVerified;

  factory CustomerUser.fromJson(Object? value) {
    final json = jsonMap(value);
    return CustomerUser(
      id: stringValue(json['id'] ?? json['_id']) ?? '',
      name: stringValue(json['name']) ?? 'Customer',
      role: stringValue(json['role']) ?? 'customer',
      email: stringValue(json['email']),
      phone: stringValue(json['phone']),
      emailVerified: json['emailVerified'] == true,
      phoneVerified: json['phoneVerified'] == true,
      status: stringValue(json['status']),
    );
  }
}

class Product {
  const Product({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
    required this.pricePaise,
    required this.stock,
    required this.images,
    this.salePricePaise,
    this.categoryName,
    this.categorySlug,
    this.materials = const [],
    this.colors = const [],
    this.dimensions = const {},
    this.specifications = const [],
    this.vendorName,
  });

  final String id;
  final String name;
  final String slug;
  final String description;
  final int pricePaise;
  final int? salePricePaise;
  final int stock;
  final List<String> images;
  final String? categoryName;
  final String? categorySlug;
  final List<String> materials;
  final List<JsonMap> colors;
  final JsonMap dimensions;
  final List<JsonMap> specifications;
  final String? vendorName;

  String? get primaryImage => images.isEmpty ? null : images.first;
  int get effectivePricePaise => salePricePaise ?? pricePaise;
  bool get isAvailable => stock > 0;

  factory Product.fromJson(Object? value) {
    final json = jsonMap(value);
    final category = jsonMap(json['categoryId']);
    final vendor = jsonMap(json['vendorId']);
    final rawImages = json['images'];
    final images = rawImages is List
        ? rawImages
            .map((image) => stringValue(jsonMap(image)['url']))
            .whereType<String>()
            .toList()
        : <String>[];
    final rawMaterials = json['materials'];
    final materials = rawMaterials is List
        ? rawMaterials.map((item) => '$item').toList()
        : <String>[];
    final rawColors = json['colors'];
    final colors =
        rawColors is List ? rawColors.map(jsonMap).toList() : <JsonMap>[];
    final rawSpecifications = json['specifications'];
    final specifications = rawSpecifications is List
        ? rawSpecifications.map(jsonMap).toList()
        : <JsonMap>[];
    final salePrice = json['salePrice'];

    return Product(
      id: stringValue(json['id'] ?? json['_id']) ?? '',
      name: stringValue(json['name']) ?? 'Furniture',
      slug: stringValue(json['slug']) ?? '',
      description: stringValue(json['description']) ?? '',
      pricePaise: intValue(json['price']),
      salePricePaise: salePrice == null ? null : intValue(salePrice),
      stock: intValue(json['stock']),
      images: images,
      categoryName: stringValue(category['name']),
      categorySlug: stringValue(category['slug']),
      materials: materials,
      colors: colors,
      dimensions: jsonMap(json['dimensions']),
      specifications: specifications,
      vendorName: stringValue(vendor['storeName']),
    );
  }
}

class ProductCategory {
  const ProductCategory({
    required this.id,
    required this.name,
    required this.slug,
    this.image,
    this.subcategories = const [],
  });

  final String id;
  final String name;
  final String slug;
  final String? image;
  final List<ProductCategory> subcategories;

  factory ProductCategory.fromJson(Object? value) {
    final json = jsonMap(value);
    final children = json['subcategories'];
    return ProductCategory(
      id: stringValue(json['id'] ?? json['_id']) ?? '',
      name: stringValue(json['name']) ?? 'Category',
      slug: stringValue(json['slug']) ?? '',
      image: stringValue(json['image']),
      subcategories: children is List
          ? children.map(ProductCategory.fromJson).toList()
          : const [],
    );
  }
}

class CustomerAddress {
  const CustomerAddress({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.street,
    required this.city,
    required this.state,
    required this.postalCode,
    this.alternatePhone,
    this.landmark,
    this.addressType = 'home',
    this.isDefault = false,
    this.deliveryInstructions,
  });

  final String id;
  final String fullName;
  final String phone;
  final String street;
  final String city;
  final String state;
  final String postalCode;
  final String? alternatePhone;
  final String? landmark;
  final String addressType;
  final bool isDefault;
  final String? deliveryInstructions;

  factory CustomerAddress.fromJson(Object? value) {
    final json = jsonMap(value);
    return CustomerAddress(
      id: stringValue(json['id'] ?? json['_id']) ?? '',
      fullName: stringValue(json['fullName']) ?? '',
      phone: stringValue(json['phone']) ?? '',
      street: stringValue(json['street']) ?? '',
      city: stringValue(json['city']) ?? '',
      state: stringValue(json['state']) ?? '',
      postalCode: stringValue(json['postalCode']) ?? '',
      alternatePhone: stringValue(json['alternatePhone']),
      landmark: stringValue(json['landmark']),
      addressType: stringValue(json['addressType']) ?? 'home',
      isDefault: json['isDefault'] == true,
      deliveryInstructions: stringValue(json['deliveryInstructions']),
    );
  }

  JsonMap toJson() => {
        'fullName': fullName,
        'phone': phone,
        'street': street,
        'city': city,
        'state': state,
        'postalCode': postalCode,
        'alternatePhone': alternatePhone,
        'landmark': landmark,
        'addressType': addressType,
        'isDefault': isDefault,
        'deliveryInstructions': deliveryInstructions,
      }..removeWhere((key, value) => value == null);
}

class CartSnapshot {
  const CartSnapshot({
    required this.items,
    required this.itemCount,
    required this.subtotalPaise,
    required this.totalBasePricePaise,
    required this.totalDiscountPaise,
    required this.isCheckoutEligible,
  });

  final List<JsonMap> items;
  final int itemCount;
  final int subtotalPaise;
  final int totalBasePricePaise;
  final int totalDiscountPaise;
  final bool isCheckoutEligible;

  factory CartSnapshot.fromJson(Object? value) {
    final json = jsonMap(value);
    final summary = jsonMap(json['summary']);
    final rawItems = json['items'];
    return CartSnapshot(
      items: rawItems is List ? rawItems.map(jsonMap).toList() : const [],
      itemCount: intValue(summary['itemCount']),
      subtotalPaise: intValue(summary['subtotal']),
      totalBasePricePaise: intValue(summary['totalBasePrice']),
      totalDiscountPaise: intValue(summary['totalDiscount']),
      isCheckoutEligible: summary['isCheckoutEligible'] == true,
    );
  }
}
