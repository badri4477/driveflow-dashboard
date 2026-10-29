/// Helpers to decide when a screen should refresh from [SocketService] events.
class SocketSync {
  SocketSync._();

  static bool matches(
    String? event, {
    List<String> entities = const [],
    List<String> prefixes = const [],
    List<String> exact = const [],
  }) {
    if (event == null || event.isEmpty) return false;

    for (final value in exact) {
      if (event == value) return true;
    }
    for (final prefix in prefixes) {
      if (event.startsWith(prefix)) return true;
    }
    for (final entity in entities) {
      if (event.contains('sync:$entity')) return true;
    }
    return false;
  }

  static bool shouldRefreshBookings(String? event) => matches(
    event,
    entities: ['booking', 'approval', 'payment'],
    prefixes: [
      'booking_created',
      'booking_updated',
      'booking_cancelled',
      'notification',
    ],
  );

  static bool shouldRefreshProducts(String? event) =>
      matches(event, entities: ['product']);

  static bool shouldRefreshProfile(String? event) =>
      matches(event, entities: ['user'], prefixes: ['user_status_update']);

  static bool shouldRefreshServices(String? event) =>
      matches(event, entities: ['service']);

  static bool shouldRefreshVehicles(String? event) =>
      matches(event, entities: ['vehicle']);

  static bool shouldRefreshReviews(String? event) =>
      matches(event, entities: ['review']);
}

/// Entity groups for [GlobalSyncRefresh].
abstract final class SyncEntities {
  static const bookings = ['booking', 'approval', 'payment', 'notification'];
  static const products = ['product'];
  static const services = ['service'];
  static const vehicles = ['vehicle'];
  static const reviews = ['review'];
  static const profile = ['user'];
  static const merchantHub = [
    'booking',
    'approval',
    'payment',
    'notification',
    'user',
    'product',
    'service',
    'setting',
  ];
}
