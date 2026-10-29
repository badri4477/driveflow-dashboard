import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/app_colors.dart';
import 'states/status_feedback.dart';

/// Bottom sheet asking where a photo should come from: the camera (Android/iOS
/// show the camera permission prompt on first use) or the gallery. Returns
/// null if dismissed. Use for every photo upload — bills, inspection, service.
Future<ImageSource?> chooseImageSource(BuildContext context) {
  return showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (context) {
      final isDark = Theme.of(context).brightness == Brightness.dark;
      Widget option(
        IconData icon,
        String title,
        String subtitle,
        ImageSource s,
      ) {
        return ListTile(
          minVerticalPadding: 12,
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primaryPurple.withValues(
                alpha: isDark ? 0.18 : 0.1,
              ),
            ),
            child: Icon(icon, color: AppColors.primaryPurple),
          ),
          title: Text(
            title,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text(subtitle),
          onTap: () => Navigator.pop(context, s),
        );
      }

      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              option(
                Icons.photo_camera_rounded,
                'Take photo',
                'Use the camera',
                ImageSource.camera,
              ),
              option(
                Icons.photo_library_rounded,
                'Choose from gallery',
                'Pick an existing photo',
                ImageSource.gallery,
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// `ImagePicker.pickImage` that never throws: if the camera/gallery can't
/// open (e.g. permission denied) it explains why and returns null.
Future<XFile?> pickImageSafely(
  ImagePicker picker, {
  required ImageSource source,
  double? maxWidth,
  double? maxHeight,
  int? imageQuality,
}) async {
  try {
    return await picker.pickImage(
      source: source,
      maxWidth: maxWidth,
      maxHeight: maxHeight,
      imageQuality: imageQuality,
    );
  } catch (_) {
    StatusFeedback.warning(
      source == ImageSource.camera
          ? 'Camera access is off. Allow camera permission for Carzzi Staff in Settings, or choose a photo from the gallery.'
          : 'Couldn’t open the gallery. Allow photo access in Settings and try again.',
      title: 'Permission needed',
    );
    return null;
  }
}
