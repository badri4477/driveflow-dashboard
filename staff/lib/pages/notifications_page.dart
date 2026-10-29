import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/api_client.dart';
import '../core/app_colors.dart';
import '../services/notification_service.dart';
import '../utils/merchant_notification_redirect.dart';
import '../widgets/states/status_feedback.dart';
import '../widgets/states/skeleton.dart';
import '../widgets/states/state_view.dart';

class NotificationsPage extends StatefulWidget {
  final bool isMerchant;

  const NotificationsPage({super.key, this.isMerchant = false});

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  final NotificationService _notificationService = NotificationService();
  bool _loading = true;
  String? _loadError;
  List<NotificationItem> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final items = await _notificationService.listMyNotifications();
      if (!mounted) return;
      setState(() => _items = items);
    } on ApiException catch (e) {
      if (!mounted) return;
      final pending =
          e.statusCode == 403 && e.message.toLowerCase().contains('pending');
      setState(() {
        _loadError = pending
            ? 'Your account is pending approval. Please wait for admin approval.'
            : e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadError =
            'Failed to load notifications. Check your connection and try again.';
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleDelete(NotificationItem item) async {
    final originalItems = List<NotificationItem>.from(_items);
    setState(() {
      _items.removeWhere((n) => n.id == item.id);
    });

    try {
      await _notificationService.deleteNotification(item.id);
      if (!mounted) return;
      StatusFeedback.auto('Notification deleted');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _items = originalItems;
      });
      StatusFeedback.error('Failed to delete notification: $e');
    }
  }

  Future<void> _openNotification(NotificationItem item) async {
    try {
      if (!item.isRead) {
        await _notificationService.markAsRead(item.id);
        setState(() {
          final index = _items.indexWhere((n) => n.id == item.id);
          if (index >= 0) {
            _items[index] = NotificationItem(
              id: item.id,
              title: item.title,
              message: item.message,
              type: item.type,
              isRead: true,
              createdAt: item.createdAt,
              bookingId: item.bookingId,
              orderId: item.orderId,
            );
          }
        });
      }
    } catch (_) {}

    if (!mounted) return;

    if (widget.isMerchant) {
      final route = MerchantNotificationRedirect.routeFor(
        type: item.type,
        bookingId: item.bookingId,
        orderId: item.orderId,
      );
      if (route == null) return;

      if (route == '/merchant-orders') {
        Navigator.pushNamed(context, route);
        return;
      }

      final bookingId = MerchantNotificationRedirect.detailBookingId(
        type: item.type,
        bookingId: item.bookingId,
        orderId: item.orderId,
      );
      if (bookingId != null) {
        Navigator.pushNamed(
          context,
          '/merchant-order-detail',
          arguments: bookingId,
        );
      }
      return;
    }

    final orderId = item.orderId ?? item.bookingId;
    if (orderId == null || orderId.isEmpty) return;
    Navigator.pushNamed(context, '/order', arguments: orderId);
  }

  Future<void> _markAllAsRead() async {
    final unread = _items.where((n) => !n.isRead).length;
    if (unread == 0) return;
    try {
      await _notificationService.markAllAsRead(_items);
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      StatusFeedback.auto('All notifications marked as read');
    } catch (_) {
      if (!mounted) return;
      StatusFeedback.auto('Failed to mark all as read');
    }
  }

  Future<void> _clearAllNotifications() async {
    if (_items.isEmpty) return;
    final shouldClear =
        await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Clear all notifications?'),
            content: const Text('This will remove all notifications.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Clear All'),
              ),
            ],
          ),
        ) ??
        false;

    if (!shouldClear) return;
    try {
      await _notificationService.clearAll();
      if (!mounted) return;
      setState(() => _items = []);
      StatusFeedback.auto('All notifications cleared');
    } catch (_) {
      if (!mounted) return;
      StatusFeedback.auto('Failed to clear notifications');
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final hasUnread = _items.any((n) => !n.isRead);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          IconButton(
            tooltip: 'Mark all as read',
            onPressed: hasUnread ? _markAllAsRead : null,
            icon: Icon(
              Icons.done_all_rounded,
              color: hasUnread
                  ? (isDark ? Colors.white70 : const Color(0xFF4B5563))
                  : (isDark ? Colors.white24 : const Color(0xFFD1D5DB)),
            ),
          ),
          IconButton(
            tooltip: 'Clear all',
            onPressed: _items.isEmpty ? null : _clearAllNotifications,
            icon: Icon(
              Icons.delete_outline_rounded,
              color: _items.isEmpty
                  ? (isDark ? Colors.white24 : const Color(0xFFD1D5DB))
                  : AppColors.primaryBlue,
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: _loading
          ? const SkeletonList()
          : _loadError != null && _items.isEmpty
          ? RefreshIndicator(
              onRefresh: _load,
              child: StateView.error(
                message: _loadError,
                onRetry: _load,
                refreshable: true,
              ),
            )
          : _items.isEmpty
          ? RefreshIndicator(
              onRefresh: _load,
              child: const StateView.empty(
                title: 'No notifications yet',
                message: 'Booking updates and alerts will show up here.',
                icon: Icons.notifications_none_rounded,
                refreshable: true,
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                itemCount: _items.length,
                separatorBuilder: (_, index) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final item = _items[index];
                  final clickable = widget.isMerchant
                      ? MerchantNotificationRedirect.isClickable(
                          type: item.type,
                          bookingId: item.bookingId,
                          orderId: item.orderId,
                        )
                      : (item.orderId ?? item.bookingId)?.isNotEmpty == true;
                  return Dismissible(
                    key: Key('notif_${item.id}'),
                    direction: DismissDirection.horizontal,
                    background: Container(
                      alignment: Alignment.centerLeft,
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      decoration: BoxDecoration(
                        color: Colors.redAccent.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(
                        Icons.delete_outline,
                        color: Colors.redAccent,
                      ),
                    ),
                    secondaryBackground: Container(
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      decoration: BoxDecoration(
                        color: Colors.redAccent.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(
                        Icons.delete_outline,
                        color: Colors.redAccent,
                      ),
                    ),
                    onDismissed: (direction) => _handleDelete(item),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(14),
                      onTap: clickable ? () => _openNotification(item) : null,
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: isDark
                              ? AppColors.backgroundSecondary
                              : Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: item.isRead
                                ? (isDark
                                      ? AppColors.borderColor
                                      : const Color(0xFFE5E7EB))
                                : (isDark
                                      ? AppColors.primaryPurple.withValues(
                                          alpha: 0.5,
                                        )
                                      : const Color(0xFFC7D2FE)),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              margin: const EdgeInsets.only(top: 6),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: item.isRead
                                    ? (isDark
                                          ? Colors.grey[600]
                                          : Colors.grey[400])
                                    : AppColors.primaryPurple,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.title.isEmpty
                                        ? 'Notification'
                                        : item.title,
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      color: isDark
                                          ? Colors.white
                                          : Colors.black87,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    item.message,
                                    style: TextStyle(
                                      color: isDark
                                          ? Colors.grey[300]
                                          : const Color(0xFF374151),
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    DateFormat(
                                      'dd MMM, hh:mm a',
                                    ).format(item.createdAt),
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: isDark
                                          ? Colors.grey[500]
                                          : const Color(0xFF6B7280),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (clickable)
                              Icon(
                                Icons.chevron_right_rounded,
                                color: isDark
                                    ? Colors.grey[500]
                                    : Colors.grey[400],
                              ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}
