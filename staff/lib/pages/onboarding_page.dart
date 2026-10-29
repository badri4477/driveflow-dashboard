import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_colors.dart';

class OnboardingPage extends StatefulWidget {
  final VoidCallback onComplete;

  const OnboardingPage({super.key, required this.onComplete});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingSlide {
  final String title;
  final String body;
  final Color accent;
  final Color glow;
  final String imageAsset;

  const _OnboardingSlide({
    required this.title,
    required this.body,
    required this.accent,
    required this.glow,
    required this.imageAsset,
  });
}

const _slides = [
  _OnboardingSlide(
    title: 'Pickup &\nDrop',
    body:
        'Collect the customer’s vehicle, take it to the workshop, and deliver it back after service.',
    accent: AppColors.primaryBlue,
    glow: AppColors.primaryBlueSoft,
    imageAsset: 'assets/onboarding_staff_pickup.png',
  ),
  _OnboardingSlide(
    title: 'Service\nthe Job',
    body:
        'Inspect, photograph, and update workshop jobs so every step of the service is recorded.',
    accent: AppColors.cinematicOrange,
    glow: Color(0xFFFF8A3D),
    imageAsset: 'assets/onboarding_staff_service.png',
  ),
  _OnboardingSlide(
    title: 'Share Live\nLocation',
    body:
        'When you tap Navigate on a job, share your live location so the team and customer can track the trip.',
    accent: AppColors.primaryPurple,
    glow: Color(0xFFA78BFA),
    imageAsset: 'assets/onboarding_staff_tracking.png',
  ),
];

class _OnboardingPageState extends State<OnboardingPage>
    with TickerProviderStateMixin {
  late final PageController _pageController;
  late final AnimationController _ambient;
  late final AnimationController _enter;
  int _index = 0;
  bool _completing = false;
  Timer? _autoplayTimer;
  static const _autoplayInterval = Duration(seconds: 3);

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _ambient = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 9000),
    )..repeat(reverse: true);
    _enter = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 520),
    )..forward();
    _scheduleAutoplay();
  }

  void _scheduleAutoplay() {
    _autoplayTimer?.cancel();
    if (_isLast) return;
    _autoplayTimer = Timer(_autoplayInterval, () {
      if (!mounted) return;
      _goTo(_index + 1);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = MediaQuery.disableAnimationsOf(context);
    if (reduce) {
      _ambient.stop();
      _ambient.value = 0.35;
    } else if (!_ambient.isAnimating) {
      _ambient.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _autoplayTimer?.cancel();
    _pageController.dispose();
    _ambient.dispose();
    _enter.dispose();
    super.dispose();
  }

  bool get _isLast => _index >= _slides.length - 1;

  void _replayEnter() {
    _enter
      ..reset()
      ..forward();
  }

  Future<void> _finish() async {
    if (_completing) return;
    _completing = true;
    _autoplayTimer?.cancel();
    HapticFeedback.mediumImpact();
    if (!mounted) return;
    widget.onComplete();
  }

  void _goTo(int index) {
    final reduce = MediaQuery.of(context).disableAnimations;
    _pageController.animateToPage(
      index,
      duration: Duration(milliseconds: reduce ? 1 : 480),
      curve: const Cubic(0.22, 1, 0.36, 1),
    );
  }

  void _onGetStarted() {
    HapticFeedback.selectionClick();
    _finish();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.of(context).disableAnimations;
    final bottom = MediaQuery.paddingOf(context).bottom;
    final slide = _slides[_index];

    return Scaffold(
      backgroundColor: AppColors.splashDeepBlack,
      body: AnimatedBuilder(
        animation: Listenable.merge([_pageController, _ambient, _enter]),
        builder: (context, _) {
          final pageValue =
              _pageController.hasClients && _pageController.page != null
              ? _pageController.page!
              : _index.toDouble();
          final t = reduce ? 0.35 : _ambient.value;
          return Stack(
            fit: StackFit.expand,
            children: [
              _AmbientBackdrop(page: pageValue, pulse: t),
              SafeArea(
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                      child: Row(
                        children: [
                          const SizedBox(width: 8),
                          Image.asset(
                            'assets/carzzilogo.png',
                            height: 22,
                            fit: BoxFit.contain,
                          ),
                          const Spacer(),
                          TextButton(
                            onPressed: _finish,
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.white54,
                              visualDensity: VisualDensity.compact,
                            ),
                            child: const Text(
                              'Skip',
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                letterSpacing: 0.2,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: PageView.builder(
                        controller: _pageController,
                        physics: const BouncingScrollPhysics(),
                        itemCount: _slides.length,
                        onPageChanged: (i) {
                          HapticFeedback.selectionClick();
                          setState(() => _index = i);
                          _replayEnter();
                          _scheduleAutoplay();
                        },
                        itemBuilder: (context, index) {
                          final delta = pageValue - index;
                          return _ParallaxStage(
                            delta: delta,
                            reduceMotion: reduce,
                            child: _OnboardingImage(
                              asset: _slides[index].imageAsset,
                              glow: _slides[index].glow,
                            ),
                          );
                        },
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.fromLTRB(24, 8, 24, 16 + bottom),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          FadeTransition(
                            opacity: CurvedAnimation(
                              parent: _enter,
                              curve: const Interval(
                                0.0,
                                0.7,
                                curve: Curves.easeOut,
                              ),
                            ),
                            child: SlideTransition(
                              position:
                                  Tween<Offset>(
                                    begin: const Offset(0, 0.12),
                                    end: Offset.zero,
                                  ).animate(
                                    CurvedAnimation(
                                      parent: _enter,
                                      curve: const Cubic(0.22, 1, 0.36, 1),
                                    ),
                                  ),
                              child: SizedBox(
                                height: 78,
                                child: Align(
                                  alignment: Alignment.bottomLeft,
                                  child: Text(
                                    slide.title,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 34,
                                      height: 1.05,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: -0.8,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          FadeTransition(
                            opacity: CurvedAnimation(
                              parent: _enter,
                              curve: const Interval(
                                0.18,
                                1.0,
                                curve: Curves.easeOut,
                              ),
                            ),
                            child: Text(
                              slide.body,
                              style: const TextStyle(
                                color: Color(0xFFB8B8B8),
                                fontSize: 16,
                                height: 1.45,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          const SizedBox(height: 28),
                          Row(
                            children: [
                              _PageIndicator(
                                count: _slides.length,
                                page: pageValue,
                                color: slide.accent,
                              ),
                              const Spacer(),
                            ],
                          ),
                          const SizedBox(height: 22),
                          SizedBox(
                            width: double.infinity,
                            height: 56,
                            child: ElevatedButton(
                              onPressed: _onGetStarted,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.cinematicOrange,
                                foregroundColor: Colors.white,
                                elevation: 4,
                                shadowColor: AppColors.cinematicOrange
                                    .withValues(alpha: 0.4),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16),
                                ),
                              ),
                              child: const Text(
                                'Get Started',
                                style: TextStyle(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 16,
                                  letterSpacing: 0.2,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 48),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ParallaxStage extends StatelessWidget {
  final double delta;
  final bool reduceMotion;
  final Widget child;

  const _ParallaxStage({
    required this.delta,
    required this.reduceMotion,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    if (reduceMotion) return child;
    final abs = delta.abs().clamp(0.0, 1.0);
    return Opacity(
      opacity: (1.0 - abs * 0.35).clamp(0.0, 1.0),
      child: Transform.translate(
        offset: Offset(delta * -28, 0),
        child: Transform.scale(scale: 1.0 - abs * 0.06, child: child),
      ),
    );
  }
}

class _OnboardingImage extends StatelessWidget {
  final String asset;
  final Color glow;

  const _OnboardingImage({required this.asset, required this.glow});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          boxShadow: [
            BoxShadow(
              color: glow.withValues(alpha: 0.22),
              blurRadius: 36,
              spreadRadius: 2,
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: SizedBox.expand(
            child: Image.asset(
              asset,
              fit: BoxFit.contain,
              alignment: Alignment.center,
              filterQuality: FilterQuality.medium,
              gaplessPlayback: true,
              errorBuilder: (_, _, _) => const ColoredBox(
                color: Color(0xFF161616),
                child: Center(
                  child: Icon(
                    Icons.directions_car_filled_rounded,
                    color: Colors.white24,
                    size: 72,
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

class _PageIndicator extends StatelessWidget {
  final int count;
  final double page;
  final Color color;

  const _PageIndicator({
    required this.count,
    required this.page,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(count, (i) {
        final dist = (page - i).abs().clamp(0.0, 1.0);
        final active = 1.0 - dist;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 280),
          curve: const Cubic(0.22, 1, 0.36, 1),
          margin: const EdgeInsets.only(right: 6),
          height: 7,
          width: 8 + (active * 20),
          decoration: BoxDecoration(
            color: Color.lerp(Colors.white24, color, active),
            borderRadius: BorderRadius.circular(99),
          ),
        );
      }),
    );
  }
}

class _AmbientBackdrop extends StatelessWidget {
  final double page;
  final double pulse;

  const _AmbientBackdrop({required this.page, required this.pulse});

  @override
  Widget build(BuildContext context) {
    final a = page.floor().clamp(0, _slides.length - 1);
    final b = page.ceil().clamp(0, _slides.length - 1);
    final t = (page - a).clamp(0.0, 1.0);
    final glow = Color.lerp(_slides[a].glow, _slides[b].glow, t)!;
    final accent = Color.lerp(_slides[a].accent, _slides[b].accent, t)!;
    final shift = (pulse - 0.5) * 40;

    return Stack(
      fit: StackFit.expand,
      children: [
        const ColoredBox(color: AppColors.splashDeepBlack),
        Align(
          alignment: Alignment(-0.9, -0.85),
          child: _GlowOrb(
            color: accent,
            size: 340,
            offset: Offset(-20 + shift, shift * 0.4),
          ),
        ),
        Align(
          alignment: const Alignment(1.1, 0.15),
          child: _GlowOrb(
            color: glow,
            size: 280,
            offset: Offset(10 - shift, -shift * 0.6),
          ),
        ),
        Align(
          alignment: const Alignment(0, 1.15),
          child: _GlowOrb(
            color: AppColors.cinematicOrange,
            size: 260,
            offset: Offset(shift * 0.3, 0),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.transparent,
                Color(0xCC0F0F0F),
                Color(0xFF0F0F0F),
              ],
              stops: [0.45, 0.78, 1.0],
            ),
          ),
        ),
      ],
    );
  }
}

class _GlowOrb extends StatelessWidget {
  final Color color;
  final double size;
  final Offset offset;

  const _GlowOrb({
    required this.color,
    required this.size,
    required this.offset,
  });

  @override
  Widget build(BuildContext context) {
    return Transform.translate(
      offset: offset,
      child: ImageFiltered(
        imageFilter: ImageFilter.blur(sigmaX: 48, sigmaY: 48),
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color.withValues(alpha: 0.22),
          ),
        ),
      ),
    );
  }
}
