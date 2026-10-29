import 'package:flutter/material.dart';
import '../../models/booking.dart';
import '../../services/booking_service.dart';
import '../../services/socket_service.dart';
import '../../core/socket_sync.dart';
import '../../utils/merchant_booking_filters.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../core/app_colors.dart';
import '../../widgets/states/status_feedback.dart';
import '../../widgets/states/skeleton.dart';
import '../../widgets/states/state_view.dart';

class MerchantOrdersPage extends StatefulWidget {
  const MerchantOrdersPage({super.key});

  @override
  State<MerchantOrdersPage> createState() => _MerchantOrdersPageState();
}

class _MerchantOrdersPageState extends State<MerchantOrdersPage> {
  final BookingService _service = BookingService();
  final SocketService _socketService = SocketService();
  final TextEditingController _searchController = TextEditingController();
  List<BookingSummary> _bookings = [];
  bool _isLoading = true;
  String? _loadError;
  String _filter = 'active';
  String _searchQuery = '';
  bool _appliedInitialArgs = false;

  @override
  void initState() {
    super.initState();
    // Show the last list right away; _load then refreshes silently.
    final cached = BookingService.cachedMerchantBookings;
    if (cached != null) {
      _bookings = cached;
      _isLoading = false;
    }
    _load();
    _socketService.on('bookingUpdated', _onBookingSocketEvent);
    _socketService.on('bookingCreated', _onBookingSocketEvent);
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text);
    });
  }

  @override
  void dispose() {
    _socketService.off('bookingUpdated', _onBookingSocketEvent);
    _socketService.off('bookingCreated', _onBookingSocketEvent);
    _searchController.dispose();
    super.dispose();
  }

  void _onBookingSocketEvent(dynamic _) {
    if (!_isLoading) _load(silent: true);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_appliedInitialArgs) return;
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is Map) {
      final initialFilter = args['filter']?.toString();
      if (initialFilter == 'active' ||
          initialFilter == 'completed' ||
          initialFilter == 'pending-bills' ||
          initialFilter == 'all') {
        _filter = initialFilter!;
      }
    }
    _appliedInitialArgs = true;
  }

  Future<void> _load({bool silent = false}) async {
    final shouldShowFullLoading = _bookings.isEmpty && !silent;

    if (shouldShowFullLoading) {
      if (mounted) {
        setState(() {
          _isLoading = true;
          _loadError = null;
        });
      }
    }

    try {
      final data = await _service.getMerchantBookings();
      if (mounted) {
        setState(() {
          _bookings = data;
          _isLoading = false;
          _loadError = null;
        });
      }
    } catch (e) {
      if (mounted) {
        // Keep showing the list if there is one; only an empty page
        // gets the full error state.
        setState(() {
          _isLoading = false;
          if (_bookings.isEmpty) {
            _loadError =
                'Failed to load orders. Check your connection and try again.';
          }
        });
        if (_bookings.isNotEmpty) {
          StatusFeedback.error('Could not refresh orders');
        }
      }
    }
  }

  List<BookingSummary> get _visibleBookings {
    return filterMerchantBookings(
      _bookings,
      filter: _filter,
      searchQuery: _searchQuery,
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleBookings;

    return GlobalSyncRefresh(
      entities: SyncEntities.bookings,
      onSync: () {
        if (!_isLoading) _load(silent: true);
      },
      child: MerchantScaffold(
        title: 'Service Orders',
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  hintText: 'Search vehicle or customer...',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  filled: true,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
            SizedBox(
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                children: [
                  _FilterChip(
                    label: 'Active',
                    selected: _filter == 'active',
                    onSelected: (_) => setState(() => _filter = 'active'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Completed',
                    selected: _filter == 'completed',
                    onSelected: (_) => setState(() => _filter = 'completed'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'Pending Bills',
                    selected: _filter == 'pending-bills',
                    onSelected: (_) =>
                        setState(() => _filter = 'pending-bills'),
                  ),
                  const SizedBox(width: 8),
                  _FilterChip(
                    label: 'All',
                    selected: _filter == 'all',
                    onSelected: (_) => setState(() => _filter = 'all'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _load,
                child: _isLoading
                    ? const SkeletonList()
                    : _loadError != null
                    ? StateView.error(
                        message: _loadError,
                        onRetry: _load,
                        refreshable: true,
                      )
                    : visible.isEmpty
                    ? const StateView.empty(
                        title: 'No orders found',
                        message: 'No orders match your current filters.',
                        icon: Icons.receipt_long_outlined,
                        refreshable: true,
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: visible.length,
                        itemBuilder: (context, index) {
                          final booking = visible[index];
                          return _OrderCard(
                            booking: booking,
                            onTap: () {
                              // Push (not replace) so Back returns to Orders.
                              Navigator.of(context).pushNamed(
                                '/merchant-order-detail',
                                arguments: booking.id,
                              );
                            },
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final ValueChanged<bool> onSelected;

  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: onSelected,
      selectedColor: isDark
          ? AppColors.primaryBlue.withValues(alpha: 0.2)
          : AppColors.primaryPurple.withValues(alpha: 0.1),
      checkmarkColor: isDark ? AppColors.primaryBlue : AppColors.primaryPurple,
      labelStyle: TextStyle(
        color: selected
            ? (isDark ? AppColors.primaryBlue : AppColors.primaryPurple)
            : (isDark ? AppColors.textSecondary : AppColors.textSecondaryLight),
        fontWeight: selected ? FontWeight.bold : FontWeight.normal,
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final BookingSummary booking;
  final VoidCallback onTap;

  const _OrderCard({required this.booking, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final plate = booking.licensePlate ?? 'N/A';
    final customer = booking.customerName ?? 'Unknown User';
    final services = booking.serviceNames.isNotEmpty
        ? booking.serviceNames
        : [booking.serviceName ?? 'General Service'];

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: isDark
            ? AppColors.backgroundSecondary
            : AppColors.backgroundSecondaryLight,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? AppColors.borderColor : AppColors.borderColorLight,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.2 : 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              Icons.directions_car_outlined,
                              size: 16,
                              color: isDark
                                  ? AppColors.textMuted
                                  : AppColors.textMutedLight,
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                booking.vehicleModel ??
                                    booking.vehicleName ??
                                    'Unknown Vehicle',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: isDark
                                      ? AppColors.textSecondary
                                      : AppColors.textSecondaryLight,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          plate,
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                            color: isDark
                                ? AppColors.textPrimary
                                : Colors.black87,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _StatusBadge(
                    status: booking.status,
                    services: booking.services,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(
                    Icons.person_outline,
                    size: 16,
                    color: isDark
                        ? AppColors.textMuted
                        : AppColors.textMutedLight,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      customer,
                      style: TextStyle(
                        fontSize: 14,
                        color: isDark
                            ? AppColors.textSecondary
                            : AppColors.textSecondaryLight,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (var i = 0; i < services.length && i < 3; i++)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: isDark
                            ? AppColors.backgroundSurface
                            : const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        services[i],
                        style: TextStyle(
                          fontSize: 11,
                          color: isDark ? Colors.grey[300] : Colors.black87,
                        ),
                      ),
                    ),
                  if (services.length > 3)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: isDark
                            ? AppColors.backgroundSurface
                            : const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '+${services.length - 3} more',
                        style: TextStyle(
                          fontSize: 11,
                          color: isDark ? Colors.grey[400] : Colors.grey[600],
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(
                    Icons.calendar_today_outlined,
                    size: 16,
                    color: isDark
                        ? AppColors.textMuted
                        : AppColors.textMutedLight,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    booking.date != null
                        ? DateTime.tryParse(
                                booking.date!,
                              )?.toLocal().toString().split(' ').first ??
                              booking.date!
                        : 'N/A',
                    style: TextStyle(
                      fontSize: 13,
                      color: isDark
                          ? AppColors.textMuted
                          : AppColors.textMutedLight,
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    Icons.chevron_right,
                    color: isDark
                        ? AppColors.textMuted
                        : AppColors.textMutedLight,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  final List<dynamic>? services;

  const _StatusBadge({required this.status, this.services});

  @override
  Widget build(BuildContext context) {
    Color color = Colors.grey;
    switch (status) {
      case 'CREATED':
      case 'ASSIGNED':
        color = AppColors.primaryBlue;
        break;
      case 'ACCEPTED':
      case 'REACHED_CUSTOMER':
      case 'VEHICLE_PICKED':
        color = AppColors.warning;
        break;
      case 'REACHED_MERCHANT':
      case 'VEHICLE_AT_MERCHANT':
      case 'SERVICE_STARTED':
        color = AppColors.primaryBlue;
        break;
      case 'SERVICE_COMPLETED':
        color = Colors.indigo;
        break;
      case 'OUT_FOR_DELIVERY':
        color = Colors.teal;
        break;
      case 'DELIVERED':
      case 'COMPLETED':
        color = AppColors.success;
        break;
      case 'CANCELLED':
        color = AppColors.error;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Text(
        BookingDetail.getStatusLabel(status, services: services),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}
