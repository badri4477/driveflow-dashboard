import '../models/booking.dart';

/// Active order statuses aligned with web merchant portal.
const merchantActiveStatuses = <String>[
  'CREATED',
  'ASSIGNED',
  'ACCEPTED',
  'REACHED_CUSTOMER',
  'VEHICLE_PICKED',
  'REACHED_MERCHANT',
  'SERVICE_STARTED',
  'SERVICE_COMPLETED',
  'OUT_FOR_DELIVERY',
];

const merchantCompletedStatuses = <String>['DELIVERED'];

bool isMerchantActiveBooking(BookingSummary booking) {
  return merchantActiveStatuses.contains(booking.status);
}

bool isMerchantCompletedBooking(BookingSummary booking) {
  return merchantCompletedStatuses.contains(booking.status);
}

bool isMerchantPendingBill(BookingSummary booking) {
  final payment = (booking.paymentStatus ?? '').toLowerCase();
  return payment == 'pending' && booking.status != 'CANCELLED';
}

List<BookingSummary> filterMerchantBookings(
  List<BookingSummary> bookings, {
  required String filter,
  String searchQuery = '',
}) {
  final query = searchQuery.trim().toLowerCase();

  return bookings.where((booking) {
    if (query.isNotEmpty) {
      final plate = (booking.licensePlate ?? '').toLowerCase();
      final model = (booking.vehicleModel ?? '').toLowerCase();
      final customer = (booking.customerName ?? '').toLowerCase();
      final vehicleBlob = (booking.vehicleName ?? '').toLowerCase();
      final matchesSearch =
          plate.contains(query) ||
          model.contains(query) ||
          customer.contains(query) ||
          vehicleBlob.contains(query);
      if (!matchesSearch) return false;
    }

    switch (filter) {
      case 'active':
        return isMerchantActiveBooking(booking);
      case 'completed':
        return isMerchantCompletedBooking(booking);
      case 'pending-bills':
        return isMerchantPendingBill(booking);
      default:
        return true;
    }
  }).toList();
}

Map<String, int> computeMerchantStats(List<BookingSummary> bookings) {
  return {
    'activeOrders': bookings.where(isMerchantActiveBooking).length,
    'completedOrders': bookings.where(isMerchantCompletedBooking).length,
    'pendingBills': bookings.where(isMerchantPendingBill).length,
  };
}
