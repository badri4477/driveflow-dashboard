import 'dart:async';

import 'package:flutter/material.dart';

/// Success dialog that counts down and then clears the stack to [route]
/// (same behaviour as web `redirectAfterCountdown`). "Stay here" cancels.
Future<void> showCountdownRedirect(
  BuildContext context, {
  required String title,
  required String message,
  required String route,
  String destinationLabel = 'home',
  int seconds = 3,
}) {
  final navigator = Navigator.of(context);
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _CountdownRedirectDialog(
      title: title,
      message: message,
      destinationLabel: destinationLabel,
      seconds: seconds,
      onGo: () => navigator.pushNamedAndRemoveUntil(route, (r) => false),
    ),
  );
}

class _CountdownRedirectDialog extends StatefulWidget {
  final String title;
  final String message;
  final String destinationLabel;
  final int seconds;
  final VoidCallback onGo;

  const _CountdownRedirectDialog({
    required this.title,
    required this.message,
    required this.destinationLabel,
    required this.seconds,
    required this.onGo,
  });

  @override
  State<_CountdownRedirectDialog> createState() =>
      _CountdownRedirectDialogState();
}

class _CountdownRedirectDialogState extends State<_CountdownRedirectDialog> {
  late int _left = widget.seconds;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      if (_left <= 1) {
        t.cancel();
        widget.onGo();
        return;
      }
      setState(() => _left -= 1);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: const Icon(Icons.check_circle, color: Color(0xFF16A34A), size: 40),
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(widget.message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          Text(
            'Going to ${widget.destinationLabel} in ${_left}s…',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () {
            _timer?.cancel();
            Navigator.of(context).pop();
          },
          child: const Text('Stay here'),
        ),
        FilledButton(
          onPressed: () {
            _timer?.cancel();
            widget.onGo();
          },
          child: const Text('Go now'),
        ),
      ],
    );
  }
}
