import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'states/status_feedback.dart';

/// Opens a full-screen viewer: pinch / double-tap to zoom, swipe between
/// [images] (network URLs or local file paths), close with the X or back.
Future<void> showImageViewer(
  BuildContext context,
  List<String> images, {
  int initialIndex = 0,
}) {
  final list = images.where((e) => e.isNotEmpty).toList();
  if (list.isEmpty) return Future.value();
  return Navigator.of(context, rootNavigator: true).push(
    PageRouteBuilder<void>(
      opaque: false,
      barrierColor: Colors.black,
      transitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (_, _, _) => _ImageViewer(
        images: list,
        initialIndex: initialIndex.clamp(0, list.length - 1),
      ),
      transitionsBuilder: (context, animation, _, child) =>
          MediaQuery.disableAnimationsOf(context)
          ? child
          : FadeTransition(opacity: animation, child: child),
    ),
  );
}

/// Wraps a thumbnail so tapping it opens [showImageViewer]. Pass [gallery]
/// to let the user swipe through the whole set.
class ViewableImage extends StatelessWidget {
  final String url;
  final List<String>? gallery;
  final Widget child;

  const ViewableImage({
    super.key,
    required this.url,
    required this.child,
    this.gallery,
  });

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return child;
    return Semantics(
      button: true,
      label: 'View photo',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          final set = gallery ?? [url];
          final index = set.indexOf(url);
          showImageViewer(context, set, initialIndex: index < 0 ? 0 : index);
        },
        child: child,
      ),
    );
  }
}

class _ImageViewer extends StatefulWidget {
  final List<String> images;
  final int initialIndex;

  const _ImageViewer({required this.images, required this.initialIndex});

  @override
  State<_ImageViewer> createState() => _ImageViewerState();
}

class _ImageViewerState extends State<_ImageViewer> {
  late final PageController _pages = PageController(
    initialPage: widget.initialIndex,
  );
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  bool _isRemote(String s) => s.startsWith('http') || kIsWeb;

  Widget _image(String src) {
    Widget broken() => const Center(
      child: Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48),
    );
    if (_isRemote(src)) {
      return CachedNetworkImage(
        imageUrl: src,
        fit: BoxFit.contain,
        placeholder: (_, _) =>
            const Center(child: CircularProgressIndicator(color: Colors.white)),
        errorWidget: (_, _, _) => broken(),
      );
    }
    return Image.file(
      File(src),
      fit: BoxFit.contain,
      errorBuilder: (_, _, _) => broken(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PageView.builder(
            controller: _pages,
            itemCount: widget.images.length,
            onPageChanged: (i) => setState(() => _index = i),
            itemBuilder: (_, i) =>
                _ZoomablePage(child: _image(widget.images[i])),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Close',
                    iconSize: 28,
                    color: Colors.white,
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.black45,
                      minimumSize: const Size(48, 48),
                    ),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                  const Spacer(),
                  if (widget.images.length > 1)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black45,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${_index + 1} / ${widget.images.length}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                          fontFeatures: [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One page: pinch to zoom, double-tap toggles 2.5x / fit.
class _ZoomablePage extends StatefulWidget {
  final Widget child;

  const _ZoomablePage({required this.child});

  @override
  State<_ZoomablePage> createState() => _ZoomablePageState();
}

class _ZoomablePageState extends State<_ZoomablePage> {
  final TransformationController _controller = TransformationController();
  TapDownDetails? _doubleTap;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggleZoom() {
    if (_controller.value != Matrix4.identity()) {
      _controller.value = Matrix4.identity();
      return;
    }
    final p = _doubleTap?.localPosition ?? Offset.zero;
    const scale = 2.5;
    _controller.value = Matrix4.identity()
      ..translateByDouble(-p.dx * (scale - 1), -p.dy * (scale - 1), 0, 1)
      ..scaleByDouble(scale, scale, 1, 1);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onDoubleTapDown: (d) => _doubleTap = d,
      onDoubleTap: _toggleZoom,
      child: InteractiveViewer(
        transformationController: _controller,
        minScale: 1,
        maxScale: 5,
        child: SizedBox.expand(child: widget.child),
      ),
    );
  }
}

/// Opens an uploaded document without leaving the app: images (bills,
/// photos) in the zoomable viewer; anything else (e.g. a PDF uploaded from
/// the web) in an in-app browser sheet instead of the external browser.
Future<void> openDocumentInApp(BuildContext context, String url) async {
  final path = Uri.tryParse(url)?.path.toLowerCase() ?? url.toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.bmp'];
  final isImage =
      imageExts.any(path.endsWith) ||
      !path.contains('.') /* extensionless uploads are images */;
  if (isImage) {
    return showImageViewer(context, [url]);
  }
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  final ok = await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
  if (!ok) StatusFeedback.error('Could not open the document');
}
