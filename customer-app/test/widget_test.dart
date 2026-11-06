import 'dart:convert';

import 'package:customer_app/repositories/customer_repository.dart';
import 'package:customer_app/screens/auth_screen.dart';
import 'package:customer_app/screens/shop_screen.dart';
import 'package:customer_app/services/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'test_support.dart';

void main() {
  testWidgets('catalog renders products returned by the public API',
      (tester) async {
    final repository = CustomerRepository(
      tokenStore: MemoryTokenStore(),
      api: ApiClient(
        tokenStore: MemoryTokenStore(),
        baseUrl: 'https://market.example/api',
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/categories')) {
            return http.Response(
              jsonEncode({'success': true, 'categories': []}),
              200,
            );
          }
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
                  'stock': 3,
                  'images': []
                }
              ],
              'pagination': {'total': 1, 'page': 1, 'limit': 24}
            }),
            200,
          );
        }),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ShopScreen(
            repository: repository,
            isAuthenticated: false,
            onRequireAuth: () async => false,
            onCartChanged: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Explore furniture'), findsOneWidget);
    expect(find.text('Oak lounge chair'), findsOneWidget);
    expect(find.text('₹1200.00'), findsOneWidget);
    repository.api.close();
  });

  testWidgets('catalog shows a retryable error instead of fake products',
      (tester) async {
    final tokens = MemoryTokenStore();
    final repository = CustomerRepository(
      tokenStore: tokens,
      api: ApiClient(
        tokenStore: tokens,
        baseUrl: 'https://market.example/api',
        httpClient: MockClient((_) async => http.Response(
              jsonEncode({
                'success': false,
                'message': 'Catalog service unavailable.'
              }),
              503,
            )),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ShopScreen(
            repository: repository,
            isAuthenticated: false,
            onRequireAuth: () async => false,
            onCartChanged: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Catalog service unavailable.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    repository.api.close();
  });

  testWidgets('sign-in form validates required fields before making requests',
      (tester) async {
    var requestCount = 0;
    final tokens = MemoryTokenStore();
    final repository = CustomerRepository(
      tokenStore: tokens,
      api: ApiClient(
        tokenStore: tokens,
        baseUrl: 'https://market.example/api',
        httpClient: MockClient((_) async {
          requestCount++;
          return http.Response('{}', 500);
        }),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(home: AuthScreen(repository: repository)),
    );
    await tester.tap(find.text('Sign in').last);
    await tester.pumpAndSettle();

    expect(find.text('Enter your email or mobile number.'), findsOneWidget);
    expect(find.text('Enter your password.'), findsOneWidget);
    expect(requestCount, 0);
    repository.api.close();
  });
}
