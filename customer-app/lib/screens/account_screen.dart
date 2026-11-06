import 'package:flutter/material.dart';

import '../models/marketplace_models.dart';
import '../repositories/customer_repository.dart';
import '../services/api_client.dart';
import '../widgets/common_widgets.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({
    super.key,
    required this.repository,
    required this.user,
    required this.onUserChanged,
    required this.onLogout,
  });

  final CustomerRepository repository;
  final CustomerUser user;
  final ValueChanged<CustomerUser> onUserChanged;
  final ValueChanged<String?> onLogout;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Your account',
              style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user.name,
                      style: Theme.of(context).textTheme.titleLarge),
                  if (user.email != null) ...[
                    const SizedBox(height: 4),
                    Text(user.email!),
                  ],
                  if (user.phone != null) Text(user.phone!),
                  const SizedBox(height: 10),
                  Chip(
                    avatar: Icon(
                      user.isVerified ? Icons.verified : Icons.info_outline,
                      size: 18,
                    ),
                    label: Text(
                      user.isVerified
                          ? 'Verified account'
                          : 'Verification needed',
                    ),
                  ),
                  if (!user.isVerified)
                    OutlinedButton.icon(
                      onPressed: () async {
                        final updated =
                            await Navigator.of(context).push<CustomerUser>(
                          MaterialPageRoute(
                            builder: (context) => VerificationScreen(
                              repository: repository,
                              user: user,
                            ),
                          ),
                        );
                        if (updated != null) onUserChanged(updated);
                      },
                      icon: const Icon(Icons.verified_user_outlined),
                      label: const Text('Verify email or mobile'),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Card(
            child: ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: const Text('Delivery addresses'),
              subtitle: const Text('Add or update saved addresses'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (context) =>
                      AddressBookScreen(repository: repository),
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => _logout(context),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
          const SizedBox(height: 12),
          Text(
            'Payments and order totals are confirmed by the marketplace server. Live GPS tracking is not available.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      );

  Future<void> _logout(BuildContext context) async {
    String? errorMessage;
    try {
      await repository.logout();
    } on ApiException catch (error) {
      errorMessage = error.message;
    }
    onLogout(errorMessage);
  }
}

class VerificationScreen extends StatefulWidget {
  const VerificationScreen({
    super.key,
    required this.repository,
    required this.user,
  });

  final CustomerRepository repository;
  final CustomerUser user;

  @override
  State<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends State<VerificationScreen> {
  late final String _channel;
  late final String _recipient;
  final _otpController = TextEditingController();
  bool _sending = false;
  bool _verifying = false;
  bool _sent = false;
  String? _message;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.user.email != null && !widget.user.emailVerified) {
      _channel = 'email';
      _recipient = widget.user.email!;
    } else {
      _channel = 'phone';
      _recipient = widget.user.phone ?? '';
    }
  }

  @override
  void dispose() {
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    setState(() {
      _sending = true;
      _error = null;
      _message = null;
    });
    try {
      _message = await widget.repository.requestOtp(
        channel: _channel,
        recipient: _recipient,
      );
      _sent = true;
    } on ApiException catch (error) {
      _error = error.message;
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _verifying = true;
      _error = null;
      _message = null;
    });
    try {
      final user = await widget.repository.verifyOtp(
        channel: _channel,
        recipient: _recipient,
        otp: _otpController.text,
      );
      if (mounted) Navigator.of(context).pop(user);
    } on ApiException catch (error) {
      _error = error.message;
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Verify account')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Verify your ${_channel == 'email' ? 'email' : 'mobile number'}',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text('A one-time code will be requested for $_recipient.'),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _sending ? null : _sendCode,
              child: Text(_sending ? 'Requesting…' : 'Send verification code'),
            ),
            if (_sent) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: '6-digit code',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _verifying ? null : _verify,
                child: Text(_verifying ? 'Verifying…' : 'Verify code'),
              ),
            ],
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      );
}

class AddressBookScreen extends StatefulWidget {
  const AddressBookScreen({super.key, required this.repository});

  final CustomerRepository repository;

  @override
  State<AddressBookScreen> createState() => _AddressBookScreenState();
}

class _AddressBookScreenState extends State<AddressBookScreen> {
  late Future<List<CustomerAddress>> _addressesFuture;

  @override
  void initState() {
    super.initState();
    _addressesFuture = widget.repository.getAddresses();
  }

  Future<void> _reload() async {
    setState(() => _addressesFuture = widget.repository.getAddresses());
    await _addressesFuture;
  }

  Future<void> _editAddress([CustomerAddress? address]) async {
    final result = await showModalBottomSheet<CustomerAddress>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _AddressForm(address: address),
    );
    if (result == null) return;
    try {
      if (result.id.isEmpty) {
        await widget.repository.createAddress(result);
      } else {
        await widget.repository.updateAddress(result);
      }
      await _reload();
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  Future<void> _setDefault(String id) async {
    try {
      await widget.repository.setDefaultAddress(id);
      await _reload();
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  Future<void> _deleteAddress(CustomerAddress address) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete address?'),
        content: Text('Remove ${address.fullName} at ${address.street}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.repository.deleteAddress(address.id);
      await _reload();
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
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Delivery addresses'),
          actions: [
            IconButton(
              tooltip: 'Add address',
              onPressed: _editAddress,
              icon: const Icon(Icons.add),
            ),
          ],
        ),
        body: FutureBuilder<List<CustomerAddress>>(
          future: _addressesFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const LoadingState(label: 'Loading addresses…');
            }
            if (snapshot.hasError) {
              final error = snapshot.error;
              return ErrorState(
                message: error is ApiException
                    ? error.message
                    : 'Could not load addresses.',
                onRetry: _reload,
              );
            }
            final addresses = snapshot.data ?? const [];
            if (addresses.isEmpty) {
              return EmptyState(
                title: 'No saved addresses',
                message: 'Save a delivery address for a smoother checkout.',
                icon: Icons.location_on_outlined,
                action: FilledButton(
                  onPressed: _editAddress,
                  child: const Text('Add address'),
                ),
              );
            }
            return RefreshIndicator(
              onRefresh: _reload,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  ...addresses.map(
                    (address) => Card(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: ListTile(
                          leading: Icon(
                            address.addressType == 'work'
                                ? Icons.business_outlined
                                : Icons.home_outlined,
                          ),
                          title: Text(
                            '${address.fullName}${address.isDefault ? ' · Default' : ''}',
                          ),
                          subtitle: Text(
                            '${address.street}${address.landmark == null ? '' : ', ${address.landmark}'}\n${address.city}, ${address.state} ${address.postalCode}\n${address.phone}',
                          ),
                          isThreeLine: true,
                          onTap: () => _editAddress(address),
                          trailing: PopupMenuButton<String>(
                            tooltip: 'Address actions',
                            onSelected: (action) {
                              if (action == 'default') {
                                _setDefault(address.id);
                              } else if (action == 'edit') {
                                _editAddress(address);
                              } else {
                                _deleteAddress(address);
                              }
                            },
                            itemBuilder: (context) => [
                              if (!address.isDefault)
                                const PopupMenuItem(
                                  value: 'default',
                                  child: Text('Set as default'),
                                ),
                              const PopupMenuItem(
                                value: 'edit',
                                child: Text('Edit'),
                              ),
                              const PopupMenuItem(
                                value: 'delete',
                                child: Text('Delete'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _editAddress,
                    icon: const Icon(Icons.add),
                    label: const Text('Add another address'),
                  ),
                ],
              ),
            );
          },
        ),
      );
}

class _AddressForm extends StatefulWidget {
  const _AddressForm({this.address});

  final CustomerAddress? address;

  @override
  State<_AddressForm> createState() => _AddressFormState();
}

class _AddressFormState extends State<_AddressForm> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _controllers;
  late String _addressType;

  @override
  void initState() {
    super.initState();
    final address = widget.address;
    _controllers = {
      'fullName': TextEditingController(text: address?.fullName ?? ''),
      'phone': TextEditingController(text: address?.phone ?? ''),
      'alternatePhone':
          TextEditingController(text: address?.alternatePhone ?? ''),
      'street': TextEditingController(text: address?.street ?? ''),
      'landmark': TextEditingController(text: address?.landmark ?? ''),
      'city': TextEditingController(text: address?.city ?? ''),
      'state': TextEditingController(text: address?.state ?? ''),
      'postalCode': TextEditingController(text: address?.postalCode ?? ''),
      'deliveryInstructions':
          TextEditingController(text: address?.deliveryInstructions ?? ''),
    };
    _addressType = address?.addressType ?? 'home';
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String? _required(String? value, String label) =>
      value == null || value.trim().isEmpty ? 'Enter $label.' : null;

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    final old = widget.address;
    final result = CustomerAddress(
      id: old?.id ?? '',
      fullName: _controllers['fullName']!.text.trim(),
      phone: _controllers['phone']!.text.trim(),
      street: _controllers['street']!.text.trim(),
      city: _controllers['city']!.text.trim(),
      state: _controllers['state']!.text.trim(),
      postalCode: _controllers['postalCode']!.text.trim(),
      alternatePhone: _controllers['alternatePhone']!.text.trim(),
      landmark: _controllers['landmark']!.text.trim(),
      addressType: _addressType,
      isDefault: old?.isDefault ?? false,
      deliveryInstructions: _controllers['deliveryInstructions']!.text.trim(),
    );
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          12,
          20,
          MediaQuery.viewInsetsOf(context).bottom + 20,
        ),
        child: Form(
          key: _formKey,
          child: ListView(
            shrinkWrap: true,
            children: [
              Text(
                widget.address == null ? 'Add address' : 'Edit address',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 16),
              _field('fullName', 'Full name', validator: (value) {
                final required = _required(value, 'a name');
                if (required != null) return required;
                return value!.trim().length <= 100
                    ? null
                    : 'Name must be at most 100 characters.';
              }),
              _field('phone', 'Mobile number', keyboard: TextInputType.phone,
                  validator: (value) {
                final required = _required(value, 'a mobile number');
                if (required != null) return required;
                return RegExp(r'^(?:\+91|91)?[6-9]\d{9}$')
                        .hasMatch(value!.trim())
                    ? null
                    : 'Enter a valid Indian mobile number.';
              }),
              _field('alternatePhone', 'Alternate mobile (optional)',
                  keyboard: TextInputType.phone, validator: (value) {
                final phone = value?.trim() ?? '';
                return phone.isEmpty ||
                        RegExp(r'^(?:\+91|91)?[6-9]\d{9}$').hasMatch(phone)
                    ? null
                    : 'Enter a valid Indian mobile number.';
              }),
              _field('street', 'Street address', validator: (value) {
                final required = _required(value, 'a street address');
                if (required != null) return required;
                return value!.trim().length <= 250
                    ? null
                    : 'Address must be at most 250 characters.';
              }),
              _field('landmark', 'Landmark (optional)'),
              _field('city', 'City',
                  validator: (value) => _required(value, 'a city')),
              _field('state', 'State',
                  validator: (value) => _required(value, 'a state')),
              _field('postalCode', '6-digit PIN code',
                  keyboard: TextInputType.number, validator: (value) {
                final required = _required(value, 'a PIN code');
                if (required != null) return required;
                return RegExp(r'^[1-9]\d{5}$').hasMatch(value!.trim())
                    ? null
                    : 'Enter a valid 6-digit PIN code.';
              }),
              DropdownButtonFormField<String>(
                initialValue: _addressType,
                decoration: const InputDecoration(labelText: 'Address type'),
                items: const [
                  DropdownMenuItem(value: 'home', child: Text('Home')),
                  DropdownMenuItem(value: 'work', child: Text('Work')),
                  DropdownMenuItem(value: 'other', child: Text('Other')),
                ],
                onChanged: (value) =>
                    setState(() => _addressType = value ?? 'home'),
              ),
              _field('deliveryInstructions', 'Delivery instructions (optional)',
                  maxLines: 2),
              const SizedBox(height: 18),
              FilledButton(
                onPressed: _save,
                child: const Text('Save address'),
              ),
            ],
          ),
        ),
      );

  Widget _field(
    String key,
    String label, {
    TextInputType? keyboard,
    String? Function(String?)? validator,
    int maxLines = 1,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: _controllers[key],
          keyboardType: keyboard,
          maxLines: maxLines,
          decoration: InputDecoration(labelText: label),
          validator: validator,
        ),
      );
}
