import 'package:flutter/material.dart';

import '../models/marketplace_models.dart';
import '../repositories/customer_repository.dart';
import '../services/api_client.dart';
import '../widgets/common_widgets.dart';
import 'shop_screen.dart';

class WishlistScreen extends StatefulWidget {
  const WishlistScreen({
    super.key,
    required this.repository,
    required this.onRequireAuth,
    required this.onCartChanged,
  });

  final CustomerRepository repository;
  final Future<bool> Function() onRequireAuth;
  final VoidCallback onCartChanged;

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  late Future<List<Product>> _wishlistFuture;

  @override
  void initState() {
    super.initState();
    _wishlistFuture = widget.repository.getWishlist();
  }

  Future<void> _reload() async {
    setState(() => _wishlistFuture = widget.repository.getWishlist());
    await _wishlistFuture;
  }

  Future<void> _remove(String id) async {
    try {
      await widget.repository.removeFromWishlist(id);
      await _reload();
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  Future<void> _moveToCart(String id) async {
    if (!await widget.onRequireAuth()) return;
    try {
      await widget.repository.moveWishlistItemToCart(id);
      widget.onCartChanged();
      await _reload();
      if (mounted) _showMessage('Item moved to your cart.');
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  void _openProduct(Product product) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => ProductDetailsScreen(
          product: product,
          repository: widget.repository,
          onRequireAuth: widget.onRequireAuth,
          onCartChanged: widget.onCartChanged,
        ),
      ),
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<Product>>(
        future: _wishlistFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const LoadingState(label: 'Loading wishlist…');
          }
          if (snapshot.hasError) {
            final error = snapshot.error;
            return ErrorState(
              message: error is ApiException
                  ? error.message
                  : 'Could not load your wishlist.',
              onRetry: _reload,
            );
          }
          final products = snapshot.data ?? const [];
          if (products.isEmpty) {
            return const EmptyState(
              title: 'Your wishlist is empty',
              message: 'Save your favorite pieces and come back to them later.',
              icon: Icons.favorite_border,
            );
          }
          return RefreshIndicator(
            onRefresh: _reload,
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 14),
                    child: sectionTitle(context, 'Saved pieces'),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  sliver: SliverLayoutBuilder(
                    builder: (context, constraints) {
                      final width = constraints.crossAxisExtent;
                      final columns = width >= 850
                          ? 4
                          : width >= 560
                              ? 3
                              : 2;
                      return SliverGrid(
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: columns,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                          childAspectRatio: width < 380 ? 0.60 : 0.67,
                        ),
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final product = products[index];
                            return Column(
                              children: [
                                Expanded(
                                  child: ProductCard(
                                    product: product,
                                    onTap: () => _openProduct(product),
                                  ),
                                ),
                                Row(
                                  children: [
                                    Expanded(
                                      child: FilledButton.tonal(
                                        onPressed: () =>
                                            _moveToCart(product.id),
                                        child: const Text('Move to cart'),
                                      ),
                                    ),
                                    IconButton.filledTonal(
                                      tooltip: 'Remove from wishlist',
                                      onPressed: () => _remove(product.id),
                                      icon: const Icon(Icons.favorite),
                                    ),
                                  ],
                                ),
                              ],
                            );
                          },
                          childCount: products.length,
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      );
}
