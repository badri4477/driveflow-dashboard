import 'package:flutter/material.dart';

import '../../core/app_colors.dart';

enum StateKind { error, empty, success, wrong }

/// Centered state screen for a page or section: error (with retry), empty,
/// success, or "something went wrong" (invalid/unexpected state). Matches
/// the look of NoInternetScreen.
class StateView extends StatelessWidget {
  final StateKind kind;
  final String? title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final IconData? icon;

  /// Fill the available height and stay scrollable — use inside a
  /// RefreshIndicator so pull-to-refresh still works on this state.
  final bool refreshable;

  const StateView({
    super.key,
    required this.kind,
    this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.icon,
    this.refreshable = false,
  });

  const StateView.error({
    super.key,
    this.title,
    this.message,
    VoidCallback? onRetry,
    this.refreshable = false,
  }) : kind = StateKind.error,
       actionLabel = 'Try Again',
       onAction = onRetry,
       icon = null;

  const StateView.empty({
    super.key,
    this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.icon,
    this.refreshable = false,
  }) : kind = StateKind.empty;

  const StateView.success({
    super.key,
    this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.refreshable = false,
  }) : kind = StateKind.success,
       icon = null;

  const StateView.wrong({
    super.key,
    this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.refreshable = false,
  }) : kind = StateKind.wrong,
       icon = null;

  static Color colorFor(StateKind kind) => switch (kind) {
    StateKind.error => AppColors.error,
    StateKind.empty => AppColors.primaryBlue,
    StateKind.success => AppColors.success,
    StateKind.wrong => AppColors.warning,
  };

  static IconData iconFor(StateKind kind) => switch (kind) {
    StateKind.error => Icons.error_outline_rounded,
    StateKind.empty => Icons.inbox_outlined,
    StateKind.success => Icons.check_circle_outline_rounded,
    StateKind.wrong => Icons.report_problem_outlined,
  };

  static String titleFor(StateKind kind) => switch (kind) {
    StateKind.error => 'Couldn’t load this',
    StateKind.empty => 'Nothing here yet',
    StateKind.success => 'Done',
    StateKind.wrong => 'Something went wrong',
  };

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final color = colorFor(kind);

    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color.withValues(alpha: 0.12),
            ),
            child: Icon(icon ?? iconFor(kind), color: color, size: 34),
          ),
          const SizedBox(height: 24),
          Text(
            title ?? titleFor(kind),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: isDark ? Colors.white : Colors.black87,
            ),
          ),
          if (message != null && message!.trim().isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14,
                height: 1.5,
                color: isDark ? Colors.white60 : Colors.black54,
              ),
            ),
          ],
          if (onAction != null) ...[
            const SizedBox(height: 28),
            ElevatedButton.icon(
              onPressed: onAction,
              icon: Icon(
                actionLabel == 'Try Again'
                    ? Icons.refresh_rounded
                    : Icons.check_rounded,
                size: 18,
              ),
              label: Text(actionLabel ?? 'Continue'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryBlue,
                foregroundColor: Colors.white,
                minimumSize: const Size(160, 48),
                padding: const EdgeInsets.symmetric(horizontal: 24),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ],
        ],
      ),
    );

    if (refreshable) {
      return LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(child: content),
          ),
        ),
      );
    }
    return Center(child: SingleChildScrollView(child: content));
  }
}
