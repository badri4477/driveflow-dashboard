import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_colors.dart';

class PaymentStatusPage extends StatefulWidget {
  final bool success;
  final String title;
  final String message;
  final String? primaryButtonLabel;
  final String? primaryRoute;
  /// Arguments passed to [primaryRoute] (e.g. a booking id for /track).
  final Object? primaryArguments;
  final bool clearStackOnPrimary;
  final bool popOnPrimary;
  final VoidCallback? onPrimaryPressed;
  final String? secondaryButtonLabel;
  final String? secondaryRoute;
  final bool clearStackOnSecondary;
  final bool popOnSecondary;
  final VoidCallback? onSecondaryPressed;

  const PaymentStatusPage({
    super.key,
    required this.success,
    required this.title,
    required this.message,
    this.primaryButtonLabel,
    this.primaryRoute,
    this.primaryArguments,
    this.clearStackOnPrimary = false,
    this.popOnPrimary = false,
    this.onPrimaryPressed,
    this.secondaryButtonLabel,
    this.secondaryRoute,
    this.clearStackOnSecondary = false,
    this.popOnSecondary = false,
    this.onSecondaryPressed,
  });

  @override
  State<PaymentStatusPage> createState() => _PaymentStatusPageState();
}

class _PaymentStatusPageState extends State<PaymentStatusPage>
    with SingleTickerProviderStateMixin {
  static const _redirectDelay = Duration(seconds: 3);

  late final AnimationController _controller;
  late final Animation<double> _cardOpacity;
  late final Animation<Offset> _cardSlide;
  late final Animation<double> _heroScale;
  Timer? _redirectTimer;
  int _secondsLeft = _redirectDelay.inSeconds;

  void _triggerPrimary() {
    if (widget.popOnPrimary) {
      Navigator.of(context).pop();
      return;
    }
    if (widget.primaryRoute != null) {
      if (widget.clearStackOnPrimary) {
        final navigator = Navigator.of(
          context,
        );
        if (widget.primaryArguments != null) {
          // Detail page (e.g. /track): reset to Home underneath so Back works.
          navigator.pushNamedAndRemoveUntil('/customer', (route) => false);
          navigator.pushNamed(
            widget.primaryRoute!,
            arguments: widget.primaryArguments,
          );
        } else {
          navigator.pushNamedAndRemoveUntil(
            widget.primaryRoute!,
            (route) => false,
          );
        }
      } else {
        Navigator.of(context).pushReplacementNamed(
          widget.primaryRoute!,
          arguments: widget.primaryArguments,
        );
      }
      return;
    }
    widget.onPrimaryPressed?.call();
  }

  void _triggerSecondary() {
    if (widget.popOnSecondary) {
      Navigator.of(context).pop();
      return;
    }
    if (widget.secondaryRoute != null) {
      if (widget.clearStackOnSecondary) {
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil(widget.secondaryRoute!, (route) => false);
      } else {
        Navigator.of(context).pushReplacementNamed(widget.secondaryRoute!);
      }
      return;
    }
    widget.onSecondaryPressed?.call();
  }

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    )..forward();

    _cardOpacity = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.65, curve: Curves.easeOut),
    );
    _cardSlide = Tween<Offset>(
      begin: const Offset(0, 0.08),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Cubic(0.2, 0, 0, 1),
      ),
    );
    _heroScale = Tween<double>(
      begin: 0.72,
      end: 1,
    ).animate(
      CurvedAnimation(
        parent: _controller,
        curve: widget.success
            ? Curves.easeOutBack
            : const Cubic(0.2, 0, 0, 1),
      ),
    );

    if (widget.primaryRoute != null || widget.onPrimaryPressed != null) {
      _redirectTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) return;
        if (_secondsLeft <= 1) {
          timer.cancel();
          _triggerPrimary();
          return;
        }
        setState(() => _secondsLeft -= 1);
      });
    }
  }

  @override
  void dispose() {
    _redirectTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final success = widget.success;
    final iconColor = success ? Colors.greenAccent.shade400 : Colors.redAccent;

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: FadeTransition(
              opacity: _cardOpacity,
              child: SlideTransition(
                position: _cardSlide,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xFF111827),
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(color: Colors.white10),
                      boxShadow: const [
                        BoxShadow(
                          color: Colors.black45,
                          blurRadius: 28,
                          offset: Offset(0, 18),
                        ),
                      ],
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ScaleTransition(
                            scale: _heroScale,
                            child: TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0.94, end: 1.06),
                              duration: const Duration(milliseconds: 1100),
                              curve: Curves.easeInOut,
                              builder: (context, value, child) {
                                return Transform.scale(
                                  scale: value,
                                  child: child,
                                );
                              },
                              child: Container(
                                width: 112,
                                height: 112,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  gradient: RadialGradient(
                                    colors: [
                                      iconColor.withValues(alpha: 0.22),
                                      iconColor.withValues(alpha: 0.06),
                                    ],
                                  ),
                                  border: Border.all(
                                    color: iconColor.withValues(alpha: 0.35),
                                  ),
                                ),
                                child: Center(
                                  child: success
                                      ? const _SuccessGlyph()
                                      : const _FailureGlyph(),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 24),
                          Text(
                            widget.title,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            widget.message,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 15,
                              height: 1.45,
                            ),
                          ),
                          if (widget.onPrimaryPressed != null) ...[
                            const SizedBox(height: 16),
                            Text(
                              'Redirecting in ${_secondsLeft}s...',
                              style: TextStyle(
                                color: iconColor.withValues(alpha: 0.95),
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                          const SizedBox(height: 28),
                          if (widget.primaryButtonLabel != null &&
                              (widget.primaryRoute != null ||
                                  widget.onPrimaryPressed != null))
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: _triggerPrimary,
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppColors.primaryBlue,
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 14,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                ),
                                child: Text(widget.primaryButtonLabel!),
                              ),
                            ),
                          if (widget.secondaryButtonLabel != null &&
                              (widget.secondaryRoute != null ||
                                  widget.onSecondaryPressed != null)) ...[
                            const SizedBox(height: 12),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton(
                                onPressed: _triggerSecondary,
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.white,
                                  side: const BorderSide(
                                    color: Colors.white24,
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 14,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                ),
                                child: Text(widget.secondaryButtonLabel!),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SuccessGlyph extends StatelessWidget {
  const _SuccessGlyph();

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 800),
      curve: Curves.easeOutBack,
      builder: (context, value, child) {
        return Transform.scale(
          scale: value.clamp(0, 1),
          child: Opacity(
            opacity: value.clamp(0, 1),
            child: const Icon(
              Icons.check_rounded,
              size: 58,
              color: Colors.greenAccent,
            ),
          ),
        );
      },
    );
  }
}

class _FailureGlyph extends StatelessWidget {
  const _FailureGlyph();

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 520),
      curve: Curves.easeInOut,
      builder: (context, value, child) {
        final offset = value < 0.25
            ? -10 * (value / 0.25)
            : value < 0.5
                ? -10 + ((value - 0.25) / 0.25) * 20
                : value < 0.75
                    ? 10 - ((value - 0.5) / 0.25) * 16
                    : -6 + ((value - 0.75) / 0.25) * 6;
        return Transform.translate(
          offset: Offset(offset, 0),
          child: child,
        );
      },
      onEnd: () {},
      child: const Icon(
        Icons.close_rounded,
        size: 58,
        color: Colors.redAccent,
      ),
    );
  }
}
