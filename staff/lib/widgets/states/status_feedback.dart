import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../main.dart' show rootNavigatorKey;

/// App-wide feedback toast (floating SnackBar), callable from anywhere —
/// including non-widget code — via [rootNavigatorKey]. Colour and icon
/// follow the kind: success / error / warning / info. A new toast replaces
/// the current one.
class StatusFeedback {
  StatusFeedback._();

  static void success(String message, {String? title}) => _show(
    message,
    color: AppColors.success,
    icon: Icons.check_circle_outline_rounded,
  );

  static void error(String message, {String? title}) => _show(
    message,
    color: AppColors.error,
    icon: Icons.error_outline_rounded,
    duration: const Duration(seconds: 4),
  );

  static void warning(String message, {String? title}) => _show(
    message,
    color: AppColors.warning,
    icon: Icons.warning_amber_rounded,
    duration: const Duration(seconds: 4),
  );

  static void info(String message, {String? title}) => _show(
    message,
    color: AppColors.primaryBlue,
    icon: Icons.info_outline_rounded,
  );

  /// Picks success / error / warning from the message wording — used where
  /// the call site didn't say which kind it was.
  static void auto(String message) {
    final m = message.toLowerCase();
    if (RegExp(
      r'fail|error|could not|couldn.t|unable|denied|invalid|too large|not allowed',
    ).hasMatch(m)) {
      error(message);
    } else if (RegExp(
      r'please|required|select|enter|must|should|at least|first|missing|'
      r'maximum|minimum|only|already|cannot|can.t|no |not ',
    ).hasMatch(m)) {
      warning(message);
    } else {
      success(message);
    }
  }

  static void _show(
    String message, {
    required Color color,
    required IconData icon,
    Duration duration = const Duration(seconds: 3),
  }) {
    final context = rootNavigatorKey.currentContext;
    if (context == null) return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;

    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(icon, color: Colors.white, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(message, style: const TextStyle(color: Colors.white)),
            ),
          ],
        ),
        backgroundColor: color,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: duration,
      ),
    );
  }
}
