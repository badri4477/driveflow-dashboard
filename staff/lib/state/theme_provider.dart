import 'package:flutter/material.dart';

import '../core/storage.dart';

class ThemeProvider extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.system;
  bool _isLoaded = false;
  bool _isAuthenticated = false;

  ThemeMode get mode => _mode;
  bool get isLoaded => _isLoaded;

  /// Login/onboarding stay on the branded dark theme. Signed-in users
  /// follow Light / Dark / System (default System).
  ThemeMode get appThemeMode => _isAuthenticated ? _mode : ThemeMode.dark;

  Future<void> loadThemeMode() async {
    if (_isLoaded) return;
    final storage = AppStorage();
    final stored = await storage.getThemeMode();
    _mode = _parseStoredMode(stored);
    final token = await storage.getToken();
    _isAuthenticated = token != null && token.isNotEmpty;
    _isLoaded = true;
    notifyListeners();
  }

  ThemeMode _parseStoredMode(String? stored) {
    if (stored == 'light') return ThemeMode.light;
    if (stored == 'dark') return ThemeMode.dark;
    return ThemeMode.system;
  }

  Future<void> applyAfterLogin() async {
    _isAuthenticated = true;
    final stored = await AppStorage().getThemeMode();
    if (stored == null || stored.isEmpty) {
      _mode = ThemeMode.system;
      await AppStorage().setThemeMode(ThemeMode.system.name);
    }
    notifyListeners();
  }

  void markUnauthenticated() {
    if (!_isAuthenticated) return;
    _isAuthenticated = false;
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    notifyListeners();
    AppStorage().setThemeMode(_mode.name);
  }
}
