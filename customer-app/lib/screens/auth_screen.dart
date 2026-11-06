import 'package:flutter/material.dart';

import '../models/marketplace_models.dart';
import '../repositories/customer_repository.dart';
import '../services/api_client.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.repository});

  final CustomerRepository repository;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _identifierController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _otpController = TextEditingController();
  bool _isRegistering = false;
  bool _awaitingOtp = false;
  bool _busy = false;
  bool _obscurePassword = true;
  String? _error;
  String? _notice;
  String? _pendingChannel;
  String? _pendingRecipient;

  @override
  void dispose() {
    _nameController.dispose();
    _identifierController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      if (_isRegistering) {
        final email = _emailController.text.trim();
        final phone = _phoneController.text.trim();
        final response = await widget.repository.register(
          name: _nameController.text,
          password: _passwordController.text,
          email: email.isEmpty ? null : email,
          phone: phone.isEmpty ? null : phone,
        );
        _pendingChannel = email.isNotEmpty ? 'email' : 'phone';
        _pendingRecipient = email.isNotEmpty ? email : phone;
        _notice = stringValue(response['message']) ??
            'Account created. Check your email or phone for a verification code.';
        _awaitingOtp = true;
      } else {
        final user = await widget.repository.login(
          identifier: _identifierController.text,
          password: _passwordController.text,
        );
        if (mounted) Navigator.of(context).pop(user);
      }
    } on ApiException catch (error) {
      _error = error.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyOtp() async {
    if (_pendingChannel == null || _pendingRecipient == null) return;
    if (!RegExp(r'^\d{6}$').hasMatch(_otpController.text.trim())) {
      setState(() => _error = 'Enter the 6-digit code sent to your contact.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final user = await widget.repository.verifyOtp(
        channel: _pendingChannel!,
        recipient: _pendingRecipient!,
        otp: _otpController.text,
      );
      if (mounted) Navigator.of(context).pop(user);
    } on ApiException catch (error) {
      _error = error.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resendOtp() async {
    if (_pendingChannel == null || _pendingRecipient == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      _notice = await widget.repository.requestOtp(
        channel: _pendingChannel!,
        recipient: _pendingRecipient!,
      );
    } on ApiException catch (error) {
      _error = error.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(_awaitingOtp
              ? 'Verify your account'
              : _isRegistering
                  ? 'Create account'
                  : 'Welcome back'),
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    _awaitingOtp
                        ? 'Enter your verification code'
                        : _isRegistering
                            ? 'Make yourself at home.'
                            : 'Sign in to your account.',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _awaitingOtp
                        ? 'The code is sent through the configured backend email or SMS provider.'
                        : 'Browse the collection and manage your orders in one place.',
                  ),
                  const SizedBox(height: 24),
                  if (_awaitingOtp) _buildOtpForm() else _buildAuthForm(),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    _MessageBox(message: _error!, isError: true),
                  ],
                  if (_notice != null) ...[
                    const SizedBox(height: 12),
                    _MessageBox(message: _notice!, isError: false),
                  ],
                ],
              ),
            ),
          ),
        ),
      );

  Widget _buildAuthForm() => Form(
        key: _formKey,
        child: Column(
          children: [
            if (_isRegistering) ...[
              TextFormField(
                controller: _nameController,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Full name'),
                validator: (value) => value == null || value.trim().isEmpty
                    ? 'Enter your name.'
                    : null,
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration:
                    const InputDecoration(labelText: 'Email (optional)'),
                validator: (value) {
                  final email = value?.trim() ?? '';
                  if (email.isNotEmpty &&
                      !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
                    return 'Enter a valid email address.';
                  }
                  if (email.isEmpty && _phoneController.text.trim().isEmpty) {
                    return 'Provide an email or mobile number.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                    labelText: 'Mobile number (optional)'),
                validator: (value) {
                  final phone = value?.trim() ?? '';
                  if (phone.isNotEmpty &&
                      !RegExp(r'^(?:\+91|91)?[6-9]\d{9}$').hasMatch(phone)) {
                    return 'Enter a valid Indian mobile number.';
                  }
                  if (_emailController.text.trim().isEmpty && phone.isEmpty) {
                    return 'Provide an email or mobile number.';
                  }
                  return null;
                },
              ),
            ] else
              TextFormField(
                controller: _identifierController,
                keyboardType: TextInputType.emailAddress,
                decoration:
                    const InputDecoration(labelText: 'Email or mobile number'),
                validator: (value) => value == null || value.trim().isEmpty
                    ? 'Enter your email or mobile number.'
                    : null,
              ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _passwordController,
              obscureText: _obscurePassword,
              decoration: InputDecoration(
                labelText: 'Password',
                suffixIcon: IconButton(
                  tooltip: _obscurePassword ? 'Show password' : 'Hide password',
                  onPressed: () =>
                      setState(() => _obscurePassword = !_obscurePassword),
                  icon: Icon(_obscurePassword
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined),
                ),
              ),
              validator: (value) {
                final password = value ?? '';
                if (_isRegistering && password.length < 8) {
                  return 'Use at least 8 characters.';
                }
                return password.isEmpty ? 'Enter your password.' : null;
              },
            ),
            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(_isRegistering ? 'Create account' : 'Sign in'),
              ),
            ),
            TextButton(
              onPressed: _busy
                  ? null
                  : () => setState(() {
                        _isRegistering = !_isRegistering;
                        _error = null;
                        _notice = null;
                      }),
              child: Text(_isRegistering
                  ? 'Already have an account? Sign in'
                  : 'New here? Create an account'),
            ),
          ],
        ),
      );

  Widget _buildOtpForm() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Code sent to ${_pendingRecipient ?? ''}'),
          const SizedBox(height: 14),
          TextField(
            controller: _otpController,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(
              labelText: '6-digit verification code',
              counterText: '',
            ),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: _busy ? null : _verifyOtp,
            child: _busy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Verify and continue'),
          ),
          TextButton(
            onPressed: _busy ? null : _resendOtp,
            child: const Text('Resend code'),
          ),
        ],
      );
}

class _MessageBox extends StatelessWidget {
  const _MessageBox({required this.message, required this.isError});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isError
              ? Theme.of(context).colorScheme.errorContainer
              : Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(message),
      );
}
