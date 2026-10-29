import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/app_colors.dart';
import '../core/storage.dart';
import '../services/auth_service.dart';
import '../state/theme_provider.dart';

class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage> with TickerProviderStateMixin {
  final AuthService _authService = AuthService();
  bool _navigated = false;

  late final AnimationController _enter;
  late final AnimationController _ambient;
  late final AnimationController _progress;

  @override
  void initState() {
    super.initState();
    _enter = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 720),
    );
    _ambient = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 4200),
    );
    _progress = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    );

    _enter.forward();
    _progress.forward();
    _ambient.repeat(reverse: true);
    _bootstrap();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = MediaQuery.disableAnimationsOf(context);
    if (reduce) {
      _enter.value = 1;
      _ambient.stop();
      _ambient.value = 0.4;
      _progress.value = 1;
    } else if (!_ambient.isAnimating) {
      _ambient.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _enter.dispose();
    _ambient.dispose();
    _progress.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    await AppStorage().ensureStorageMatchesInstall();

    final userFuture = _authService.getCurrentUser();
    await Future<void>.delayed(const Duration(milliseconds: 2000));

    if (!mounted || _navigated) return;

    final user = await userFuture;
    if (!mounted || _navigated) return;
    _navigated = true;

    if (user != null) {
      await context.read<ThemeProvider>().applyAfterLogin();
      if (!mounted) return;
      final role = user.role.toLowerCase();
      if (role == 'merchant') {
        Navigator.of(context).pushReplacementNamed('/merchant-dashboard');
      } else {
        Navigator.of(context).pushReplacementNamed('/home');
      }
      return;
    }

    Navigator.of(context).pushReplacementNamed('/onboarding');
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AppColors.splashDeepBlack,
        body: AnimatedBuilder(
          animation: Listenable.merge([_enter, _ambient, _progress]),
          builder: (context, _) {
            final pulse = _ambient.value;
            final enter = CurvedAnimation(
              parent: _enter,
              curve: const Cubic(0.22, 1, 0.36, 1),
            ).value;
            final tagline = CurvedAnimation(
              parent: _enter,
              curve: const Interval(0.38, 1, curve: Cubic(0.22, 1, 0.36, 1)),
            ).value;
            final float = math.sin(pulse * math.pi) * 6;

            return Stack(
              fit: StackFit.expand,
              children: [
                const ColoredBox(color: AppColors.splashDeepBlack),
                _Glow(
                  alignment: const Alignment(-1.05, -0.85),
                  color: AppColors.primaryBlue,
                  size: 340,
                  offset: Offset(-10 + pulse * 18, pulse * 12),
                ),
                _Glow(
                  alignment: const Alignment(1.1, 0.2),
                  color: AppColors.cinematicOrange,
                  size: 300,
                  offset: Offset(12 - pulse * 16, -pulse * 10),
                ),
                _Glow(
                  alignment: const Alignment(0, 1.2),
                  color: AppColors.primaryBlueSoft,
                  size: 260,
                  offset: Offset(0, pulse * 8),
                ),
                Center(
                  child: Opacity(
                    opacity: enter,
                    child: Transform.translate(
                      offset: Offset(0, (1 - enter) * 18 + float),
                      child: Transform.scale(
                        scale: 0.88 + (enter * 0.12),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Image.asset(
                              'assets/splashscreen.png',
                              width: 176,
                              fit: BoxFit.contain,
                            ),
                            const SizedBox(height: 18),
                            Opacity(
                              opacity: tagline,
                              child: Transform.translate(
                                offset: Offset(0, (1 - tagline) * 8),
                                child: const Text(
                                  'On the job, in sync.',
                                  style: TextStyle(
                                    color: Color(0xFFB8B8B8),
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.4,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                Positioned(
                  left: 48,
                  right: 48,
                  bottom: 36 + bottom,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: SizedBox(
                      height: 3,
                      child: LinearProgressIndicator(
                        value: _progress.value.clamp(0.0, 1.0),
                        backgroundColor: Colors.white.withValues(alpha: 0.08),
                        color: AppColors.cinematicOrange,
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  final Alignment alignment;
  final Color color;
  final double size;
  final Offset offset;

  const _Glow({
    required this.alignment,
    required this.color,
    required this.size,
    required this.offset,
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: Transform.translate(
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
      ),
    );
  }
}
