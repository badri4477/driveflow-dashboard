import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:io' show Platform;
import 'dart:async';
import 'dart:ui';
// import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'pages/splash_page.dart';
import 'pages/onboarding_page.dart';
import 'pages/login_page.dart';
import 'pages/register_page.dart';
import 'pages/legal_webview_page.dart';
import 'pages/forgot_password_page.dart';
import 'pages/reset_password_page.dart';
import 'pages/payment_status_page.dart';
import 'pages/track_booking_page.dart';
import 'pages/my_payments_page.dart';
import 'pages/support_page.dart';
import 'pages/notifications_page.dart';
import 'pages/main_navigation_page.dart';
import 'pages/my_vehicles_page.dart';
import 'pages/vehicle_detail_page.dart';
import 'models/vehicle.dart';
import 'pages/add_vehicle_page.dart';
import 'pages/my_bookings_page.dart';
import 'pages/profile_page.dart';
import 'pages/coupons_page.dart';
import 'pages/speshway_vehiclecare_dashboard_page.dart';
import 'pages/book_service_flow_page.dart';
import 'services/socket_service.dart';
import 'services/notification_service.dart';
import 'state/auth_provider.dart';
import 'state/global_sync_provider.dart';
import 'state/navigation_provider.dart';
import 'state/theme_provider.dart';
import 'state/tracking_provider.dart';
import 'core/app_colors.dart';
import 'core/env.dart';
import 'core/storage.dart';
import 'utils/location_helper.dart';
import 'widgets/connectivity_gate.dart';
import 'package:device_info_plus/device_info_plus.dart';

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

// Future<void> initializeBackgroundService() async {
//   final service = FlutterBackgroundService();

//   await service.configure(
//     androidConfiguration: AndroidConfiguration(
//       onStart: onStart,
//       autoStart: false,
//       isForegroundMode: true,
//       notificationChannelId: 'high_importance_channel',
//       initialNotificationTitle: 'Carzzi Service',
//       initialNotificationContent: 'Running in background',
//       foregroundServiceNotificationId: 999,
//     ),
//     iosConfiguration: IosConfiguration(
//       autoStart: false,
//       onForeground: onStart,
//       onBackground: onIosBackground,
//     ),
//   );
//   await service.startService();
// }

// @pragma('vm:entry-point')
// Future<bool> onIosBackground(ServiceInstance service) async {
//   WidgetsFlutterBinding.ensureInitialized();
//   DartPluginRegistrant.ensureInitialized();
//   return true;
// }

// @pragma('vm:entry-point')
// void onStart(ServiceInstance service) async {
//   WidgetsFlutterBinding.ensureInitialized();
//   DartPluginRegistrant.ensureInitialized();

//   if (service is AndroidServiceInstance) {
//     service.on('setAsForeground').listen((event) {
//       service.setAsForegroundService();
//     });
//     service.on('setAsBackground').listen((event) {
//       service.setAsBackgroundService();
//     });
//   }
//   service.on('stopService').listen((event) {
//     service.stopSelf();
//   });

//   // You can initialize your background services here, like socket or tracking
//   Timer.periodic(const Duration(seconds: 1), (timer) async {
//     // Keep alive logic or periodic tasks
//   });
// }

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (!kIsWeb && Platform.isAndroid) {
    try {
      final deviceInfo = DeviceInfoPlugin();
      final androidInfo = await deviceInfo.androidInfo;
      Env.isPhysicalDevice = androidInfo.isPhysicalDevice;
    } catch (e) {
      debugPrint('Failed to detect physical device: $e');
    }
  }

  FlutterError.onError = (FlutterErrorDetails details) {
    final exception = details.exception.toString();
    final stack = details.stack.toString();
    if (exception.contains(
          "The DOM element of this text editing strategy is not currently active",
        ) ||
        exception.contains("domElement != null") ||
        exception.contains("text_editing.dart") ||
        stack.contains("text_editing.dart")) {
      debugPrint('Ignoring known Flutter web text editing error');
      return;
    }
    FlutterError.presentError(details);
  };

  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    final exception = error.toString();
    final stackStr = stack.toString();
    if (exception.contains(
          "The DOM element of this text editing strategy is not currently active",
        ) ||
        exception.contains("domElement != null") ||
        exception.contains("text_editing.dart") ||
        stackStr.contains("text_editing.dart")) {
      debugPrint('Ignoring known Flutter web text editing platform error');
      return true;
    }
    debugPrint('[PlatformError] $error');
    debugPrint('[PlatformError] $stack');
    return true;
  };

  // Registered once here (not again in NotificationService.initialize).
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

  final authProvider = AuthProvider();
  final themeProvider = ThemeProvider();
  final trackingProvider = TrackingProvider();
  final globalSyncProvider = GlobalSyncProvider();
  final socketService = SocketService();
  socketService.setTrackingProvider(trackingProvider);
  final notificationService = NotificationService();

  // Mount UI first so iOS doesn't stay on a blank launch screen.
  runApp(
    MyApp(
      authProvider: authProvider,
      themeProvider: themeProvider,
      globalSyncProvider: globalSyncProvider,
      socketService: socketService,
      notificationService: notificationService,
      trackingProvider: trackingProvider,
      precachedLogo: const AssetImage('assets/carzzilogo_padded.png'),
    ),
  );

  unawaited(
    _bootstrapApp(
      authProvider: authProvider,
      themeProvider: themeProvider,
      trackingProvider: trackingProvider,
      socketService: socketService,
      notificationService: notificationService,
    ),
  );
}

Future<void> _bootstrapApp({
  required AuthProvider authProvider,
  required ThemeProvider themeProvider,
  required TrackingProvider trackingProvider,
  required SocketService socketService,
  required NotificationService notificationService,
}) async {
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    ).timeout(const Duration(seconds: 15));
  } catch (e, stack) {
    debugPrint('Firebase init failed: $e');
    debugPrint(stack.toString());
  }

  try {
    await AppStorage().ensureStorageMatchesInstall();
    await Future.wait([
      authProvider.loadMe().timeout(const Duration(seconds: 15)),
      themeProvider.loadThemeMode().timeout(const Duration(seconds: 10)),
    ]);
  } catch (e, stack) {
    debugPrint('Initial state load failed: $e');
    debugPrint(stack.toString());
  }

  // Do not block app startup on notification initialization.
  // Some devices/environments can take longer than expected here.
  // Permission is only requested here if the user already has a session
  // from a previous login; first-time users are asked right after login.
  unawaited(() async {
    try {
      await notificationService.initialize().timeout(
        const Duration(seconds: 20),
      );
      if (authProvider.isAuthenticated) {
        await notificationService.requestPermissions();
        await LocationHelper.requestPermissionAfterLogin();
      }
      await notificationService.syncToken();
    } catch (e) {
      debugPrint('Notification init skipped at startup: $e');
    }
  }());

  final role = authProvider.user?.role?.toLowerCase();
  final shouldStartBackgroundService = role == 'staff' || role == 'merchant';
  if (!kIsWeb &&
      (Platform.isAndroid || Platform.isIOS) &&
      shouldStartBackgroundService) {
    try {
      // await initializeBackgroundService().timeout(const Duration(seconds: 15));
    } catch (e) {
      debugPrint('Failed to start background service: $e');
    }
  }

  if (authProvider.isAuthenticated) {
    socketService.init(authProvider.user);
    unawaited(notificationService.syncToken());
    trackingProvider.init(authProvider.user?.role, authProvider.user?.id);
  }
}

class StartupErrorApp extends StatelessWidget {
  final String error;

  const StartupErrorApp({super.key, required this.error});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Startup failed',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Check debug console for stack trace.',
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: SingleChildScrollView(
                    child: Text(
                      error,
                      style: const TextStyle(
                        color: Colors.redAccent,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SmoothPageTransitionsBuilder extends PageTransitionsBuilder {
  const SmoothPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    // Standardizing on a premium sliding transition that feels natural
    return const CupertinoPageTransitionsBuilder().buildTransitions(
      route,
      context,
      animation,
      secondaryAnimation,
      child,
    );
  }
}

class MyApp extends StatelessWidget {
  static bool _precacheOnce = false;
  final AuthProvider authProvider;
  final ThemeProvider themeProvider;
  final GlobalSyncProvider globalSyncProvider;
  final SocketService socketService;
  final NotificationService notificationService;
  final TrackingProvider trackingProvider;
  final ImageProvider? precachedLogo;

  const MyApp({
    super.key,
    required this.authProvider,
    required this.themeProvider,
    required this.globalSyncProvider,
    required this.socketService,
    required this.notificationService,
    required this.trackingProvider,
    this.precachedLogo,
  });

  @override
  Widget build(BuildContext context) {
    if (precachedLogo != null && !_precacheOnce) {
      _precacheOnce = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) {
          precacheImage(precachedLogo!, context).catchError((_) {});
        }
      });
    }

    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: authProvider),
        ChangeNotifierProvider(create: (_) => NavigationProvider()),
        ChangeNotifierProvider.value(value: themeProvider),
        ChangeNotifierProvider.value(value: globalSyncProvider),
        ChangeNotifierProvider.value(value: socketService),
        ChangeNotifierProvider.value(value: trackingProvider),
        Provider.value(value: notificationService),
      ],
      child: Builder(
        builder: (context) {
          final mode = context.watch<ThemeProvider>().mode;
          final isAuthenticated = context.watch<AuthProvider>().isAuthenticated;
          // Guest browse (no login) always uses light mode, regardless of
          // device setting. Onboarding/login screens keep their own
          // hardcoded dark visual design either way — this only affects
          // Material-themed pages a guest can reach (e.g. browsing
          // services). Signed-in users keep their saved preference.
          final themeMode = isAuthenticated ? mode : ThemeMode.light;

          return MaterialApp(
            navigatorKey: rootNavigatorKey,
            title: 'Carzzi',
            debugShowCheckedModeBanner: false,
            themeMode: themeMode,
            themeAnimationDuration: const Duration(milliseconds: 300),
            scrollBehavior: const ScrollBehavior().copyWith(
              physics: const BouncingScrollPhysics(),
            ),
            builder: (context, child) {
              return GestureDetector(
                onTap: () =>
                    FocusManager.instance.primaryFocus?.unfocus(),
                behavior: HitTestBehavior.opaque,
                child: ConnectivityGate(
                  child: child ?? const SizedBox.shrink(),
                ),
              );
            },
            theme: ThemeData(
              useMaterial3: true,
              colorScheme: ColorScheme.fromSeed(
                seedColor: AppColors.primaryBlue,
                brightness: Brightness.light,
              ),
              scaffoldBackgroundColor: AppColors.backgroundPrimaryLight,
              appBarTheme: const AppBarTheme(
                backgroundColor: AppColors.backgroundPrimaryLight,
                surfaceTintColor: AppColors.backgroundPrimaryLight,
                centerTitle: true,
                titleTextStyle: TextStyle(
                  color: Colors.black,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
                iconTheme: IconThemeData(color: Colors.black),
              ),
              textTheme: const TextTheme(
                titleLarge: TextStyle(
                  color: Colors.black,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
                titleMedium: TextStyle(
                  color: Colors.black,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
                bodyLarge: TextStyle(
                  color: AppColors.textSecondaryLight,
                  fontSize: 14,
                  fontWeight: FontWeight.normal,
                ),
                bodyMedium: TextStyle(
                  color: AppColors.textMutedLight,
                  fontSize: 12,
                  fontWeight: FontWeight.normal,
                ),
              ),
              pageTransitionsTheme: const PageTransitionsTheme(
                builders: {
                  TargetPlatform.android: SmoothPageTransitionsBuilder(),
                  TargetPlatform.iOS: SmoothPageTransitionsBuilder(),
                  TargetPlatform.linux: SmoothPageTransitionsBuilder(),
                  TargetPlatform.macOS: SmoothPageTransitionsBuilder(),
                  TargetPlatform.windows: SmoothPageTransitionsBuilder(),
                },
              ),
            ),
            darkTheme: ThemeData(
              useMaterial3: true,
              colorScheme: const ColorScheme.dark(
                primary: AppColors.primaryBlue,
                onPrimary: AppColors.textPrimary,
                secondary: AppColors.primaryBlueSoft,
                onSecondary: AppColors.textPrimary,
                surface: AppColors.backgroundSecondary,
                onSurface: AppColors.textPrimary,
                error: AppColors.error,
                onError: AppColors.textPrimary,
              ),
              scaffoldBackgroundColor: AppColors.backgroundPrimary,
              appBarTheme: AppBarTheme(
                backgroundColor: AppColors.backgroundPrimary,
                surfaceTintColor: Colors.transparent,
                elevation: 0,
                titleTextStyle: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
                iconTheme: const IconThemeData(color: AppColors.textPrimary),
              ),
              textTheme: const TextTheme(
                titleLarge: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
                titleMedium: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
                bodyLarge: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 14,
                  fontWeight: FontWeight.normal,
                ),
                bodyMedium: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.normal,
                ),
                displayLarge: TextStyle(color: AppColors.textPrimary),
                displayMedium: TextStyle(color: AppColors.textPrimary),
                displaySmall: TextStyle(color: AppColors.textPrimary),
                headlineLarge: TextStyle(color: AppColors.textPrimary),
                headlineMedium: TextStyle(color: AppColors.textPrimary),
                headlineSmall: TextStyle(color: AppColors.textPrimary),
                titleSmall: TextStyle(color: AppColors.textPrimary),
                bodySmall: TextStyle(color: AppColors.textPrimary),
                labelLarge: TextStyle(color: AppColors.textPrimary),
                labelMedium: TextStyle(color: AppColors.textPrimary),
                labelSmall: TextStyle(color: AppColors.textPrimary),
              ),
              cardTheme: CardThemeData(
                color: AppColors.backgroundSecondary,
                surfaceTintColor: Colors.transparent,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: const BorderSide(color: AppColors.borderColor),
                ),
                margin: EdgeInsets.zero,
              ),
              elevatedButtonTheme: ElevatedButtonThemeData(
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 12,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  foregroundColor: AppColors.textPrimary,
                  backgroundColor: Colors.transparent,
                  shadowColor: AppColors.primaryBlue.withValues(alpha: 0.15),
                  elevation: 8,
                ),
              ),
              bottomNavigationBarTheme: BottomNavigationBarThemeData(
                backgroundColor: AppColors.backgroundSecondary,
                selectedItemColor: AppColors.primaryBlue,
                unselectedItemColor: AppColors.textMuted,
                elevation: 0,
                type: BottomNavigationBarType.fixed,
                selectedLabelStyle: const TextStyle(fontSize: 12),
                unselectedLabelStyle: const TextStyle(fontSize: 12),
              ),
              pageTransitionsTheme: const PageTransitionsTheme(
                builders: {
                  TargetPlatform.android: SmoothPageTransitionsBuilder(),
                  TargetPlatform.iOS: SmoothPageTransitionsBuilder(),
                  TargetPlatform.linux: SmoothPageTransitionsBuilder(),
                  TargetPlatform.macOS: SmoothPageTransitionsBuilder(),
                  TargetPlatform.windows: SmoothPageTransitionsBuilder(),
                },
              ),
            ),
            initialRoute: '/',
            routes: {
              '/': (_) => const RootGate(),
              '/splash': (_) => const SplashPage(),
              '/onboarding': (_) => OnboardingPage(
                onComplete: () {
                  rootNavigatorKey.currentState?.pushNamedAndRemoveUntil(
                    '/',
                    (route) => false,
                  );
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    rootNavigatorKey.currentState?.pushNamed('/login');
                  });
                },
                // Skip goes straight to guest browsing (RootGate resolves
                // to the guest MainNavigationPage once onboarding is
                // marked seen) instead of pushing the login screen.
                onSkip: () {
                  rootNavigatorKey.currentState?.pushNamedAndRemoveUntil(
                    '/',
                    (route) => false,
                  );
                },
              ),
              '/login': (_) => const LoginPage(),
              '/register': (context) {
                final args =
                    ModalRoute.of(context)?.settings.arguments
                        as Map<String, dynamic>?;
                return RegisterPage(
                  initialEmail: args?['email'] as String?,
                  initialPhone: args?['phone'] as String?,
                  initialMaskedPhone: args?['maskedPhone'] as String?,
                  otpAlreadySent: args?['otpAlreadySent'] as bool? ?? false,
                );
              },
              '/terms': (_) => const LegalWebViewPage(
                title: 'Terms & Conditions',
                url: 'https://carzzi.com/terms',
              ),
              '/privacy': (_) => const LegalWebViewPage(
                title: 'Privacy Policy',
                url: 'https://carzzi.com/privacy',
              ),
              '/forgot-password': (_) => const ForgotPasswordPage(),
              '/reset-password': (_) => const ResetPasswordPage(),
              '/payment-status': (context) {
                final args = ModalRoute.of(context)?.settings.arguments;
                if (args is PaymentStatusPage) return args;
                return const PaymentStatusPage(
                  success: false,
                  title: 'Payment status unavailable',
                  message: 'We could not load the payment result.',
                );
              },
              '/services': (_) => const _TabRedirect(index: 1),
              '/customer': (_) => const MainNavigationPage(),
              '/bookings': (_) => const MyBookingsPage(),
              '/payments': (_) => const MyPaymentsPage(),
              '/vehicles': (_) => const MyVehiclesPage(),
              '/vehicle-detail': (context) {
                final args = ModalRoute.of(context)?.settings.arguments;
                if (args is Vehicle) {
                  return VehicleDetailPage(vehicle: args);
                }
                return Scaffold(
                  appBar: AppBar(title: const Text('Vehicle')),
                  body: const Center(child: Text('Vehicle not found')),
                );
              },
              '/add-vehicle': (_) => const AddVehiclePage(),
              '/notifications': (_) => const NotificationsPage(),
              '/essentials': (_) =>
                  const BookServiceFlowPage(initialCategory: 'Essentials'),
              '/support': (_) => const SupportPage(),
              '/profile': (_) => const ProfilePage(),
              '/coupons': (_) => const CouponsPage(),
              '/car-wash': (_) => const _TabRedirect(index: 0),
              '/tires': (_) => const _TabRedirect(index: 3),
              '/battery': (_) => const _TabRedirect(index: 4),
              '/track': (_) => const TrackBookingPage(),
              '/book': (context) {
                final args = ModalRoute.of(context)?.settings.arguments;
                if (args is String) {
                  return BookServiceFlowPage(initialCategory: args);
                }
                return const BookServiceFlowPage();
              },
              '/carzzi-dashboard': (_) => const CarzziDashboard(),
              '/merchant': (_) => const MerchantHomePage(),
              '/staff': (_) => const StaffHomePage(),
              '/admin': (_) => const AdminHomePage(),
            },
            onGenerateRoute: (settings) {
              if (settings.name == '/auth') {
                return MaterialPageRoute(
                  builder: (_) => const MainNavigationPage(),
                  settings: const RouteSettings(name: '/'),
                );
              }
              return null;
            },
            onUnknownRoute: (settings) {
              return MaterialPageRoute(
                builder: (_) => const MainNavigationPage(),
                settings: const RouteSettings(name: '/'),
              );
            },
          );
        },
      ),
    );
  }
}

class _TabRedirect extends StatelessWidget {
  final int index;
  const _TabRedirect({required this.index});

  @override
  Widget build(BuildContext context) {
    // Use addPostFrameCallback to avoid calling notifyListeners during build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final nav = context.read<NavigationProvider>();
      final args = ModalRoute.of(context)?.settings.arguments;
      nav.setTab(index, arguments: args);
    });
    return const MainNavigationPage();
  }
}

class RootGate extends StatefulWidget {
  const RootGate({super.key});

  @override
  State<RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<RootGate> {
  static bool _coldStartSplashDone = false;

  bool _splashDelayComplete = _coldStartSplashDone;
  bool _hasSeenOnboarding = false;

  @override
  void initState() {
    super.initState();
    if (_coldStartSplashDone) return;
    Future<void>.delayed(const Duration(milliseconds: 2000), () {
      _coldStartSplashDone = true;
      if (!mounted) return;
      setState(() => _splashDelayComplete = true);
    });
  }

  void _onOnboardingComplete() {
    setState(() => _hasSeenOnboarding = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.of(context).pushNamed('/login');
    });
  }

  // Skip goes straight to guest browsing — unlike "Get Started", it must
  // NOT also push '/login' afterwards.
  void _onOnboardingSkip() {
    setState(() => _hasSeenOnboarding = true);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    late final Widget child;
    if (!_splashDelayComplete || !auth.isInitialized) {
      child = const SplashPage(key: ValueKey('splash'));
    } else if (auth.isAuthenticated) {
      final role = auth.user?.role;
      if (role == 'merchant') {
        child = const MerchantHomePage(key: ValueKey('merchant'));
      } else if (role == 'staff') {
        child = const StaffHomePage(key: ValueKey('staff'));
      } else if (role == 'admin') {
        child = const AdminHomePage(key: ValueKey('admin'));
      } else {
        child = const MainNavigationPage(key: ValueKey('main'));
      }
    } else if (!_hasSeenOnboarding) {
      child = OnboardingPage(
        key: const ValueKey('onboarding'),
        onComplete: _onOnboardingComplete,
        onSkip: _onOnboardingSkip,
      );
    } else {
      child = const MainNavigationPage(key: ValueKey('main'));
    }

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 520),
      switchInCurve: const Cubic(0.22, 1, 0.36, 1),
      switchOutCurve: Curves.easeIn,
      transitionBuilder: (current, animation) {
        return FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0, 0.035),
              end: Offset.zero,
            ).animate(animation),
            child: current,
          ),
        );
      },
      child: child,
    );
  }
}

class MerchantHomePage extends StatelessWidget {
  const MerchantHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const _RoleHomeScaffold(title: 'Merchant Dashboard');
  }
}

class StaffHomePage extends StatelessWidget {
  const StaffHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const _RoleHomeScaffold(title: 'Staff Dashboard');
  }
}

class AdminHomePage extends StatelessWidget {
  const AdminHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const _RoleHomeScaffold(title: 'Admin Dashboard');
  }
}

class _RoleHomeScaffold extends StatelessWidget {
  final String title;

  const _RoleHomeScaffold({required this.title});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            onPressed: () async {
              await context.read<AuthProvider>().logout();
              if (!context.mounted) return;
              Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
            },
            icon: const Icon(Icons.logout),
            tooltip: 'Logout',
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  user != null ? 'Hi, ${user.name}' : 'Hi',
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                if (user != null) ...[
                  Text(user.email, textAlign: TextAlign.center),
                  if (user.role != null && user.role!.isNotEmpty)
                    Text('Role: ${user.role}', textAlign: TextAlign.center),
                  if (user.subRole != null && user.subRole!.isNotEmpty)
                    Text(
                      'SubRole: ${user.subRole}',
                      textAlign: TextAlign.center,
                    ),
                ],
                const SizedBox(height: 24),
                const Text(
                  'This area is ready for role-specific features.',
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
