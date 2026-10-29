import 'dart:convert';
import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/env.dart';
import '../core/storage.dart';
import '../models/user.dart';
import 'notification_service.dart';
import 'socket_service.dart';

/// Result of login prepare — either OTP required or session ready (skipOtp / admin).
class LoginPrepareResult {
  final StaffUser? user;
  final String? maskedPhone;

  const LoginPrepareResult({this.user, this.maskedPhone});
}

class AuthService {
  final ApiClient _api = ApiClient();

  static const _allowedRoles = {'staff', 'admin', 'merchant'};

  void _assertAllowedRole(Map<String, dynamic> response) {
    final role = response['role']?.toString().toLowerCase() ?? '';
    if (!_allowedRoles.contains(role)) {
      throw ApiException(
        statusCode: 403,
        message: 'Access denied. Staff or merchant account required.',
      );
    }
  }

  Future<StaffUser> _completeSession(Map<String, dynamic> response) async {
    _assertAllowedRole(response);

    final token = (response['accessToken'] ?? response['token'])?.toString();
    if (token == null || token.isEmpty) {
      throw ApiException(statusCode: 500, message: 'Missing token in response');
    }

    final storage = AppStorage();
    await storage.setToken(token);
    await storage.setUserJson(jsonEncode(response));

    await SocketService().reconnect();
    NotificationService().syncToken();

    return StaffUser.fromJson(response);
  }

  /// Step 1 — verify email/password (same as web).
  Future<LoginPrepareResult> prepareLogin({
    required String email,
    required String password,
  }) async {
    final response = await _api.postJson(
      ApiEndpoints.authLoginPrepare,
      body: {'email': email.trim(), 'password': password},
    );

    if (response['skipOtp'] == true) {
      final user = await _completeSession(response);
      return LoginPrepareResult(user: user);
    }

    final masked = response['mobile']?.toString();
    if (masked == null || masked.isEmpty) {
      throw ApiException(
        statusCode: 500,
        message: 'Could not start OTP verification',
      );
    }

    return LoginPrepareResult(maskedPhone: masked);
  }

  /// Step 2 — send OTP to WhatsApp/SMS.
  Future<LoginPrepareResult> sendLoginOtp({required String email}) async {
    final response = await _api.postJson(
      ApiEndpoints.authLoginSendOtp,
      body: {'email': email.trim()},
    );

    return _otpOrSession(response);
  }

  /// Step 3 — verify OTP and complete login.
  Future<StaffUser> verifyLoginOtp({
    required String email,
    required String otp,
  }) async {
    final response = await _api.postJson(
      ApiEndpoints.authLoginVerifyOtp,
      body: {'email': email.trim(), 'otp': otp.trim()},
    );

    return _completeSession(response);
  }

  /// Passwordless mobile-number login — sends an OTP straight to the given
  /// phone (no password step).
  Future<LoginPrepareResult> sendPhoneLoginOtp({required String phone}) async {
    final response = await _api.postJson(
      ApiEndpoints.authPhoneLoginSendOtp,
      body: {'phone': phone.trim()},
    );

    return _otpOrSession(response);
  }

  /// Backend skips OTP when APP_ENV=testing (same as web): it returns
  /// `skipOtp`/a token and the session is completed immediately.
  Future<LoginPrepareResult> _otpOrSession(
    Map<String, dynamic> response,
  ) async {
    final hasToken =
        (response['accessToken'] ?? response['token'])?.toString().isNotEmpty ==
        true;
    if (response['skipOtp'] == true || hasToken) {
      return LoginPrepareResult(user: await _completeSession(response));
    }
    return LoginPrepareResult(maskedPhone: response['mobile']?.toString());
  }

  /// Verify the phone-login OTP and complete login.
  Future<StaffUser> verifyPhoneLoginOtp({
    required String phone,
    required String otp,
  }) async {
    final response = await _api.postJson(
      ApiEndpoints.authPhoneLoginVerifyOtp,
      body: {'phone': phone.trim(), 'otp': otp.trim()},
    );

    return _completeSession(response);
  }

  /// Legacy direct login (kept for compatibility; prefer prepare + OTP flow).
  Future<StaffUser> login({
    required String email,
    required String password,
  }) async {
    final response = await _api.postJson(
      ApiEndpoints.authLogin,
      body: {'email': email.trim(), 'password': password},
    );

    return _completeSession(response);
  }

  Future<void> _clearSession() async {
    final storage = AppStorage();
    await storage.clearToken();
    await storage.clearUser();
  }

  Future<StaffUser?> getCurrentUser({bool forceRefresh = false}) async {
    final storage = AppStorage();
    final token = await storage.getToken();
    if (token == null || token.isEmpty) {
      await _clearSession();
      return null;
    }

    if (!forceRefresh) {
      final json = await storage.getUserJson();
      if (json != null && json.isNotEmpty) {
        try {
          final map = jsonDecode(json) as Map<String, dynamic>;
          final user = StaffUser.fromJson(map);
          NotificationService().syncToken();
          return user;
        } catch (e) {
          debugPrint('AuthService: Error parsing cached user: $e');
        }
      }
    }

    try {
      final response = await _api.getJson(ApiEndpoints.usersMe);
      await storage.setUserJson(jsonEncode(response));
      final user = StaffUser.fromJson(response);
      NotificationService().syncToken();
      return user;
    } catch (e) {
      debugPrint('AuthService: Error fetching user from server: $e');
      if (e is ApiException && e.statusCode == 401) {
        await _clearSession();
      }
      return null;
    }
  }

  Future<void> logout() async {
    // Revoke the token server-side first (staff tokens don't expire on
    // their own — this is what actually ends the session). Must run
    // before clearing local storage, since it needs the still-present
    // token to authenticate. Best-effort: local logout proceeds regardless.
    try {
      await _api.postAny(ApiEndpoints.authLogout);
    } catch (_) {
      // Ignore — local logout must still proceed.
    }
    await _clearSession();
    await SocketService().reconnect();
  }

  Future<void> updateOnlineStatus(bool isOnline) async {
    await _api.putJson(
      ApiEndpoints.usersOnlineStatus,
      body: {'isOnline': isOnline},
    );
  }

  Future<void> updateProfile(Map<String, dynamic> data) async {
    final response = await _api.putJson(ApiEndpoints.authProfile, body: data);
    await AppStorage().setUserJson(jsonEncode(response));
  }

  /// Public self-service application for a garage/business to become a
  /// Carzzi merchant partner. No session is created — the account starts
  /// unapproved and only becomes usable once an admin approves it.
  /// Returns the server's confirmation message.
  Future<String> applyAsMerchant({
    required String businessName,
    required String email,
    required String password,
    required String phone,
    required String address,
  }) async {
    final response = await _api.postJson(
      ApiEndpoints.authMerchantApply,
      body: {
        'name': businessName.trim(),
        'email': email.trim(),
        'password': password,
        'phone': phone.trim(),
        'address': address.trim(),
      },
    );
    return response['message']?.toString() ??
        'Your application has been submitted.';
  }
}
