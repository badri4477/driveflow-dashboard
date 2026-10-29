import 'package:flutter/material.dart';
import '../../core/socket_sync.dart';
import '../../services/product_service.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../widgets/states/status_feedback.dart';
import '../../widgets/states/skeleton.dart';
import '../../widgets/states/state_view.dart';

class MerchantStockPage extends StatefulWidget {
  const MerchantStockPage({super.key});

  @override
  State<MerchantStockPage> createState() => _MerchantStockPageState();
}

class _MerchantStockPageState extends State<MerchantStockPage> {
  final ProductService _service = ProductService();
  List<Product> _products = [];
  bool _isLoading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _loadError = null;
      });
    }
    try {
      final data = await _service.getProducts();
      if (mounted) {
        setState(() {
          _products = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadError =
              'Failed to load stock. Check your connection and try again.';
        });
      }
    }
  }

  Future<void> _updateQuantity(Product product, int delta) async {
    final newQuantity = (product.quantity + delta).clamp(0, 9999);
    if (newQuantity == product.quantity) return;

    try {
      await _service.updateProduct(product.id, {'quantity': newQuantity});
      _load();
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to update quantity');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return GlobalSyncRefresh(
      entities: SyncEntities.products,
      onSync: () {
        if (!_isLoading) _load();
      },
      child: MerchantScaffold(
        title: 'Stock Management',
        body: RefreshIndicator(
          onRefresh: _load,
          child: _isLoading
              ? const SkeletonList()
              : _loadError != null
              ? StateView.error(
                  message: _loadError,
                  onRetry: _load,
                  refreshable: true,
                )
              : _products.isEmpty
              ? const StateView.empty(
                  title: 'No stock items yet',
                  message: 'Products you add to stock will show up here.',
                  icon: Icons.inventory_2_outlined,
                  refreshable: true,
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _products.length,
                  itemBuilder: (context, index) {
                    final product = _products[index];
                    final isLowStock = product.quantity <= product.threshold;
                    final isOutOfStock = product.quantity == 0;

                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                        side: BorderSide(color: Colors.grey[200]!),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        product.name,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 16,
                                        ),
                                      ),
                                      Text(
                                        product.category,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Colors.grey[600],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                _StatusBadge(
                                  isOutOfStock: isOutOfStock,
                                  isLowStock: isLowStock,
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  '₹${product.price}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 18,
                                    color: Colors.deepPurple,
                                  ),
                                ),
                                Row(
                                  children: [
                                    IconButton(
                                      onPressed: () =>
                                          _updateQuantity(product, -1),
                                      icon: const Icon(
                                        Icons.remove_circle_outline,
                                      ),
                                      color: Colors.grey[600],
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 12,
                                        vertical: 4,
                                      ),
                                      decoration: BoxDecoration(
                                        color: Colors.grey[100],
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Text(
                                        '${product.quantity}',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 16,
                                        ),
                                      ),
                                    ),
                                    IconButton(
                                      onPressed: () =>
                                          _updateQuantity(product, 1),
                                      icon: const Icon(
                                        Icons.add_circle_outline,
                                      ),
                                      color: Colors.deepPurple,
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final bool isOutOfStock;
  final bool isLowStock;

  const _StatusBadge({required this.isOutOfStock, required this.isLowStock});

  @override
  Widget build(BuildContext context) {
    if (isOutOfStock) {
      return _badge('Out of Stock', Colors.red);
    } else if (isLowStock) {
      return _badge('Low Stock', Colors.orange);
    } else {
      return _badge('Available', Colors.green);
    }
  }

  Widget _badge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}
