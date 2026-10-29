import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/app_colors.dart';
import '../core/api_client.dart';
import '../models/booking.dart';
import '../services/booking_service.dart';
import '../core/socket_sync.dart';
import '../state/auth_provider.dart';
import '../widgets/customer_drawer.dart';
import '../widgets/global_sync_refresh.dart';
import '../widgets/guest_login_prompt.dart';
import '../utils/auth_gate.dart';

class MyPaymentsPage extends StatefulWidget {
  const MyPaymentsPage({super.key});

  @override
  State<MyPaymentsPage> createState() => _MyPaymentsPageState();
}

class _MyPaymentsPageState extends State<MyPaymentsPage> {
  final _service = BookingService();

  bool _loading = true;
  String? _error;
  List<Booking> _payments = const [];

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
      final items = await _service.listMyBookings();
      // Filter for bookings that have payment info or are paid. A cancelled
      // booking that was never actually paid is excluded — otherwise it
      // would still show up here as "Pending" with a "Pay Now" button.
      // A cancelled booking that *was* paid (e.g. later refunded) still
      // belongs in the payment history, so it's kept.
      final paidItems = items
          .where(
            (b) =>
                b.paymentStatus == 'paid' ||
                (b.status.toUpperCase() != 'CANCELLED' &&
                    (b.paymentStatus != 'pending' || b.totalAmount > 0)),
          )
          .toList();
      paidItems.sort((a, b) => b.date.compareTo(a.date));
      if (mounted) setState(() => _payments = paidItems);
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

  DateTime? _parseDate(String value) {
    try {
      return DateTime.parse(value).toLocal();
    } catch (_) {
      return null;
    }
  }

  String _formatDateTime(BuildContext context, String value) {
    final dt = _parseDate(value);
    if (dt == null) return value;
    final date = MaterialLocalizations.of(context).formatMediumDate(dt);
    return date;
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final routeName = ModalRoute.of(context)?.settings.name;
    return GlobalSyncRefresh(
      entities: SyncEntities.payments,
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
          backgroundColor: isDark ? Colors.black : Colors.white,
          drawer: CustomerDrawer(currentRouteName: routeName),
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
                    tooltip: 'Menu',
                    onPressed: () => Scaffold.of(context).openDrawer(),
                  ),
                ),
              ),
            ),
            title: Text(
              'My Payments',
              style: TextStyle(
                color: isDark ? Colors.white : Colors.black,
                fontWeight: FontWeight.w700,
              ),
            ),
            actions: const [],
          ),
          body: !context.watch<AuthProvider>().isAuthenticated
              ? const GuestLoginPrompt(
                  title: 'Your payments',
                  message: 'Log in to view invoices and payment history.',
                )
              : Stack(
                  children: [
                    if (isDark)
                      Container(color: Colors.black)
                    else
                      Container(color: Colors.white),
                    RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          if (_loading)
                            const Padding(
                              padding: EdgeInsets.only(top: 32),
                              child: Center(child: CircularProgressIndicator()),
                            )
                          else if (_error != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 24),
                              child: Column(
                                children: [
                                  Text(
                                    'Failed to load payments',
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    _error!,
                                    textAlign: TextAlign.center,
                                    style: Theme.of(context).textTheme.bodySmall
                                        ?.copyWith(color: Colors.white70),
                                  ),
                                  const SizedBox(height: 12),
                                  OutlinedButton(
                                    onPressed: _load,
                                    child: const Text('Retry'),
                                  ),
                                ],
                              ),
                            )
                          else if (_payments.isEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 24),
                              child: Center(
                                child: Text(
                                  'No payments found',
                                  style: Theme.of(context).textTheme.bodyMedium
                                      ?.copyWith(color: Colors.white),
                                ),
                              ),
                            )
                          else ...[
                            for (final b in _payments)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: _PaymentCard(
                                  booking: b,
                                  dateLabel: _formatDateTime(context, b.date),
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _PaymentCard extends StatefulWidget {
  final Booking booking;
  final String dateLabel;

  const _PaymentCard({required this.booking, required this.dateLabel});

  @override
  State<_PaymentCard> createState() => _PaymentCardState();
}

class _PaymentCardState extends State<_PaymentCard> {
  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    super.dispose();
  }

  IconData _iconForTitle(String title) {
    final v = title.toLowerCase();
    if (v.contains('wash') || v.contains('polish') || v.contains('detail')) {
      return Icons.local_car_wash_outlined;
    }
    if (v.contains('battery') || v.contains('tire') || v.contains('tyre')) {
      return Icons.battery_charging_full_outlined;
    }
    if (v.contains('engine') || v.contains('repair')) {
      return Icons.settings_suggest_outlined;
    }
    if (v.contains('insurance') || v.contains('essentials')) {
      return Icons.shield_outlined;
    }
    return Icons.payments_outlined;
  }

  // Same rule as web My Payments: final (post-discount/updated bill) amount
  // first, then billing total, then the booked total.
  num _displayAmount(Booking b) {
    final finalAmount = b.finalAmount;
    if (finalAmount != null && finalAmount > 0) return finalAmount;
    final billingTotal = b.billing?.total ?? 0;
    if (billingTotal > 0) return billingTotal;
    return b.totalAmount;
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isPaid = b.paymentStatus == 'paid';
    final isCancelled = b.status.toUpperCase() == 'CANCELLED';
    // Periodic/general services are billed after the service — inspection
    // can add parts, so the amount is only an estimate until then.
    final isAwaitingFinalBill =
        !isPaid &&
        !isCancelled &&
        !b.services.any(
          (s) => RegExp(
            r'battery|tire|tyre|wash|essentials',
          ).hasMatch((s.category ?? '').toLowerCase()),
        ) &&
        !const [
          'SERVICE_COMPLETED',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'COMPLETED',
        ].contains(b.status.toUpperCase());
    final statusText = isCancelled && !isPaid
        ? 'CANCELLED'
        : isAwaitingFinalBill
        ? 'DUE AFTER SERVICE'
        : (b.paymentStatus ?? 'pending').toUpperCase();
    final accent = isPaid
        ? const Color(0xFF22C55E)
        : (isCancelled ? const Color(0xFF9CA3AF) : const Color(0xFFF59E0B));
    final primaryService = b.services.isNotEmpty ? b.services.first : null;
    final title = primaryService?.name ?? 'Service';
    final category = primaryService?.category;

    return GestureDetector(
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
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    color: isDark
                        ? Colors.white.withValues(alpha: 0.04)
                        : Colors.black.withValues(alpha: 0.03),
                    border: Border.all(
                      color: isDark
                          ? AppColors.borderColor
                          : AppColors.borderColorLight,
                    ),
                  ),
                  child: Icon(
                    _iconForTitle(title),
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Booking #${b.orderNumber ?? b.id.toUpperCase()}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w900,
                          color: isDark ? AppColors.textPrimary : Colors.black,
                        ),
                      ),
                      if (category != null && category.trim().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(999),
                              color: isDark
                                  ? Colors.white.withValues(alpha: 0.08)
                                  : Colors.black.withValues(alpha: 0.05),
                            ),
                            child: Text(
                              category.toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
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
                        accent.withValues(alpha: 0.25),
                        Color.lerp(
                          accent,
                          Colors.white,
                          0.18,
                        )!.withValues(alpha: 0.32),
                      ],
                      begin: const Alignment(-1, 0),
                      end: const Alignment(1, 0),
                    ),
                  ),
                  child: Text(
                    statusText,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  Icons.schedule,
                  size: 16,
                  color: isDark
                      ? AppColors.textSecondary
                      : AppColors.textSecondaryLight,
                ),
                const SizedBox(width: 8),
                Text(
                  widget.dateLabel,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isDark
                        ? AppColors.textSecondary
                        : AppColors.textSecondaryLight,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Service for ${b.vehicle?.make ?? 'Vehicle'} ${b.vehicle?.licensePlate ?? ''}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w800,
                color: isDark
                    ? AppColors.textPrimary
                    : AppColors.textPrimaryLight,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Text(
                  '${isAwaitingFinalBill ? 'Est. ' : ''}₹${_displayAmount(b)}',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                    color: isDark
                        ? AppColors.textPrimary
                        : AppColors.textPrimaryLight,
                  ),
                ),
                const Spacer(),
                if (b.paymentStatus != 'paid' &&
                    b.totalAmount > 0 &&
                    !isCancelled &&
                    !isAwaitingFinalBill)
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
                        onPressed: () {
                          Navigator.pushNamed(
                            context,
                            '/track',
                            arguments: b.id,
                          );
                        },
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
                        child: const Text(
                          'Pay Now',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
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
    );
  }
}
