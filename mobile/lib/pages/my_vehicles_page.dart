import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/app_colors.dart';
import '../core/app_spacing.dart';
import '../core/api_client.dart';
import '../models/vehicle.dart';
import '../services/vehicle_service.dart';
import '../core/socket_sync.dart';
import '../core/vehicle_info.dart';
import '../state/auth_provider.dart';
import '../widgets/customer_drawer.dart';
import '../widgets/global_sync_refresh.dart';
import '../widgets/guest_login_prompt.dart';
import '../utils/auth_gate.dart';
import 'book_service_flow_page.dart';

class MyVehiclesPage extends StatefulWidget {
  const MyVehiclesPage({super.key});

  @override
  State<MyVehiclesPage> createState() => _MyVehiclesPageState();
}

class _MyVehiclesPageState extends State<MyVehiclesPage> {
  final _service = VehicleService();
  bool _loading = true;
  String? _error;
  List<Vehicle> _vehicles = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load() async {
    if (!mounted) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final items = await _service.listMyVehicles();
      if (mounted) setState(() => _vehicles = items);
    } catch (e) {
      if (e is ApiException && e.statusCode == 401) {
        if (!mounted) return;
        await handleUnauthorized(context);
        return;
      }
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openAddVehicleSheet() async {
    final result = await Navigator.pushNamed(context, '/add-vehicle');
    if (result == true) {
      _load();
    }
  }

  void _showBookServiceDialog(Vehicle vehicle) {
    if (!mounted) return;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    void openFlow(String category) {
      Navigator.pop(context);
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => BookServiceFlowPage(
            initialCategory: category,
            initialVehicleId: vehicle.id,
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
            _CategoryTile(
              icon: Icons.local_car_wash_outlined,
              title: 'Car Wash',
              subtitle: 'Premium cleaning services',
              color: Colors.blue,
              onTap: () => openFlow('Wash'),
            ),
            const SizedBox(height: 12),
            _CategoryTile(
              icon: Icons.settings_suggest_outlined,
              title: 'services',
              subtitle: 'General maintenance & repairs',
              color: AppColors.primaryBlue,
              onTap: () => openFlow('Periodic'),
            ),
            const SizedBox(height: 12),
            _CategoryTile(
              icon: Icons.shield_outlined,
              title: 'Essentials',
              subtitle: 'Essential services',
              color: Colors.purple,
              onTap: () => openFlow('Essentials'),
            ),
            const SizedBox(height: 12),
            _CategoryTile(
              icon: Icons.tire_repair_outlined,
              title: 'Tyres',
              subtitle: 'Replacement & maintenance',
              color: Colors.orange,
              onTap: () => openFlow('Tyres'),
            ),
            const SizedBox(height: 12),
            _CategoryTile(
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

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GlobalSyncRefresh(
      entities: SyncEntities.vehicles,
      onSync: _load,
      child: PopScope(
        canPop: Navigator.of(context).canPop(),
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          Navigator.of(
            context,
          ).pushNamedAndRemoveUntil('/customer', (route) => false);
        },
        child: Scaffold(
          backgroundColor: isDark
              ? AppColors.backgroundPrimary
              : AppColors.backgroundPrimaryLight,
          drawer: const CustomerDrawer(currentRouteName: '/vehicles'),
          appBar: AppBar(
            backgroundColor: Colors.transparent,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            centerTitle: true,
            leading: Builder(
              builder: (context) => Padding(
                padding: const EdgeInsets.all(8.0),
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isDark
                          ? Colors.white.withValues(alpha: 0.28)
                          : Colors.black.withValues(alpha: 0.16),
                      width: 1.0,
                    ),
                  ),
                  child: IconButton(
                    icon: Icon(
                      Icons.menu,
                      color: isDark ? Colors.white : Colors.black,
                    ),
                    onPressed: () => Scaffold.of(context).openDrawer(),
                  ),
                ),
              ),
            ),
            title: Text(
              'My Vehicles',
              style: TextStyle(
                color: isDark ? Colors.white : Colors.black,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          body: !context.watch<AuthProvider>().isAuthenticated
              ? const GuestLoginPrompt(
                  title: 'Your vehicles',
                  message: 'Log in to add vehicles and book doorstep service.',
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _loading && _vehicles.isEmpty
                      ? const Center(child: CircularProgressIndicator())
                      : _error != null
                      ? ListView(
                          padding: AppSpacing.edgeInsetsAllDefault,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(
                                top: AppSpacing.section,
                              ),
                              child: Column(
                                children: [
                                  Text(
                                    'Failed to load vehicles',
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                  AppSpacing.verticalSmall,
                                  Text(
                                    _error!,
                                    textAlign: TextAlign.center,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodySmall,
                                  ),
                                  AppSpacing.verticalMedium,
                                  OutlinedButton(
                                    onPressed: _load,
                                    child: const Text('Retry'),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : _vehicles.isEmpty
                      ? ListView(
                          padding: AppSpacing.edgeInsetsAllDefault,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(
                                top: AppSpacing.section,
                              ),
                              child: Column(
                                children: [
                                  Icon(
                                    Icons.directions_car_outlined,
                                    size: 64,
                                    color: AppColors.textSecondary.withValues(
                                      alpha: 0.5,
                                    ),
                                  ),
                                  AppSpacing.verticalMedium,
                                  Text(
                                    'Your garage is empty',
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                  AppSpacing.verticalSmall,
                                  Text(
                                    'Add your vehicles to get started with services.',
                                    textAlign: TextAlign.center,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodySmall,
                                  ),
                                  AppSpacing.verticalSection,
                                  ElevatedButton(
                                    onPressed: _openAddVehicleSheet,
                                    child: const Text('Add My First Vehicle'),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: AppSpacing.edgeInsetsAllDefault,
                          itemCount: _vehicles.length,
                          separatorBuilder: (context, _) =>
                              AppSpacing.verticalMedium,
                          itemBuilder: (context, index) {
                            final v = _vehicles[index];
                            return _VehicleCard(
                              vehicle: v,
                              onBookService: () => _showBookServiceDialog(v),
                            );
                          },
                        ),
                ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: _openAddVehicleSheet,
            icon: const Icon(Icons.add),
            label: const Text('Add Vehicle'),
          ),
        ),
      ),
    );
  }
}

class _CategoryTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _CategoryTile({
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

class _VehicleCard extends StatefulWidget {
  final Vehicle vehicle;
  final VoidCallback onBookService;

  const _VehicleCard({required this.vehicle, required this.onBookService});

  @override
  State<_VehicleCard> createState() => _VehicleCardState();
}

class _VehicleCardState extends State<_VehicleCard> {
  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    super.dispose();
  }

  Color _accentForType(String? type) {
    final t = type?.toLowerCase() ?? '';
    if (t.contains('bike')) return const Color(0xFF22D3EE);
    return const Color(0xFF2563EB);
  }

  String _typeLabel(String? type) {
    if (type == null || type.trim().isEmpty) return 'VEHICLE';
    final t = type.toLowerCase();
    if (t.contains('car')) return 'CAR';
    if (t.contains('bike')) return 'BIKE';
    return type.toUpperCase();
  }

  IconData _iconForType(String? type) {
    final t = type?.toLowerCase() ?? '';
    if (t.contains('bike')) return Icons.two_wheeler_outlined;
    return Icons.directions_car_filled_outlined;
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final v = widget.vehicle;
    final accent = _accentForType(v.type);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          Navigator.of(context).pushNamed('/vehicle-detail', arguments: v);
        },
        child: Container(
          padding: AppSpacing.edgeInsetsAllDefault,
          decoration: BoxDecoration(
            color: isDark
                ? AppColors.backgroundSecondary
                : AppColors.backgroundSecondaryLight,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isDark
                  ? AppColors.borderColor
                  : AppColors.borderColorLight,
            ),
            boxShadow: [
              BoxShadow(
                color: isDark
                    ? Colors.black.withValues(alpha: 0.4)
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
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      color: isDark
                          ? AppColors.backgroundSurface
                          : Colors.black.withValues(alpha: 0.03),
                      border: Border.all(
                        color: isDark
                            ? AppColors.borderColor
                            : AppColors.borderColorLight,
                      ),
                    ),
                    child: Icon(_iconForType(v.type), color: accent),
                  ),
                  AppSpacing.horizontalMedium,
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${v.make} ${v.model}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(
                                fontWeight: FontWeight.w900,
                                color: isDark
                                    ? AppColors.textPrimary
                                    : Colors.black,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(999),
                            color: isDark
                                ? Colors.white.withValues(alpha: 0.08)
                                : Colors.black.withValues(alpha: 0.05),
                          ),
                          child: Text(
                            _typeLabel(v.type),
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: isDark
                                      ? AppColors.textSecondary
                                      : AppColors.textSecondaryLight,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.6,
                                ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              AppSpacing.verticalMedium,
              Row(
                children: [
                  Icon(
                    Icons.tag,
                    size: 16,
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                  ),
                  AppSpacing.horizontalSmall,
                  Text(
                    v.licensePlate,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: isDark
                          ? AppColors.textSecondary
                          : AppColors.textSecondaryLight,
                    ),
                  ),
                  if (v.fuelType != null && v.fuelType!.trim().isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primaryBlue.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: AppColors.primaryBlue.withValues(alpha: 0.4),
                          width: 1,
                        ),
                      ),
                      child: Text(
                        v.fuelType!.toUpperCase(),
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.5,
                          color: isDark
                              ? AppColors.primaryBlue.withValues(alpha: 0.95)
                              : AppColors.primaryBlue,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              if (v.variant != null && v.variant!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  v.variant!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                  ),
                ),
              ],
              // Vahan facts saved at add time (skipped when empty) — parity with web.
              ...vehicleInfoRows(v)
                  .where(
                    (r) =>
                        r.value.trim().isNotEmpty &&
                        !const {
                          'Registration number',
                          'Make',
                          'Model',
                          'Fuel type',
                        }.contains(r.label),
                  )
                  .map(
                    (r) => Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 5,
                            child: Text(
                              r.label,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(
                                    color: isDark
                                        ? AppColors.textSecondary
                                        : AppColors.textSecondaryLight,
                                  ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 6,
                            child: Text(
                              r.expired ? '${r.value} (expired)' : r.value,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: r.expired
                                        ? Theme.of(context).colorScheme.error
                                        : null,
                                  ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              AppSpacing.verticalMedium,
              Row(
                children: [
                  const Spacer(),
                  Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: Container(
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [
                            AppColors.primaryBlue,
                            AppColors.primaryBlueDark,
                          ],
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: ElevatedButton(
                        onPressed: widget.onBookService,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          foregroundColor: AppColors.textPrimary,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          minimumSize: const Size(0, 0),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.add_task_outlined, size: 14),
                            SizedBox(width: 6),
                            Text(
                              'Book Service',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
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
      ),
    );
  }
}
