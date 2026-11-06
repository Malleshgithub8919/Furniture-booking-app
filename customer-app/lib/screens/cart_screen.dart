import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../models/marketplace_models.dart';
import '../repositories/customer_repository.dart';
import '../services/api_client.dart';
import '../widgets/common_widgets.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({
    super.key,
    required this.repository,
    required this.user,
    required this.onOrderPlaced,
    required this.onBrowse,
  });

  final CustomerRepository repository;
  final CustomerUser user;
  final VoidCallback onOrderPlaced;
  final VoidCallback onBrowse;

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  late Future<CartSnapshot> _cartFuture;

  @override
  void initState() {
    super.initState();
    _cartFuture = widget.repository.getCart();
  }

  Future<void> _refresh() async {
    setState(() => _cartFuture = widget.repository.getCart());
    await _cartFuture;
  }

  Future<void> _changeQuantity(String itemId, int quantity) async {
    try {
      final cart = await widget.repository.updateCartItem(itemId, quantity);
      if (mounted) setState(() => _cartFuture = Future.value(cart));
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  Future<void> _removeItem(String itemId) async {
    try {
      final cart = await widget.repository.removeCartItem(itemId);
      if (mounted) setState(() => _cartFuture = Future.value(cart));
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  Future<void> _clearCart() async {
    final clear = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear your cart?'),
        content: const Text('All items will be removed from this cart.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep items'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Clear cart'),
          ),
        ],
      ),
    );
    if (clear != true) return;
    try {
      final cart = await widget.repository.clearCart();
      if (mounted) setState(() => _cartFuture = Future.value(cart));
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<CartSnapshot>(
        future: _cartFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const LoadingState(label: 'Refreshing cart prices…');
          }
          if (snapshot.hasError) {
            final error = snapshot.error;
            return ErrorState(
              message: error is ApiException
                  ? error.message
                  : 'Could not load your cart.',
              onRetry: _refresh,
            );
          }
          final cart = snapshot.data!;
          if (cart.items.isEmpty) {
            return EmptyState(
              title: 'Your cart is waiting',
              message: 'Find something you love and it will appear here.',
              icon: Icons.shopping_bag_outlined,
              action: FilledButton(
                onPressed: widget.onBrowse,
                child: const Text('Explore furniture'),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Your cart',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ),
                    TextButton(
                      onPressed: _clearCart,
                      child: const Text('Clear all'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ...cart.items.map((item) => _buildItem(item)),
                const SizedBox(height: 18),
                _buildSummary(cart),
                const SizedBox(height: 18),
                if (!cart.isCheckoutEligible)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: Text(
                      'Some items are unavailable or exceed current stock. Update or remove those items before checkout.',
                      style: TextStyle(color: Colors.deepOrange),
                    ),
                  ),
                FilledButton(
                  onPressed: cart.isCheckoutEligible
                      ? () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (context) => CheckoutScreen(
                                repository: widget.repository,
                                user: widget.user,
                                onOrderPlaced: widget.onOrderPlaced,
                              ),
                            ),
                          );
                          _refresh();
                        }
                      : null,
                  child: const Text('Continue to checkout'),
                ),
              ],
            ),
          );
        },
      );

  Widget _buildItem(JsonMap item) {
    final product = jsonMap(item['product']);
    final pricing = jsonMap(item['pricing']);
    final customizations = jsonMap(item['customizations']);
    final itemId = stringValue(item['_id']) ?? '';
    final quantity = intValue(item['quantity'], 1);
    final available = item['isAvailable'] == true;
    final image = stringValue(product['primaryImage']);
    final name = stringValue(product['name'] ?? item['name']) ?? 'Furniture';
    final price = intValue(pricing['lineTotal']);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: 82,
                height: 82,
                child: ProductImage(url: image),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: Theme.of(context).textTheme.titleMedium),
                  if (stringValue(jsonMap(product['vendor'])['storeName']) !=
                      null)
                    Text(
                      'Sold by ${jsonMap(product['vendor'])['storeName']}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  if (customizations.isNotEmpty)
                    Text(
                      [
                        if (customizations['selectedColor'] != null)
                          'Color: ${customizations['selectedColor']}',
                        if (customizations['selectedMaterial'] != null)
                          'Material: ${customizations['selectedMaterial']}',
                      ].join(' · '),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  const SizedBox(height: 5),
                  Text(
                    available
                        ? formatPaise(price)
                        : stringValue(item['message']) ??
                            'This item is unavailable.',
                    style: TextStyle(
                      color: available
                          ? null
                          : Theme.of(context).colorScheme.error,
                    ),
                  ),
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Decrease quantity',
                        onPressed: available && quantity > 1
                            ? () => _changeQuantity(itemId, quantity - 1)
                            : null,
                        icon: const Icon(Icons.remove_circle_outline),
                        visualDensity: VisualDensity.compact,
                      ),
                      Text('$quantity'),
                      IconButton(
                        tooltip: 'Increase quantity',
                        onPressed: available &&
                                quantity < intValue(item['availableStock']) &&
                                quantity < 20
                            ? () => _changeQuantity(itemId, quantity + 1)
                            : null,
                        icon: const Icon(Icons.add_circle_outline),
                        visualDensity: VisualDensity.compact,
                      ),
                      const Spacer(),
                      IconButton(
                        tooltip: 'Remove from cart',
                        onPressed: () => _removeItem(itemId),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummary(CartSnapshot cart) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              _summaryRow('Items', '${cart.itemCount}'),
              const SizedBox(height: 8),
              _summaryRow('List price', formatPaise(cart.totalBasePricePaise)),
              const SizedBox(height: 8),
              _summaryRow(
                'Discount',
                '−${formatPaise(cart.totalDiscountPaise)}',
              ),
              const Divider(height: 24),
              _summaryRow(
                'Current subtotal',
                formatPaise(cart.subtotalPaise),
                emphasized: true,
              ),
              const SizedBox(height: 8),
              Text(
                'Final order totals are calculated by the server at checkout.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      );

  Widget _summaryRow(String label, String value, {bool emphasized = false}) =>
      Row(
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
            style: emphasized ? Theme.of(context).textTheme.titleMedium : null,
          ),
        ],
      );
}

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({
    super.key,
    required this.repository,
    required this.user,
    required this.onOrderPlaced,
  });

  final CustomerRepository repository;
  final CustomerUser user;
  final VoidCallback onOrderPlaced;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  late Future<List<CustomerAddress>> _addressesFuture;
  List<CustomerAddress> _addresses = const [];
  String? _selectedAddressId;
  String _paymentMethod = 'cod';
  bool _busy = false;
  late final Razorpay _razorpay;
  String? _activeOrderId;
  String? _activeOrderNumber;

  @override
  void initState() {
    super.initState();
    _addressesFuture = widget.repository.getAddresses();
    _razorpay = Razorpay()
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentFailure);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _loadAddresses() async {
    setState(() => _addressesFuture = widget.repository.getAddresses());
    await _addressesFuture;
  }

  Future<void> _placeOrder() async {
    final addressId = _selectedAddressId;
    if (addressId == null) {
      _showMessage('Choose a delivery address first.');
      return;
    }
    if (_paymentMethod == 'razorpay' && !widget.user.isVerified) {
      _showMessage(
        'Verify your email or mobile number in your account before online payment.',
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final response = await widget.repository.checkout(
        addressId: addressId,
        paymentMethod: _paymentMethod,
      );
      final order = jsonMap(response['order']);
      final orderId = stringValue(order['_id'] ?? order['id']);
      _activeOrderId = orderId;
      _activeOrderNumber = stringValue(order['orderNumber']);
      if (orderId == null) {
        throw const ApiException('The server did not return the placed order.');
      }

      if (_paymentMethod == 'cod') {
        _finishOrder('Order placed. Cash on delivery was selected.');
        return;
      }

      final payment = await widget.repository.createPaymentOrder(orderId);
      final keyId = stringValue(payment['keyId']);
      if (!isRazorpayTestOrder(payment) || keyId == null) {
        _finishOrder(
          'Order placed${_activeOrderNumber == null ? '' : ' (${_activeOrderNumber!})'}. Payment was not started because a Razorpay TEST key is not configured. Payment remains pending; no payment was simulated.',
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
        'prefill': {
          if (widget.user.email != null) 'email': widget.user.email,
          if (widget.user.phone != null) 'contact': widget.user.phone,
        },
        'theme': {'color': '#315C4B'},
      });
      if (mounted) setState(() => _busy = false);
    } on ApiException catch (error) {
      if (mounted) {
        _showMessage(
          _activeOrderId == null
              ? error.message
              : 'Order placed, but payment could not be started: ${error.message}',
        );
        if (_activeOrderId != null) widget.onOrderPlaced();
      }
      if (_activeOrderId != null && mounted) {
        Navigator.of(context).pop();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onPaymentSuccess(PaymentSuccessResponse response) async {
    final orderId = _activeOrderId;
    final razorpayOrderId = response.orderId;
    final paymentId = response.paymentId;
    final signature = response.signature;
    if (orderId == null ||
        razorpayOrderId == null ||
        paymentId == null ||
        signature == null) {
      _showMessage(
        'The gateway response was incomplete. Payment status is not confirmed.',
      );
      await _checkPaymentStatus();
      return;
    }
    try {
      await widget.repository.verifyPayment(
        orderId: orderId,
        razorpayOrderId: razorpayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      );
      _finishOrder('Payment verified by the marketplace server.');
    } on ApiException catch (error) {
      _showMessage(
        'Payment was received by the gateway but could not be verified by the server: ${error.message}',
      );
      await _checkPaymentStatus();
    }
  }

  Future<void> _onPaymentFailure(PaymentFailureResponse response) async {
    _showMessage(
      'Payment was not completed. The order remains pending until the server confirms payment.',
    );
    await _checkPaymentStatus();
  }

  Future<void> _checkPaymentStatus() async {
    final orderId = _activeOrderId;
    if (orderId == null) return;
    try {
      final status = await widget.repository.getPaymentStatus(orderId);
      final paymentStatus = stringValue(status['paymentStatus']) ?? 'pending';
      if (paymentStatus == 'captured') {
        _finishOrder('The server confirms that this payment was captured.');
      } else {
        _finishOrder(
            'Payment status: $paymentStatus. Check the order details.');
      }
    } on ApiException {
      if (mounted) widget.onOrderPlaced();
    }
  }

  void _finishOrder(String message) {
    widget.onOrderPlaced();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 5)),
    );
    Navigator.of(context).pop();
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Checkout')),
        body: FutureBuilder<List<CustomerAddress>>(
          future: _addressesFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const LoadingState(label: 'Loading delivery addresses…');
            }
            if (snapshot.hasError) {
              final error = snapshot.error;
              return ErrorState(
                message: error is ApiException
                    ? error.message
                    : 'Could not load saved addresses.',
                onRetry: _loadAddresses,
              );
            }
            _addresses = snapshot.data ?? const [];
            final defaultAddresses =
                _addresses.where((address) => address.isDefault).toList();
            if (_selectedAddressId == null && defaultAddresses.isNotEmpty) {
              _selectedAddressId = defaultAddresses.first.id;
            }
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                sectionTitle(context, 'Delivery address'),
                const SizedBox(height: 12),
                if (_addresses.isEmpty)
                  const Text(
                    'Add a delivery address in your account before checkout.',
                  )
                else
                  RadioGroup<String>(
                    groupValue: _selectedAddressId,
                    onChanged: (value) =>
                        setState(() => _selectedAddressId = value),
                    child: Column(
                      children: _addresses
                          .map(
                            (address) => RadioListTile<String>(
                              value: address.id,
                              title: Text(
                                '${address.fullName}${address.isDefault ? ' · Default' : ''}',
                              ),
                              subtitle: Text(
                                '${address.street}, ${address.city}, ${address.state} ${address.postalCode}\n${address.phone}',
                              ),
                              isThreeLine: true,
                              contentPadding: EdgeInsets.zero,
                            ),
                          )
                          .toList(),
                    ),
                  ),
                const SizedBox(height: 22),
                sectionTitle(context, 'Payment method'),
                const SizedBox(height: 8),
                RadioGroup<String>(
                  groupValue: _paymentMethod,
                  onChanged: (value) => setState(
                    () => _paymentMethod = value ?? 'cod',
                  ),
                  child: Column(
                    children: [
                      RadioListTile<String>(
                        value: 'cod',
                        title: const Text('Cash on delivery'),
                      ),
                      RadioListTile<String>(
                        value: 'razorpay',
                        title:
                            const Text('Online payment · Razorpay TEST mode'),
                        subtitle: Text(
                          widget.user.isVerified
                              ? 'Payment is verified by the marketplace backend.'
                              : 'Account email or mobile verification is required.',
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy || _addresses.isEmpty ? null : _placeOrder,
                  child: _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Place order'),
                ),
              ],
            );
          },
        ),
      );
}
