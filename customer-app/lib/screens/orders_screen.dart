import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../models/marketplace_models.dart';
import '../repositories/customer_repository.dart';
import '../services/api_client.dart';
import '../widgets/common_widgets.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({
    super.key,
    required this.repository,
    required this.user,
  });

  final CustomerRepository repository;
  final CustomerUser user;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  late Future<List<JsonMap>> _ordersFuture;

  @override
  void initState() {
    super.initState();
    _ordersFuture = widget.repository.getOrders();
  }

  Future<void> _reload() async {
    setState(() => _ordersFuture = widget.repository.getOrders());
    await _ordersFuture;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<JsonMap>>(
        future: _ordersFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const LoadingState(label: 'Loading your orders…');
          }
          if (snapshot.hasError) {
            final error = snapshot.error;
            return ErrorState(
              message: error is ApiException
                  ? error.message
                  : 'Could not load your orders.',
              onRetry: _reload,
            );
          }
          final orders = snapshot.data ?? const [];
          if (orders.isEmpty) {
            return const EmptyState(
              title: 'No orders yet',
              message: 'Your order history will appear here after checkout.',
              icon: Icons.receipt_long_outlined,
            );
          }
          return RefreshIndicator(
            onRefresh: _reload,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 4, 4, 14),
                  child: Text(
                    'Your orders',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                ...orders.map((order) {
                  final pricing = jsonMap(order['pricing']);
                  final id = stringValue(order['_id'] ?? order['id']) ?? '';
                  final number = stringValue(order['orderNumber']) ?? id;
                  final subOrders = order['vendorOrderIds'];
                  final count = subOrders is List ? subOrders.length : 0;
                  return Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.all(14),
                      title: Text(number),
                      subtitle: Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          '${stringValue(order['orderStatus']) ?? 'placed'} · ${count == 1 ? '1 vendor' : '$count vendors'}\n${stringValue(order['paymentMethod'])?.toUpperCase() ?? 'COD'} · ${stringValue(order['paymentStatus']) ?? 'pending'}',
                        ),
                      ),
                      isThreeLine: true,
                      trailing: Text(
                        formatPaise(intValue(pricing['grandTotal'])),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      onTap: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (context) => OrderDetailScreen(
                              repository: widget.repository,
                              user: widget.user,
                              orderNumber: number,
                            ),
                          ),
                        );
                        _reload();
                      },
                    ),
                  );
                }),
              ],
            ),
          );
        },
      );
}

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({
    super.key,
    required this.repository,
    required this.user,
    required this.orderNumber,
  });

  final CustomerRepository repository;
  final CustomerUser user;
  final String orderNumber;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late Future<JsonMap> _orderFuture;
  late final Razorpay _razorpay;
  String? _activeOrderId;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _orderFuture = widget.repository.getOrder(widget.orderNumber);
    _razorpay = Razorpay()
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentFailure);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(
        () => _orderFuture = widget.repository.getOrder(widget.orderNumber));
    await _orderFuture;
  }

  Future<void> _cancelVendorOrder(String vendorOrderId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this vendor order?'),
        content: const Text(
          'Cancellation is subject to marketplace status and inventory rules.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep order'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel vendor order'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.repository.cancelOrder(
        stringValue(_currentOrder?['_id']) ?? '',
        vendorOrderId: vendorOrderId,
      );
      await _reload();
      if (mounted) _showMessage('Cancellation submitted to the server.');
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  JsonMap? _currentOrder;

  Future<void> _startPayment() async {
    if (!widget.user.isVerified) {
      _showMessage('Verify your account before retrying online payment.');
      return;
    }
    final order = _currentOrder;
    final orderId = stringValue(order?['_id']);
    if (orderId == null) return;
    setState(() => _busy = true);
    _activeOrderId = orderId;
    try {
      final payment = await widget.repository.createPaymentOrder(orderId);
      final keyId = stringValue(payment['keyId']);
      if (!isRazorpayTestOrder(payment) || keyId == null) {
        _showMessage(
          'Payment remains pending. A Razorpay TEST key is not configured; no payment was simulated.',
        );
        return;
      }
      _razorpay.open({
        'key': keyId,
        'amount': intValue(payment['amount']),
        'currency': stringValue(payment['currency']) ?? 'INR',
        'order_id': stringValue(payment['gatewayOrderId']),
        'name': 'FurniSpace',
        'description': 'Furniture marketplace order',
        'theme': {'color': '#315C4B'},
      });
    } on ApiException catch (error) {
      _showMessage(error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onPaymentSuccess(PaymentSuccessResponse response) async {
    final orderId = _activeOrderId;
    if (orderId == null ||
        response.orderId == null ||
        response.paymentId == null ||
        response.signature == null) {
      _showMessage('Payment response is incomplete and is not confirmed.');
      return;
    }
    try {
      await widget.repository.verifyPayment(
        orderId: orderId,
        razorpayOrderId: response.orderId!,
        razorpayPaymentId: response.paymentId!,
        razorpaySignature: response.signature!,
      );
      _showMessage('Payment verified by the marketplace server.');
    } on ApiException catch (error) {
      _showMessage('Payment verification failed: ${error.message}');
    }
    await _reload();
  }

  Future<void> _onPaymentFailure(PaymentFailureResponse response) async {
    _showMessage(
      'Payment was not completed. The server will show the current payment state.',
    );
    await _reload();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Order details')),
        body: FutureBuilder<JsonMap>(
          future: _orderFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const LoadingState(label: 'Loading order details…');
            }
            if (snapshot.hasError) {
              final error = snapshot.error;
              return ErrorState(
                message: error is ApiException
                    ? error.message
                    : 'Could not load order details.',
                onRetry: _reload,
              );
            }
            final order = snapshot.data!;
            _currentOrder = order;
            return _buildOrder(order);
          },
        ),
      );

  Widget _buildOrder(JsonMap order) {
    final pricing = jsonMap(order['pricing']);
    final address = jsonMap(order['shippingAddress']);
    final rawVendorOrders = order['vendorOrderIds'];
    final vendorOrders = rawVendorOrders is List
        ? rawVendorOrders.map(jsonMap).toList()
        : <JsonMap>[];
    final rawHistory = order['statusHistory'];
    final history = rawHistory is List ? rawHistory.map(jsonMap).toList() : [];
    final paymentMethod = stringValue(order['paymentMethod']) ?? 'cod';
    final paymentStatus = stringValue(order['paymentStatus']) ?? 'pending';
    final canRetryPayment = paymentMethod == 'razorpay' &&
        paymentStatus != 'captured' &&
        stringValue(order['orderStatus']) != 'cancelled';

    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Text(
            stringValue(order['orderNumber']) ?? '',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            '${stringValue(order['orderStatus']) ?? 'placed'} · ${paymentMethod.toUpperCase()} · $paymentStatus',
          ),
          const SizedBox(height: 18),
          sectionTitle(context, 'Order timeline'),
          const SizedBox(height: 8),
          if (history.isEmpty)
            const Text('Status updates will appear here.')
          else
            ...history.map(
              (entry) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.check_circle_outline),
                title: Text(stringValue(entry['status']) ?? ''),
                subtitle: Text(
                  [
                    stringValue(entry['note']),
                    stringValue(entry['timestamp']),
                  ].whereType<String>().join('\n'),
                ),
              ),
            ),
          const Divider(height: 28),
          sectionTitle(context, 'Delivery address'),
          const SizedBox(height: 8),
          Text(
            '${address['fullName'] ?? ''}\n${address['street'] ?? ''}${address['landmark'] == null ? '' : ', ${address['landmark']}'}\n${address['city'] ?? ''}, ${address['state'] ?? ''} ${address['postalCode'] ?? ''}\n${address['phone'] ?? ''}',
          ),
          const SizedBox(height: 22),
          sectionTitle(context, 'Vendor orders'),
          const SizedBox(height: 8),
          ...vendorOrders.map(_buildVendorOrder),
          const SizedBox(height: 18),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _priceRow('Items subtotal',
                      formatPaise(intValue(pricing['itemsSubtotal']))),
                  _priceRow('Discount',
                      '−${formatPaise(intValue(pricing['totalDiscount']))}'),
                  _priceRow('Shipping',
                      formatPaise(intValue(pricing['shippingFee']))),
                  const Divider(height: 22),
                  _priceRow(
                    'Order total',
                    formatPaise(intValue(pricing['grandTotal'])),
                    emphasized: true,
                  ),
                ],
              ),
            ),
          ),
          if (canRetryPayment) ...[
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _startPayment,
              child: Text(_busy ? 'Starting…' : 'Retry online payment'),
            ),
          ],
          const SizedBox(height: 12),
          const Text(
            'This timeline reflects order statuses provided by the backend. Live GPS tracking is not available.',
          ),
        ],
      ),
    );
  }

  Widget _buildVendorOrder(JsonMap vendorOrder) {
    final status = stringValue(vendorOrder['status']) ?? 'placed';
    final canCancel =
        const ['placed', 'confirmed', 'preparing'].contains(status);
    final vendor = jsonMap(vendorOrder['vendorId']);
    final items = vendorOrder['items'];
    final itemList = items is List ? items.map(jsonMap).toList() : <JsonMap>[];
    final historyRaw = vendorOrder['statusHistory'];
    final history = historyRaw is List ? historyRaw.map(jsonMap).toList() : [];
    final id = stringValue(vendorOrder['_id'] ?? vendorOrder['id']) ?? '';
    final pricing = jsonMap(vendorOrder['pricing']);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              stringValue(vendorOrder['subOrderNumber']) ?? 'Vendor order',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              '${stringValue(vendor['storeName']) ?? 'Marketplace vendor'} · $status',
            ),
            const SizedBox(height: 8),
            ...itemList.map(
              (item) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(stringValue(item['name']) ?? 'Furniture'),
                subtitle: Text('Quantity: ${intValue(item['quantity'], 1)}'),
                trailing: Text(
                  formatPaise(intValue(item['lineTotal'])),
                ),
              ),
            ),
            for (final entry in history)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '${stringValue(entry['status']) ?? ''} · ${stringValue(entry['timestamp']) ?? ''}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            const Divider(height: 20),
            _priceRow(
              'Vendor order total',
              formatPaise(intValue(pricing['grandTotal'])),
            ),
            if (canCancel)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _cancelVendorOrder(id),
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Cancel vendor order'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _priceRow(String label, String value, {bool emphasized = false}) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style:
                    emphasized ? Theme.of(context).textTheme.titleMedium : null,
              ),
            ),
            Text(
              value,
              style:
                  emphasized ? Theme.of(context).textTheme.titleMedium : null,
            ),
          ],
        ),
      );
}
