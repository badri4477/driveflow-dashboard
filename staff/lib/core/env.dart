import 'dart:io';

import 'package:flutter/foundation.dart';

class Env {
  static const bool useProduction = false;

  static const String mapTileUrlTemplate = String.fromEnvironment(
    'MAP_TILE_URL_TEMPLATE',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  static const List<String> mapTileSubdomains = <String>['a', 'b', 'c'];

  // Physical phone over USB: run `adb reverse tcp:5000 tcp:5000` so the
  // phone's localhost reaches this PC's backend. Set false for the emulator.
  static bool isPhysicalDevice = true;

  static String get localBaseUrl {
    const fromEnv = String.fromEnvironment('LOCAL_BASE_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (!kIsWeb && Platform.isAndroid && !isPhysicalDevice) {
      return 'http://10.0.2.2:5000';
    }
    return 'http://localhost:5000';
  }

  static String get productionBaseUrl {
    return 'https://api.carzzi.com';
  }

  static String get baseUrl {
    return useProduction ? productionBaseUrl : localBaseUrl;
  }

  static String get apiBaseUrl =>
      baseUrl.endsWith('/api') ? baseUrl : '$baseUrl/api';

  static String get userAgent =>
      'com.carzzi.staff/1.0.0 (Flutter; Android/iOS)';
}

class ApiEndpoints {
  static const String authLogin = '/auth/login';
  static const String authMerchantApply = '/auth/merchant/apply';
  static const String authLogout = '/auth/logout';
  static const String authLoginPrepare = '/auth/login/prepare';
  static const String authLoginSendOtp = '/auth/login/send-otp';
  static const String authLoginVerifyOtp = '/auth/login/verify-otp';
  static const String authPhoneLoginSendOtp = '/auth/login/phone/send-otp';
  static const String authPhoneLoginVerifyOtp = '/auth/login/phone/verify-otp';
  static const String authProfile = '/users/profile';
  static const String usersMe = '/users/me';
  static const String usersOnlineStatus = '/users/online-status';
  static const String bookings = '/bookings';
  static const String myBookings = '/bookings/mybookings';
  static const String trackingUser = '/tracking/user';
  static String bookingById(String id) => '/bookings/$id';
  static String bookingStatus(String id) => '/bookings/$id/status';
  static String bookingGenerateOtp(String id) => '/bookings/$id/generate-otp';
  static String bookingVerifyOtp(String id) => '/bookings/$id/verify-otp';
  static String bookingDetails(String id) => '/bookings/$id/details';
  static const String uploadMultiple = '/upload/multiple';

  // Services Endpoints
  static const String services = '/services';
  static String serviceById(String id) => '/services/$id';

  // Booking Car Wash Endpoints
  static const String carWashBookings = '/bookings/carwash';
  static String carWashBeforePhotos(String bookingId) =>
      '/bookings/$bookingId/carwash/before-photos';
  static String carWashAfterPhotos(String bookingId) =>
      '/bookings/$bookingId/carwash/after-photos';
  static String carWashStart(String bookingId) =>
      '/bookings/$bookingId/carwash/start';
  static String carWashComplete(String bookingId) =>
      '/bookings/$bookingId/carwash/complete';

  // Battery/Tire Endpoints
  static String batteryTireApproval(String id) =>
      '/bookings/$id/battery-tire-approval';
  static String addWarranty(String id) => '/bookings/$id/warranty';

  // Merchant Endpoints
  static const String products = '/products';
  static const String reviews = '/reviews';
  static const String merchantStats = '/bookings/merchant-stats';
}
