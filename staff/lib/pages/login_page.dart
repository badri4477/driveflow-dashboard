import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../core/api_client.dart';
import '../core/app_colors.dart';
import '../core/phone_input_formatter.dart';
import '../models/user.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';
import '../state/theme_provider.dart';
import '../utils/post_login_permissions.dart';

enum _LoginStep { identifier, password, emailOtp, phoneOtp }

class StaffLoginPage extends StatefulWidget {
  const StaffLoginPage({super.key});

  @override
  State<StaffLoginPage> createState() => _StaffLoginPageState();
}

class _StaffLoginPageState extends State<StaffLoginPage>
    with SingleTickerProviderStateMixin {
  final AuthService _authService = AuthService();
  final TextEditingController _identifierController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _otpController = TextEditingController();

  bool _isSubmitting = false;
  bool _showPassword = false;
  _LoginStep _step = _LoginStep.identifier;
  String? _maskedPhone;
  String? _errorText;
  late final AnimationController _animationController;
  late final Animation<double> _fadeAnimation;
  late final Animation<Offset> _slideAnimation;

  bool _isValidEmail(String value) {
    final v = value.trim();
    return RegExp(
      r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$",
    ).hasMatch(v);
  }

  bool _isValidPhone(String value) {
    return RegExp(r'^\d{10}$').hasMatch(value.trim());
  }

  @override
  void initState() {
    super.initState();
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
    _animationController.dispose();
    super.dispose();
  }

  void _clearError() {
    if (_errorText != null) setState(() => _errorText = null);
  }

  void _goToIdentifierStep() {
    setState(() {
      _step = _LoginStep.identifier;
      _passwordController.clear();
      _otpController.clear();
      _errorText = null;
    });
  }

  Future<void> _navigateAfterLogin(StaffUser user) async {
    await context.read<ThemeProvider>().applyAfterLogin();
    if (!mounted) return;
    final role = user.role.toLowerCase();
    if (role == 'merchant') {
      Navigator.of(context).pushReplacementNamed('/merchant-dashboard');
      await PostLoginPermissions.request();
    } else if (role == 'staff' || role == 'admin') {
      Navigator.of(context).pushReplacementNamed('/home');
      await PostLoginPermissions.request();
    } else {
      _authService.logout();
      setState(() {
        _errorText = 'Access denied. Staff or merchant account required.';
      });
    }
  }

  Future<void> _handleIdentifierNext() async {
    FocusScope.of(context).unfocus();
    final identifier = _identifierController.text.trim();

    if (identifier.isEmpty) {
      setState(() => _errorText = 'Email or mobile number is required');
      return;
    }

    if (_isValidPhone(identifier)) {
      setState(() {
        _isSubmitting = true;
        _errorText = null;
      });

      try {
        final result = await _authService.sendPhoneLoginOtp(phone: identifier);
        if (!mounted) return;
        if (result.user != null) {
          _navigateAfterLogin(result.user!);
          return;
        }
        final masked = result.maskedPhone ?? '';
        setState(() {
          _maskedPhone = masked.isNotEmpty ? masked : null;
          _otpController.clear();
          _step = _LoginStep.phoneOtp;
        });
      } on ApiException catch (e) {
        if (mounted) setState(() => _errorText = e.message);
      } catch (_) {
        if (mounted) {
          setState(() => _errorText = 'Failed to send OTP. Please try again.');
        }
      } finally {
        if (mounted) setState(() => _isSubmitting = false);
      }
      return;
    }

    if (!_isValidEmail(identifier)) {
      setState(
        () => _errorText =
            'Enter a valid email address or 10-digit mobile number',
      );
      return;
    }

    setState(() {
      _passwordController.clear();
      _step = _LoginStep.password;
      _errorText = null;
    });
  }

  Future<void> _handleCredentials() async {
    FocusScope.of(context).unfocus();
    final email = _identifierController.text.trim();
    final password = _passwordController.text;

    if (password.isEmpty) {
      setState(() => _errorText = 'Password is required');
      return;
    }
    if (password.length > 15) {
      setState(() => _errorText = 'Too long data not accept');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorText = null;
    });

    try {
      final result = await _authService.prepareLogin(
        email: email,
        password: password,
      );

      if (!mounted) return;

      if (result.user != null) {
        await SocketService().reconnect();
        _navigateAfterLogin(result.user!);
        return;
      }

      setState(() {
        _step = _LoginStep.emailOtp;
        _maskedPhone = result.maskedPhone;
        _otpController.clear();
      });

      final sent = await _authService.sendLoginOtp(email: email);
      if (!mounted) return;
      if (sent.user != null) {
        _navigateAfterLogin(sent.user!);
        return;
      }
      final masked = sent.maskedPhone ?? '';
      if (masked.isNotEmpty) {
        setState(() => _maskedPhone = masked);
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _errorText = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _errorText = 'Login failed. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _handleVerifyOtp() async {
    final identifier = _identifierController.text.trim();
    final otp = _otpController.text.trim();

    if (otp.length != 6) {
      setState(() => _errorText = 'Enter the 6-digit OTP');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorText = null;
    });

    try {
      final user = _step == _LoginStep.phoneOtp
          ? await _authService.verifyPhoneLoginOtp(phone: identifier, otp: otp)
          : await _authService.verifyLoginOtp(email: identifier, otp: otp);
      if (!mounted) return;
      await SocketService().reconnect();
      _navigateAfterLogin(user);
    } on ApiException catch (e) {
      if (mounted) setState(() => _errorText = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _errorText = 'OTP verification failed. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _handleResendOtp() async {
    final identifier = _identifierController.text.trim();
    setState(() {
      _isSubmitting = true;
      _errorText = null;
      _otpController.clear();
    });

    try {
      final sent = _step == _LoginStep.phoneOtp
          ? await _authService.sendPhoneLoginOtp(phone: identifier)
          : await _authService.sendLoginOtp(email: identifier);
      if (!mounted) return;
      if (sent.user != null) {
        _navigateAfterLogin(sent.user!);
        return;
      }
      final masked = sent.maskedPhone ?? '';
      if (masked.isNotEmpty) {
        setState(() => _maskedPhone = masked);
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _errorText = e.message);
    } catch (_) {
      if (mounted) setState(() => _errorText = 'Failed to resend OTP');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
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

  String get _headingText {
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isOtpStep =
        _step == _LoginStep.emailOtp || _step == _LoginStep.phoneOtp;

    return PopScope(
      canPop: false,
      child: Scaffold(
        resizeToAvoidBottomInset: true,
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
                  child: Center(
                    child: SingleChildScrollView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 24,
                        vertical: 16,
                      ),
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
                            const SizedBox(height: 20),
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
                            const SizedBox(height: 10),
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
                            Card(
                              color: AppColors.backgroundSecondary.withValues(
                                alpha: 0.9,
                              ),
                              elevation: 8,
                              shadowColor: Colors.black.withValues(alpha: 0.5),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(24),
                                side: BorderSide(
                                  color: Colors.white.withValues(alpha: 0.05),
                                ),
                              ),
                              child: Padding(
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
                                      _headingText,
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
                                        onChanged: _clearError,
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
                                            () =>
                                                _showPassword = !_showPassword,
                                          ),
                                          icon: Icon(
                                            _showPassword
                                                ? Icons.visibility_off
                                                : Icons.visibility,
                                            color: Colors.white38,
                                            size: 20,
                                          ),
                                        ),
                                        onChanged: _clearError,
                                        onSubmitted: (_) =>
                                            _handleCredentials(),
                                      ),
                                    ] else ...[
                                      _GlassField(
                                        controller: _otpController,
                                        hintText: '6-digit OTP',
                                        keyboardType: TextInputType.number,
                                        textInputAction: TextInputAction.done,
                                        prefixIcon: Icons.sms_outlined,
                                        maxLength: 6,
                                        onChanged: _clearError,
                                        onSubmitted: (_) => _handleVerifyOtp(),
                                      ),
                                    ],
                                    if (_errorText != null) ...[
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
                                                _errorText!,
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
                                    const SizedBox(height: 32),
                                    SizedBox(
                                      height: 56,
                                      child: ElevatedButton(
                                        onPressed: _isSubmitting
                                            ? null
                                            : _handlePrimaryAction,
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor:
                                              AppColors.cinematicOrange,
                                          foregroundColor: Colors.white,
                                          elevation: 4,
                                          shadowColor: AppColors.cinematicOrange
                                              .withValues(alpha: 0.4),
                                          shape: RoundedRectangleBorder(
                                            borderRadius: BorderRadius.circular(
                                              16,
                                            ),
                                          ),
                                          disabledBackgroundColor: AppColors
                                              .cinematicOrange
                                              .withValues(alpha: 0.6),
                                        ),
                                        child: _isSubmitting
                                            ? const SizedBox(
                                                width: 24,
                                                height: 24,
                                                child:
                                                    CircularProgressIndicator.adaptive(
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
                                            onPressed: _isSubmitting
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
                                            TextButton(
                                              onPressed: _isSubmitting
                                                  ? null
                                                  : _handleResendOtp,
                                              child: const Text(
                                                'Resend OTP',
                                                style: TextStyle(
                                                  color:
                                                      AppColors.cinematicOrange,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ),
                                        ],
                                      ),
                                    ],
                                    if (_step == _LoginStep.identifier) ...[
                                      const SizedBox(height: 20),
                                      Center(
                                        child: TextButton(
                                          onPressed: _isSubmitting
                                              ? null
                                              : () => Navigator.of(
                                                  context,
                                                ).pushNamed('/merchant-apply'),
                                          child: const Text(
                                            "Own a garage? Apply as a Partner",
                                            style: TextStyle(
                                              color: AppColors.cinematicOrange,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 13,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
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
  final VoidCallback? onChanged;
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
      style: const TextStyle(color: Colors.white),
      onChanged: (_) => onChanged?.call(),
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
