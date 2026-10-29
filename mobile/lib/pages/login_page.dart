import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/app_colors.dart';
import '../core/form_validation.dart';
import '../core/phone_input_formatter.dart';
import '../state/auth_provider.dart';
import '../utils/auth_gate.dart';

enum _LoginStep { identifier, password, emailOtp, phoneOtp }

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage>
    with SingleTickerProviderStateMixin {
  late final TextEditingController _identifierController;
  late final TextEditingController _passwordController;
  late final TextEditingController _otpController;
  bool _submitting = false;
  _LoginStep _step = _LoginStep.identifier;
  String? _maskedPhone;
  String? _error;
  bool _showPassword = false;
  static const _resendCooldownSeconds = 30;
  int _resendSecondsLeft = 0;
  Timer? _resendTimer;
  late final AnimationController _animationController;
  late final Animation<double> _fadeAnimation;
  late final Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _identifierController = TextEditingController();
    _passwordController = TextEditingController();
    _otpController = TextEditingController();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
    );
    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.1), end: Offset.zero).animate(
          CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
        );
    _animationController.forward();
  }

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    _otpController.dispose();
    _resendTimer?.cancel();
    _animationController.dispose();
    super.dispose();
  }

  void _clearError() {
    if (_error != null) setState(() => _error = null);
  }

  void _startResendCountdown() {
    _resendTimer?.cancel();
    setState(() => _resendSecondsLeft = _resendCooldownSeconds);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_resendSecondsLeft <= 1) {
        timer.cancel();
        setState(() => _resendSecondsLeft = 0);
      } else {
        setState(() => _resendSecondsLeft -= 1);
      }
    });
  }

  void _goToIdentifierStep() {
    _resendTimer?.cancel();
    setState(() {
      _step = _LoginStep.identifier;
      _passwordController.clear();
      _otpController.clear();
      _error = null;
      _resendSecondsLeft = 0;
    });
  }

  Future<void> _handleIdentifierNext() async {
    if (_submitting) return;

    HapticFeedback.mediumImpact();
    FocusScope.of(context).unfocus();
    final identifier = _identifierController.text.trim();

    final digits = FormValidation.digitsOnly(identifier);
    final isPhone = digits.length == 10 && digits == identifier.trim();
    final emailError = isPhone
        ? null
        : FormValidation.validateEmail(identifier, rawInput: identifier);

    if (isPhone) {
      setState(() {
        _submitting = true;
        _error = null;
      });

      final auth = context.read<AuthProvider>();
      final masked = await auth.sendPhoneLoginOtp(digits);
      if (!mounted) return;
      if (auth.isAuthenticated) {
        setState(() => _submitting = false);
        await completeAuthNavigation(context, auth.homeRoute);
        return;
      }

      if (masked == null) {
        if (auth.lastErrorStatusCode == 404) {
          // No account with this number yet — send the signup OTP for it
          // right away and take them to Create Account with the OTP field
          // already showing, instead of a dead-end error.
          final signupMasked = await auth.sendPhoneSignupOtp(digits);
          if (!mounted) return;
          setState(() => _submitting = false);
          Navigator.pushReplacementNamed(
            context,
            '/register',
            arguments: {
              'phone': digits,
              'maskedPhone': signupMasked,
              'otpAlreadySent': signupMasked != null,
            },
          );
        } else {
          setState(() {
            _submitting = false;
            _error = auth.lastError ?? 'Failed to send OTP';
          });
        }
        return;
      }

      setState(() {
        _submitting = false;
        _maskedPhone = masked;
        _otpController.clear();
        _step = _LoginStep.phoneOtp;
      });
      _startResendCountdown();
      return;
    }

    if (emailError != null) {
      setState(() {
        _error = 'Enter a valid email address or 10-digit mobile number';
      });
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    final auth = context.read<AuthProvider>();
    final exists = await auth.checkEmailExists(identifier);
    if (!mounted) return;

    if (exists == null) {
      setState(() {
        _submitting = false;
        _error = auth.lastError ?? 'Something went wrong. Please try again.';
      });
      return;
    }

    if (!exists) {
      setState(() => _submitting = false);
      // No account with this email yet — go straight to signup with it
      // prefilled instead of asking for a password that can't work.
      Navigator.pushReplacementNamed(
        context,
        '/register',
        arguments: {'email': identifier},
      );
      return;
    }

    setState(() {
      _submitting = false;
      _passwordController.clear();
      _step = _LoginStep.password;
      _error = null;
    });
  }

  Future<void> _handleCredentials() async {
    if (_submitting) return;

    HapticFeedback.mediumImpact();
    FocusScope.of(context).unfocus();
    final email = _identifierController.text.trim();
    final password = _passwordController.text;

    final passwordError = FormValidation.validateLoginPassword(password);
    if (passwordError != null) {
      setState(() => _error = passwordError);
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final auth = context.read<AuthProvider>();
      final masked = await auth.prepareLogin(email, password);
      if (!mounted) return;

      if (masked == null) {
        if (auth.lastError != null) {
          setState(
            () => _error = auth.lastError ?? 'Invalid email or password',
          );
        } else {
          await completeAuthNavigation(context, auth.homeRoute);
        }
        return;
      }

      setState(() {
        _step = _LoginStep.emailOtp;
        _maskedPhone = masked;
        _otpController.clear();
      });

      final sentMasked = await auth.sendLoginOtp(email);
      if (!mounted) return;
      if (auth.isAuthenticated) {
        await completeAuthNavigation(context, auth.homeRoute);
        return;
      }

      if (sentMasked != null) {
        setState(() => _maskedPhone = sentMasked);
        _startResendCountdown();
      } else {
        setState(() {
          _step = _LoginStep.password;
          _error = auth.lastError ?? 'Failed to send OTP';
        });
      }
    } catch (e, stackTrace) {
      debugPrint('Login prepare error: $e\n$stackTrace');
      if (mounted) setState(() => _error = 'An unexpected error occurred');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _handleVerifyOtp() async {
    if (_submitting) return;

    final otp = _otpController.text.trim();

    final otpError = FormValidation.validateOtp(otp);
    if (otpError != null) {
      setState(() => _error = otpError);
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final auth = context.read<AuthProvider>();
      final isPhone = _step == _LoginStep.phoneOtp;
      final ok = isPhone
          ? await auth.verifyPhoneLoginOtp(
              phone: FormValidation.digitsOnly(_identifierController.text),
              otp: otp,
            )
          : await auth.verifyLoginOtp(
              email: _identifierController.text.trim(),
              otp: otp,
            );
      if (!mounted) return;
      if (ok) {
        await Future.delayed(Duration.zero);
        if (!mounted) return;
        await completeAuthNavigation(context, auth.homeRoute);
      } else {
        setState(() => _error = auth.lastError ?? 'OTP verification failed');
      }
    } catch (e, stackTrace) {
      debugPrint('Login verify error: $e\n$stackTrace');
      if (mounted) setState(() => _error = 'An unexpected error occurred');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _handleResendOtp() async {
    setState(() {
      _submitting = true;
      _error = null;
      _otpController.clear();
    });

    try {
      final auth = context.read<AuthProvider>();
      final isPhone = _step == _LoginStep.phoneOtp;
      final masked = isPhone
          ? await auth.sendPhoneLoginOtp(
              FormValidation.digitsOnly(_identifierController.text),
            )
          : await auth.sendLoginOtp(_identifierController.text.trim());
      if (!mounted) return;
      if (auth.isAuthenticated) {
        await completeAuthNavigation(context, auth.homeRoute);
        return;
      }
      if (masked != null) {
        setState(() => _maskedPhone = masked);
        _startResendCountdown();
      } else {
        setState(() => _error = auth.lastError ?? 'Failed to resend OTP');
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String get _titleText {
    switch (_step) {
      case _LoginStep.identifier:
        return 'Login';
      case _LoginStep.password:
        return 'Enter Password';
      case _LoginStep.emailOtp:
      case _LoginStep.phoneOtp:
        return 'Verify OTP';
    }
  }

  void _handlePrimaryAction() {
    switch (_step) {
      case _LoginStep.identifier:
        _handleIdentifierNext();
        break;
      case _LoginStep.password:
        _handleCredentials();
        break;
      case _LoginStep.emailOtp:
      case _LoginStep.phoneOtp:
        _handleVerifyOtp();
        break;
    }
  }

  String get _primaryButtonLabel {
    switch (_step) {
      case _LoginStep.identifier:
        return 'Next';
      case _LoginStep.password:
        return 'Continue';
      case _LoginStep.emailOtp:
      case _LoginStep.phoneOtp:
        return 'Verify';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isOtpStep =
        _step == _LoginStep.emailOtp || _step == _LoginStep.phoneOtp;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white70,
        actions: [
          TextButton(
            onPressed: () => leaveAuthScreens(context),
            style: TextButton.styleFrom(foregroundColor: Colors.white70),
            child: const Text(
              'Skip',
              style: TextStyle(fontWeight: FontWeight.w700, letterSpacing: 0.2),
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [AppColors.splashDeepBlack, AppColors.splashDarkGray],
              ),
            ),
          ),
          Center(
            child: Container(
              width: 400,
              height: 400,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppColors.cinematicOrange.withValues(alpha: 0.15),
                    Colors.transparent,
                  ],
                  stops: const [0.0, 0.7],
                ),
              ),
            ),
          ),
          SafeArea(
            child: FadeTransition(
              opacity: _fadeAnimation,
              child: SlideTransition(
                position: _slideAnimation,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    return SingleChildScrollView(
                      // Lets the form scroll instead of overflowing when
                      // the keyboard shrinks the available height.
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: constraints.maxHeight,
                        ),
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 420),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Image.asset(
                                  'assets/appicon.png',
                                  width: 220,
                                  color: Colors.white,
                                  fit: BoxFit.contain,
                                ),
                                const SizedBox(height: 5),
                                Wrap(
                                  alignment: WrapAlignment.center,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: [
                                    ShaderMask(
                                      shaderCallback: (bounds) =>
                                          const LinearGradient(
                                            begin: Alignment.topCenter,
                                            end: Alignment.bottomCenter,
                                            colors: [
                                              Color(0xFFFFE082),
                                              Color(0xFFFFA000),
                                            ],
                                          ).createShader(bounds),
                                      child: Text(
                                        'Drive Smarter ',
                                        style: theme.textTheme.headlineSmall
                                            ?.copyWith(
                                              fontWeight: FontWeight.bold,
                                              fontFamily: 'serif',
                                              fontSize: 28,
                                              color: Colors.white,
                                            ),
                                      ),
                                    ),
                                    Text(
                                      'Manage Easier',
                                      style: theme.textTheme.headlineSmall
                                          ?.copyWith(
                                            fontWeight: FontWeight.bold,
                                            fontFamily: 'serif',
                                            fontSize: 28,
                                            color: Colors.white,
                                          ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 20),
                                Container(
                                  height: 1.5,
                                  width: double.infinity,
                                  margin: const EdgeInsets.symmetric(
                                    horizontal: 40,
                                  ),
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        Colors.transparent,
                                        const Color(
                                          0xFFFFB74D,
                                        ).withValues(alpha: 0.5),
                                        const Color(0xFFFFB74D),
                                        const Color(
                                          0xFFFFB74D,
                                        ).withValues(alpha: 0.5),
                                        Colors.transparent,
                                      ],
                                      stops: const [0.0, 0.3, 0.5, 0.7, 1.0],
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 30),
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                    24,
                                    32,
                                    24,
                                    24,
                                  ),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      Text(
                                        _titleText,
                                        key: const Key('login_title'),
                                        textAlign: TextAlign.center,
                                        style: theme.textTheme.headlineSmall
                                            ?.copyWith(
                                              color: Colors.white,
                                              fontWeight: FontWeight.bold,
                                              letterSpacing: 0.5,
                                            ),
                                      ),
                                      if (_step == _LoginStep.password) ...[
                                        const SizedBox(height: 8),
                                        Text(
                                          _identifierController.text.trim(),
                                          textAlign: TextAlign.center,
                                          style: const TextStyle(
                                            color: Colors.white60,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ],
                                      if (isOtpStep) ...[
                                        const SizedBox(height: 8),
                                        Text(
                                          'Code sent to ${_maskedPhone ?? 'your WhatsApp'}',
                                          textAlign: TextAlign.center,
                                          style: const TextStyle(
                                            color: Colors.white60,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ],
                                      const SizedBox(height: 32),
                                      if (_step == _LoginStep.identifier) ...[
                                        _GlassField(
                                          controller: _identifierController,
                                          hintText: 'Email or mobile number',
                                          keyboardType:
                                              TextInputType.emailAddress,
                                          textInputAction: TextInputAction.done,
                                          prefixIcon: Icons.person_outline,
                                          onChanged: (_) => _clearError(),
                                          onSubmitted: (_) =>
                                              _handleIdentifierNext(),
                                          extraInputFormatters: [
                                            IndianPhoneOrEmailInputFormatter(),
                                          ],
                                        ),
                                      ] else if (_step ==
                                          _LoginStep.password) ...[
                                        _GlassField(
                                          controller: _passwordController,
                                          hintText: 'Password',
                                          obscureText: !_showPassword,
                                          textInputAction: TextInputAction.done,
                                          prefixIcon: Icons.lock_outline,
                                          maxLength: 15,
                                          suffix: IconButton(
                                            onPressed: () => setState(
                                              () => _showPassword =
                                                  !_showPassword,
                                            ),
                                            icon: Icon(
                                              _showPassword
                                                  ? Icons.visibility
                                                  : Icons.visibility_off,
                                              color: Colors.white38,
                                              size: 20,
                                            ),
                                          ),
                                          onChanged: (_) => _clearError(),
                                          onSubmitted: (_) =>
                                              _handleCredentials(),
                                        ),
                                        const SizedBox(height: 10),
                                        Align(
                                          alignment: Alignment.centerRight,
                                          child: TextButton(
                                            key: const Key(
                                              'forgot_password_button',
                                            ),
                                            onPressed: () =>
                                                Navigator.pushNamed(
                                                  context,
                                                  '/forgot-password',
                                                ),
                                            child: const Text(
                                              'Forgot Password?',
                                              style: TextStyle(
                                                color:
                                                    AppColors.cinematicOrange,
                                                fontSize: 13,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ] else ...[
                                        _GlassField(
                                          controller: _otpController,
                                          hintText: '6-digit OTP',
                                          keyboardType: TextInputType.number,
                                          textInputAction: TextInputAction.done,
                                          prefixIcon: Icons.sms_outlined,
                                          maxLength: 6,
                                          onChanged: (_) => _clearError(),
                                          onSubmitted: (_) =>
                                              _handleVerifyOtp(),
                                        ),
                                      ],
                                      if (_error != null) ...[
                                        const SizedBox(height: 16),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 12,
                                            vertical: 8,
                                          ),
                                          decoration: BoxDecoration(
                                            color: AppColors.error.withValues(
                                              alpha: 0.1,
                                            ),
                                            borderRadius: BorderRadius.circular(
                                              8,
                                            ),
                                          ),
                                          child: Row(
                                            children: [
                                              const Icon(
                                                Icons.error_outline,
                                                color: AppColors.error,
                                                size: 18,
                                              ),
                                              const SizedBox(width: 8),
                                              Expanded(
                                                child: Text(
                                                  _error!,
                                                  style: const TextStyle(
                                                    color: AppColors.error,
                                                    fontSize: 13,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                      const SizedBox(height: 24),
                                      SizedBox(
                                        height: 56,
                                        child: ElevatedButton(
                                          onPressed: _submitting
                                              ? null
                                              : _handlePrimaryAction,
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor:
                                                AppColors.cinematicOrange,
                                            foregroundColor: Colors.white,
                                            elevation: 4,
                                            shadowColor: AppColors
                                                .cinematicOrange
                                                .withValues(alpha: 0.4),
                                            shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(16),
                                            ),
                                            disabledBackgroundColor: AppColors
                                                .cinematicOrange
                                                .withValues(alpha: 0.6),
                                          ),
                                          child: _submitting
                                              ? const SizedBox(
                                                  width: 24,
                                                  height: 24,
                                                  child: CircularProgressIndicator.adaptive(
                                                    strokeWidth: 2.5,
                                                    valueColor:
                                                        AlwaysStoppedAnimation<
                                                          Color
                                                        >(Colors.white),
                                                  ),
                                                )
                                              : Text(
                                                  _primaryButtonLabel,
                                                  style: const TextStyle(
                                                    fontSize: 16,
                                                    fontWeight: FontWeight.bold,
                                                    letterSpacing: 1,
                                                  ),
                                                ),
                                        ),
                                      ),
                                      if (_step != _LoginStep.identifier) ...[
                                        const SizedBox(height: 12),
                                        Row(
                                          mainAxisAlignment: isOtpStep
                                              ? MainAxisAlignment.spaceBetween
                                              : MainAxisAlignment.start,
                                          children: [
                                            TextButton(
                                              onPressed: _submitting
                                                  ? null
                                                  : _goToIdentifierStep,
                                              child: const Text(
                                                'Back',
                                                style: TextStyle(
                                                  color: Colors.white60,
                                                ),
                                              ),
                                            ),
                                            if (isOtpStep)
                                              _resendSecondsLeft > 0
                                                  ? Padding(
                                                      padding:
                                                          const EdgeInsets.all(
                                                            8,
                                                          ),
                                                      child: Text(
                                                        'Resend OTP in ${_resendSecondsLeft}s',
                                                        style: const TextStyle(
                                                          color: Colors.white38,
                                                          fontWeight:
                                                              FontWeight.w600,
                                                        ),
                                                      ),
                                                    )
                                                  : TextButton(
                                                      onPressed: _submitting
                                                          ? null
                                                          : _handleResendOtp,
                                                      child: const Text(
                                                        'Resend OTP',
                                                        style: TextStyle(
                                                          color: AppColors
                                                              .cinematicOrange,
                                                          fontWeight:
                                                              FontWeight.bold,
                                                        ),
                                                      ),
                                                    ),
                                          ],
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GlassField extends StatelessWidget {
  final TextEditingController controller;
  final String hintText;
  final IconData prefixIcon;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Widget? suffix;
  final int? maxLength;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final List<TextInputFormatter> extraInputFormatters;

  const _GlassField({
    required this.controller,
    required this.hintText,
    required this.prefixIcon,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.suffix,
    this.maxLength,
    this.onChanged,
    this.onSubmitted,
    this.extraInputFormatters = const [],
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      maxLength: maxLength,
      // Collapses the counter row entirely instead of just hiding its text
      // (counterText: '' alone still reserves that blank line of space).
      buildCounter:
          (context, {required currentLength, required isFocused, maxLength}) =>
              null,
      style: const TextStyle(color: Colors.white),
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      inputFormatters: [
        if (keyboardType == TextInputType.number)
          FilteringTextInputFormatter.digitsOnly,
        ...extraInputFormatters,
      ],
      decoration: InputDecoration(
        hintText: hintText,
        hintStyle: const TextStyle(color: Colors.white38, fontSize: 14),
        prefixIcon: Icon(
          prefixIcon,
          color: AppColors.cinematicOrange,
          size: 20,
        ),
        suffixIcon: suffix,
        counterText: '',
        filled: true,
        fillColor: Colors.white.withValues(alpha: 0.03),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(
            color: AppColors.cinematicOrange,
            width: 1.5,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.error, width: 1.5),
        ),
      ),
    );
  }
}
