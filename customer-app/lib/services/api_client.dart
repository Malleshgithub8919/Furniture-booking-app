import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import '../models/marketplace_models.dart';
import 'token_store.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({
    required TokenStore tokenStore,
    http.Client? httpClient,
    String? baseUrl,
    this.timeout = const Duration(seconds: 20),
  })  : _tokenStore = tokenStore,
        _httpClient = httpClient ?? http.Client(),
        _baseUrl =
            (baseUrl ?? ApiConfig.baseUrl).replaceFirst(RegExp(r'/$'), '');

  final TokenStore _tokenStore;
  final http.Client _httpClient;
  final String _baseUrl;
  final Duration timeout;
  Future<bool>? _refreshing;

  Future<JsonMap> get(
    String path, {
    Map<String, String> query = const {},
    bool authenticated = true,
  }) =>
      _request('GET', path, query: query, authenticated: authenticated);

  Future<JsonMap> post(
    String path, {
    JsonMap body = const {},
    Map<String, String> headers = const {},
    bool authenticated = true,
  }) =>
      _request(
        'POST',
        path,
        body: body,
        headers: headers,
        authenticated: authenticated,
      );

  Future<JsonMap> put(
    String path, {
    JsonMap body = const {},
  }) =>
      _request('PUT', path, body: body);

  Future<JsonMap> patch(
    String path, {
    JsonMap body = const {},
  }) =>
      _request('PATCH', path, body: body);

  Future<JsonMap> delete(String path) => _request('DELETE', path);

  Future<JsonMap> _request(
    String method,
    String path, {
    JsonMap? body,
    Map<String, String> query = const {},
    Map<String, String> headers = const {},
    bool authenticated = true,
    bool retryAfterRefresh = true,
  }) async {
    final uri = Uri.parse('$_baseUrl/$path').replace(
      queryParameters: query.isEmpty ? null : query,
    );
    final requestHeaders = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      ...headers,
    };
    if (authenticated) {
      final accessToken = await _tokenStore.readAccessToken();
      if (accessToken != null) {
        requestHeaders['Authorization'] = 'Bearer $accessToken';
      }
    }

    final response = await _send(
      method,
      uri,
      headers: requestHeaders,
      body: body == null ? null : jsonEncode(body),
    );
    final responseJson = _decodeResponse(response);

    if (response.statusCode == 401 &&
        retryAfterRefresh &&
        authenticated &&
        path != 'auth/refresh' &&
        responseJson['code'] == 'TOKEN_EXPIRED') {
      final refreshed = await _refreshSession();
      if (refreshed) {
        return _request(
          method,
          path,
          body: body,
          query: query,
          headers: headers,
          authenticated: authenticated,
          retryAfterRefresh: false,
        );
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = jsonMap(responseJson['error']);
      throw ApiException(
        stringValue(responseJson['message'] ?? error['message']) ??
            'The request could not be completed.',
        statusCode: response.statusCode,
        code: stringValue(responseJson['code'] ?? error['code']),
      );
    }
    if (responseJson['success'] == false) {
      throw ApiException(
        stringValue(responseJson['message']) ??
            'The request could not be completed.',
      );
    }
    return responseJson;
  }

  Future<http.Response> _send(
    String method,
    Uri uri, {
    required Map<String, String> headers,
    String? body,
  }) async {
    try {
      switch (method) {
        case 'GET':
          return await _httpClient.get(uri, headers: headers).timeout(timeout);
        case 'POST':
          return await _httpClient
              .post(uri, headers: headers, body: body)
              .timeout(timeout);
        case 'PUT':
          return await _httpClient
              .put(uri, headers: headers, body: body)
              .timeout(timeout);
        case 'PATCH':
          return await _httpClient
              .patch(uri, headers: headers, body: body)
              .timeout(timeout);
        case 'DELETE':
          return await _httpClient
              .delete(uri, headers: headers)
              .timeout(timeout);
        default:
          throw ArgumentError.value(
              method, 'method', 'Unsupported HTTP method');
      }
    } on TimeoutException {
      throw const ApiException('The server took too long to respond.');
    } on http.ClientException {
      throw const ApiException(
        'Could not connect to the server. Check your connection and API URL.',
      );
    }
  }

  JsonMap _decodeResponse(http.Response response) {
    if (response.body.isEmpty) return <String, dynamic>{};
    try {
      return jsonMap(jsonDecode(response.body));
    } on FormatException {
      throw ApiException(
        'The server returned an invalid response (HTTP ${response.statusCode}).',
        statusCode: response.statusCode,
      );
    }
  }

  Future<bool> _refreshSession() async {
    final activeRefresh = _refreshing;
    if (activeRefresh != null) return activeRefresh;

    final refreshFuture = _performRefresh();
    _refreshing = refreshFuture;
    try {
      return await refreshFuture;
    } finally {
      if (identical(_refreshing, refreshFuture)) _refreshing = null;
    }
  }

  Future<bool> _performRefresh() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      await _tokenStore.clear();
      return false;
    }
    final response = await _send(
      'POST',
      Uri.parse('$_baseUrl/auth/refresh'),
      headers: const {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'refreshToken': refreshToken}),
    );
    final data = _decodeResponse(response);
    final access = stringValue(data['accessToken']);
    final rotatedRefresh = stringValue(data['refreshToken']);
    if (response.statusCode >= 500 || response.statusCode == 429) {
      throw ApiException(
        stringValue(data['message']) ??
            'The session service is temporarily unavailable.',
        statusCode: response.statusCode,
      );
    }
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        access == null ||
        rotatedRefresh == null) {
      await _tokenStore.clear();
      return false;
    }
    await _tokenStore.saveTokens(access, rotatedRefresh);
    return true;
  }

  void close() => _httpClient.close();
}
