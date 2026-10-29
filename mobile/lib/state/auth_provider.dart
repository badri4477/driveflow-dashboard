import 'dart:convert';
import 'package:flutter/material.dart';
import '../main.dart'; // import rootNavigatorKey
import '../core/api_client.dart';
import '../core/storage.dart';
import '../core/session_cache.dart';
import '../models/user.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';

import '../services/notification_service.dart';

class AuthProvider extends ChangeNotifier {
  final AuthService _auth = AuthService();
  User? user;
  bool loading = false;
  bool _isInitialized = false;
  String? lastError;

  /// HTTP status of the most recent failed auth call, when available —
  /// lets callers distinguish e.g. "account not found" (404) from other
  /// failures without parsing [lastError] text.
  int? lastErrorStatusCode;

  AuthProvider() {
    SocketService().addListener(_onSocketEvent);
  }

  @override
  void dispose() {
    SocketService().removeListener(_onSocketEvent);
    super.dispose();
  }

  void _onSocketEvent() {
    final event = SocketService().value;
    if (event == null) return;

    if (event.startsWith('role_updated:')) {
      try {
        final payloadStr = event.substring('role_updated:'.length);
        final data = jsonDecode(payloadStr) as Map<String, dynamic>;
        if (user != null) {
          final updatedUser = User.fromJson({
            ...user!.toJson(),
            'role': data['role'] ?? user!.role,
            'subRole': data['subRole'] ?? user!.subRole,
          });
          user = updatedUser;
          AppStorage().setUserJson(jsonEncode(updatedUser.toJson()));
          notifyListeners();

          // We used to force navigation here, but it was too abrupt and caused data loss
          // for users in the middle of a flow. Instead, we just update the user state
          // and let the next app restart or manual navigation handle the view change.
          // RootGate will also switch the background view if the user is at the root.

          if (rootNavigatorKey.currentContext != null) {
            final role = updatedUser.role?.toLowerCase() ?? 'user';
            ScaffoldMessenger.of(rootNavigatorKey.currentContext!).showSnackBar(
              SnackBar(
                content: Text('Your role has been updated to $role.'),
                duration: const Duration(seconds: 5),
                behavior: SnackBarBehavior.floating,
                action: SnackBarAction(
                  label: 'Refresh',
                  onPressed: () {
                    final h = homeRoute;
                    rootNavigatorKey.currentState?.pushNamedAndRemoveUntil(
                      h,
                      (route) => false,
                    );
                  },
                ),
              ),
            );
          }
        }
      } catch (e) {
        // Ignore
      }
    } else if (event.startsWith('sync:')) {
      // Reload profile when user/settings change; other screens listen per-entity.
      if (event.contains('sync:user') || event.contains('sync:setting')) {
        _refreshUserInBackground();
      }
      notifyListeners();
    }
  }

  bool get isAuthenticated => user != null;
  bool get isInitialized => _isInitialized;

  String _messageFromError(Object error) {
    if (error is ApiException) {
      return error.message;
    }
    final raw = error.toString();
    if (raw.startsWith('ApiException')) {
      return raw;
    }
    if (raw.startsWith('Exception: ')) {
      return raw.substring('Exception: '.length);
    }
    return raw;
  }

  String get homeRoute {
    final role = user?.role;
    if (role == 'merchant') return '/merchant';
    if (role == 'staff') return '/staff';
    if (role == 'admin') return '/admin';
    return '/customer';
  }

  Future<void> refreshUser() async {
    await _refreshUserInBackground();
  }

  Future<void> loadMe({bool force = false}) async {
    if (loading) return;
    if (_isInitialized && !force) {
      return;
    }

    lastError = null;

    try {
      final token = await AppStorage().getToken();
      if (token == null || token.isEmpty) {
        user = null;
        loading = false;
        _isInitialized = true;
        notifyListeners();
        return;
      }

      // 1. Try to load from local storage first
      final cachedUserJson = await AppStorage().getUserJson();
      if (cachedUserJson != null && cachedUserJson.isNotEmpty) {
        try {
          final decoded = jsonDecode(cachedUserJson);
          User? cachedUser;
          if (decoded is Map<String, dynamic>) {
            cachedUser = User.fromJson(decoded);
          } else if (decoded is Map) {
            cachedUser = User.fromJson(Map<String, dynamic>.from(decoded));
          }

          if (cachedUser != null) {
            user = cachedUser;
            _isInitialized = true;
            loading = false;
            notifyListeners();

            // Initialize socket service with cached session
            SocketService().init(user);

            // Start background refresh without awaiting it
            _refreshUserInBackground();
            return;
          }
        } catch (e) {
          // Silent catch
        }
      }

      // If we don't have a cached user, we must wait for the server
      loading = true;
      notifyListeners();
      await _refreshUserInBackground();
    } catch (e) {
      if (user == null) {
        lastError = _messageFromError(e);
      }
      // Log network errors even if we have a cached user
      if (e is ApiException && e.isNetworkError) {
        debugPrint('Network error during loadMe: $e');
      }
    } finally {
      loading = false;
      _isInitialized = true;
      notifyListeners();
    }
  }

  Future<void> _refreshUserInBackground() async {
    try {
      final fresh = await _auth.me();
      if (fresh != null) {
        final oldUserJson = user != null ? jsonEncode(user!.toJson()) : null;
        final newUserJson = jsonEncode(fresh.toJson());

        user = fresh;
        await AppStorage().setUserJson(newUserJson);

        // Only notify if the user data actually changed from the cached version
        if (oldUserJson != newUserJson) {
          notifyListeners();
        }
        SocketService().init(user);
      }
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        debugPrint(
          '[AuthProvider] Background /users/me returned 401 — '
          'clearing session.',
        );
        await AppStorage().clearToken();
        await AppStorage().clearUser();
        user = null;
        notifyListeners();
      }
    } catch (e) {
      debugPrint('[AuthProvider] Background refresh failed: $e');
    }
  }

  Future<void> _completeLoginSession(AuthResult res) async {
    if (res.token == null || res.token!.isEmpty) {
      throw Exception('Login failed: No token received');
    }
    user = res.user;
    if (user == null) {
      user = await _auth.me();
      if (user != null) {
        await AppStorage().setUserJson(jsonEncode(user!.toJson()));
      }
    }
    await AppStorage().clearHasSeenNoVehicleModal();
    await SessionCache.clearForNewSession();
    SocketService().init(user);
    NotificationService().syncToken();
  }

  /// Email-first login step — null on network/server error (caller should
  /// show a generic error and not navigate anywhere), true/false otherwise.
  Future<bool?> checkEmailExists(String email) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final exists = await _auth.checkEmailExists(email);
      loading = false;
      notifyListeners();
      return exists;
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return null;
    }
  }

  Future<String?> prepareLogin(String email, String password) async {
    await logout();

    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.prepareLogin(email: email, password: password);

      if (res['skipOtp'] == true) {
        final token = (res['accessToken'] ?? res['token'])?.toString();
        final user = _userFromAuthResponse(res);

        if (token != null && token.isNotEmpty) {
          await AppStorage().setToken(token);
        }
        if (user != null) {
          await AppStorage().setUserJson(jsonEncode(user.toJson()));
        }

        final authResult = AuthResult(token: token, user: user);
        await _completeLoginSession(authResult);

        loading = false;
        notifyListeners();
        return null;
      }

      loading = false;
      notifyListeners();
      return (res['mobile'] as String?) ?? '';
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return null;
    }
  }

  User? _userFromAuthResponse(Map<String, dynamic> res) {
    final userCandidate = res['user'];
    if (userCandidate is Map<String, dynamic>) {
      return User.fromJson(userCandidate);
    }
    if (userCandidate is Map) {
      return User.fromJson(Map<String, dynamic>.from(userCandidate));
    }

    if (res['_id'] != null || res['id'] != null) {
      return User.fromJson(res);
    }
    return null;
  }

  Future<void> _completeSkippedOtpSession(Map<String, dynamic> res) async {
    final token = (res['accessToken'] ?? res['token'])?.toString();
    if (token != null && token.isNotEmpty) {
      await AppStorage().setToken(token);
    }
    final skippedUser = _userFromAuthResponse(res);
    if (skippedUser != null) {
      await AppStorage().setUserJson(jsonEncode(skippedUser.toJson()));
    }
    await _completeLoginSession(AuthResult(token: token, user: skippedUser));
  }

  bool _isOtpSkipped(Map<String, dynamic> res) {
    final token = (res['accessToken'] ?? res['token'])?.toString();
    return res['skipOtp'] == true || (token != null && token.isNotEmpty);
  }

  Future<String?> sendLoginOtp(String email) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.sendLoginOtp(email: email);
      // APP_ENV=testing: backend skips OTP and returns a session (as web).
      if (_isOtpSkipped(res)) await _completeSkippedOtpSession(res);
      loading = false;
      notifyListeners();
      return (res['mobile'] as String?) ?? '';
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return null;
    }
  }

  Future<bool> verifyLoginOtp({
    required String email,
    required String otp,
  }) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.verifyLoginOtp(email: email, otp: otp);
      await _completeLoginSession(res);
      loading = false;
      notifyListeners();
      return true;
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return false;
    }
  }

  /// Passwordless mobile-number login — sends an OTP straight to the given
  /// phone (no password step). Returns the masked mobile on success.
  Future<String?> sendPhoneLoginOtp(String phone) async {
    await logout();

    loading = true;
    lastError = null;
    lastErrorStatusCode = null;
    notifyListeners();
    try {
      final res = await _auth.sendPhoneLoginOtp(phone: phone);
      // APP_ENV=testing: backend skips OTP and returns a session (as web).
      if (_isOtpSkipped(res)) await _completeSkippedOtpSession(res);
      loading = false;
      notifyListeners();
      return (res['mobile'] as String?) ?? '';
    } catch (e) {
      lastError = _messageFromError(e);
      lastErrorStatusCode = e is ApiException ? e.statusCode : null;
      loading = false;
      notifyListeners();
      return null;
    }
  }

  Future<bool> verifyPhoneLoginOtp({
    required String phone,
    required String otp,
  }) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.verifyPhoneLoginOtp(phone: phone, otp: otp);
      await _completeLoginSession(res);
      loading = false;
      notifyListeners();
      return true;
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> login(String email, String password) async {
    await logout();

    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.login(email, password);
      await _completeLoginSession(res);
      loading = false;
      notifyListeners();
      return true;
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<String?> sendSignupOtp({
    required String name,
    required String email,
    required String password,
    required String phone,
  }) async {
    await logout();

    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final prepared = await _auth.prepareSignup(
        name: name,
        email: email,
        password: password,
        phone: phone,
      );

      if (prepared['skipOtp'] == true) {
        final token = (prepared['accessToken'] ?? prepared['token'])
            ?.toString();
        final user = _userFromAuthResponse(prepared);
        if (token != null && token.isNotEmpty) {
          await AppStorage().setToken(token);
        }
        if (user != null) {
          await AppStorage().setUserJson(jsonEncode(user.toJson()));
        }
        final authResult = AuthResult(token: token, user: user);
        await _completeLoginSession(authResult);
        loading = false;
        notifyListeners();
        return null;
      }

      final res = await _auth.sendSignupOtp(phone: phone);
      loading = false;
      notifyListeners();
      return (res['mobile'] as String?) ??
          (prepared['mobile'] as String?) ??
          '';
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return null;
    }
  }

  Future<bool> verifySignupOtp({
    required String phone,
    required String otp,
  }) async {
    await logout();

    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.verifySignupOtp(phone: phone, otp: otp);
      if (res.token != null && res.token!.isNotEmpty) {
        user = res.user;
        if (user == null) {
          user = await _auth.me();
          if (user != null) {
            await AppStorage().setUserJson(jsonEncode(user!.toJson()));
          }
        }
        await AppStorage().clearHasSeenNoVehicleModal();
        await SessionCache.clearForNewSession();
        SocketService().init(user);
        NotificationService().syncToken();
        loading = false;
        notifyListeners();
        return true;
      }
      lastError = 'OTP verification failed';
    } catch (e) {
      lastError = _messageFromError(e);
    }
    loading = false;
    notifyListeners();
    return false;
  }

  /// Phone-first signup step 1 — sends an OTP to verify the mobile number
  /// on its own, before name/email/password exist. Returns the masked
  /// mobile on success.
  Future<String?> sendPhoneSignupOtp(String phone) async {
    loading = true;
    lastError = null;
    lastErrorStatusCode = null;
    notifyListeners();
    try {
      final res = await _auth.sendPhoneSignupOtp(phone);
      loading = false;
      notifyListeners();
      return (res['mobile'] as String?) ?? '';
    } catch (e) {
      lastError = _messageFromError(e);
      lastErrorStatusCode = e is ApiException ? e.statusCode : null;
      loading = false;
      notifyListeners();
      return null;
    }
  }

  /// Phone-first signup step 2 — verifies the OTP and creates the account
  /// in one call.
  Future<bool> completeSignup({
    required String name,
    required String email,
    required String password,
    required String phone,
    required String otp,
  }) async {
    await logout();

    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.completeSignup(
        name: name,
        email: email,
        password: password,
        phone: phone,
        otp: otp,
      );
      if (res.token != null && res.token!.isNotEmpty) {
        user = res.user;
        if (user == null) {
          user = await _auth.me();
          if (user != null) {
            await AppStorage().setUserJson(jsonEncode(user!.toJson()));
          }
        }
        await AppStorage().clearHasSeenNoVehicleModal();
        await SessionCache.clearForNewSession();
        SocketService().init(user);
        NotificationService().syncToken();
        loading = false;
        notifyListeners();
        return true;
      }
      lastError = 'Could not create account';
    } catch (e) {
      lastError = _messageFromError(e);
    }
    loading = false;
    notifyListeners();
    return false;
  }

  Future<bool> register(
    String name,
    String email,
    String password, {
    String? phone,
  }) async {
    // Clear old session before register
    await logout();

    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final res = await _auth.register(name, email, password, phone: phone);
      if (res.token != null && res.token!.isNotEmpty) {
        user = res.user;
        if (user == null) {
          user = await _auth.me();
          if (user != null) {
            await AppStorage().setUserJson(jsonEncode(user!.toJson()));
          }
        }
        await AppStorage().clearHasSeenNoVehicleModal();
        await SessionCache.clearForNewSession();
        SocketService().init(user);
        NotificationService().syncToken();
        loading = false;
        notifyListeners();
        return true;
      }
      lastError = 'Registration failed';
    } catch (e) {
      lastError = _messageFromError(e);
    }
    loading = false;
    notifyListeners();
    return false;
  }

  Future<void> logout() async {
    loading = true;
    notifyListeners();
    try {
      // 1. Clear state in providers
      SocketService().trackingProvider?.clear();
      SocketService().disconnect();

      // 2. Revoke the token server-side, then clear it locally. Must run
      // before wiping local storage — AuthService.logout() needs the
      // still-present token to authenticate the revocation call; it
      // clears storage itself once that's done (or failed).
      await _auth.logout();
      await SessionCache.clearForNewSession();

      // 3. Reset local state
      user = null;
      lastError = null;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Permanently deletes the account. Returns false (with [lastError] set)
  /// if the server call fails — the caller should keep the user signed in
  /// and let them retry, rather than acting as if deletion succeeded.
  Future<bool> deleteAccount() async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      await _auth.deleteAccount();

      SocketService().trackingProvider?.clear();
      SocketService().disconnect();
      await SessionCache.clearForNewSession();

      user = null;
      return true;
    } catch (e) {
      lastError = _messageFromError(e);
      return false;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> updateProfile({
    String? name,
    String? email,
    String? phone,
    List<SavedAddress>? addresses,
    List<PaymentMethod>? paymentMethods,
  }) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      final updatedUser = await _auth.updateProfile(
        name: name,
        email: email,
        phone: phone,
        addresses: addresses,
        paymentMethods: paymentMethods,
      );
      if (updatedUser != null) {
        user = updatedUser;
      }
    } catch (e) {
      lastError = _messageFromError(e);
      rethrow;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<bool> forgotPassword(String email) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      await _auth.forgotPassword(email);
      loading = false;
      notifyListeners();
      return true;
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> resetPassword({
    required String email,
    required String otp,
    required String password,
  }) async {
    loading = true;
    lastError = null;
    notifyListeners();
    try {
      await _auth.resetPassword(email: email, otp: otp, password: password);
      loading = false;
      notifyListeners();
      return true;
    } catch (e) {
      lastError = _messageFromError(e);
      loading = false;
      notifyListeners();
      return false;
    }
  }
}
