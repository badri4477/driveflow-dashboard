import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api_client.dart';
import '../core/app_colors.dart';
import '../core/app_spacing.dart';
import '../models/booking.dart';
import '../models/vehicle.dart';
import '../services/booking_service.dart';
import '../core/socket_sync.dart';
import '../core/vehicle_info.dart';
import '../widgets/global_sync_refresh.dart';
import '../services/vehicle_service.dart';
import '../utils/auth_gate.dart';
import '../utils/vehicle_health.dart';
import 'book_service_flow_page.dart';
import 'add_vehicle_page.dart';
import '../widgets/gradient_button.dart';

/// Order and copy aligned with [frontend/src/components/VehicleHealthIndicators.tsx].
const List<Map<String, String>> _kVehicleHealthIndicatorRows = [
  {'key': 'generalService', 'label': 'Engine Oil / Service', 'emoji': '🛢️'},
  {'key': 'brakePads', 'label': 'Brake Pads', 'emoji': '🛑'},
  {'key': 'tires', 'label': 'Tire Condition', 'emoji': '🛞'},
  {'key': 'battery', 'label': 'Battery Health', 'emoji': '🔋'},
  {'key': 'wiperBlade', 'label': 'Wiper Blade', 'emoji': '🧹'},
];

class VehicleDetailPage extends StatefulWidget {
  final Vehicle vehicle;

  const VehicleDetailPage({super.key, required this.vehicle});

  @override
  State<VehicleDetailPage> createState() => _VehicleDetailPageState();
}

class _VehicleDetailPageState extends State<VehicleDetailPage>
    with SingleTickerProviderStateMixin {
  final _vehicleService = VehicleService();
  final _bookingService = BookingService();

  late TabController _tabController;
  late Vehicle _vehicle;

  bool _loading = true;
  String? _error;
  List<Booking> _bookings = const [];
  Timer? _healthClock;

  @override
  void initState() {
    super.initState();
    _vehicle = widget.vehicle;
    _tabController = TabController(length: 2, vsync: this);
    _healthClock = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  @override
  void dispose() {
    _healthClock?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _showEditDialog() async {
    final updated = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AddVehiclePage(editingVehicle: _vehicle),
      ),
    );
    if (updated == true && mounted) {
      _load();
    }
  }

  Future<void> _showDeleteConfirmation() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete Vehicle'),
        content: const Text(
          'Are you sure you want to delete this vehicle? This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await _vehicleService.deleteVehicle(_vehicle.id);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Failed to delete vehicle: $e')));
    }
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    Vehicle nextVehicle = _vehicle;
    List<Booking> nextBookings = _bookings;
    final errors = <String>[];

    try {
      nextVehicle = await _vehicleService.getVehicleById(_vehicle.id);
    } catch (e) {
      if (e is ApiException && e.statusCode == 401) {
        if (!mounted) return;
        await handleUnauthorized(context);
        return;
      }
      errors.add(e.toString());
    }

    try {
      var list = await _bookingService.listBookingsForVehicle(_vehicle.id);
      list = List<Booking>.from(list);
      list.sort((a, b) {
        final da = _parseDate(a.date) ?? DateTime(1900);
        final db = _parseDate(b.date) ?? DateTime(1900);
        return db.compareTo(da);
      });
      nextBookings = list;
    } catch (e) {
      if (e is ApiException && e.statusCode == 401) {
        if (!mounted) return;
        await handleUnauthorized(context);
        return;
      }
      errors.add(e.toString());
    }

    if (!mounted) return;
    setState(() {
      _vehicle = nextVehicle;
      _bookings = nextBookings;
      _error = errors.isEmpty ? null : errors.join('\n');
      _loading = false;
    });
  }

  /// "Select Service Category" picker for this vehicle's Book Service
  /// button — same categories/copy as the one on My Vehicles
  /// (my_vehicles_page.dart), but pushes a fresh BookServiceFlowPage with
  /// this vehicle preselected instead of switching the shared bottom-nav
  /// tabs (which have no way to carry a preselected vehicle through).
  void _showBookServiceCategoryDialog() {
    if (!mounted) return;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    void openFlow(String category) {
      Navigator.pop(context);
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => BookServiceFlowPage(
            initialCategory: category,
            initialVehicleId: _vehicle.id,
          ),
        ),
      );
    }

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: isDark ? const Color(0xFF121212) : Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
        title: Text(
          'Select Service Category',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: isDark ? Colors.white : Colors.black87,
          ),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _BookServiceCategoryTile(
              icon: Icons.local_car_wash_outlined,
              title: 'Car Wash',
              subtitle: 'Premium cleaning services',
              color: Colors.blue,
              onTap: () => openFlow('Wash'),
            ),
            const SizedBox(height: 12),
            _BookServiceCategoryTile(
              icon: Icons.settings_suggest_outlined,
              title: 'services',
              subtitle: 'General maintenance & repairs',
              color: AppColors.primaryBlue,
              onTap: () => openFlow('Periodic'),
            ),
            const SizedBox(height: 12),
            _BookServiceCategoryTile(
              icon: Icons.shield_outlined,
              title: 'Essentials',
              subtitle: 'Essential services',
              color: Colors.purple,
              onTap: () => openFlow('Essentials'),
            ),
            const SizedBox(height: 12),
            _BookServiceCategoryTile(
              icon: Icons.tire_repair_outlined,
              title: 'Tyres',
              subtitle: 'Replacement & maintenance',
              color: Colors.orange,
              onTap: () => openFlow('Tyres'),
            ),
            const SizedBox(height: 12),
            _BookServiceCategoryTile(
              icon: Icons.battery_charging_full_outlined,
              title: 'Battery',
              subtitle: 'Replacement & maintenance',
              color: Colors.orange,
              onTap: () => openFlow('Battery'),
            ),
          ],
        ),
      ),
    );
  }

  DateTime? _parseDate(String value) {
    try {
      return DateTime.parse(value).toLocal();
    } catch (_) {
      return null;
    }
  }

  String _formatDate(BuildContext context, String value) {
    final dt = _parseDate(value);
    if (dt == null) return value;
    return MaterialLocalizations.of(context).formatMediumDate(dt);
  }

  String _formatTime(BuildContext context, String value) {
    final dt = _parseDate(value);
    if (dt == null) return '';
    return MaterialLocalizations.of(
      context,
    ).formatTimeOfDay(TimeOfDay.fromDateTime(dt), alwaysUse24HourFormat: false);
  }

  Color _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'CREATED':
      case 'ASSIGNED':
        return AppColors.primaryBlue;
      case 'ACCEPTED':
      case 'REACHED_CUSTOMER':
        return AppColors.primaryBlueSoft;
      case 'VEHICLE_PICKED':
      case 'REACHED_MERCHANT':
      case 'VEHICLE_AT_MERCHANT':
      case 'SERVICE_STARTED':
      case 'SERVICE_IN_PROGRESS':
        return AppColors.primaryBlue;
      case 'SERVICE_COMPLETED':
      case 'OUT_FOR_DELIVERY':
        return AppColors.warning;
      case 'DELIVERED':
      case 'COMPLETED':
        return AppColors.success;
      case 'CANCELLED':
        return AppColors.error;
      default:
        return AppColors.textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark
        ? AppColors.backgroundPrimary
        : AppColors.backgroundPrimaryLight;

    return GlobalSyncRefresh(
      entities: SyncEntities.vehicles,
      onSync: () {
        if (!_loading) _load();
      },
      child: Scaffold(
        backgroundColor: bg,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          centerTitle: true,
          title: Text(
            'Vehicle details',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: isDark ? Colors.white : Colors.black,
            ),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Edit vehicle',
              onPressed: _showEditDialog,
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              tooltip: 'Delete vehicle',
              onPressed: _showDeleteConfirmation,
            ),
          ],
        ),
        body: NestedScrollView(
          headerSliverBuilder: (BuildContext context, bool innerBoxIsScrolled) {
            return [
              SliverToBoxAdapter(
                child: Padding(
                  padding: AppSpacing.edgeInsetsAllDefault,
                  child: _buildVehicleSummaryCard(context, isDark),
                ),
              ),
              if (_error != null)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Text(
                      _error!,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(color: AppColors.error),
                    ),
                  ),
                ),
              SliverOverlapAbsorber(
                handle: NestedScrollView.sliverOverlapAbsorberHandleFor(
                  context,
                ),
                sliver: SliverPersistentHeader(
                  pinned: true,
                  delegate: _VehicleDetailTabsHeaderDelegate(
                    tabController: _tabController,
                    isDark: isDark,
                    backgroundColor: bg,
                  ),
                ),
              ),
            ];
          },
          body: TabBarView(
            controller: _tabController,
            children: [
              _buildNestedHealthTab(context, isDark),
              _buildNestedServiceHistoryTab(context, isDark),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNestedServiceHistoryTab(BuildContext context, bool isDark) {
    return Builder(
      builder: (BuildContext nestedContext) {
        return RefreshIndicator(
          onRefresh: _load,
          child: CustomScrollView(
            key: const PageStorageKey<String>('vehicle_detail_services'),
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverOverlapInjector(
                handle: NestedScrollView.sliverOverlapAbsorberHandleFor(
                  nestedContext,
                ),
              ),
              ..._serviceHistorySlivers(context, isDark),
            ],
          ),
        );
      },
    );
  }

  Widget _buildNestedHealthTab(BuildContext context, bool isDark) {
    return Builder(
      builder: (BuildContext nestedContext) {
        return RefreshIndicator(
          onRefresh: _load,
          child: CustomScrollView(
            key: const PageStorageKey<String>('vehicle_detail_health'),
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverOverlapInjector(
                handle: NestedScrollView.sliverOverlapAbsorberHandleFor(
                  nestedContext,
                ),
              ),
              ..._healthTabSlivers(context, isDark),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _serviceHistorySlivers(BuildContext context, bool isDark) {
    if (_loading && _bookings.isEmpty) {
      return const [
        SliverFillRemaining(child: Center(child: CircularProgressIndicator())),
      ];
    }

    if (_bookings.isEmpty) {
      return [
        SliverFillRemaining(
          hasScrollBody: false,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    "This vehicle hasn't been serviced with us yet. "
                    'Book your first service today!',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: isDark
                          ? AppColors.textSecondary
                          : AppColors.textSecondaryLight,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.section),
                  SizedBox(
                    width: 220,
                    child: GradientButton(
                      text: 'Book Service',
                      icon: Icons.add_circle_outline,
                      onPressed: _showBookServiceCategoryDialog,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ];
    }

    return [
      SliverPadding(
        padding: AppSpacing.edgeInsetsAllDefault,
        sliver: SliverList(
          delegate: SliverChildBuilderDelegate((context, index) {
            final b = _bookings[index];
            return Padding(
              padding: EdgeInsets.only(
                bottom: index < _bookings.length - 1 ? AppSpacing.medium : 0,
              ),
              child: _buildServiceHistoryBookingCard(context, isDark, b),
            );
          }, childCount: _bookings.length),
        ),
      ),
    ];
  }

  List<Widget> _healthTabSlivers(BuildContext context, bool isDark) {
    if (_loading &&
        (_vehicle.healthIndicators == null ||
            _vehicle.healthIndicators!.isEmpty)) {
      return const [
        SliverFillRemaining(child: Center(child: CircularProgressIndicator())),
      ];
    }

    final map = _vehicle.healthIndicators;
    final effectiveMap = (map == null || map.isEmpty)
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(map);

    return [
      SliverPadding(
        padding: AppSpacing.edgeInsetsAllDefault,
        sliver: SliverToBoxAdapter(
          child: _buildVehicleHealthIndicatorsPanel(
            context,
            isDark,
            effectiveMap,
          ),
        ),
      ),
    ];
  }

  Widget _buildVehicleHealthIndicatorsPanel(
    BuildContext context,
    bool isDark,
    Map<String, dynamic> healthMap,
  ) {
    final locale = Localizations.localeOf(context).toString();
    final cardBg = isDark ? AppColors.backgroundSecondary : Colors.white;
    final titleColor = isDark ? AppColors.textPrimary : const Color(0xFF1A1A1A);
    final mutedColor = isDark ? AppColors.textMuted : const Color(0xFF757575);
    final borderColor = isDark
        ? AppColors.borderColor
        : const Color(0xFFE2E8F0);
    final badgeFill = isDark
        ? AppColors.backgroundSurface
        : const Color(0xFFF1F5F9);
    final barTrack = isDark
        ? AppColors.borderColor.withValues(alpha: 0.65)
        : const Color(0xFFE0E0E0);

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: borderColor),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.45)
                : Colors.black.withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  'Vehicle Health Indicators',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.3,
                    color: titleColor,
                    fontSize: 20,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 158),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: badgeFill,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: borderColor),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 5,
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.info_outline, size: 12, color: mutedColor),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            'Merchant Update Only',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: mutedColor,
                              height: 1.1,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          for (var i = 0; i < _kVehicleHealthIndicatorRows.length; i++) ...[
            if (i > 0) const SizedBox(height: 24),
            _buildVehicleHealthIndicatorRow(
              context,
              rowKey: _kVehicleHealthIndicatorRows[i]['key']!,
              label: _kVehicleHealthIndicatorRows[i]['label']!,
              emoji: _kVehicleHealthIndicatorRows[i]['emoji']!,
              data: _mapForHealthKey(
                healthMap,
                _kVehicleHealthIndicatorRows[i]['key']!,
              ),
              vehicleMileage: _vehicle.mileage,
              titleColor: titleColor,
              mutedColor: mutedColor,
              barTrack: barTrack,
              locale: locale,
            ),
          ],
          Padding(
            padding: const EdgeInsets.only(top: 20),
            child: Divider(height: 1, thickness: 1, color: borderColor),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text(
              'Health stats are updated by certified merchants during service '
              'inspections. Values reflect the remaining lifecycle based on '
              'time and mileage.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 10,
                height: 1.5,
                color: mutedColor,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _mapForHealthKey(
    Map<String, dynamic> healthMap,
    String key,
  ) {
    final raw = healthMap[key];
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return {};
  }

  Widget _buildVehicleHealthIndicatorRow(
    BuildContext context, {
    required String rowKey,
    required String label,
    required String emoji,
    required Map<String, dynamic> data,
    required num? vehicleMileage,
    required Color titleColor,
    required Color mutedColor,
    required Color barTrack,
    required String locale,
  }) {
    final pct = computeVehicleHealthPercent(data, vehicleMileage);
    final fixedKm = data['fixedKm'];
    final fixedDays = data['fixedDays'];
    final kmFmt = NumberFormat.decimalPattern(locale);

    final subChunks = <Widget>[];
    if (fixedKm != null && fixedKm is num) {
      subChunks.add(
        Text(
          '${kmFmt.format(fixedKm)} KM',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            color: mutedColor,
          ),
        ),
      );
    }
    if (fixedDays != null && fixedDays is num) {
      subChunks.add(
        Text(
          '${kmFmt.format(fixedDays)} Days',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            color: mutedColor,
          ),
        ),
      );
    }

    return TweenAnimationBuilder<double>(
      key: ValueKey<String>('$rowKey-$pct'),
      tween: Tween<double>(begin: 0, end: pct.toDouble()),
      duration: const Duration(milliseconds: 1200),
      curve: Curves.easeOut,
      builder: (context, animated, _) {
        final display = animated.round().clamp(0, 100);
        final colors = healthPercentColors(display);
        final w = (animated / 100.0).clamp(0.0, 1.0);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Text(
                        emoji,
                        style: const TextStyle(fontSize: 22, height: 1),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              label,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: titleColor,
                                height: 1.2,
                              ),
                            ),
                            if (subChunks.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Wrap(
                                spacing: 12,
                                runSpacing: 4,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: subChunks,
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  '$display%',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: colors.text,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: SizedBox(
                height: 8,
                child: LayoutBuilder(
                  builder: (context, c) {
                    return Stack(
                      fit: StackFit.expand,
                      children: [
                        ColoredBox(color: barTrack),
                        Positioned(
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: c.maxWidth * w,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [colors.barStart, colors.barEnd],
                              ),
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildServiceHistoryBookingCard(
    BuildContext context,
    bool isDark,
    Booking b,
  ) {
    final names = b.services.isEmpty
        ? 'Service'
        : b.services.map((s) => s.name).join(' · ');
    final statusLabel = Booking.getStatusLabel(b.status, b.services);
    final statusColor = _statusColor(b.status);
    final dateLabel = _formatDate(context, b.date);
    final timeLabel = _formatTime(context, b.date);

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () {
        Navigator.pushNamed(context, '/track', arguments: b.id);
      },
      child: Container(
        padding: const EdgeInsets.all(14),
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
              color: isDark
                  ? Colors.black.withValues(alpha: 0.35)
                  : Colors.black.withValues(alpha: 0.05),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    color: isDark
                        ? Colors.white.withValues(alpha: 0.05)
                        : Colors.black.withValues(alpha: 0.04),
                    border: Border.all(
                      color: isDark
                          ? AppColors.borderColor
                          : AppColors.borderColorLight,
                    ),
                  ),
                  child: Icon(
                    Icons.miscellaneous_services_outlined,
                    size: 22,
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                  ),
                ),
                AppSpacing.horizontalMedium,
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        names,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: isDark
                              ? AppColors.textPrimary
                              : AppColors.textPrimaryLight,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Order #${b.orderNumber ?? b.id}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: isDark
                              ? AppColors.textMuted
                              : AppColors.textMutedLight,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    gradient: LinearGradient(
                      colors: [
                        statusColor.withValues(alpha: 0.35),
                        Color.lerp(
                          statusColor,
                          Colors.white,
                          0.2,
                        )!.withValues(alpha: 0.4),
                      ],
                    ),
                  ),
                  child: Text(
                    statusLabel,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
            AppSpacing.verticalMedium,
            Row(
              children: [
                Icon(
                  Icons.calendar_today_outlined,
                  size: 16,
                  color: isDark
                      ? AppColors.textSecondary
                      : AppColors.textSecondaryLight,
                ),
                const SizedBox(width: 6),
                Text(
                  dateLabel,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 16),
                Icon(
                  Icons.schedule,
                  size: 16,
                  color: isDark
                      ? AppColors.textSecondary
                      : AppColors.textSecondaryLight,
                ),
                const SizedBox(width: 6),
                Text(
                  timeLabel.isEmpty ? '—' : timeLabel,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            AppSpacing.verticalSmall,
            Row(
              children: [
                Text(
                  '₹${b.calculatedTotal is int || b.calculatedTotal == b.calculatedTotal.roundToDouble() ? b.calculatedTotal.round() : b.calculatedTotal.toStringAsFixed(1)}',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                    color: isDark
                        ? AppColors.textPrimary
                        : AppColors.textPrimaryLight,
                  ),
                ),
                const Spacer(),
                Icon(
                  Icons.chevron_right,
                  color: isDark
                      ? AppColors.textSecondary
                      : AppColors.textSecondaryLight,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  IconData _vehicleHeroIcon() {
    final t = _vehicle.type?.toLowerCase() ?? '';
    if (t.contains('bike')) return Icons.two_wheeler_rounded;
    return Icons.directions_car_filled_rounded;
  }

  Widget _buildVehicleSummaryCard(BuildContext context, bool isDark) {
    final v = _vehicle;
    final headline = '${v.make} ${v.model}'.trim();
    final variant = (v.variant ?? '').trim();

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
      decoration: BoxDecoration(
        color: isDark
            ? AppColors.backgroundSecondary
            : AppColors.backgroundSecondaryLight,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? AppColors.borderColor : AppColors.borderColorLight,
        ),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.4)
                : Colors.black.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppColors.primaryBlue, AppColors.primaryBlueDark],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryBlue.withValues(alpha: 0.35),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Icon(_vehicleHeroIcon(), color: Colors.white, size: 32),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      headline.toUpperCase(),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.4,
                        height: 1.15,
                        color: isDark
                            ? AppColors.textPrimary
                            : AppColors.textPrimaryLight,
                      ),
                    ),
                    if (variant.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        variant,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: isDark
                              ? AppColors.textSecondary
                              : AppColors.textSecondaryLight,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              gradient: LinearGradient(
                colors: [
                  AppColors.primaryBlue.withValues(alpha: isDark ? 0.28 : 0.14),
                  AppColors.primaryBlue.withValues(alpha: isDark ? 0.08 : 0.05),
                ],
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
              ),
              border: Border.all(
                color: AppColors.primaryBlue.withValues(alpha: 0.4),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Registration',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.8,
                    color: isDark
                        ? Colors.white.withValues(alpha: 0.72)
                        : AppColors.primaryBlue,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  v.licensePlate.toUpperCase(),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                    letterSpacing: 2.2,
                    fontFeatures: const [FontFeature.tabularFigures()],
                    color: isDark ? Colors.white : AppColors.textPrimaryLight,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'At a glance',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
              color: isDark
                  ? AppColors.textSecondary
                  : AppColors.textSecondaryLight,
            ),
          ),
          const SizedBox(height: 10),
          LayoutBuilder(
            builder: (context, constraints) {
              final specs = _vehicleSpecItems(v);
              if (specs.isEmpty) {
                return const SizedBox.shrink();
              }
              final w = (constraints.maxWidth - 10) / 2;
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: specs
                    .map(
                      (s) => SizedBox(
                        width: w,
                        child: _buildVehicleSpecTile(context, isDark, s),
                      ),
                    )
                    .toList(),
              );
            },
          ),
        ],
      ),
    );
  }

  List<_VehicleSpecItem> _vehicleSpecItems(Vehicle v) {
    final list = <_VehicleSpecItem>[];
    if ((v.type ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(Icons.category_outlined, 'Type', v.type!.trim()),
      );
    }
    if ((v.fuelType ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(
          Icons.local_gas_station_outlined,
          'Fuel',
          v.fuelType!.trim().toUpperCase(),
        ),
      );
    }
    // Saved from Vahan at add time — parity with web My Vehicles.
    const vahanIcons = {
      'Body type': Icons.directions_car_outlined,
      'Colour': Icons.palette_outlined,
      'Manufacturing month/year': Icons.event_outlined,
      'Insurance valid till': Icons.verified_user_outlined,
      'Registration valid till': Icons.assignment_outlined,
    };
    for (final r in vehicleInfoRows(v)) {
      final icon = vahanIcons[r.label];
      if (icon == null || r.value.trim().isEmpty) continue;
      list.add(
        _VehicleSpecItem(
          icon,
          r.label,
          r.expired ? '${r.value} (expired)' : r.value,
        ),
      );
    }
    if (v.mileage != null) {
      list.add(
        _VehicleSpecItem(Icons.speed_outlined, 'Odometer', '${v.mileage} km'),
      );
    }
    if ((v.vin ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(Icons.qr_code_2_outlined, 'VIN', v.vin!.trim()),
      );
    }
    if ((v.frontTyres ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(
          Icons.circle_outlined,
          'Front tyres',
          v.frontTyres!.trim(),
        ),
      );
    }
    if ((v.rearTyres ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(
          Icons.circle_outlined,
          'Rear tyres',
          v.rearTyres!.trim(),
        ),
      );
    }
    if ((v.batteryDetails ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(
          Icons.battery_charging_full_outlined,
          'Battery',
          v.batteryDetails!.trim(),
        ),
      );
    }
    if ((v.pickupDropPrice ?? '').trim().isNotEmpty) {
      list.add(
        _VehicleSpecItem(
          Icons.currency_rupee_outlined,
          'Pickup/Drop',
          '₹${v.pickupDropPrice!.trim()}',
        ),
      );
    }
    return list;
  }

  Widget _buildVehicleSpecTile(
    BuildContext context,
    bool isDark,
    _VehicleSpecItem item,
  ) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: isDark
            ? Colors.white.withValues(alpha: 0.04)
            : Colors.white.withValues(alpha: 0.85),
        border: Border.all(
          color: isDark
              ? AppColors.borderColor.withValues(alpha: 0.85)
              : AppColors.borderColorLight,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: AppColors.primaryBlue.withValues(alpha: 0.12),
            ),
            child: Icon(item.icon, size: 20, color: AppColors.primaryBlue),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.label,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: isDark
                        ? AppColors.textMuted
                        : AppColors.textMutedLight,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  item.value,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: isDark
                        ? AppColors.textPrimary
                        : AppColors.textPrimaryLight,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VehicleDetailTabsHeaderDelegate extends SliverPersistentHeaderDelegate {
  final TabController tabController;
  final bool isDark;
  final Color backgroundColor;

  _VehicleDetailTabsHeaderDelegate({
    required this.tabController,
    required this.isDark,
    required this.backgroundColor,
  });

  /// TabBar intrinsic height + divider; keep a few px slack to avoid
  /// "BOTTOM OVERFLOWED" on some text scales and indicator weights.
  static const double _extent = 54;

  @override
  double get minExtent => _extent;

  @override
  double get maxExtent => _extent;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return SizedBox(
      height: maxExtent,
      child: Material(
        color: backgroundColor,
        elevation: overlapsContent ? 2 : 0,
        shadowColor: Colors.black38,
        child: Column(
          mainAxisSize: MainAxisSize.max,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: TabBar(
                controller: tabController,
                labelColor: AppColors.primaryBlue,
                unselectedLabelColor: isDark
                    ? AppColors.textSecondary
                    : AppColors.textSecondaryLight,
                indicatorColor: AppColors.primaryBlue,
                indicatorWeight: 3,
                labelStyle: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
                tabs: const [
                  Tab(text: 'Vehicle health'),
                  Tab(text: 'Service history'),
                ],
              ),
            ),
            Divider(
              height: 1,
              thickness: 1,
              color: isDark
                  ? AppColors.borderColor.withValues(alpha: 0.6)
                  : AppColors.borderColorLight,
            ),
          ],
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _VehicleDetailTabsHeaderDelegate oldDelegate) {
    return oldDelegate.tabController != tabController ||
        oldDelegate.isDark != isDark ||
        oldDelegate.backgroundColor != backgroundColor;
  }
}

class _VehicleSpecItem {
  final IconData icon;
  final String label;
  final String value;

  const _VehicleSpecItem(this.icon, this.label, this.value);
}

/// Row in the "Select Service Category" dialog. Mirrors _CategoryTile in
/// my_vehicles_page.dart (kept as a separate copy since Dart privacy is
/// per-file, not shared across libraries).
class _BookServiceCategoryTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _BookServiceCategoryTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isDark ? Colors.grey.shade800 : Colors.grey.shade200,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 12,
                      color: isDark ? Colors.white60 : Colors.grey.shade600,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              color: isDark ? Colors.white30 : Colors.grey.shade400,
            ),
          ],
        ),
      ),
    );
  }
}
