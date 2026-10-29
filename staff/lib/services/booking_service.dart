import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

import '../core/api_client.dart';
import '../core/env.dart';
import '../models/booking.dart';
import '../utils/merchant_booking_filters.dart';

class BookingService {
  final ApiClient _api = ApiClient();

  List<BookingSummary> _parseBookingList(dynamic data) {
    final items = <BookingSummary>[];
    if (data is! List) {
      throw ApiException(statusCode: 500, message: 'Unexpected response type');
    }
    for (final e in data) {
      try {
        if (e is Map<String, dynamic>) {
          items.add(BookingSummary.fromJson(e));
        } else if (e is Map) {
          items.add(BookingSummary.fromJson(Map<String, dynamic>.from(e)));
        }
      } catch (err) {
        debugPrint('Error parsing booking summary: $err');
      }
    }
    return items;
  }

  /// Last merchant booking list, kept in memory so Home / Orders can show it
  /// instantly when reopened and refresh quietly in the background.
  static List<BookingSummary>? _merchantBookingsCache;
  static List<BookingSummary>? get cachedMerchantBookings =>
      _merchantBookingsCache == null
      ? null
      : List<BookingSummary>.of(_merchantBookingsCache!);

  /// Merchant bookings — same endpoint as web (`GET /bookings`).
  Future<List<BookingSummary>> getMerchantBookings() async {
    List<BookingSummary> list;
    try {
      final data = await _api.getAny(ApiEndpoints.bookings);
      list = _parseBookingList(data);
    } catch (_) {
      final data = await _api.getAny(ApiEndpoints.myBookings);
      list = _parseBookingList(data);
    }
    _merchantBookingsCache = list;
    return List<BookingSummary>.of(list);
  }

  Future<List<BookingSummary>> getMyBookings() async {
    final data = await _api.getAny(ApiEndpoints.myBookings);
    return _parseBookingList(data);
  }

  Future<List<BookingSummary>> getCarWashBookings() async {
    final data = await _api.getAny(ApiEndpoints.carWashBookings);
    final items = <BookingSummary>[];
    if (data is List) {
      for (final e in data) {
        try {
          if (e is Map<String, dynamic>) {
            items.add(BookingSummary.fromJson(e));
          } else if (e is Map) {
            items.add(BookingSummary.fromJson(Map<String, dynamic>.from(e)));
          }
        } catch (err) {
          debugPrint('Error parsing car wash booking summary: $err');
        }
      }
      return items;
    }
    throw ApiException(statusCode: 500, message: 'Unexpected response type');
  }

  Future<BookingDetail> getBookingById(String id) async {
    final data = await _api.getJson(ApiEndpoints.bookingById(id));
    return BookingDetail.fromJson(data);
  }

  Future<void> updateBookingStatus(String id, String status) async {
    await _api.putJson(
      ApiEndpoints.bookingStatus(id),
      body: {'status': status},
    );
  }

  Future<void> verifyDeliveryOtp(String id, String otp) async {
    await _api.postJson(ApiEndpoints.bookingVerifyOtp(id), body: {'otp': otp});
  }

  Future<void> generateDeliveryOtp(String id) async {
    await _api.postJson(ApiEndpoints.bookingGenerateOtp(id));
  }

  Future<void> updatePrePickupPhotos(String id, List<String> urls) async {
    await _api.putJson(
      ApiEndpoints.bookingDetails(id),
      body: {'prePickupPhotos': urls},
    );
  }

  Future<Map<String, dynamic>> getMerchantStats() async {
    final bookings = await getMerchantBookings();
    return computeMerchantStats(bookings);
  }

  Future<List<String>> uploadPrePickupPhotos(
    String id,
    List<XFile> files, {
    List<String> existing = const [],
  }) async {
    final uploaded = await _api.uploadFiles(ApiEndpoints.uploadMultiple, files);
    final newUrls = uploaded
        .map((e) => e is Map<String, dynamic> ? e['url']?.toString() : null)
        .whereType<String>()
        .toList();
    final allUrls = <String>[...existing, ...newUrls];
    await updatePrePickupPhotos(id, allUrls);
    return allUrls;
  }

  Future<void> updateBookingDetails(
    String id,
    Map<String, dynamic> data,
  ) async {
    await _api.putJson(ApiEndpoints.bookingDetails(id), body: data);
  }

  Future<List<String>> uploadFiles(List<XFile> files) async {
    final uploaded = await _api.uploadFiles(ApiEndpoints.uploadMultiple, files);
    return uploaded
        .map((e) => e is Map<String, dynamic> ? e['url']?.toString() : null)
        .whereType<String>()
        .toList();
  }

  Future<void> createApproval(Map<String, dynamic> data) async {
    await _api.postJson('/approvals', body: data);
  }

  Future<void> uploadCarWashBeforePhotos(
    String bookingId,
    List<String> urls,
  ) async {
    await _api.putJson(
      ApiEndpoints.carWashBeforePhotos(bookingId),
      body: {'photos': urls},
    );
  }

  Future<void> uploadCarWashAfterPhotos(
    String bookingId,
    List<String> urls,
  ) async {
    await _api.putJson(
      ApiEndpoints.carWashAfterPhotos(bookingId),
      body: {'photos': urls},
    );
  }

  Future<void> startCarWash(String bookingId) async {
    await _api.putJson(ApiEndpoints.carWashStart(bookingId));
  }

  Future<void> completeCarWash(String bookingId) async {
    await _api.putJson(ApiEndpoints.carWashComplete(bookingId));
  }

  Future<void> batteryTireApproval(
    String id, {
    required String status,
    num? price,
    String? image,
    String? notes,
  }) async {
    final body = <String, dynamic>{'status': status};
    if (price != null) body['price'] = price;
    if (image != null) body['image'] = image;
    if (notes != null) body['notes'] = notes;

    await _api.putJson(ApiEndpoints.batteryTireApproval(id), body: body);
  }

  Future<void> addWarranty(
    String id, {
    required String name,
    required num price,
    required int warrantyMonths,
    String? image,
  }) async {
    final body = <String, dynamic>{
      'name': name,
      'price': price,
      'warrantyMonths': warrantyMonths,
    };
    if (image != null) body['image'] = image;

    await _api.putJson(ApiEndpoints.addWarranty(id), body: body);
  }
}
