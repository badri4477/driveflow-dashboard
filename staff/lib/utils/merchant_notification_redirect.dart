/// Merchant notification navigation aligned with web [notificationUtils].
class MerchantNotificationRedirect {
  static String? routeFor({String? type, String? bookingId, String? orderId}) {
    final normalizedType = (type ?? '').toLowerCase();

    if (bookingId != null && bookingId.isNotEmpty) {
      return '/merchant-order-detail';
    }

    if (orderId != null && orderId.isNotEmpty) {
      return '/merchant-orders';
    }

    switch (normalizedType) {
      case 'payment':
        return '/merchant-orders';
      case 'nearby':
      case 'status':
      case 'otp':
        if (bookingId != null && bookingId.isNotEmpty) {
          return '/merchant-order-detail';
        }
        break;
    }

    return null;
  }

  static String? detailBookingId({
    String? type,
    String? bookingId,
    String? orderId,
  }) {
    if (bookingId != null && bookingId.isNotEmpty) return bookingId;
    if (orderId != null &&
        orderId.isNotEmpty &&
        routeFor(type: type, bookingId: bookingId, orderId: orderId) ==
            '/merchant-order-detail') {
      return orderId;
    }
    return null;
  }

  static bool isClickable({String? type, String? bookingId, String? orderId}) {
    return routeFor(type: type, bookingId: bookingId, orderId: orderId) != null;
  }
}
