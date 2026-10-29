import 'package:flutter/material.dart';

class AppSpacing {
  /// 8px - Small gap
  static const double small = 8.0;

  /// 12px - Medium gap
  static const double medium = 12.0;

  /// 16px - Default padding
  static const double defaultPadding = 16.0;

  /// 24px - Section spacing
  static const double section = 24.0;

  // Helper widgets for common spacing
  static const SizedBox verticalSmall = SizedBox(height: small);
  static const SizedBox verticalMedium = SizedBox(height: medium);
  static const SizedBox verticalDefault = SizedBox(height: defaultPadding);
  static const SizedBox verticalSection = SizedBox(height: section);

  static const SizedBox horizontalSmall = SizedBox(width: small);
  static const SizedBox horizontalMedium = SizedBox(width: medium);
  static const SizedBox horizontalDefault = SizedBox(width: defaultPadding);
  static const SizedBox horizontalSection = SizedBox(width: section);

  // Common EdgeInsets
  static const EdgeInsets edgeInsetsAllSmall = EdgeInsets.all(small);
  static const EdgeInsets edgeInsetsAllMedium = EdgeInsets.all(medium);
  static const EdgeInsets edgeInsetsAllDefault = EdgeInsets.all(defaultPadding);
  static const EdgeInsets edgeInsetsAllSection = EdgeInsets.all(section);

  static const EdgeInsets edgeInsetsHorizontalDefault = EdgeInsets.symmetric(
    horizontal: defaultPadding,
  );
  static const EdgeInsets edgeInsetsVerticalDefault = EdgeInsets.symmetric(
    vertical: defaultPadding,
  );
}
