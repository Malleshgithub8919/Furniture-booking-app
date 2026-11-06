import 'package:flutter/material.dart';

import 'models/marketplace_models.dart';
import 'repositories/customer_repository.dart';
import 'screens/account_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/shop_screen.dart';
import 'screens/wishlist_screen.dart';
import 'services/api_client.dart';
import 'services/token_store.dart';
import 'widgets/common_widgets.dart';

void main() => runApp(const CustomerApp());

class CustomerApp extends StatefulWidget {
  const CustomerApp({super.key, this.repository});

  final CustomerRepository? repository;

  @override
  State<CustomerApp> createState() => _CustomerAppState();
}

class _CustomerAppState extends State<CustomerApp> {
  late final TokenStore _tokenStore;
  late final CustomerRepository _repository;
  CustomerUser? _user;
  bool _restoring = true;
  String? _restoreMessage;

  @override
  void initState() {
    super.initState();
    _tokenStore =
        widget.repository == null ? SecureTokenStore() : _NoopTokenStore();
    _repository = widget.repository ??
        CustomerRepository(
          tokenStore: _tokenStore,
          api: ApiClient(tokenStore: _tokenStore),
        );
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    CustomerUser? user;
    String? message;
    try {
      user = await _repository.restoreSession();
    } on ApiException catch (error) {
      message = error.message;
    }
    if (!mounted) return;
    setState(() {
      _user = user;
      _restoreMessage = message;
      _restoring = false;
    });
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'FurniSpace',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF315C4B),
            brightness: Brightness.light,
          ),
          scaffoldBackgroundColor: const Color(0xFFF7F7F3),
          useMaterial3: true,
          cardTheme: CardThemeData(
            color: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(color: Color(0xFFE7E8E1)),
            ),
          ),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFFE2E5DD)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFFE2E5DD)),
            ),
          ),
        ),
        home: _restoring
            ? const Scaffold(
                body: LoadingState(label: 'Restoring your session…'),
              )
            : MarketShell(
                repository: _repository,
                user: _user,
                restoreMessage: _restoreMessage,
                onUserChanged: (user) => setState(() => _user = user),
                onLogout: (message) {
                  setState(() {
                    _user = null;
                    _restoreMessage = message;
                  });
                },
              ),
      );
}

class MarketShell extends StatefulWidget {
  const MarketShell({
    super.key,
    required this.repository,
    required this.user,
    required this.onUserChanged,
    required this.onLogout,
    this.restoreMessage,
  });

  final CustomerRepository repository;
  final CustomerUser? user;
  final ValueChanged<CustomerUser> onUserChanged;
  final ValueChanged<String?> onLogout;
  final String? restoreMessage;

  @override
  State<MarketShell> createState() => _MarketShellState();
}

class _MarketShellState extends State<MarketShell> {
  int _selectedIndex = 0;
  String? _message;
  bool _showRestoreMessage = true;

  Future<bool> _requireAuth() async {
    if (widget.user != null) return true;
    final user = await Navigator.of(context).push<CustomerUser>(
      MaterialPageRoute(
        builder: (context) => AuthScreen(repository: widget.repository),
      ),
    );
    if (user == null || !mounted) return false;
    widget.onUserChanged(user);
    setState(() => _message = null);
    return true;
  }

  Future<void> _selectTab(int index) async {
    if (index != 0 && !await _requireAuth()) return;
    if (mounted) setState(() => _selectedIndex = index);
  }

  void _showPendingMessage(String? message) {
    widget.onLogout(message);
    if (mounted) {
      setState(() {
        _message = message;
        _selectedIndex = 0;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.user;
    final titles = ['FurniSpace', 'Wishlist', 'Your cart', 'Orders', 'Account'];
    final pages = <Widget>[
      ShopScreen(
        repository: widget.repository,
        isAuthenticated: user != null,
        onRequireAuth: _requireAuth,
        onCartChanged: () => setState(() => _selectedIndex = 2),
      ),
      user == null
          ? _signInPrompt(context)
          : WishlistScreen(
              repository: widget.repository,
              onRequireAuth: _requireAuth,
              onCartChanged: () => setState(() => _selectedIndex = 2),
            ),
      user == null
          ? _signInPrompt(context)
          : CartScreen(
              repository: widget.repository,
              user: user,
              onOrderPlaced: () => setState(() => _selectedIndex = 3),
              onBrowse: () => setState(() => _selectedIndex = 0),
            ),
      user == null
          ? _signInPrompt(context)
          : OrdersScreen(repository: widget.repository, user: user),
      user == null
          ? _signInPrompt(context)
          : AccountScreen(
              repository: widget.repository,
              user: user,
              onUserChanged: widget.onUserChanged,
              onLogout: _showPendingMessage,
            ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(titles[_selectedIndex]),
        actions: [
          if (user == null)
            TextButton(
              onPressed: _requireAuth,
              child: const Text('Sign in'),
            )
          else
            Padding(
              padding: const EdgeInsets.only(right: 14),
              child: Center(
                child: Text(
                  user.name.split(' ').first,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          if (_showRestoreMessage && widget.restoreMessage != null)
            MaterialBanner(
              content: Text(
                'Session was not restored: ${widget.restoreMessage}',
              ),
              leading: const Icon(Icons.info_outline),
              actions: [
                TextButton(
                  onPressed: () => setState(() => _showRestoreMessage = false),
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          if (_message != null)
            MaterialBanner(
              content: Text(_message!),
              leading: const Icon(Icons.info_outline),
              actions: [
                TextButton(
                  onPressed: () => setState(() => _message = null),
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          Expanded(child: pages[_selectedIndex]),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Shop',
          ),
          NavigationDestination(
            icon: Icon(Icons.favorite_border),
            selectedIcon: Icon(Icons.favorite),
            label: 'Wishlist',
          ),
          NavigationDestination(
            icon: Icon(Icons.shopping_bag_outlined),
            selectedIcon: Icon(Icons.shopping_bag),
            label: 'Cart',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Orders',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Account',
          ),
        ],
      ),
    );
  }

  Widget _signInPrompt(BuildContext context) => EmptyState(
        title: 'Sign in to continue',
        message:
            'Your cart, wishlist, addresses, and order history are securely linked to your customer account.',
        icon: Icons.lock_outline,
        action: FilledButton(
          onPressed: _requireAuth,
          child: const Text('Sign in or create account'),
        ),
      );
}

class _NoopTokenStore implements TokenStore {
  @override
  Future<void> clear() async {}

  @override
  Future<String?> readAccessToken() async => null;

  @override
  Future<String?> readRefreshToken() async => null;

  @override
  Future<void> saveTokens(String accessToken, String refreshToken) async {}
}
