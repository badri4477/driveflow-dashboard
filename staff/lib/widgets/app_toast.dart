import 'states/status_feedback.dart';

/// App-wide feedback helper, callable from anywhere — including non-widget
/// code like [ApiClient]. Shows a coloured toast (see [StatusFeedback]).
class AppToast {
  AppToast._();

  static void showError(String message) => StatusFeedback.error(message);

  static void showSuccess(String message) => StatusFeedback.success(message);
}
