import 'dart:convert';

import 'package:customer_app/models/marketplace_models.dart';
import 'package:customer_app/repositories/customer_repository.dart';
import 'package:customer_app/services/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'test_support.dart';

void main() {
  group('CustomerRepository catalog and cart', () {
    test('uses the public catalog contract and parses server products',
        () async {
      Uri? requestedUri;
      final api = ApiClient(
        tokenStore: MemoryTokenStore(),
        baseUrl: 'https://market.example/api',
        httpClient: MockClient((request) async {
          requestedUri = request.url;
          return http.Response(
            jsonEncode({
              'success': true,
              'products': [
                {
                  '_id': 'product-1',
                  'name': 'Oak lounge chair',
                  'slug': 'oak-lounge-chair',
                  'description': 'Solid oak frame.',
                  'price': 120000,
                  'salePrice': 99000,
                  'stock': 3,
                  'images': [
                    {'url': 'https://images.example/chair.jpg'}
                  ],
                  'categoryId': {'name': 'Living room', 'slug': 'living-room'},
                  'vendorId': {'storeName': 'Northwood'}
                }
              ],
              'pagination': {'page': 1, 'limit': 24, 'total': 1},
            }),
            200,
          );
        }),
      );
      final repository = CustomerRepository(
        api: api,
        tokenStore: MemoryTokenStore(),
      );

      final products = await repository.getProducts(
        query: 'oak chair',
        category: 'living-room',
        sort: 'price_asc',
      );

      expect(requestedUri!.path, '/api/products');
      expect(requestedUri!.queryParameters['q'], 'oak chair');
      expect(requestedUri!.queryParameters['category'], 'living-room');
      expect(requestedUri!.queryParameters['sort'], 'price_asc');
      expect(products.single.name, 'Oak lounge chair');
      expect(products.single.effectivePricePaise, 99000);
      expect(products.single.primaryImage, 'https://images.example/chair.jpg');
      expect(products.single.vendorName, 'Northwood');
      api.close();
    });

    test('cart uses backend totals and attaches the access token', () async {
      final tokens = MemoryTokenStore()..accessToken = 'access-secret';
      String? authorization;
      final api = ApiClient(
        tokenStore: tokens,
        baseUrl: 'https://market.example/api',
        httpClient: MockClient((request) async {
          authorization = request.headers['authorization'];
          return http.Response(
            jsonEncode({
              'success': true,
              'cart': {
                'items': [],
                'summary': {
                  'itemCount': 2,
                  'totalBasePrice': 200000,
                  'totalDiscount': 25000,
                  'subtotal': 175000,
                  'isCheckoutEligible': true
                }
              }
            }),
            200,
          );
        }),
      );
      final repository = CustomerRepository(api: api, tokenStore: tokens);

      final cart = await repository.getCart();

      expect(authorization, 'Bearer access-secret');
      expect(cart.itemCount, 2);
      expect(cart.totalBasePricePaise, 200000);
      expect(cart.totalDiscountPaise, 25000);
      expect(cart.subtotalPaise, 175000);
      expect(cart.isCheckoutEligible, isTrue);
      api.close();
    });

    test('surfaces backend errors without treating them as empty data',
        () async {
      final api = ApiClient(
        tokenStore: MemoryTokenStore(),
        baseUrl: 'https://market.example/api',
        httpClient: MockClient((_) async => http.Response(
              jsonEncode({
                'success': false,
                'code': 'INSUFFICIENT_STOCK',
                'message': 'Only 1 unit is currently available.'
              }),
              400,
            )),
      );
      final repository =
          CustomerRepository(api: api, tokenStore: MemoryTokenStore());

      await expectLater(
        repository.addToCart(productId: 'product-1', quantity: 3),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'status', 400)
              .having((error) => error.message, 'message',
                  'Only 1 unit is currently available.'),
        ),
      );
      api.close();
    });
  });

  test('refreshes an expired access token and retries the original request',
      () async {
    final tokens = MemoryTokenStore()
      ..accessToken = 'expired'
      ..refreshToken = 'refresh-old';
    var protectedRequests = 0;
    final api = ApiClient(
      tokenStore: tokens,
      baseUrl: 'https://market.example/api',
      httpClient: MockClient((request) async {
        if (request.url.path == '/api/auth/refresh') {
          expect(jsonDecode(request.body), {'refreshToken': 'refresh-old'});
          return http.Response(
            jsonEncode({
              'success': true,
              'accessToken': 'access-new',
              'refreshToken': 'refresh-new'
            }),
            200,
          );
        }
        protectedRequests++;
        if (request.headers['authorization'] == 'Bearer expired') {
          return http.Response(
            jsonEncode({
              'success': false,
              'code': 'TOKEN_EXPIRED',
              'message': 'Access token expired.'
            }),
            401,
          );
        }
        expect(request.headers['authorization'], 'Bearer access-new');
        return http.Response(jsonEncode({'success': true, 'user': {}}), 200);
      }),
    );

    final response = await api.get('auth/me');

    expect(response['success'], isTrue);
    expect(protectedRequests, 2);
    expect(tokens.accessToken, 'access-new');
    expect(tokens.refreshToken, 'refresh-new');
    api.close();
  });

  test('maps backend category and address JSON into typed models', () {
    final category = ProductCategory.fromJson({
      '_id': 'category-1',
      'name': 'Living room',
      'slug': 'living-room',
      'subcategories': [
        {'_id': 'category-2', 'name': 'Sofas', 'slug': 'sofas'}
      ]
    });
    final address = CustomerAddress.fromJson({
      '_id': 'address-1',
      'fullName': 'A Customer',
      'phone': '9876543210',
      'street': '42 Oak Street',
      'city': 'Bengaluru',
      'state': 'Karnataka',
      'postalCode': '560034',
      'isDefault': true
    });

    expect(category.subcategories.single.name, 'Sofas');
    expect(address.isDefault, isTrue);
    expect(address.toJson()['postalCode'], '560034');
  });

  test('only launches Razorpay for a non-mock TEST key', () {
    expect(
      isRazorpayTestOrder({'keyId': 'rzp_test_marketplace', 'isMock': false}),
      isTrue,
    );
    expect(
      isRazorpayTestOrder({'keyId': 'rzp_live_marketplace', 'isMock': false}),
      isFalse,
    );
    expect(
      isRazorpayTestOrder({'keyId': 'rzp_test_marketplace', 'isMock': true}),
      isFalse,
    );
  });
}
