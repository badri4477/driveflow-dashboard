import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/app_colors.dart';
import '../../core/socket_sync.dart';
import '../../models/booking.dart';
import '../../models/user.dart';
import '../../services/auth_service.dart';
import '../../services/booking_service.dart';
import '../../services/notification_service.dart';
import '../../utils/merchant_booking_filters.dart';
import '../../utils/post_login_permissions.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../widgets/states/skeleton.dart';

class MerchantDashboardPage extends StatefulWidget {
  const MerchantDashboardPage({super.key});

  @override
  State<MerchantDashboardPage> createState() => _MerchantDashboardPageState();
}

class _MerchantDashboardPageState extends State<MerchantDashboardPage> {
  final AuthService _authService = AuthService();
  final BookingService _bookingService = BookingService();
  final NotificationService _notificationService = NotificationService();
  StaffUser? _user;
  bool _isLoading = true;
  Map<String, dynamic> _stats = {
    'activeOrders': 0,
    'completedOrders': 0,
    'pendingBills': 0,
  };
  int _unreadNotifications = 0;
  List<BookingSummary> _recentOrders = [];

  @override
  void initState() {
    super.initState();
    _showCachedFirst();
    _init();
  }

  /// Paint immediately from the last bookings + the stored user so reopening
  /// Home doesn't flash a skeleton; _init refreshes in the background.
  Future<void> _showCachedFirst() async {
    final cached = BookingService.cachedMerchantBookings;
    if (cached == null) return;
    final user = await _authService.getCurrentUser();
    if (!mounted || user == null || _user != null) return;
    cached.sort((a, b) {
      final aDate =
          DateTime.tryParse(a.createdAt ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0);
      final bDate =
          DateTime.tryParse(b.createdAt ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0);
      return bDate.compareTo(aDate);
    });
    setState(() {
      _user = user;
      _stats = computeMerchantStats(cached);
      _recentOrders = cached.take(3).toList();
      _isLoading = false;
    });
  }

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String get _displayName {
    final name = (_user?.name ?? 'Merchant').trim();
    if (name.isEmpty) return 'Merchant';
    return name.split(RegExp(r'\s+')).first;
  }

  Future<void> _init() async {
    final shouldShowFullLoading = _user == null;
    if (shouldShowFullLoading && mounted) {
      setState(() => _isLoading = true);
    }

    // Permission prompts shouldn't hold up the dashboard.
    unawaited(PostLoginPermissions.request());

    try {
      // Fetch in parallel, and download bookings ONCE — stats are computed
      // from the same list (getMerchantStats used to re-download it).
      final results = await Future.wait<Object?>([
        _authService.getCurrentUser(forceRefresh: true),
        _bookingService.getMerchantBookings(),
        _notificationService
            .listMyNotifications()
            .then<Object?>((n) => n)
            .catchError((Object _) => null),
      ]);
      final user = results[0] as dynamic;
      final bookings = results[1] as List<BookingSummary>;
      final notifications = (results[2] as List?) ?? const [];
      final stats = computeMerchantStats(bookings);
      bookings.sort((a, b) {
        final aDate =
            DateTime.tryParse(a.createdAt ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0);
        final bDate =
            DateTime.tryParse(b.createdAt ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0);
        return bDate.compareTo(aDate);
      });
      if (!mounted) return;
      setState(() {
        _user = user;
        _stats = stats;
        _recentOrders = bookings
            .take(3)
            .toList(); // home shows max 3 (app + web)
        _unreadNotifications = notifications.where((n) => !n.isRead).length;
        _isLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _openNotifications() async {
    await Navigator.pushNamed(context, '/merchant-notifications');
    if (!mounted) return;
    _init();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final shopOpen = _user?.isShopOpen ?? true;

    return GlobalSyncRefresh(
      entities: SyncEntities.merchantHub,
      onSync: () {
        if (!_isLoading) _init();
      },
      child: MerchantScaffold(
        title: 'Carzzi Merchant',
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: _openNotifications,
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.notifications_none_rounded),
                if (_unreadNotifications > 0)
                  Positioned(
                    right: -6,
                    top: -6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 1,
                      ),
                      decoration: const BoxDecoration(
                        color: Color(0xFFEF4444),
                        borderRadius: BorderRadius.all(Radius.circular(999)),
                      ),
                      constraints: const BoxConstraints(minWidth: 16),
                      child: Text(
                        _unreadNotifications > 99
                            ? '99+'
                            : _unreadNotifications.toString(),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
        body: _isLoading
            ? const SkeletonList(itemCount: 5, showLeading: false)
            : RefreshIndicator(
                onRefresh: _init,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
                  children: [
                    _GreetingHeader(
                      greeting: _greeting,
                      name: _displayName,
                      shopOpen: shopOpen,
                      isDark: isDark,
                    ),
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        _StatTile(
                          title: 'Ongoing',
                          value: '${_stats['activeOrders'] ?? 0}',
                          color: AppColors.primaryBlue,
                          isDark: isDark,
                          onTap: () => Navigator.pushNamed(
                            context,
                            '/merchant-orders',
                            arguments: {'filter': 'active'},
                          ),
                        ),
                        const SizedBox(width: 10),
                        _StatTile(
                          title: 'Completed',
                          value: '${_stats['completedOrders'] ?? 0}',
                          color: AppColors.success,
                          isDark: isDark,
                          onTap: () => Navigator.pushNamed(
                            context,
                            '/merchant-orders',
                            arguments: {'filter': 'completed'},
                          ),
                        ),
                        const SizedBox(width: 10),
                        _StatTile(
                          title: 'Pending pay',
                          value: '${_stats['pendingBills'] ?? 0}',
                          color: AppColors.warning,
                          isDark: isDark,
                          onTap: () => Navigator.pushNamed(
                            context,
                            '/merchant-orders',
                            arguments: {'filter': 'pending-bills'},
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 28),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Recent orders',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: isDark
                                  ? Colors.white
                                  : const Color(0xFF111827),
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: () =>
                              Navigator.pushNamed(context, '/merchant-orders'),
                          child: const Text('See all'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    if (_recentOrders.isEmpty)
                      _EmptyOrders(isDark: isDark)
                    else
                      ..._recentOrders.map(
                        (order) => _RecentOrderCard(
                          order: order,
                          isDark: isDark,
                          onTap: () => Navigator.pushNamed(
                            context,
                            '/merchant-order-detail',
                            arguments: order.id,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _GreetingHeader extends StatelessWidget {
  final String greeting;
  final String name;
  final bool shopOpen;
  final bool isDark;

  const _GreetingHeader({
    required this.greeting,
    required this.name,
    required this.shopOpen,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSecondary : Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '$greeting, $name',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.4,
                    color: isDark ? Colors.white : const Color(0xFF111827),
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: (shopOpen ? AppColors.success : AppColors.warning)
                      .withValues(alpha: isDark ? 0.18 : 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  shopOpen ? 'Shop open' : 'Shop closed',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: shopOpen ? AppColors.success : AppColors.warning,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Here’s how your workshop is doing today.',
            style: TextStyle(
              fontSize: 13,
              height: 1.35,
              color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final String title;
  final String value;
  final Color color;
  final bool isDark;
  final VoidCallback onTap;

  const _StatTile({
    required this.title,
    required this.value,
    required this.color,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Ink(
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 14),
            decoration: BoxDecoration(
              color: isDark
                  ? color.withValues(alpha: 0.14)
                  : color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: color.withValues(alpha: isDark ? 0.28 : 0.18),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: isDark
                        ? Colors.white70
                        : color.withValues(alpha: 0.9),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 26,
                    height: 1,
                    fontWeight: FontWeight.w800,
                    color: isDark ? Colors.white : const Color(0xFF111827),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyOrders extends StatelessWidget {
  final bool isDark;

  const _EmptyOrders({required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSecondary : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        children: [
          Icon(
            Icons.inbox_outlined,
            size: 36,
            color: isDark ? Colors.grey[600] : const Color(0xFF9CA3AF),
          ),
          const SizedBox(height: 12),
          Text(
            'No recent orders',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 15,
              color: isDark ? Colors.white : const Color(0xFF111827),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'New jobs will show up here as they come in.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentOrderCard extends StatelessWidget {
  final BookingSummary order;
  final bool isDark;
  final VoidCallback onTap;

  const _RecentOrderCard({
    required this.order,
    required this.isDark,
    required this.onTap,
  });

  String get _vehicleTitle {
    final title = [
      if ((order.vehicleMake ?? '').isNotEmpty) order.vehicleMake,
      if ((order.vehicleModel ?? '').isNotEmpty) order.vehicleModel,
    ].join(' ');
    if (title.isNotEmpty) return title;
    return order.vehicleName ?? 'Vehicle';
  }

  String get _dateLabel {
    final raw = order.date ?? order.createdAt;
    if (raw == null) return '';
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return raw;
    return DateFormat('d MMM').format(parsed.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    final plate = (order.licensePlate ?? '').trim();
    final status = BookingDetail.getStatusLabel(
      order.status,
      services: order.services,
    );
    final services = order.serviceNames.isNotEmpty
        ? order.serviceNames
        : [if ((order.serviceName ?? '').isNotEmpty) order.serviceName!];

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark ? AppColors.backgroundSecondary : Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
              ),
            ),
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
                          Text(
                            plate.isNotEmpty ? plate : _vehicleTitle,
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              color: isDark
                                  ? Colors.white
                                  : const Color(0xFF111827),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            [
                              if (plate.isNotEmpty) _vehicleTitle,
                              if ((order.customerName ?? '').isNotEmpty)
                                order.customerName,
                            ].join(' · '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13,
                              color: isDark
                                  ? Colors.grey[400]
                                  : const Color(0xFF6B7280),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: isDark
                            ? const Color(0xFF1E293B)
                            : const Color(0xFFE0EAFF),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        status,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: isDark
                              ? const Color(0xFF93C5FD)
                              : const Color(0xFF1E40AF),
                        ),
                      ),
                    ),
                  ],
                ),
                if (services.isNotEmpty) ...[
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
                              fontWeight: FontWeight.w600,
                              color: isDark
                                  ? Colors.grey[300]
                                  : const Color(0xFF374151),
                            ),
                          ),
                        ),
                      if (services.length > 3)
                        Text(
                          '+${services.length - 3}',
                          style: TextStyle(
                            fontSize: 11,
                            color: isDark
                                ? Colors.grey[500]
                                : const Color(0xFF6B7280),
                          ),
                        ),
                    ],
                  ),
                ],
                if (_dateLabel.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    _dateLabel,
                    style: TextStyle(
                      fontSize: 12,
                      color: isDark
                          ? Colors.grey[500]
                          : const Color(0xFF9CA3AF),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
