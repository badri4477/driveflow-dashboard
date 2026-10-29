import 'package:flutter/material.dart';
import '../../core/socket_sync.dart';
import '../../services/auth_service.dart';
import '../../services/review_service.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../widgets/states/skeleton.dart';
import '../../widgets/states/state_view.dart';

class MerchantFeedbackPage extends StatefulWidget {
  const MerchantFeedbackPage({super.key});

  @override
  State<MerchantFeedbackPage> createState() => _MerchantFeedbackPageState();
}

class _MerchantFeedbackPageState extends State<MerchantFeedbackPage> {
  final ReviewService _service = ReviewService();
  final AuthService _authService = AuthService();
  List<Review> _reviews = [];
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
      // Only the merchant id is needed — the stored user is enough.
      final user = await _authService.getCurrentUser();
      if (user != null) {
        final data = await _service.getMerchantReviews(user.id);
        if (mounted) {
          setState(() {
            _reviews = data;
            _isLoading = false;
          });
        }
      } else {
        if (mounted) setState(() => _isLoading = false);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadError =
              'Failed to load feedback. Check your connection and try again.';
        });
      }
    }
  }

  double get _averageRating {
    if (_reviews.isEmpty) return 0;
    final total = _reviews.fold<int>(0, (sum, r) => sum + r.rating);
    return double.parse((total / _reviews.length).toStringAsFixed(1));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GlobalSyncRefresh(
      entities: SyncEntities.reviews,
      onSync: () {
        if (!_isLoading) _load();
      },
      child: MerchantScaffold(
        title: 'Customer Feedback',
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
              : _reviews.isEmpty
              ? const StateView.empty(
                  title: 'No feedback yet',
                  message: 'Customer reviews will show up here.',
                  icon: Icons.reviews_outlined,
                  refreshable: true,
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_reviews.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: isDark
                              ? const Color(0xFF1E3A8A).withValues(alpha: 0.25)
                              : const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          'Average Rating: $_averageRating / 5.0',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: isDark
                                ? const Color(0xFF93C5FD)
                                : const Color(0xFF1D4ED8),
                          ),
                        ),
                      ),
                    ..._reviews.map((review) => _ReviewCard(review: review)),
                  ],
                ),
        ),
      ),
    );
  }
}

class _ReviewCard extends StatelessWidget {
  final Review review;

  const _ReviewCard({required this.review});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final vehicle = review.vehicle;
    final vehicleLabel = vehicle != null
        ? [
            vehicle.make,
            vehicle.model,
            vehicle.licensePlate != null ? '(${vehicle.licensePlate})' : null,
          ].whereType<String>().where((s) => s.isNotEmpty).join(' ')
        : null;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: isDark ? const Color(0xFF1F2937) : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isDark ? Colors.grey[800]! : Colors.grey[200]!),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 72,
              child: Column(
                children: [
                  Text(
                    '${review.rating}.0',
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      5,
                      (i) => Icon(
                        i < review.rating ? Icons.star : Icons.star_border,
                        color: Colors.amber,
                        size: 14,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    review.createdAt?.split('T').first ?? '',
                    style: TextStyle(
                      fontSize: 10,
                      color: isDark ? Colors.grey[500] : Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    review.reviewerName ?? 'Anonymous',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
                  ),
                  if (vehicleLabel != null && vehicleLabel.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(
                          Icons.directions_car,
                          size: 14,
                          color: isDark ? Colors.grey[400] : Colors.grey[600],
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            vehicleLabel,
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark
                                  ? Colors.grey[400]
                                  : Colors.grey[700],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (review.serviceNames.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(
                          Icons.build_outlined,
                          size: 14,
                          color: isDark ? Colors.grey[400] : Colors.grey[600],
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            review.serviceNames.join(', '),
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark
                                  ? Colors.grey[400]
                                  : Colors.grey[700],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isDark
                          ? Colors.black.withValues(alpha: 0.2)
                          : const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '"${review.comment}"',
                      style: TextStyle(
                        fontSize: 14,
                        fontStyle: FontStyle.italic,
                        color: isDark ? Colors.grey[300] : Colors.black87,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
