import 'package:flutter/material.dart';

import '../models/marketplace_models.dart';
import '../repositories/customer_repository.dart';
import '../services/api_client.dart';
import '../widgets/common_widgets.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({
    super.key,
    required this.repository,
    required this.isAuthenticated,
    required this.onRequireAuth,
    required this.onCartChanged,
  });

  final CustomerRepository repository;
  final bool isAuthenticated;
  final Future<bool> Function() onRequireAuth;
  final VoidCallback onCartChanged;

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  final _searchController = TextEditingController();
  List<Product> _products = const [];
  List<ProductCategory> _categories = const [];
  Set<String> _wishlistIds = {};
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String? _wishlistError;
  String? _selectedCategory;
  String _sort = 'newest';
  int _page = 1;
  bool _hasMore = true;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
    if (widget.isAuthenticated) _loadWishlistIds();
  }

  @override
  void didUpdateWidget(covariant ShopScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isAuthenticated && !oldWidget.isAuthenticated) {
      _loadWishlistIds();
    } else if (!widget.isAuthenticated && oldWidget.isAuthenticated) {
      setState(() => _wishlistIds = {});
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadCatalog({bool reset = true}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
        _page = 1;
        _hasMore = true;
      });
    } else {
      if (_loadingMore || !_hasMore) return;
      setState(() => _loadingMore = true);
    }

    try {
      final result = await Future.wait<Object>([
        widget.repository.getProducts(
          query: _searchController.text,
          category: _selectedCategory,
          sort: _sort,
          page: reset ? 1 : _page + 1,
        ),
        if (reset) widget.repository.getCategories(),
      ]);
      final products = result.first as List<Product>;
      if (!mounted) return;
      setState(() {
        if (reset) {
          _products = products;
          _categories = result.length > 1
              ? result[1] as List<ProductCategory>
              : _categories;
          _loading = false;
          _error = null;
          _page = 1;
        } else {
          _products = [..._products, ...products];
          _loadingMore = false;
          _page++;
        }
        _hasMore = products.length == 24;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<bool> _loadWishlistIds() async {
    try {
      final products = await widget.repository.getWishlist();
      if (mounted) {
        setState(() {
          _wishlistIds = products.map((e) => e.id).toSet();
          _wishlistError = null;
        });
      }
      return true;
    } on ApiException catch (error) {
      if (mounted) setState(() => _wishlistError = error.message);
      return false;
    }
  }

  Future<void> _toggleWishlist(Product product) async {
    if (!await widget.onRequireAuth()) return;
    if (!await _loadWishlistIds()) return;
    try {
      if (_wishlistIds.contains(product.id)) {
        await widget.repository.removeFromWishlist(product.id);
        _wishlistIds.remove(product.id);
      } else {
        await widget.repository.addToWishlist(product.id);
        _wishlistIds.add(product.id);
      }
      if (mounted) setState(() {});
    } on ApiException catch (error) {
      if (mounted) _showMessage(error.message);
    }
  }

  void _openProduct(Product product) {
    Navigator.of(context)
        .push(
          MaterialPageRoute<void>(
            builder: (context) => ProductDetailsScreen(
              product: product,
              repository: widget.repository,
              onRequireAuth: widget.onRequireAuth,
              onCartChanged: widget.onCartChanged,
            ),
          ),
        )
        .then((_) => _loadWishlistIds());
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: () => _loadCatalog(),
        child: _loading
            ? ListView(
                children: const [
                  SizedBox(height: 180),
                  LoadingState(label: 'Finding pieces for your home…'),
                ],
              )
            : _error != null
                ? ListView(
                    children: [
                      SizedBox(
                        height: MediaQuery.sizeOf(context).height * 0.6,
                        child: ErrorState(
                          message: _error!,
                          onRetry: _loadCatalog,
                        ),
                      ),
                    ],
                  )
                : CustomScrollView(
                    slivers: [
                      SliverToBoxAdapter(child: _buildHeader()),
                      SliverToBoxAdapter(child: _buildCategories()),
                      if (_wishlistError != null)
                        SliverToBoxAdapter(
                          child: MaterialBanner(
                            content: Text(_wishlistError!),
                            leading: const Icon(Icons.info_outline),
                            actions: [
                              TextButton(
                                onPressed: () =>
                                    setState(() => _wishlistError = null),
                                child: const Text('Dismiss'),
                              ),
                            ],
                          ),
                        ),
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                          child: Row(
                            children: [
                              Expanded(
                                child: sectionTitle(
                                  context,
                                  _searchController.text.isEmpty
                                      ? 'Explore furniture'
                                      : 'Search results',
                                  subtitle: _products.isEmpty
                                      ? null
                                      : '${_products.length} items loaded from the catalog',
                                ),
                              ),
                              DropdownButton<String>(
                                value: _sort,
                                underline: const SizedBox.shrink(),
                                onChanged: (value) {
                                  if (value == null) return;
                                  setState(() => _sort = value);
                                  _loadCatalog();
                                },
                                items: const [
                                  DropdownMenuItem(
                                    value: 'newest',
                                    child: Text('Newest'),
                                  ),
                                  DropdownMenuItem(
                                    value: 'popular',
                                    child: Text('Popular'),
                                  ),
                                  DropdownMenuItem(
                                    value: 'price_asc',
                                    child: Text('Price: low to high'),
                                  ),
                                  DropdownMenuItem(
                                    value: 'price_desc',
                                    child: Text('Price: high to low'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (_products.isEmpty)
                        const SliverFillRemaining(
                          hasScrollBody: false,
                          child: EmptyState(
                            title: 'No furniture found',
                            message:
                                'Try another search or choose a different category.',
                          ),
                        )
                      else
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
                                gridDelegate:
                                    SliverGridDelegateWithFixedCrossAxisCount(
                                  crossAxisCount: columns,
                                  crossAxisSpacing: 12,
                                  mainAxisSpacing: 12,
                                  childAspectRatio: width < 380 ? 0.60 : 0.67,
                                ),
                                delegate: SliverChildBuilderDelegate(
                                  (context, index) {
                                    if (index == _products.length) {
                                      if (_loadingMore) {
                                        return const Center(
                                          child: CircularProgressIndicator(),
                                        );
                                      }
                                      return TextButton(
                                        onPressed: _hasMore
                                            ? () => _loadCatalog(reset: false)
                                            : null,
                                        child: Text(
                                          _hasMore
                                              ? 'Load more'
                                              : 'You’re all caught up',
                                        ),
                                      );
                                    }
                                    final product = _products[index];
                                    return ProductCard(
                                      product: product,
                                      isFavorite:
                                          _wishlistIds.contains(product.id),
                                      onFavorite: () =>
                                          _toggleWishlist(product),
                                      onTap: () => _openProduct(product),
                                    );
                                  },
                                  childCount: _products.length + 1,
                                ),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
      );

  Widget _buildHeader() => Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Make room for\nliving better.',
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    height: 1.08,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'Thoughtfully selected furniture for the way you live.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 18),
            TextField(
              controller: _searchController,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _loadCatalog(),
              decoration: InputDecoration(
                hintText: 'Search sofas, beds, tables…',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                  tooltip: 'Search',
                  onPressed: _loadCatalog,
                  icon: const Icon(Icons.arrow_forward),
                ),
                filled: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 18),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.secondaryContainer,
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'A home that feels like you',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  SizedBox(height: 5),
                  Text(
                    'Discover approved pieces from marketplace vendors. Product availability and prices are checked by the server.',
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _buildCategories() => SizedBox(
        height: 64,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: ChoiceChip(
                label: const Text('All'),
                selected: _selectedCategory == null,
                onSelected: (_) {
                  setState(() => _selectedCategory = null);
                  _loadCatalog();
                },
              ),
            ),
            ..._categories.map(
              (category) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: ChoiceChip(
                  label: Text(category.name),
                  selected: _selectedCategory == category.slug,
                  onSelected: (_) {
                    setState(() => _selectedCategory =
                        _selectedCategory == category.slug
                            ? null
                            : category.slug);
                    _loadCatalog();
                  },
                ),
              ),
            ),
          ],
        ),
      );
}

class ProductDetailsScreen extends StatefulWidget {
  const ProductDetailsScreen({
    super.key,
    required this.product,
    required this.repository,
    required this.onRequireAuth,
    required this.onCartChanged,
  });

  final Product product;
  final CustomerRepository repository;
  final Future<bool> Function() onRequireAuth;
  final VoidCallback onCartChanged;

  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  late Future<Product> _productFuture;
  String? _selectedColor;
  String? _selectedMaterial;
  final _customNoteController = TextEditingController();
  int _quantity = 1;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final identifier =
        widget.product.slug.isEmpty ? widget.product.id : widget.product.slug;
    _productFuture = widget.repository.getProduct(identifier);
  }

  @override
  void dispose() {
    _customNoteController.dispose();
    super.dispose();
  }

  Future<void> _addToCart(Product product) async {
    if (!await widget.onRequireAuth()) return;
    setState(() => _busy = true);
    try {
      await widget.repository.addToCart(
        productId: product.id,
        quantity: _quantity,
        selectedColor: _selectedColor,
        selectedMaterial: _selectedMaterial,
        customNote: _customNoteController.text,
      );
      widget.onCartChanged();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Added to your cart.')),
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Product details')),
        body: FutureBuilder<Product>(
          future: _productFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const LoadingState(label: 'Loading product details…');
            }
            if (snapshot.hasError) {
              final error = snapshot.error;
              return ErrorState(
                message: error is ApiException
                    ? error.message
                    : 'Could not load this product.',
                onRetry: () => setState(() {
                  _productFuture = widget.repository.getProduct(
                    widget.product.slug.isEmpty
                        ? widget.product.id
                        : widget.product.slug,
                  );
                }),
              );
            }
            final product = snapshot.data!;
            return _buildDetails(product);
          },
        ),
      );

  Widget _buildDetails(Product product) => ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: ProductImage(url: product.primaryImage, height: 280),
          ),
          const SizedBox(height: 18),
          if (product.categoryName != null)
            Text(
              product.categoryName!.toUpperCase(),
              style: Theme.of(context).textTheme.labelMedium,
            ),
          const SizedBox(height: 4),
          Text(product.name, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                formatPaise(product.effectivePricePaise),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (product.salePricePaise != null) ...[
                const SizedBox(width: 8),
                Text(
                  formatPaise(product.pricePaise),
                  style: const TextStyle(
                    decoration: TextDecoration.lineThrough,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          Text(
            product.isAvailable
                ? 'In stock · availability confirmed when added'
                : 'Currently out of stock',
            style: TextStyle(
              color: product.isAvailable
                  ? Theme.of(context).colorScheme.primary
                  : Theme.of(context).colorScheme.error,
            ),
          ),
          if (product.vendorName != null) ...[
            const SizedBox(height: 4),
            Text('Sold by ${product.vendorName}'),
          ],
          const SizedBox(height: 18),
          Text(product.description),
          if (product.colors.isNotEmpty) ...[
            const SizedBox(height: 20),
            DropdownButtonFormField<String>(
              initialValue: _selectedColor,
              decoration: const InputDecoration(labelText: 'Color'),
              items: product.colors
                  .map((color) => stringValue(color['name']))
                  .whereType<String>()
                  .map((name) =>
                      DropdownMenuItem(value: name, child: Text(name)))
                  .toList(),
              onChanged: (value) => setState(() => _selectedColor = value),
            ),
          ],
          if (product.materials.isNotEmpty) ...[
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _selectedMaterial,
              decoration: const InputDecoration(labelText: 'Material'),
              items: product.materials
                  .map((material) => DropdownMenuItem(
                        value: material,
                        child: Text(material),
                      ))
                  .toList(),
              onChanged: (value) => setState(() => _selectedMaterial = value),
            ),
          ],
          if (product.dimensions.isNotEmpty) ...[
            const SizedBox(height: 20),
            sectionTitle(context, 'Dimensions'),
            const SizedBox(height: 8),
            Text(
              [
                for (final side in ['length', 'width', 'height'])
                  if (product.dimensions[side] != null)
                    '${side[0].toUpperCase()}${side.substring(1)}: ${product.dimensions[side]}',
                if (product.dimensions['unit'] != null)
                  'Unit: ${product.dimensions['unit']}',
              ].join('   •   '),
            ),
          ],
          if (product.specifications.isNotEmpty) ...[
            const SizedBox(height: 18),
            sectionTitle(context, 'Specifications'),
            ...product.specifications.map(
              (spec) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(stringValue(spec['key']) ?? ''),
                trailing: Text(stringValue(spec['value']) ?? ''),
              ),
            ),
          ],
          if (product.stock > 0) ...[
            const SizedBox(height: 22),
            TextField(
              controller: _customNoteController,
              maxLength: 250,
              decoration: const InputDecoration(
                labelText: 'Customization note (optional)',
                hintText: 'Add a note for the vendor',
              ),
            ),
            Row(
              children: [
                IconButton(
                  tooltip: 'Decrease quantity',
                  onPressed:
                      _quantity > 1 ? () => setState(() => _quantity--) : null,
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                Text('$_quantity'),
                IconButton(
                  tooltip: 'Increase quantity',
                  onPressed: _quantity < product.stock && _quantity < 20
                      ? () => setState(() => _quantity++)
                      : null,
                  icon: const Icon(Icons.add_circle_outline),
                ),
                const Spacer(),
                Expanded(
                  flex: 3,
                  child: FilledButton.icon(
                    onPressed: _busy ? null : () => _addToCart(product),
                    icon: const Icon(Icons.shopping_bag_outlined),
                    label: Text(_busy ? 'Adding…' : 'Add to cart'),
                  ),
                ),
              ],
            ),
          ],
        ],
      );
}
