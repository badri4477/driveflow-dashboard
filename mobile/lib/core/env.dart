import 'dart:io';

import 'package:flutter/foundation.dart';

class Env {
  static const bool useProduction = true;
  // MUST stay false for testing with rzp_test keys

  static bool isPhysicalDevice = true;

  static String get localBaseUrl {
    const fromEnv = String.fromEnvironment('LOCAL_BASE_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (!kIsWeb && Platform.isAndroid) {
      if (isPhysicalDevice) {
        return 'http://localhost:5001'; // Redirects via adb reverse tcp:5000 tcp:5000
      }
      return 'http://10.0.2.2:5001';
    }
    return 'http://localhost:5001';
  }

  static String get productionBaseUrl {
    return 'https://api.carzzi.com';
  }

  static String get baseUrl {
    return useProduction ? productionBaseUrl : localBaseUrl;
  }

  static String get apiBaseUrl =>
      baseUrl.endsWith('/api') ? baseUrl : '$baseUrl/api';

  static String get userAgent => 'com.carzzi.user/1.0.0 (Flutter; Android/iOS)';
}

class ApiEndpoints {
  static const String authForgotPassword = '/auth/forgot-password';
  static const String authResetPassword = '/auth/reset-password';
  static const String authRegister = '/auth/register';
  static const String authSignupPrepare = '/auth/signup/prepare';
  static const String authSignupSendOtp = '/auth/signup/send-otp';
  static const String authSignupVerifyOtp = '/auth/signup/verify-otp';
  static const String authSignupPhoneSendOtp = '/auth/signup/phone/send-otp';
  static const String authSignupComplete = '/auth/signup/complete';
  static const String authLogin = '/auth/login';
  static const String authLogout = '/auth/logout';
  static const String authLoginCheckEmail = '/auth/login/check-email';
  static const String authLoginPrepare = '/auth/login/prepare';
  static const String authLoginSendOtp = '/auth/login/send-otp';
  static const String authLoginVerifyOtp = '/auth/login/verify-otp';
  static const String authPhoneLoginSendOtp = '/auth/login/phone/send-otp';
  static const String authPhoneLoginVerifyOtp = '/auth/login/phone/verify-otp';
  static const String usersMe = '/users/me';
  static const String usersProfile = '/users/profile';
  static const String notificationsRegisterToken = '/users/device-token';
  static const String services = '/services';
  static const String vehicles = '/vehicles';
  static String vehicleById(String id) => '/vehicles/$id';
  static String bookingsForVehicle(String vehicleId) =>
      '/bookings/vehicle/$vehicleId';
  static const String fetchVehicleDetails = '/vehicles/fetch-details';
  static const String vahanStatus = '/vehicles/vahan/status';
  static const String vahanLookup = '/vehicles/vahan/lookup';
  static const String vehicleReference = '/vehicle-reference';
  static const String vehicleReferenceSearch = '/vehicle-reference/search';
  static const String vehicleReferenceColumns = '/vehicle-reference/columns';
  static const String vehicleReferenceBuiltinColumns =
      '/vehicle-reference/builtin-columns';
  static const String bookings = '/bookings';
  static const String myBookings = '/bookings/mybookings';
  static const String bookingsAvailableSlots = '/bookings/available-slots';
  static const String bookingsAvailableServicePincodes =
      '/bookings/available-service-pincodes';
  static String bookingById(String id) => '/bookings/$id';
  static const String paymentsCreateOrder = '/payments/create-order';
  static const String paymentsVerifyPayment = '/payments/verify';
  static const String paymentsDummyPay = '/payments/dummy-pay';
  static const String approvalsMyApprovals = '/approvals/my-approvals';
  static String approvalById(String id) => '/approvals/$id';
  static const String tickets = '/tickets';
  static const String hero = '/hero';
  static String ticketById(String id) => '/tickets/$id';
  static String ticketMessages(String id) => '/tickets/$id/messages';
}
