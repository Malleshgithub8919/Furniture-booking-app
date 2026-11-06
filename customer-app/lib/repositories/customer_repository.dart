import 'dart:math';

import '../models/marketplace_models.dart';
import '../services/api_client.dart';
import '../services/token_store.dart';

bool isRazorpayTestOrder(JsonMap payment) {
  final keyId = stringValue(payment['keyId']);
  return payment['isMock'] != true && keyId?.startsWith('rzp_test_') == true;
}

class CustomerRepository {
  CustomerRepository({
    required this.api,
    required TokenStore tokenStore,
  }) : _tokenStore = tokenStore;

  final ApiClient api;
  final TokenStore _tokenStore;

  Future<CustomerUser?> restoreSession() async {
    final token = await _tokenStore.readAccessToken();
    if (token == null || token.isEmpty) return null;
    try {
      final response = await api.get('auth/me');
      final user = CustomerUser.fromJson(response['user']);
      if (user.role != 'customer') {
        await _tokenStore.clear();
        return null;
      }
      return user;
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await _tokenStore.clear();
        return null;
      }
      rethrow;
    }
  }

  Future<CustomerUser> login({
    required String identifier,
    required String password,
  }) async {
    final response = await api.post(
      'auth/login',
      authenticated: false,
      body: {'identifier': identifier.trim(), 'password': password},
    );
    final user = CustomerUser.fromJson(response['user']);
    if (user.role != 'customer') {
      throw const ApiException('This account does not have customer access.');
    }
    await _saveSession(response);
    return user;
  }

  Future<JsonMap> register({
    required String name,
    required String password,
    String? email,
    String? phone,
  }) async {
    final response = await api.post(
      'auth/register',
      authenticated: false,
      body: {
        'name': name.trim(),
        'password': password,
        if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
      },
    );
    final user = CustomerUser.fromJson(response['user']);
    if (user.role != 'customer') {
      throw const ApiException(
          'Registration did not create a customer account.');
    }
    await _saveSession(response);
    return response;
  }

  Future<CustomerUser> verifyOtp({
    required String channel,
    required String recipient,
    required String otp,
  }) async {
    final response = await api.post(
      'auth/otp/verify',
      authenticated: false,
      body: {
        'channel': channel,
        'recipient': recipient.trim(),
        'otp': otp.trim()
      },
    );
    final accessToken = stringValue(response['accessToken']);
    final refreshToken = await _tokenStore.readRefreshToken();
    if (accessToken == null || refreshToken == null) {
      throw const ApiException('Your session expired. Please sign in again.');
    }
    await _tokenStore.saveTokens(accessToken, refreshToken);
    return CustomerUser.fromJson(response['user']);
  }

  Future<String?> requestOtp({
    required String channel,
    required String recipient,
  }) async {
    final response = await api.post(
      'auth/otp/send',
      authenticated: false,
      body: {'channel': channel, 'recipient': recipient.trim()},
    );
    return stringValue(response['message']);
  }

  Future<void> logout() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    try {
      await api.post(
        'auth/logout',
        authenticated: false,
        body: {'refreshToken': refreshToken},
      );
    } finally {
      await _tokenStore.clear();
    }
  }

  Future<void> _saveSession(JsonMap response) async {
    final accessToken = stringValue(response['accessToken']);
    final refreshToken = stringValue(response['refreshToken']);
    if (accessToken == null || refreshToken == null) {
      throw const ApiException(
          'The server did not return a valid sign-in session.');
    }
    await _tokenStore.saveTokens(accessToken, refreshToken);
  }

  Future<List<ProductCategory>> getCategories() async {
    final response = await api.get('categories', authenticated: false);
    final categories = response['categories'];
    return categories is List
        ? categories.map(ProductCategory.fromJson).toList()
        : const [];
  }

  Future<List<Product>> getProducts({
    String? query,
    String? category,
    String sort = 'newest',
    int page = 1,
  }) async {
    final response = await api.get(
      'products',
      authenticated: false,
      query: {
        'limit': '24',
        'page': '$page',
        'sort': sort,
        if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
        if (category != null && category.isNotEmpty) 'category': category,
      },
    );
    final products = response['products'];
    return products is List
        ? products.map(Product.fromJson).toList()
        : const [];
  }

  Future<Product> getProduct(String slugOrId) async {
    final response = await api.get(
      'products/${Uri.encodeComponent(slugOrId)}',
      authenticated: false,
    );
    return Product.fromJson(response['product']);
  }

  Future<CartSnapshot> getCart() async {
    final response = await api.get('customer/cart');
    return CartSnapshot.fromJson(response['cart']);
  }

  Future<CartSnapshot> addToCart({
    required String productId,
    int quantity = 1,
    String? selectedColor,
    String? selectedMaterial,
    String? customNote,
  }) async {
    final response = await api.post(
      'customer/cart',
      body: {
        'productId': productId,
        'quantity': quantity,
        if (selectedColor != null) 'selectedColor': selectedColor,
        if (selectedMaterial != null) 'selectedMaterial': selectedMaterial,
        if (customNote != null && customNote.trim().isNotEmpty)
          'customNote': customNote.trim(),
      },
    );
    return CartSnapshot.fromJson(response['cart']);
  }

  Future<CartSnapshot> updateCartItem(String itemId, int quantity) async {
    final response = await api.put(
      'customer/cart/items/${Uri.encodeComponent(itemId)}',
      body: {'quantity': quantity},
    );
    return CartSnapshot.fromJson(response['cart']);
  }

  Future<CartSnapshot> removeCartItem(String itemId) async {
    final response = await api.delete(
      'customer/cart/items/${Uri.encodeComponent(itemId)}',
    );
    return CartSnapshot.fromJson(response['cart']);
  }

  Future<CartSnapshot> clearCart() async {
    final response = await api.delete('customer/cart');
    return CartSnapshot.fromJson(response['cart']);
  }

  Future<List<Product>> getWishlist() async {
    final response = await api.get('customer/wishlist');
    final products = response['products'];
    return products is List
        ? products.map(Product.fromJson).toList()
        : const [];
  }

  Future<void> addToWishlist(String productId) async {
    await api.post('customer/wishlist', body: {'productId': productId});
  }

  Future<void> removeFromWishlist(String productId) async {
    await api.delete('customer/wishlist/${Uri.encodeComponent(productId)}');
  }

  Future<CartSnapshot> moveWishlistItemToCart(String productId) async {
    final response = await api.post(
      'customer/wishlist/move-to-cart',
      body: {'productId': productId, 'quantity': 1},
    );
    return CartSnapshot.fromJson(response['cart']);
  }

  Future<List<CustomerAddress>> getAddresses() async {
    final response = await api.get('customer/addresses');
    final addresses = response['addresses'];
    return addresses is List
        ? addresses.map(CustomerAddress.fromJson).toList()
        : const [];
  }

  Future<CustomerAddress> createAddress(CustomerAddress address) async {
    final response = await api.post(
      'customer/addresses',
      body: address.toJson(),
    );
    return CustomerAddress.fromJson(response['address']);
  }

  Future<CustomerAddress> updateAddress(CustomerAddress address) async {
    final response = await api.put(
      'customer/addresses/${Uri.encodeComponent(address.id)}',
      body: address.toJson(),
    );
    return CustomerAddress.fromJson(response['address']);
  }

  Future<void> deleteAddress(String id) async {
    await api.delete('customer/addresses/${Uri.encodeComponent(id)}');
  }

  Future<CustomerAddress> setDefaultAddress(String id) async {
    final response = await api.patch(
      'customer/addresses/${Uri.encodeComponent(id)}/default',
    );
    return CustomerAddress.fromJson(response['address']);
  }

  Future<JsonMap> checkout({
    required String addressId,
    required String paymentMethod,
  }) async {
    final response = await api.post(
      'orders/checkout',
      body: {
        'addressId': addressId,
        'paymentMethod': paymentMethod,
        'idempotencyKey': _newIdempotencyKey(),
      },
    );
    return response;
  }

  String _newIdempotencyKey() {
    final random = Random.secure();
    final suffix = List<int>.generate(16, (_) => random.nextInt(256))
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    return 'customer-$timestamp-$suffix';
  }

  Future<List<JsonMap>> getOrders({int page = 1}) async {
    final response = await api.get(
      'orders/mine',
      query: {'page': '$page', 'limit': '20'},
    );
    final orders = response['orders'];
    return orders is List ? orders.map(jsonMap).toList() : const [];
  }

  Future<JsonMap> getOrder(String idOrNumber) async {
    final response = await api.get(
      'orders/mine/${Uri.encodeComponent(idOrNumber)}',
    );
    return jsonMap(response['order']);
  }

  Future<JsonMap> cancelOrder(String id, {String? vendorOrderId}) async {
    final response = await api.post(
      'orders/mine/${Uri.encodeComponent(id)}/cancel',
      body: {
        'reason': 'Cancelled by customer',
        if (vendorOrderId != null) 'vendorOrderId': vendorOrderId,
      },
    );
    return response;
  }

  Future<JsonMap> createPaymentOrder(String orderId) async {
    final response = await api.post(
      'payments/create-order',
      body: {'orderId': orderId},
    );
    return jsonMap(response['data']);
  }

  Future<JsonMap> verifyPayment({
    required String orderId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final response = await api.post(
      'payments/verify',
      body: {
        'orderId': orderId,
        'razorpayOrderId': razorpayOrderId,
        'razorpayPaymentId': razorpayPaymentId,
        'razorpaySignature': razorpaySignature,
      },
    );
    return jsonMap(response['data']);
  }

  Future<JsonMap> getPaymentStatus(String orderId) async {
    final response = await api.get(
      'payments/order/${Uri.encodeComponent(orderId)}',
    );
    return jsonMap(response['data']);
  }
}
