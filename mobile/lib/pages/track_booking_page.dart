import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:cached_network_image/cached_network_image.dart';

import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_cashfree_pg_sdk/api/cferrorresponse/cferrorresponse.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpayment/cfwebcheckoutpayment.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpaymentgateway/cfpaymentgatewayservice.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfsession/cfsession.dart';
import 'package:flutter_cashfree_pg_sdk/utils/cfenums.dart';

import '../core/app_colors.dart';
import '../core/env.dart';
import '../core/order_pricing.dart';
import '../core/vehicle_service_pricing.dart';
import '../core/api_client.dart';
import '../core/storage.dart';
import '../models/booking.dart';
import '../services/booking_service.dart';
import '../services/payment_service.dart';
import '../services/review_service.dart';
import '../services/vehicle_service.dart';
import '../core/socket_sync.dart';
import '../services/socket_service.dart';
import 'payment_status_page.dart';
import '../widgets/global_sync_refresh.dart';
import '../state/auth_provider.dart';
import 'package:provider/provider.dart';
import 'chat_page.dart';
import '../utils/chat_seen_store.dart';
import 'coupons_page.dart';

List<String> _mergeTrackPhotoUrlLists(
  List<String> previous,
  List<String> incoming,
) {
  final seen = <String>{};
  final merged = <String>[];
  for (final url in [...previous, ...incoming]) {
    if (url.isEmpty || seen.contains(url)) continue;
    seen.add(url);
    merged.add(url);
  }
  if (merged.length > 4) return merged.sublist(0, 4);
  return merged;
}

Booking _mergeTrackBookingCarWashPhotos(Booking? previous, Booking incoming) {
  if (previous == null || previous.id != incoming.id) return incoming;
  final prevCw = previous.carWash;
  final nextCw = incoming.carWash;
  if (prevCw == null || nextCw == null) return incoming;

  return Booking(
    id: incoming.id,
    orderNumber: incoming.orderNumber,
    status: incoming.status,
    date: incoming.date,
    totalAmount: incoming.totalAmount,
    finalAmount: incoming.finalAmount,
    gstAmount: incoming.gstAmount,
    discountAmount: incoming.discountAmount,
    couponCode: incoming.couponCode,
    vehicle: incoming.vehicle,
    services: incoming.services,
    location: incoming.location,
    notes: incoming.notes,
    paymentStatus: incoming.paymentStatus,
    createdAt: incoming.createdAt,
    merchantLocation: incoming.merchantLocation,
    merchantName: incoming.merchantName,
    merchantPhone: incoming.merchantPhone,
    merchant: incoming.merchant,
    deliveryOtp: incoming.deliveryOtp,
    prePickupPhotos: incoming.prePickupPhotos,
    beforeServicePhotos: incoming.beforeServicePhotos,
    duringServicePhotos: incoming.duringServicePhotos,
    postServicePhotos: incoming.postServicePhotos,
    serviceParts: incoming.serviceParts,
    invoiceUrl: incoming.invoiceUrl,
    driverName: incoming.driverName,
    driverPhone: incoming.driverPhone,
    technicianName: incoming.technicianName,
    technicianPhone: incoming.technicianPhone,
    pickupRequired: incoming.pickupRequired,
    inspectionCompletedAt: incoming.inspectionCompletedAt,
    qcCompletedAt: incoming.qcCompletedAt,
    assignedAt: incoming.assignedAt,
    carWash: CarWashDetails(
      isCarWashService: nextCw.isCarWashService,
      beforeWashPhotos: _mergeTrackPhotoUrlLists(
        prevCw.beforeWashPhotos,
        nextCw.beforeWashPhotos,
      ),
      afterWashPhotos: _mergeTrackPhotoUrlLists(
        prevCw.afterWashPhotos,
        nextCw.afterWashPhotos,
      ),
      washStartedAt: nextCw.washStartedAt ?? prevCw.washStartedAt,
      washCompletedAt: nextCw.washCompletedAt ?? prevCw.washCompletedAt,
      staffName: nextCw.staffName ?? prevCw.staffName,
      staffPhone: nextCw.staffPhone ?? prevCw.staffPhone,
    ),
    batteryTire: incoming.batteryTire,
    inspection: incoming.inspection,
    delay: incoming.delay,
    revisit: incoming.revisit,
    statusHistory: incoming.statusHistory,
    billing: incoming.billing,
    pickupDropPrice: incoming.pickupDropPrice,
  );
}

class TrackBookingPage extends StatefulWidget {
  const TrackBookingPage({super.key});

  @override
  State<TrackBookingPage> createState() => _TrackBookingPageState();
}

class _PhotoCarouselItem {
  final String url;
  final String? label;

  const _PhotoCarouselItem({required this.url, this.label});
}

class _TrackBookingPageState extends State<TrackBookingPage> {
  final _service = BookingService();
  final _paymentService = PaymentService();
  final _cashfreeGateway = CFPaymentGatewayService();
  final _reviewService = ReviewService();
  final _vehicleService = VehicleService();
  final _mapController = MapController();
  final _api = ApiClient();

  bool _loading = true;
  String? _error;
  Booking? _booking;
  String? _bookingId;
  Map<String, dynamic>? _vehicleRef;
  // Admin-configurable per-category invoice toggle; null until loaded, in
  // which case invoice-eligibility checks fall back to the pre-toggle
  // defaults (see Booking.canShowInvoiceDownload).
  Map<String, dynamic>? _invoiceSettings;

  late SocketService _socketService;
  bool _nearAlertShown = false;
  bool _hasMerchantReview = false;
  bool _hasPlatformReview = false;
  bool _isReviewLoading = false;
  final double _bearingRad = 0.0;
  String? _etaTextDuration;
  String? _etaTextDistance;
  Timer? _approvalsTimer;
  List<LatLng> _routePoints = [];
  bool _mapReady = false;

  // Live tracking state
  LatLng? _liveLatLng;
  String? _liveName;
  DateTime? _liveUpdatedAt;
  bool _isPaymentLoading = false;
  bool _isMapMaximized = false;
  int _chatUnreadCount = 0;
  bool get _socketConnected => _socketService.isConnected;
  String? _socketError;
  // Performance optimizations
  DateTime? _lastLocationUpdate;
  DateTime? _lastRouteFetch;
  static const _locationThrottle = Duration(milliseconds: 2000);
  static const _routeThrottle = Duration(seconds: 15);

  @override
  void initState() {
    super.initState();
    _socketService = SocketService();
    _setupSocketListeners();

    if (!kIsWeb) {
      _cashfreeGateway.setCallback(_handlePaymentSuccess, _handlePaymentError);
    }

    _service
        .getInvoiceSettings()
        .then((settings) {
          if (mounted) setState(() => _invoiceSettings = settings);
        })
        .catchError((_) {});
  }

  void _handlePaymentSuccess(String orderId) async {
    // Show a loading dialog while verifying
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final verifyData = {
        'cashfree_order_id': orderId,
        'bookingId': _bookingId,
      };

      final result = await _verifyPaymentWithRetry(verifyData);

      if (mounted) {
        Navigator.pop(context); // Close loading dialog

        final data = result['data'] as Map<String, dynamic>?;
        final paymentStatus = data?['status'] as String? ?? 'unknown';
        final isPaid = result['success'] == true && paymentStatus == 'paid';

        if (isPaid) {
          Navigator.of(context).pushNamed(
            '/payment-status',
            arguments: PaymentStatusPage(
              success: true,
              title: 'Payment successful',
              message: 'Your booking payment has been completed successfully.',
              primaryButtonLabel: 'Go to home',
              primaryRoute: '/customer',
              clearStackOnPrimary: true,
            ),
          );
        } else if (_isFailurePaymentStatus(paymentStatus)) {
          final statusMsg = paymentStatus == 'user_dropped'
              ? 'Payment was cancelled.'
              : paymentStatus == 'failed'
              ? 'Payment failed. Please try again.'
              : 'Payment not completed (status: $paymentStatus). Please try again.';
          Navigator.of(context).pushNamed(
            '/payment-status',
            arguments: PaymentStatusPage(
              success: false,
              title: 'Payment not completed',
              message: statusMsg,
              primaryButtonLabel: 'Back to booking',
              onPrimaryPressed: () => Navigator.of(context).pop(),
            ),
          );
        } else {
          Navigator.of(context).pushNamed(
            '/payment-status',
            arguments: PaymentStatusPage(
              success: true,
              title: 'Payment received',
              message:
                  'Cashfree reported success. We are still syncing your booking status.',
              primaryButtonLabel: 'Go to home',
              primaryRoute: '/customer',
              clearStackOnPrimary: true,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        Navigator.pop(context);
        Navigator.of(context).pushNamed(
          '/payment-status',
          arguments: PaymentStatusPage(
            success: false,
            title: 'Payment verification failed',
            message: 'We could not confirm the payment. Please try again. $e',
            primaryButtonLabel: 'Back to booking',
            onPrimaryPressed: () => Navigator.of(context).pop(),
          ),
        );
      }
    }
  }

  Future<Map<String, dynamic>> _verifyPaymentWithRetry(
    Map<String, dynamic> verifyData,
  ) async {
    const retryDelays = <Duration>[
      Duration.zero,
      Duration(milliseconds: 1200),
      Duration(milliseconds: 2000),
      Duration(milliseconds: 3000),
      Duration(milliseconds: 4000),
      Duration(milliseconds: 5000),
    ];

    Map<String, dynamic> lastResult = const {};

    for (final delay in retryDelays) {
      if (delay > Duration.zero) {
        await Future<void>.delayed(delay);
      }

      final result = await _paymentService.verifyPayment(verifyData);
      lastResult = result;

      final data = result['data'] as Map<String, dynamic>?;
      final paymentStatus = (data?['status'] as String? ?? 'unknown')
          .toLowerCase();
      final isPaid = result['success'] == true && paymentStatus == 'paid';

      if (isPaid) return result;

      const transientStatuses = {
        'pending',
        'created',
        'attempted',
        'processing',
        'unknown',
      };
      if (!transientStatuses.contains(paymentStatus)) {
        return result;
      }
    }

    return lastResult;
  }

  bool _isFailurePaymentStatus(String status) {
    final normalized = status.toLowerCase();
    return normalized == 'failed' ||
        normalized == 'user_dropped' ||
        normalized == 'cancelled' ||
        normalized == 'expired';
  }

  void _handlePaymentError(CFErrorResponse response, String orderId) {
    Navigator.of(context).pushNamed(
      '/payment-status',
      arguments: PaymentStatusPage(
        success: false,
        title: 'Payment failed',
        message: '${response.getMessage()} (Order: $orderId)',
        primaryButtonLabel: 'Back to booking',
        onPrimaryPressed: () => Navigator.of(context).pop(),
      ),
    );
  }

  void _setupSocketListeners() {
    _socketService.on('liveLocation', (data) {
      if (!mounted) return;
      if (data != null) {
        try {
          final now = DateTime.now();
          if (_lastLocationUpdate != null &&
              now.difference(_lastLocationUpdate!) < _locationThrottle) {
            return;
          }
          _lastLocationUpdate = now;

          final mapData = data is Map<String, dynamic>
              ? data
              : Map<String, dynamic>.from(data as Map);
          final lat = mapData['lat'];
          final lng = mapData['lng'];
          if (lat is num && lng is num) {
            final next = LatLng(lat.toDouble(), lng.toDouble());
            setState(() {
              _liveLatLng = next;
              _liveName = mapData['name']?.toString();
              _liveUpdatedAt = DateTime.tryParse(
                mapData['updatedAt']?.toString() ?? '',
              );
            });

            // Safely move map if ready
            if (_mapReady) {
              try {
                final loc = _booking?.location;
                if (loc != null && loc.lat != null && loc.lng != null) {
                  final dest = LatLng(loc.lat!, loc.lng!);
                  // Only auto-center if the user isn't manually exploring
                  // or if it's the first update
                  _mapController.fitCamera(
                    CameraFit.bounds(
                      bounds: LatLngBounds.fromPoints([next, dest]),
                      padding: const EdgeInsets.all(50),
                    ),
                  );
                } else {
                  _mapController.move(next, 16.0);
                }
              } catch (e) {
                // Ignore
              }
            }

            if (_booking?.location?.lat != null &&
                _booking?.location?.lng != null) {
              final dest = LatLng(
                _booking!.location!.lat!,
                _booking!.location!.lng!,
              );

              // Throttle route fetching
              if (_lastRouteFetch == null ||
                  now.difference(_lastRouteFetch!) > _routeThrottle) {
                _fetchRoute(next, dest);
                _lastRouteFetch = now;
              }
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    });

    _socketService.on('bookingUpdated', (data) {
      if (!mounted) return;
      if (data != null) {
        try {
          final mapData = data is Map<String, dynamic>
              ? data
              : Map<String, dynamic>.from(data as Map);
          final updated = Booking.fromJson(mapData);
          if (updated.id == _bookingId) {
            setState(
              () =>
                  _booking = _mergeTrackBookingCarWashPhotos(_booking, updated),
            );
            _fetchPendingApprovals(); // Refresh approvals too
            if (updated.status == 'DELIVERED' ||
                updated.status == 'COMPLETED') {
              _fetchReviewsStatus(updated.id);
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    });

    _socketService.on('newApproval', (data) {
      if (!mounted) return;
      _fetchPendingApprovals();
      try {
        final mapData = data is Map<String, dynamic>
            ? data
            : Map<String, dynamic>.from(data as Map);
        final relatedBookingId = (mapData['relatedId'] ?? '').toString();
        if (_bookingId != null && relatedBookingId == _bookingId) {
          setState(() => _chatUnreadCount++);
        }
      } catch (_) {}
    });

    _socketService.on('loadMessages', _handleLoadMessagesForBadge);

    _socketService.on('receiveMessage', (data) {
      if (!mounted || _isChatSheetOpen) return;
      try {
        final mapData = data is Map<String, dynamic>
            ? data
            : Map<String, dynamic>.from(data as Map);
        final bookingId = (mapData['bookingId'] ?? mapData['relatedId'] ?? '')
            .toString();
        final sender = mapData['sender'];
        final senderId = sender is Map
            ? (sender['_id'] ?? sender['id'] ?? '').toString()
            : '';
        final currentUserId = context.read<AuthProvider>().user?.id;
        if (_bookingId != null &&
            bookingId == _bookingId &&
            senderId.isNotEmpty &&
            senderId != currentUserId) {
          setState(() => _chatUnreadCount++);
        }
      } catch (_) {}
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final args = ModalRoute.of(context)?.settings.arguments;
    final nextId = args?.toString();
    if (nextId != null && nextId.isNotEmpty && nextId != _bookingId) {
      if (_bookingId != null) {
        _socketService.leaveRoom('booking_$_bookingId');
      }
      _bookingId = nextId;
      _nearAlertShown = false;
      _load();
      _socketService.joinRoom('booking_$nextId');
      // Seed the unread badge from history (messages since last view).
      _socketService.emit('getMessages', {'bookingId': nextId});
    }
  }

  bool _isChatSheetOpen = false;

  Future<void> _handleLoadMessagesForBadge(dynamic data) async {
    final bookingId = _bookingId;
    if (!mounted || bookingId == null || _isChatSheetOpen || data is! List) {
      return;
    }
    if (data.isNotEmpty &&
        data.first is Map &&
        (data.first as Map)['bookingId']?.toString() != bookingId) {
      return;
    }
    final lastSeen = await ChatSeenStore.lastSeen(bookingId);
    if (!mounted) return;
    final selfId = context.read<AuthProvider>().user?.id;
    setState(
      () =>
          _chatUnreadCount = ChatSeenStore.countUnread(data, lastSeen, selfId),
    );
  }

  @override
  void dispose() {
    _socketService.off('loadMessages', _handleLoadMessagesForBadge);
    _socketService.off('liveLocation');
    _socketService.off('bookingUpdated');
    _socketService.off('receiveMessage');
    if (_bookingId != null) {
      _socketService.leaveRoom('booking_$_bookingId');
    }
    _approvalsTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchRoute(LatLng start, LatLng end) async {
    try {
      final url = Uri.parse(
        'https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson',
      );
      final response = await http.get(url);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final routes = data['routes'] as List;
        if (routes.isNotEmpty) {
          final geometry = routes[0]['geometry'];
          final coordinates = geometry['coordinates'] as List;
          if (!mounted) return;
          setState(() {
            _routePoints = coordinates
                .map((c) => LatLng(c[1].toDouble(), c[0].toDouble()))
                .toList();
          });
        }
      }
    } catch (e) {
      // Silent catch
    }
  }

  Future<void> _handlePayment() async {
    final booking = _booking;
    if (booking == null) return;

    setState(() => _isPaymentLoading = true);
    var loadingDialogOpen = true;
    void closeLoadingDialog() {
      if (!loadingDialogOpen || !mounted) return;
      loadingDialogOpen = false;
      Navigator.of(context, rootNavigator: true).pop();
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => PopScope(
        canPop: false,
        child: Dialog(
          backgroundColor: Colors.transparent,
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? AppColors.backgroundSecondary
                  : Colors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0.92, end: 1.08),
                  duration: const Duration(milliseconds: 900),
                  curve: Curves.easeInOut,
                  builder: (context, value, child) {
                    return Transform.scale(scale: value, child: child);
                  },
                  child: Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.primaryBlue.withValues(alpha: 0.12),
                    ),
                    child: const Center(
                      child: SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(strokeWidth: 3.2),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Loading secure checkout...',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white
                        : Colors.black87,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Please wait while Cashfree opens.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white60
                        : Colors.black54,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    try {
      final orderData = await _paymentService.createOrder(
        bookingId: booking.id,
        amount: booking.calculatedTotal,
      );

      if (mounted) {
        final orderId =
            (orderData['orderId'] ??
                    orderData['order_id'] ??
                    orderData['id'] ??
                    '')
                .toString();
        final paymentSessionId = (orderData['paymentSessionId'] ?? '')
            .toString();
        final environment = (orderData['environment'] ?? 'sandbox').toString();

        if (kIsWeb) {
          closeLoadingDialog();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Payments are only available on mobile'),
            ),
          );
        } else if (orderId.isEmpty || paymentSessionId.isEmpty) {
          closeLoadingDialog();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Payment setup failed. Please try again.'),
              backgroundColor: Colors.red,
            ),
          );
        } else {
          final session = CFSessionBuilder()
              .setEnvironment(
                environment == 'production'
                    ? CFEnvironment.PRODUCTION
                    : CFEnvironment.SANDBOX,
              )
              .setOrderId(orderId)
              .setPaymentSessionId(paymentSessionId)
              .build();

          final cfPayment = CFWebCheckoutPaymentBuilder()
              .setSession(session)
              .build();

          _cashfreeGateway.doPayment(cfPayment);
          closeLoadingDialog();
        }
      }
    } catch (e) {
      if (!mounted) return;
      closeLoadingDialog();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Payment initiation failed: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isPaymentLoading = false);
      }
    }
  }

  Future<void> _onPayNowClicked(bool isGeneralService) async {
    final booking = _booking;
    if (booking == null) return;

    if (isGeneralService) {
      // Navigate to checkout screen (redesigned coupons page)
      final selectedCoupon = await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => CouponsPage(
            isSelectionMode: true,
            bookingTotal: booking.totalAmount.toDouble(),
            bookingCategory: booking.services.isNotEmpty == true
                ? booking.services.first.category
                : 'All',
            booking: booking,
          ),
        ),
      );

      // If user proceeded from checkout (either with a coupon or without)
      // selectedCoupon might be a Map or null (if they just clicked proceed)
      if (selectedCoupon != null &&
          selectedCoupon is Map<String, dynamic> &&
          selectedCoupon['code'] != null) {
        await _applyCouponByCode(selectedCoupon['code']);
        // Refresh booking to get new total
        await _load(silent: true);
      }
    }

    // Proceed to standard payment
    _handlePayment();
  }

  Future<void> _load({bool silent = false}) async {
    final id = _bookingId;
    if (id == null || id.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'Missing booking id';
      });
      return;
    }

    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final booking = await _service.getBooking(id);
      if (mounted) {
        setState(() => _booking = booking);
        final vehicle = booking.vehicle;
        if (vehicle != null &&
            vehicle.make.isNotEmpty &&
            vehicle.model.isNotEmpty) {
          final ref = await _vehicleService.searchReference(
            make: vehicle.make,
            model: vehicle.model,
            variant: vehicle.variant,
            fuelType: vehicle.fuelType,
          );
          if (mounted) {
            setState(() => _vehicleRef = ref);
          }
        }
        _fetchPendingApprovals();
        _startApprovalsTimer();
        if (booking.status == 'DELIVERED' || booking.status == 'COMPLETED') {
          _fetchReviewsStatus(booking.id);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _applyCouponByCode(String code) async {
    final booking = _booking;
    if (booking == null) return;

    setState(() => _isPaymentLoading = true);
    try {
      final updated = await _service.applyCoupon(booking.id, code);
      if (mounted) {
        setState(() {
          _booking = updated;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Coupon applied successfully!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to apply coupon: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isPaymentLoading = false);
    }
  }

  Future<void> _fetchReviewsStatus(String bookingId) async {
    try {
      final reviews = await _reviewService.getBookingReviews(bookingId);
      final hasMerchant = reviews.any((r) => r['category'] == 'Merchant');
      final hasPlatform = reviews.any((r) => r['category'] == 'Platform');
      if (mounted) {
        setState(() {
          _hasMerchantReview = hasMerchant;
          _hasPlatformReview = hasPlatform;
        });
      }
    } catch (_) {}
  }

  Future<void> _showReviewDialog() async {
    final booking = _booking;
    if (booking == null) return;

    int merchantRating = 5;
    int platformRating = 5;
    final merchantCommentController = TextEditingController();
    final platformCommentController = TextEditingController();

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final isDark = Theme.of(context).brightness == Brightness.dark;
            final isComplete = _hasMerchantReview && _hasPlatformReview;

            if (isComplete) {
              return Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.check_circle_outline,
                      size: 64,
                      color: Colors.green,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Feedback Submitted',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Thank you for sharing your experience with us!',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Close'),
                      ),
                    ),
                  ],
                ),
              );
            }

            return Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                16,
                16,
                16 + MediaQuery.of(context).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Rate your experience',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (!_hasMerchantReview) ...[
                      Text(
                        'Service Center Rating',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(
                          5,
                          (i) => IconButton(
                            onPressed: () =>
                                setModalState(() => merchantRating = i + 1),
                            icon: Icon(
                              i < merchantRating
                                  ? Icons.star
                                  : Icons.star_border,
                              color: Colors.amber,
                              size: 32,
                            ),
                          ),
                        ),
                      ),
                      TextField(
                        controller: merchantCommentController,
                        style: TextStyle(
                          color: isDark ? Colors.white : Colors.black87,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Share your thoughts about the service...',
                          border: OutlineInputBorder(),
                        ),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 24),
                    ],
                    if (!_hasPlatformReview) ...[
                      Text(
                        'Platform Experience Rating',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(
                          5,
                          (i) => IconButton(
                            onPressed: () =>
                                setModalState(() => platformRating = i + 1),
                            icon: Icon(
                              i < platformRating
                                  ? Icons.star
                                  : Icons.star_border,
                              color: Colors.amber,
                              size: 32,
                            ),
                          ),
                        ),
                      ),
                      TextField(
                        controller: platformCommentController,
                        style: TextStyle(
                          color: isDark ? Colors.white : Colors.black87,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Share your thoughts about our app...',
                          border: OutlineInputBorder(),
                        ),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 24),
                    ],
                    ElevatedButton(
                      onPressed: _isReviewLoading
                          ? null
                          : () async {
                              setModalState(() => _isReviewLoading = true);
                              try {
                                if (!_hasMerchantReview) {
                                  await _reviewService.createReview(
                                    bookingId: booking.id,
                                    rating: merchantRating,
                                    comment: merchantCommentController.text
                                        .trim(),
                                    category: 'Merchant',
                                  );
                                }
                                if (!_hasPlatformReview) {
                                  await _reviewService.createReview(
                                    bookingId: booking.id,
                                    rating: platformRating,
                                    comment: platformCommentController.text
                                        .trim(),
                                    category: 'Platform',
                                  );
                                }
                                if (context.mounted) {
                                  Navigator.pop(context);
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Thank you for your feedback!',
                                        ),
                                      ),
                                    );
                                  }
                                  _fetchReviewsStatus(booking.id);
                                }
                              } catch (e) {
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        'Failed to submit review: $e',
                                      ),
                                    ),
                                  );
                                }
                              } finally {
                                setModalState(() => _isReviewLoading = false);
                              }
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _isReviewLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2,
                              ),
                            )
                          : const Text(
                              'Submit Review',
                              style: TextStyle(fontWeight: FontWeight.bold),
                            ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showImagePreview(String url) {
    if (url.isEmpty) return;
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(10),
        child: Stack(
          alignment: Alignment.center,
          children: [
            InteractiveViewer(
              child: CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.contain,
                placeholder: (context, url) => const Center(
                  child: CircularProgressIndicator(color: Colors.white),
                ),
                errorWidget: (context, url, error) => const Icon(
                  Icons.broken_image,
                  color: Colors.white,
                  size: 50,
                ),
              ),
            ),
            Positioned(
              top: 10,
              right: 10,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white, size: 30),
                onPressed: () => Navigator.pop(context),
              ),
            ),
          ],
        ),
      ),
    );
  }

  DateTime? _parseDate(String value) {
    try {
      return DateTime.parse(value).toLocal();
    } catch (_) {
      return null;
    }
  }

  String _formatDateTime(BuildContext context, String? value) {
    if (value == null || value.isEmpty) return '';
    final dt = _parseDate(value);
    if (dt == null) return value;
    final date =
        '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
    final time = TimeOfDay.fromDateTime(dt).format(context);
    return '$date • $time';
  }

  String _formatClockTime(BuildContext context, DateTime dt) {
    return TimeOfDay.fromDateTime(dt).format(context);
  }

  String? _resolveImageUrl(dynamic raw) {
    if (raw == null) return null;
    final s = raw.toString().trim();
    if (s.isEmpty) return null;
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('/')) return '${Env.baseUrl}$s';
    return '${Env.baseUrl}/$s';
  }

  Widget _buildPartImage(String? imagePath, String label, bool isDark) {
    final resolvedUrl = _resolveImageUrl(imagePath);
    return Column(
      children: [
        Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isDark ? Colors.grey.shade800 : const Color(0xFFE5E7EB),
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(7),
            child: resolvedUrl != null
                ? CachedNetworkImage(
                    imageUrl: resolvedUrl,
                    fit: BoxFit.cover,
                    memCacheHeight: 150,
                    placeholder: (context, url) => const Center(
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                    errorWidget: (context, url, error) => Icon(
                      Icons.image_not_supported_outlined,
                      size: 20,
                      color: isDark ? Colors.white24 : Colors.black26,
                    ),
                  )
                : Icon(
                    Icons.image_not_supported_outlined,
                    size: 20,
                    color: isDark ? Colors.white24 : Colors.black26,
                  ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            color: isDark ? Colors.white60 : Colors.black54,
          ),
        ),
      ],
    );
  }

  void _showPartDetailsDialog(ServicePart part, bool isDark) {
    final beforeImageUrl = _resolveImageUrl(part.oldImage);
    final afterImageUrl = _resolveImageUrl(part.image);
    final total = part.price * part.quantity;

    showDialog(
      context: context,
      builder: (dialogContext) => Dialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        backgroundColor: isDark ? const Color(0xFF0F172A) : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        part.name,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: isDark
                              ? Colors.white
                              : const Color(0xFF0F172A),
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      icon: Icon(
                        Icons.close_rounded,
                        color: isDark ? Colors.white70 : Colors.black54,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Qty: ${part.quantity} • Price: ₹${part.price} • Total: ₹$total',
                  style: TextStyle(
                    fontSize: 13,
                    color: isDark ? Colors.white70 : Colors.black54,
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: part.fromInspection
                        ? const Color(0xFFDCFCE7)
                        : const Color(0xFFDBEAFE),
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(
                    part.fromInspection ? 'From inspection' : 'New discovery',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: part.fromInspection
                          ? const Color(0xFF166534)
                          : const Color(0xFF1E40AF),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: _buildPartImagePreviewCard(
                        imageUrl: beforeImageUrl,
                        label: 'Before',
                        isDark: isDark,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildPartImagePreviewCard(
                        imageUrl: afterImageUrl,
                        label: 'After',
                        isDark: isDark,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPartImagePreviewCard({
    required String? imageUrl,
    required String label,
    required bool isDark,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: isDark ? Colors.white70 : Colors.black54,
          ),
        ),
        const SizedBox(height: 8),
        GestureDetector(
          onTap: imageUrl == null ? null : () => _showImagePreview(imageUrl),
          child: Container(
            height: 120,
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF111827) : const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isDark ? Colors.grey.shade800 : const Color(0xFFE5E7EB),
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(11),
              child: imageUrl == null
                  ? Center(
                      child: Icon(
                        Icons.image_not_supported_outlined,
                        size: 24,
                        color: isDark ? Colors.white30 : Colors.black26,
                      ),
                    )
                  : CachedNetworkImage(
                      imageUrl: imageUrl,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => const Center(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                      errorWidget: (context, url, error) => Icon(
                        Icons.broken_image_outlined,
                        size: 24,
                        color: isDark ? Colors.white30 : Colors.black26,
                      ),
                    ),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _fetchPendingApprovals() async {
    final booking = _booking;
    if (booking == null) return;
    final res = await _api.getAny(ApiEndpoints.approvalsMyApprovals);
    final items = <Map<String, dynamic>>[];
    if (res is List) {
      for (final e in res) {
        if (e is Map) {
          final map = e is Map<String, dynamic>
              ? e
              : Map<String, dynamic>.from(e);
          final rawRelated = map['relatedId'];
          String relatedId = '';
          if (rawRelated is String) {
            relatedId = rawRelated;
          } else if (rawRelated is Map) {
            final inner = rawRelated;
            final candidate = inner['_id'];
            if (candidate is String) {
              relatedId = candidate;
            } else if (candidate != null) {
              relatedId = candidate.toString();
            } else {
              relatedId = rawRelated.toString();
            }
          } else if (rawRelated != null) {
            relatedId = rawRelated.toString();
          }
          final status = map['status']?.toString();
          final type = map['type']?.toString();
          if (relatedId == booking.id &&
              status == 'Pending' &&
              type == 'PartReplacement') {
            items.add(map);
          }
        }
      }
    }
    if (!mounted) return;
    setState(() {
      // _pendingApprovals = items;
    });
  }

  void _startApprovalsTimer() {
    _approvalsTimer?.cancel();
    final booking = _booking;
    if (booking == null || booking.id.isEmpty) return;

    // Only run polling if the status is one where approvals might happen
    // and if we haven't already completed the service
    const activeStatuses = [
      'ASSIGNED',
      'ACCEPTED',
      'REACHED_CUSTOMER',
      'VEHICLE_PICKED',
      'REACHED_MERCHANT',
      'VEHICLE_AT_MERCHANT',
      'SERVICE_STARTED',
    ];

    if (!activeStatuses.contains(booking.status)) {
      return;
    }

    _approvalsTimer = Timer.periodic(
      const Duration(
        seconds: 20,
      ), // Increased to 20s for better battery/performance
      (_) => _fetchPendingApprovals(),
    );
  }

  String _statusLabel(String status) {
    final booking = _booking;
    if (booking != null &&
        booking.pickupRequired &&
        status == 'ACCEPTED' &&
        booking.status == 'REACHED_CUSTOMER') {
      return 'Staff waiting at your location';
    }
    if (booking != null &&
        booking.pickupRequired &&
        status == 'OUT_FOR_DELIVERY' &&
        booking.paymentStatus != 'paid') {
      return 'Waiting for payment';
    }
    if (status == 'SERVICE_COMPLETED') {
      return 'Payment awaiting to dispatch vehicle. Service is completed.';
    }

    return Booking.getStatusLabel(status, booking?.services);
  }

  @override
  Widget build(BuildContext context) {
    final booking = _booking;
    final bookingLoc = booking?.location;
    final bookingLatLng = bookingLoc?.lat != null && bookingLoc?.lng != null
        ? LatLng(bookingLoc!.lat!, bookingLoc.lng!)
        : null;
    final merchantLoc = booking?.merchantLocation;
    final merchantLatLng = merchantLoc?.lat != null && merchantLoc?.lng != null
        ? LatLng(merchantLoc!.lat!, merchantLoc.lng!)
        : null;
    final mapLatLng = booking != null && booking.pickupRequired
        ? bookingLatLng
        : (merchantLatLng ?? bookingLatLng);
    final center = _liveLatLng ?? mapLatLng ?? const LatLng(12.9716, 77.5946);
    final showLiveTrackingMap =
        booking != null &&
        booking.pickupRequired &&
        (booking.status == 'ASSIGNED' ||
            booking.status == 'ACCEPTED' ||
            booking.status == 'REACHED_CUSTOMER' ||
            booking.status == 'VEHICLE_PICKED' ||
            booking.status == 'REACHED_MERCHANT' ||
            booking.status == 'VEHICLE_AT_MERCHANT' ||
            booking.status == 'SERVICE_STARTED' ||
            booking.status == 'SERVICE_COMPLETED' ||
            booking.status == 'OUT_FOR_DELIVERY');
    final canDownloadInvoice =
        booking?.canShowInvoiceDownload(_invoiceSettings) ?? false;
    final isBookedStatus = booking?.status.toUpperCase() == 'BOOKED';

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GlobalSyncRefresh(
      entities: SyncEntities.bookings,
      onSync: () {
        if (_loading || _bookingId == null) return;
        _load(silent: true);
      },
      child: Scaffold(
        backgroundColor: isDark ? Colors.black : Colors.white,
        appBar: AppBar(
          leading: IconButton(
            icon: Icon(
              Icons.arrow_back_ios_new_rounded,
              color: isDark ? Colors.white : const Color(0xFF0F172A),
              size: 22,
            ),
            onPressed: () {
              final navigator = Navigator.of(context);
              if (navigator.canPop()) {
                navigator.pop();
                return;
              }
              navigator.pushReplacementNamed('/customer');
            },
          ),
          automaticallyImplyLeading: false,
          centerTitle: true,
          backgroundColor: isDark ? Colors.transparent : Colors.white,
          surfaceTintColor: isDark ? Colors.transparent : Colors.white,
          elevation: isDark ? 0 : 5.0,
          shadowColor: isDark
              ? Colors.transparent
              : Colors.black.withValues(alpha: 0.1),
          title: Text(
            'Track Service',
            style: TextStyle(
              color: isDark ? Colors.white : Colors.black,
              fontWeight: FontWeight.w700,
            ),
          ),
          actions: [
            if (canDownloadInvoice)
              Padding(
                padding: const EdgeInsets.only(right: 5.0),
                child: IconButton(
                  tooltip: 'Download Invoice',
                  onPressed: () async {
                    String? url = _resolveImageUrl(booking?.invoiceUrl);

                    // If no direct URL, fallback to auto-generation endpoint
                    if (url == null && booking != null) {
                      final token = await AppStorage().getToken();
                      if (token != null) {
                        url =
                            '${Env.apiBaseUrl}${ApiEndpoints.bookings}/${booking.id}/invoice?token=$token';
                      }
                    }

                    // Uploaded merchant invoice on S3: get a signed URL with
                    // "attachment" so the browser downloads it instead of
                    // previewing (same endpoint the web uses).
                    if (url != null &&
                        url.contains('.amazonaws.com/carzzi_uploads/')) {
                      try {
                        final ext =
                            RegExp(
                              r'\.([a-zA-Z0-9]{2,5})(?:\?|$)',
                            ).firstMatch(url)?.group(1) ??
                            'pdf';
                        final name =
                            'Carzzi_Invoice_${booking?.orderNumber ?? 'booking'}.$ext';
                        final query = Uri(
                          queryParameters: {'url': url, 'filename': name},
                        ).query;
                        final res = await ApiClient().getJson(
                          '/upload/download-url?$query',
                        );
                        final signed = res['url']?.toString();
                        if (signed != null && signed.isNotEmpty) url = signed;
                      } catch (_) {
                        // fall back to opening the file URL as before
                      }
                    }

                    if (url != null) {
                      final uri = Uri.parse(url);
                      if (await canLaunchUrl(uri)) {
                        await launchUrl(
                          uri,
                          mode: kIsWeb
                              ? LaunchMode.platformDefault
                              : LaunchMode.externalApplication,
                        );
                      } else {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Could not launch invoice URL'),
                            ),
                          );
                        }
                      }
                    }
                  },
                  icon: const Icon(Icons.download_rounded, size: 26),
                ),
              ),
          ],
        ),
        floatingActionButton:
            booking != null &&
                [
                  'SERVICE_STARTED',
                  'CAR_WASH_STARTED',
                  'INSTALLATION',
                  'On Hold',
                ].contains(booking.status.toUpperCase())
            ? FloatingActionButton(
                onPressed: () async {
                  setState(() {
                    _chatUnreadCount = 0;
                    _isChatSheetOpen = true;
                  });
                  await ChatSeenStore.markSeen(booking.id);
                  if (!context.mounted) return;
                  await showModalBottomSheet(
                    context: context,
                    isScrollControlled: true,
                    backgroundColor: Colors.transparent,
                    builder: (context) => DraggableScrollableSheet(
                      initialChildSize: 0.8,
                      minChildSize: 0.5,
                      maxChildSize: 0.95,
                      builder: (_, scrollController) => Container(
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.vertical(
                            top: Radius.circular(24),
                          ),
                        ),
                        child: ChatPage(booking: booking),
                      ),
                    ),
                  );
                  // Messages read while the sheet was open count as seen.
                  await ChatSeenStore.markSeen(booking.id);
                  if (mounted) setState(() => _isChatSheetOpen = false);
                },
                backgroundColor: const Color(0xFF2563EB),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const Icon(Icons.chat_bubble_outline, color: Colors.white),
                    if (_chatUnreadCount > 0)
                      Positioned(
                        right: -10,
                        top: -8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.red,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: Colors.white, width: 1.2),
                          ),
                          child: Text(
                            _chatUnreadCount > 99
                                ? '99+'
                                : _chatUnreadCount.toString(),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              )
            : null,
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: EdgeInsets.fromLTRB(16, isBookedStatus ? 8 : 16, 16, 16),
            children: [
              if (_loading)
                const Padding(
                  padding: EdgeInsets.only(top: 32),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 24),
                  child: Column(
                    children: [
                      Text(
                        'Failed to load booking',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: isDark ? Colors.white : Colors.black54,
                        ),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: _load,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              else if (_booking == null)
                const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: Center(child: Text('Booking not found')),
                )
              else ...[
                Builder(
                  builder: (context) {
                    final booking = _booking!;
                    final isCarWash =
                        booking.services.any((s) {
                          final cat = (s.category ?? '').toLowerCase();
                          return cat.contains('car wash') ||
                              cat.contains('wash') ||
                              cat.contains('detailing') ||
                              cat.contains('essentials');
                        }) ||
                        booking.carWash?.isCarWashService == true;
                    final isBatteryTire =
                        booking.services.any((s) {
                          final cat = (s.category ?? '').toLowerCase();
                          return cat.contains('battery') ||
                              cat.contains('tyres') ||
                              cat.contains('tyre') ||
                              cat.contains('tire');
                        }) ||
                        booking.batteryTire?.isBatteryTireService == true;
                    final isGeneralService = booking.services.any((s) {
                      final cat = (s.category ?? '').toLowerCase();
                      final name = s.name.toLowerCase();
                      return cat == 'periodic' ||
                          cat == 'services' ||
                          name.contains('general service');
                    });
                    final parts = (booking.billing?.partsTotal ?? 0).toDouble();
                    final labour = (booking.billing?.labourCost ?? 0)
                        .toDouble();
                    final merchantGst = (booking.billing?.gst ?? 0).toDouble();
                    final pickup =
                        (booking.billing?.pickupDropPrice ??
                                booking.pickupDropPrice ??
                                0)
                            .toDouble();
                    final discount = (booking.discountAmount ?? 0).toDouble();
                    double servicesTotal = sumBookingServicesSubtotal(
                      booking.services,
                      _vehicleRef,
                    );
                    if (servicesTotal == 0) {
                      final rawTotal = booking.totalAmount.toDouble();
                      servicesTotal =
                          (rawTotal - parts - labour - merchantGst - pickup)
                              .clamp(0, double.infinity);
                    }
                    double subtotal = servicesTotal;
                    if (isGeneralService && pickup > 0) {
                      subtotal += pickup;
                    }
                    OrderTotals orderTotals = calculateOrderTotals(
                      subtotal,
                      discount,
                      !isGeneralService,
                    );
                    double tax = merchantGst > 0
                        ? merchantGst
                        : (!isGeneralService ? orderTotals.tax : 0);
                    double finalTotal =
                        (booking.finalAmount ??
                                booking.billing?.total ??
                                booking.totalAmount)
                            .toDouble();
                    if (finalTotal <= 0) {
                      finalTotal = orderTotals.total;
                    }
                    final isDeliveredStatus =
                        booking.status.toUpperCase() == 'DELIVERED';
                    final canShowTopReviewCta =
                        (booking.status == 'DELIVERED' ||
                            booking.status == 'COMPLETED') &&
                        (!_hasMerchantReview || !_hasPlatformReview);
                    final inspectionItems = <_PhotoCarouselItem>[
                      if (booking.inspection?.frontPhoto != null &&
                          _resolveImageUrl(booking.inspection!.frontPhoto) !=
                              null)
                        _PhotoCarouselItem(
                          url: _resolveImageUrl(
                            booking.inspection!.frontPhoto,
                          )!,
                          label: 'Photo 1',
                        ),
                      if (booking.inspection?.backPhoto != null &&
                          _resolveImageUrl(booking.inspection!.backPhoto) !=
                              null)
                        _PhotoCarouselItem(
                          url: _resolveImageUrl(booking.inspection!.backPhoto)!,
                          label: 'Photo 2',
                        ),
                      if (booking.inspection?.leftPhoto != null &&
                          _resolveImageUrl(booking.inspection!.leftPhoto) !=
                              null)
                        _PhotoCarouselItem(
                          url: _resolveImageUrl(booking.inspection!.leftPhoto)!,
                          label: 'Photo 3',
                        ),
                      if (booking.inspection?.rightPhoto != null &&
                          _resolveImageUrl(booking.inspection!.rightPhoto) !=
                              null)
                        _PhotoCarouselItem(
                          url: _resolveImageUrl(
                            booking.inspection!.rightPhoto,
                          )!,
                          label: 'Photo 4',
                        ),
                    ];
                    final prePickupItems = <_PhotoCarouselItem>[
                      for (int i = 0; i < booking.prePickupPhotos.length; i++)
                        if (_resolveImageUrl(booking.prePickupPhotos[i]) !=
                            null)
                          _PhotoCarouselItem(
                            url: _resolveImageUrl(booking.prePickupPhotos[i])!,
                            label: 'Photo ${i + 1}',
                          ),
                    ];
                    final servicePhotoItems = <_PhotoCarouselItem>[];
                    final beforeCarWashItems = <_PhotoCarouselItem>[];
                    final afterCarWashItems = <_PhotoCarouselItem>[];
                    final isEssentialsCarWash =
                        isCarWash &&
                        booking.services.any(
                          (s) => (s.category ?? '').toLowerCase().contains(
                            'essentials',
                          ),
                        );
                    final beforeCarWashTitle = isEssentialsCarWash
                        ? 'Before Service'
                        : 'Before Car Wash';
                    final afterCarWashTitle = isEssentialsCarWash
                        ? 'After Service'
                        : 'After Car Wash';
                    const directionalLabels = [
                      'Photo 1',
                      'Photo 2',
                      'Photo 3',
                      'Photo 4',
                    ];
                    void addServicePhotos(
                      List<String> photos,
                      String labelPrefix,
                    ) {
                      for (int i = 0; i < photos.length; i++) {
                        final resolved = _resolveImageUrl(photos[i]);
                        if (resolved == null) continue;
                        servicePhotoItems.add(
                          _PhotoCarouselItem(
                            url: resolved,
                            label: i < directionalLabels.length
                                ? directionalLabels[i]
                                : '$labelPrefix ${i + 1}',
                          ),
                        );
                      }
                    }

                    void addCarWashPhotoItems(
                      List<String> photos,
                      List<_PhotoCarouselItem> target,
                      String labelPrefix,
                    ) {
                      for (int i = 0; i < photos.length; i++) {
                        final resolved = _resolveImageUrl(photos[i]);
                        if (resolved == null) continue;
                        target.add(
                          _PhotoCarouselItem(
                            url: resolved,
                            label: i < directionalLabels.length
                                ? directionalLabels[i]
                                : '$labelPrefix ${i + 1}',
                          ),
                        );
                      }
                    }

                    if (isCarWash) {
                      addCarWashPhotoItems(
                        booking.carWash?.beforeWashPhotos ?? const [],
                        beforeCarWashItems,
                        beforeCarWashTitle,
                      );
                      addCarWashPhotoItems(
                        booking.carWash?.afterWashPhotos ?? const [],
                        afterCarWashItems,
                        afterCarWashTitle,
                      );
                    } else {
                      addServicePhotos(
                        booking.beforeServicePhotos,
                        'Before Service',
                      );
                      addServicePhotos(
                        booking.duringServicePhotos,
                        'During Service',
                      );
                      addServicePhotos(
                        booking.postServicePhotos,
                        'After Service',
                      );
                    }

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (showLiveTrackingMap) ...[
                          RepaintBoundary(
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 300),
                              height: _isMapMaximized ? 500 : 260,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: const Color(0xFFE5E7EB),
                                ),
                              ),
                              child: Stack(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(16),
                                    child: FlutterMap(
                                      mapController: _mapController,
                                      options: MapOptions(
                                        initialCenter: center,
                                        initialZoom: 13,
                                        onMapReady: () {
                                          if (mounted) {
                                            setState(() => _mapReady = true);
                                          }
                                        },
                                      ),
                                      children: [
                                        TileLayer(
                                          urlTemplate:
                                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                                          userAgentPackageName: Env.userAgent,
                                          tileProvider:
                                              CancellableNetworkTileProvider(),
                                        ),
                                        PolylineLayer(
                                          polylines: [
                                            if (_routePoints.isNotEmpty)
                                              Polyline(
                                                points: _routePoints,
                                                color: const Color(0xFF2563EB),
                                                strokeWidth: 4,
                                              ),
                                          ],
                                        ),
                                        MarkerLayer(
                                          markers: [
                                            if (booking.pickupRequired &&
                                                _liveLatLng != null)
                                              Marker(
                                                point: _liveLatLng!,
                                                width: 40,
                                                height: 40,
                                                child: Transform.rotate(
                                                  angle: _bearingRad,
                                                  child: const Icon(
                                                    Icons.two_wheeler,
                                                    size: 34,
                                                    color: Color(0xFFEF4444),
                                                  ),
                                                ),
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  Positioned(
                                    top: 12,
                                    right: 12,
                                    child: GestureDetector(
                                      onTap: () => setState(
                                        () =>
                                            _isMapMaximized = !_isMapMaximized,
                                      ),
                                      child: Container(
                                        padding: const EdgeInsets.all(8),
                                        decoration: BoxDecoration(
                                          color: Colors.white.withValues(
                                            alpha: 0.9,
                                          ),
                                          borderRadius: BorderRadius.circular(
                                            8,
                                          ),
                                          boxShadow: [
                                            BoxShadow(
                                              color: Colors.black.withValues(
                                                alpha: 0.1,
                                              ),
                                              blurRadius: 4,
                                              offset: const Offset(0, 2),
                                            ),
                                          ],
                                        ),
                                        child: Icon(
                                          _isMapMaximized
                                              ? Icons.fullscreen_exit
                                              : Icons.fullscreen,
                                          size: 20,
                                          color: const Color(0xFF2563EB),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                        if (booking.delay?.isDelayed == true) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEF2F2),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: const Color(0xFFFECACA),
                              ),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.error_outline,
                                  color: Color(0xFFDC2626),
                                  size: 20,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Service Delayed',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                              fontWeight: FontWeight.w700,
                                              color: const Color(0xFF991B1B),
                                            ),
                                      ),
                                      Text(
                                        '${booking.delay?.reason ?? 'Other'}: ${booking.delay?.note ?? 'No additional details'}',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: const Color(0xFF991B1B),
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (booking.revisit?.isRevisit == true) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEFF6FF),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: const Color(0xFFBFDBFE),
                              ),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.refresh,
                                  color: Color(0xFF2563EB),
                                  size: 20,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Revisit Service',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                              fontWeight: FontWeight.w700,
                                              color: const Color(0xFF1E40AF),
                                            ),
                                      ),
                                      Text(
                                        booking.revisit?.reason ??
                                            'This is a revisit for a previous service.',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: const Color(0xFF1E40AF),
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (booking.pickupRequired && _nearAlertShown) ...[
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFECFDF3),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: const Color(0xFFBBF7D0),
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 22,
                                  height: 22,
                                  decoration: const BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: Color(0xFF22C55E),
                                  ),
                                  child: Icon(
                                    isCarWash
                                        ? Icons.wash
                                        : Icons.directions_car_filled,
                                    size: 14,
                                    color: Colors.white,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        isCarWash
                                            ? 'Staff is nearby'
                                            : 'Staff is nearby',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                              fontWeight: FontWeight.w700,
                                              color: const Color(0xFF166534),
                                            ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        isCarWash
                                            ? (booking.services.any(
                                                    (s) => (s.category ?? '')
                                                        .toLowerCase()
                                                        .contains('essentials'),
                                                  )
                                                  ? 'Your service partner has almost reached your location.'
                                                  : 'Your car wash partner has almost reached your location.')
                                            : 'Your pickup partner has almost reached your location.',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: const Color(0xFF166534),
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (canShowTopReviewCta) ...[
                          const SizedBox(height: 16),
                          SizedBox(
                            width: double.infinity,
                            child: Container(
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [
                                    AppColors.primaryBlue,
                                    AppColors.primaryBlueDark,
                                  ],
                                ),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: ElevatedButton.icon(
                                onPressed: _showReviewDialog,
                                icon: const Icon(Icons.star),
                                label: const Text(
                                  'Rate your experience',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.transparent,
                                  shadowColor: Colors.transparent,
                                  foregroundColor: AppColors.textPrimary,
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 16,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                        if (!isDeliveredStatus && showLiveTrackingMap) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: isDark
                                  ? const Color(0xFF1E1E1E)
                                  : Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: isDark
                                    ? Colors.grey.shade800
                                    : Colors.grey.shade200,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: isDark
                                      ? Colors.black.withValues(alpha: 0.2)
                                      : Colors.black.withValues(alpha: 0.05),
                                  blurRadius: 10,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    if (booking.pickupRequired ||
                                        isCarWash) ...[
                                      Container(
                                        width: 10,
                                        height: 10,
                                        decoration: BoxDecoration(
                                          color: _socketConnected
                                              ? const Color(0xFF22C55E)
                                              : const Color(0xFF94A3B8),
                                          borderRadius: BorderRadius.circular(
                                            999,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          _socketConnected
                                              ? 'Live tracking connected'
                                              : 'Live tracking disconnected',
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.copyWith(
                                                fontWeight: FontWeight.w700,
                                              ),
                                        ),
                                      ),
                                      if (_liveLatLng != null &&
                                          _liveUpdatedAt != null)
                                        Text(
                                          ' • ${_formatClockTime(context, _liveUpdatedAt!)}',
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.copyWith(
                                                fontWeight: FontWeight.w700,
                                              ),
                                        ),
                                      if (_etaTextDuration != null &&
                                          _etaTextDistance != null)
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            left: 8,
                                          ),
                                          child: Text(
                                            'ETA: $_etaTextDuration • $_etaTextDistance',
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall
                                                ?.copyWith(
                                                  fontWeight: FontWeight.w700,
                                                ),
                                          ),
                                        ),
                                    ] else ...[
                                      Expanded(
                                        child: Text(
                                          'Pickup not required. Go directly to the workshop.',
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.copyWith(
                                                fontWeight: FontWeight.w700,
                                              ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  (booking.pickupRequired || isCarWash)
                                      ? (bookingLoc?.address != null &&
                                                bookingLoc!.address!.isNotEmpty
                                            ? bookingLoc.address!
                                            : (bookingLatLng == null
                                                  ? 'Service location not set'
                                                  : '${bookingLatLng.latitude.toStringAsFixed(6)}, ${bookingLatLng.longitude.toStringAsFixed(6)}'))
                                      : (merchantLoc?.address != null &&
                                                merchantLoc!.address!.isNotEmpty
                                            ? merchantLoc.address!
                                            : (merchantLatLng == null
                                                  ? 'Workshop location not set'
                                                  : '${merchantLatLng.latitude.toStringAsFixed(6)}, ${merchantLatLng.longitude.toStringAsFixed(6)}')),
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(
                                        color: isDark
                                            ? Colors.white70
                                            : Colors.black87,
                                      ),
                                ),
                                if ((booking.pickupRequired || isCarWash) &&
                                    _liveLatLng != null) ...[
                                  const SizedBox(height: 8),
                                  Text(
                                    '${_liveName ?? 'Staff'} • ${_liveUpdatedAt != null ? _formatClockTime(context, _liveUpdatedAt!) : 'Live'}',
                                    style: Theme.of(context).textTheme.bodySmall
                                        ?.copyWith(
                                          color: isDark
                                              ? Colors.white70
                                              : Colors.black87,
                                        ),
                                  ),
                                ],
                                if ((booking.pickupRequired || isCarWash) &&
                                    _socketError != null &&
                                    _socketError!.isNotEmpty) ...[
                                  const SizedBox(height: 8),
                                  Text(
                                    _socketError!,
                                    style: Theme.of(context).textTheme.bodySmall
                                        ?.copyWith(
                                          color: isDark
                                              ? Colors.white70
                                              : Colors.black54,
                                        ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                        if ((booking.status == 'SERVICE_COMPLETED' ||
                                booking.status == 'COMPLETED' ||
                                booking.status == 'DELIVERED') &&
                            booking.paymentStatus != 'paid') ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEEF2FF),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: const Color(0xFF6366F1),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Icon(
                                      Icons.payment,
                                      color: Color(0xFF4F46E5),
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Payment Required',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleSmall
                                          ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                            color: const Color(0xFF4F46E5),
                                          ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Payment awaiting to dispatch vehicle. Service is completed',
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(
                                        color: const Color(0xFF4B5563),
                                      ),
                                ),
                                const SizedBox(height: 16),
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: _isPaymentLoading
                                        ? null
                                        : () => _onPayNowClicked(
                                            isGeneralService,
                                          ),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFF4F46E5),
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 14,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      elevation: 0,
                                    ),
                                    child: _isPaymentLoading
                                        ? const SizedBox(
                                            height: 20,
                                            width: 20,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: Colors.white,
                                            ),
                                          )
                                        : Text(
                                            'Pay ₹${formatInrAmount(booking.calculatedTotal)}',
                                            style: TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],

                        if (booking.shouldShowCustomerDeliveryOtp) ...[
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEEF2FF),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: const Color(0xFF6366F1),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  (isCarWash || isBatteryTire)
                                      ? 'Completion OTP'
                                      : 'Delivery OTP',
                                  style: Theme.of(context).textTheme.titleMedium
                                      ?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: const Color(0xFF4F46E5),
                                      ),
                                ),
                                const SizedBox(height: 8),
                                Center(
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 10,
                                    ),
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      booking.deliveryOtp!.code,
                                      style: const TextStyle(
                                        fontSize: 22,
                                        letterSpacing: 4,
                                        fontWeight: FontWeight.w700,
                                        color: Color(0xFF111827),
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  (isCarWash || isBatteryTire)
                                      ? 'Share this code with our staff to confirm service completion.'
                                      : 'Share this code only with our staff at the time of delivery.',
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(
                                        color: const Color(0xFF4B5563),
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (!isCarWash &&
                            !isBatteryTire &&
                            !isGeneralService) ...[
                          const SizedBox(height: 24),
                          Text(
                            'Detailed Status',
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: isDark ? Colors.black : Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: isDark
                                    ? Colors.grey.shade900
                                    : const Color(0xFFE5E7EB),
                              ),
                            ),
                            child: Column(
                              children: [
                                _StatusRow(
                                  label: 'Inspection',
                                  isCompleted:
                                      booking.inspectionCompletedAt != null,
                                  time: _formatDateTime(
                                    context,
                                    booking.inspectionCompletedAt,
                                  ),
                                  isDark: isDark,
                                ),
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 12),
                                  child: Divider(height: 1),
                                ),
                                _StatusRow(
                                  label: 'Service & QC',
                                  isCompleted: booking.qcCompletedAt != null,
                                  time: _formatDateTime(
                                    context,
                                    booking.qcCompletedAt,
                                  ),
                                  isDark: isDark,
                                ),
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 12),
                                  child: Divider(height: 1),
                                ),
                                _StatusRow(
                                  label: 'Payment',
                                  isCompleted: booking.paymentStatus == 'paid',
                                  time: booking.paymentStatus == 'paid'
                                      ? 'Completed'
                                      : 'Pending',
                                  isDark: isDark,
                                ),
                              ],
                            ),
                          ),
                        ],
                        const SizedBox(height: 24),
                        Text(
                          'Service Progress',
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.only(
                            top: 20,
                            left: 20,
                            right: 20,
                            bottom: 10,
                          ),
                          decoration: BoxDecoration(
                            color: isDark ? Colors.black : Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: isDark
                                  ? Colors.grey.shade900
                                  : const Color(0xFFE5E7EB),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (booking.pickupRequired &&
                                  booking.status == 'REACHED_CUSTOMER' &&
                                  _nearAlertShown) ...[
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(
                                      width: 8,
                                      height: 8,
                                      decoration: const BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: Color(0xFF22C55E),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      'Staff is nearby',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall
                                          ?.copyWith(
                                            fontWeight: FontWeight.w600,
                                            color: const Color(0xFF166534),
                                          ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 10),
                              ],
                              Builder(
                                builder: (context) {
                                  final flow = Booking.getFlowForBooking(
                                    booking,
                                  );
                                  final labels = flow
                                      .map(
                                        (s) => Booking.getStatusLabel(
                                          s,
                                          booking.services,
                                        ),
                                      )
                                      .toList();
                                  final labelToStatus = Map.fromIterables(
                                    labels,
                                    flow,
                                  );

                                  // Determine active index based on status flow
                                  int activeIndex = flow.indexOf(
                                    booking.status.toUpperCase(),
                                  );
                                  if (activeIndex == -1) {
                                    // Handle some aliases or special cases
                                    if (booking.status.toUpperCase() ==
                                            'COMPLETED' &&
                                        flow.contains('DELIVERED')) {
                                      activeIndex = flow.indexOf('DELIVERED');
                                    } else if (booking.status.toUpperCase() ==
                                            'DELIVERED' &&
                                        flow.contains('COMPLETED')) {
                                      activeIndex = flow.indexOf('COMPLETED');
                                    } else {
                                      activeIndex = 0;
                                    }
                                  }

                                  return _VerticalStepper(
                                    labels: labels,
                                    activeIndex: activeIndex,
                                    statusHistory: booking.statusHistory,
                                    labelToStatus: labelToStatus,
                                  );
                                },
                              ),
                            ],
                          ),
                        ),
                        if (!isDeliveredStatus) ...[
                          // Driver/Staff Details Section
                          const SizedBox(height: 16),
                          (() {
                            final name =
                                booking.carWash?.staffName ??
                                booking.driverName ??
                                booking.technicianName;
                            final phone =
                                booking.carWash?.staffPhone ??
                                booking.driverPhone ??
                                booking.technicianPhone;

                            return _buildInfoCard(
                              context,
                              title: isCarWash
                                  ? 'Staff Details'
                                  : 'Driver Details',
                              icon: isCarWash
                                  ? Icons.person
                                  : Icons.two_wheeler,
                              name: name,
                              phone: phone,
                              subtitle: name == null
                                  ? 'your ${isCarWash ? 'staff' : 'driver'} details provided shortly'
                                  : null,
                              isDark: isDark,
                              actions: phone != null
                                  ? [
                                      _buildCircleActionButton(
                                        icon: Icons.phone,
                                        color: const Color(0xFF22C55E),
                                        bgColor: const Color(0xFFDCFCE7),
                                        onTap: () =>
                                            launchUrl(Uri.parse('tel:$phone')),
                                      ),
                                    ]
                                  : [],
                            );
                          })(),
                          const SizedBox(height: 12),
                          // Service Center Section - only for non-car wash
                          if (!isCarWash) ...[
                            _buildInfoCard(
                              context,
                              title: 'Service Center',
                              icon: Icons.storefront,
                              name: booking.merchantName,
                              phone: booking.merchantPhone,
                              subtitle: booking.merchantName == null
                                  ? 'your authorised service center details provide shortly'
                                  : null,
                              isDark: isDark,
                              actions: [
                                if (booking.merchantPhone != null)
                                  _buildCircleActionButton(
                                    icon: Icons.phone,
                                    color: const Color(0xFF22C55E),
                                    bgColor: const Color(0xFFDCFCE7),
                                    onTap: () => launchUrl(
                                      Uri.parse('tel:${booking.merchantPhone}'),
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 16),
                          ],
                        ],
                        if (inspectionItems.isNotEmpty) ...[
                          const SizedBox(height: 24),
                          _buildPhotoGridSection(
                            title: 'Vehicle Inspection',
                            subtitle:
                                'Photos of your vehicle taken by the service center before starting the service.',
                            items: inspectionItems,
                            isDark: isDark,
                          ),
                        ],

                        // Replaced Parts Section (Frontend Parity)
                        if (booking.serviceParts.isNotEmpty) ...[
                          const SizedBox(height: 24),
                          Text(
                            'Replaced Parts',
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 12),
                          ListView.separated(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: booking.serviceParts.length,
                            separatorBuilder: (context, _) =>
                                const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final part = booking.serviceParts[index];
                              return Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(12),
                                  onTap: () =>
                                      _showPartDetailsDialog(part, isDark),
                                  child: Container(
                                    padding: const EdgeInsets.all(12),
                                    decoration: BoxDecoration(
                                      color: isDark
                                          ? Colors.black
                                          : Colors.white,
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(
                                        color: isDark
                                            ? Colors.grey.shade900
                                            : const Color(0xFFE5E7EB),
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                part.name,
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 14,
                                                ),
                                              ),
                                              Text(
                                                'Qty: ${part.quantity} • Price: ₹${part.price}',
                                                style: TextStyle(
                                                  fontSize: 12,
                                                  color: isDark
                                                      ? Colors.white60
                                                      : Colors.black54,
                                                ),
                                              ),
                                              const SizedBox(height: 4),
                                              Container(
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                      horizontal: 8,
                                                      vertical: 2,
                                                    ),
                                                decoration: BoxDecoration(
                                                  color: part.fromInspection
                                                      ? const Color(0xFFDCFCE7)
                                                      : const Color(0xFFDBEAFE),
                                                  borderRadius:
                                                      BorderRadius.circular(99),
                                                ),
                                                child: Text(
                                                  part.fromInspection
                                                      ? 'From inspection'
                                                      : 'New discovery',
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w700,
                                                    color: part.fromInspection
                                                        ? const Color(
                                                            0xFF166534,
                                                          )
                                                        : const Color(
                                                            0xFF1E40AF,
                                                          ),
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        _buildPartImage(
                                          part.oldImage,
                                          'Before',
                                          isDark,
                                        ),
                                        const SizedBox(width: 8),
                                        _buildPartImage(
                                          part.image,
                                          'After',
                                          isDark,
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ],
                        if (prePickupItems.isNotEmpty) ...[
                          const SizedBox(height: 24),
                          _buildPhotoGridSection(
                            title: isBatteryTire
                                ? 'Pickup & Installation'
                                : 'Pre-Picked Photos',
                            items: prePickupItems,
                            isDark: isDark,
                          ),
                        ],
                        if (isCarWash &&
                            (beforeCarWashItems.isNotEmpty ||
                                afterCarWashItems.isNotEmpty)) ...[
                          const SizedBox(height: 24),
                          Text(
                            'Service Photos',
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          if (beforeCarWashItems.isNotEmpty) ...[
                            const SizedBox(height: 12),
                            _buildPhotoGridSection(
                              title:
                                  '$beforeCarWashTitle (${beforeCarWashItems.length}/4)',
                              items: beforeCarWashItems,
                              isDark: isDark,
                            ),
                          ],
                          if (afterCarWashItems.isNotEmpty) ...[
                            const SizedBox(height: 12),
                            _buildPhotoGridSection(
                              title:
                                  '$afterCarWashTitle (${afterCarWashItems.length}/4)',
                              items: afterCarWashItems,
                              isDark: isDark,
                            ),
                          ],
                        ] else if (servicePhotoItems.isNotEmpty) ...[
                          const SizedBox(height: 24),
                          _buildPhotoGridSection(
                            title: 'Service Photos',
                            items: servicePhotoItems,
                            isDark: isDark,
                          ),
                        ],
                        const SizedBox(height: 24),
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: isDark
                                ? const Color(0xFF1E1E1E)
                                : Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: isDark
                                  ? Colors.grey.shade800
                                  : Colors.grey.shade200,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: isDark
                                    ? Colors.black.withValues(alpha: 0.2)
                                    : Colors.black.withValues(alpha: 0.05),
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  ConstrainedBox(
                                    constraints: const BoxConstraints(
                                      maxWidth: 220,
                                    ),
                                    child: Text(
                                      'Booking #${booking.orderNumber ?? booking.id}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleSmall
                                          ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                          ),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 6,
                                    ),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFEDE9FE),
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                    child: Text(
                                      _statusLabel(booking.status),
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                        color: Color.fromARGB(255, 76, 42, 230),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              Text(
                                _formatDateTime(context, booking.date),
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
                                      color: isDark
                                          ? Colors.white70
                                          : Colors.black54,
                                    ),
                              ),
                              const SizedBox(height: 12),
                              if (booking.vehicle != null) ...[
                                Row(
                                  children: [
                                    if (_resolveImageUrl(
                                          booking.vehicle!.image,
                                        ) !=
                                        null)
                                      Container(
                                        width: 60,
                                        height: 60,
                                        margin: const EdgeInsets.only(
                                          right: 12,
                                        ),
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          border: Border.all(
                                            color: isDark
                                                ? Colors.grey.shade900
                                                : const Color(0xFFE5E7EB),
                                          ),
                                        ),
                                        child: ClipRRect(
                                          borderRadius: BorderRadius.circular(
                                            11,
                                          ),
                                          child: CachedNetworkImage(
                                            imageUrl: _resolveImageUrl(
                                              booking.vehicle!.image,
                                            )!,
                                            fit: BoxFit.cover,
                                            placeholder: (context, url) =>
                                                const Center(
                                                  child:
                                                      CircularProgressIndicator(
                                                        strokeWidth: 2,
                                                      ),
                                                ),
                                            errorWidget:
                                                (context, url, error) =>
                                                    const Icon(
                                                      Icons.broken_image,
                                                      size: 20,
                                                    ),
                                          ),
                                        ),
                                      ),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '${booking.vehicle!.make} ${booking.vehicle!.model}${booking.vehicle!.variant != null && booking.vehicle!.variant!.isNotEmpty ? ' ${booking.vehicle!.variant}' : ''}',
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodyMedium
                                                ?.copyWith(
                                                  fontWeight: FontWeight.w600,
                                                ),
                                          ),
                                          Text(
                                            booking.vehicle!.licensePlate,
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall
                                                ?.copyWith(
                                                  color: isDark
                                                      ? Colors.white70
                                                      : Colors.black54,
                                                ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                              if ((booking.billing != null &&
                                      (booking.billing!.total > 0 ||
                                          booking.billing!.invoiceNumber !=
                                              null)) ||
                                  (booking.pickupDropPrice != null &&
                                      booking.pickupDropPrice! > 0)) ...[
                                const SizedBox(height: 12),
                                const Divider(height: 1),
                                const SizedBox(height: 12),
                                _buildCostRow(
                                  'Base Service Amount',
                                  '₹${servicesTotal.toInt()}',
                                  isDark,
                                ),
                                if ((booking.billing?.partsTotal ?? 0) > 0)
                                  _buildCostRow(
                                    'Parts Total',
                                    '₹${booking.billing!.partsTotal}',
                                    isDark,
                                  ),
                                if ((booking.billing?.labourCost ?? 0) > 0)
                                  _buildCostRow(
                                    'Labour Cost',
                                    '₹${booking.billing!.labourCost}',
                                    isDark,
                                  ),
                                if ((tax > 0) ||
                                    (!isGeneralService && orderTotals.tax > 0))
                                  _buildCostRow(
                                    'Tax (GST 18%)',
                                    '₹${formatInrAmount(tax)}',
                                    isDark,
                                  ),
                                if (((booking.pickupDropPrice ??
                                            booking.billing?.pickupDropPrice ??
                                            0) >
                                        0) &&
                                    isGeneralServiceList(booking.services))
                                  _buildCostRow(
                                    'Pickup/Drop Price',
                                    '₹${booking.pickupDropPrice ?? booking.billing?.pickupDropPrice}',
                                    isDark,
                                  ),
                                if ((booking.discountAmount ?? 0) > 0)
                                  _buildCalculationBreakdown(
                                    booking: booking,
                                    isDark: isDark,
                                    isGeneralService: isGeneralService,
                                    discount: discount,
                                    totalAmount: orderTotals.subtotal,
                                    finalAmount: finalTotal,
                                  ),
                                const SizedBox(height: 8),
                                const Divider(height: 1),
                                const SizedBox(height: 8),
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      'Total Billed Amount',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyMedium
                                          ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                            color: isDark
                                                ? Colors.white
                                                : Colors.black87,
                                          ),
                                    ),
                                    Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.end,
                                      children: [
                                        Text(
                                          '₹${formatInrAmount(finalTotal)}',
                                          style: Theme.of(context)
                                              .textTheme
                                              .titleMedium
                                              ?.copyWith(
                                                color: const Color(0xFF2563EB),
                                                fontWeight: FontWeight.w800,
                                              ),
                                        ),
                                        if (discount > 0)
                                          Text(
                                            '₹${(finalTotal + discount).toStringAsFixed(2)}',
                                            style: const TextStyle(
                                              fontSize: 10,
                                              color: Colors.grey,
                                              decoration:
                                                  TextDecoration.lineThrough,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ] else ...[
                                _buildCostRow(
                                  isGeneralService
                                      ? 'Base Service Amount'
                                      : 'Subtotal',
                                  '₹${formatInrAmount(subtotal)}',
                                  isDark,
                                ),
                                if (discount > 0) ...[
                                  _buildCostRow(
                                    'Discount',
                                    '-₹$discount',
                                    isDark,
                                  ),
                                  _buildCalculationBreakdown(
                                    booking: booking,
                                    isDark: isDark,
                                    isGeneralService: isGeneralService,
                                    discount: discount,
                                    totalAmount: orderTotals.subtotal,
                                    finalAmount: finalTotal,
                                  ),
                                ],
                                if (!isGeneralService && tax > 0)
                                  _buildCostRow(
                                    'Tax (GST 18%)',
                                    '₹${formatInrAmount(tax)}',
                                    isDark,
                                  ),
                                if ((booking.partsAndOtherTotal) > 0)
                                  _buildCostRow(
                                    'Additional Parts/Service',
                                    '₹${booking.partsAndOtherTotal}',
                                    isDark,
                                  ),
                                const SizedBox(height: 8),
                                const Divider(height: 1),
                                const SizedBox(height: 8),
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      'Total Amount',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyMedium
                                          ?.copyWith(
                                            color: isDark
                                                ? Colors.white70
                                                : Colors.black54,
                                          ),
                                    ),
                                    Text(
                                      '₹${formatInrAmount(finalTotal)}',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium
                                          ?.copyWith(
                                            color: isDark
                                                ? Colors.white
                                                : Colors.black87,
                                            fontWeight: FontWeight.w800,
                                          ),
                                    ),
                                  ],
                                ),
                              ],
                              if (booking.paymentStatus != 'paid' &&
                                  (booking.status == 'SERVICE_COMPLETED' ||
                                      booking.status == 'COMPLETED' ||
                                      booking.status == 'DELIVERED') &&
                                  !isCarWash &&
                                  !isBatteryTire)
                                ...[],
                              if ((isCarWash || isBatteryTire) &&
                                  booking.paymentStatus == 'pending')
                                Container(
                                  margin: const EdgeInsets.only(top: 12),
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFF7ED),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                      color: const Color(0xFFFFEDD5),
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      const Icon(
                                        Icons.warning_amber_rounded,
                                        size: 16,
                                        color: Color(0xFFC2410C),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          isCarWash
                                              ? (booking.services.any(
                                                      (s) => (s.category ?? '')
                                                          .toLowerCase()
                                                          .contains(
                                                            'essentials',
                                                          ),
                                                    )
                                                    ? 'Payment required to confirm your service booking'
                                                    : 'Payment required to confirm your car wash booking')
                                              : 'Payment required to confirm your battery/tire booking',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                            color: Color(0xFFC2410C),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              if ((isCarWash || isBatteryTire) &&
                                  booking.paymentStatus == 'paid')
                                Container(
                                  margin: const EdgeInsets.only(top: 12),
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF0FDF4),
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(
                                      color: const Color(0xFFDCFCE7),
                                    ),
                                  ),
                                  child: const Row(
                                    children: [
                                      Icon(
                                        Icons.check_circle_outline,
                                        size: 16,
                                        color: Color(0xFF15803D),
                                      ),
                                      SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          'Payment completed',
                                          style: TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                            color: Color(0xFF15803D),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              if (booking.paymentStatus != 'paid' &&
                                  ((isCarWash || isBatteryTire) ||
                                      booking.status == 'SERVICE_COMPLETED' ||
                                      booking.status == 'COMPLETED' ||
                                      booking.status == 'DELIVERED')) ...[
                                const SizedBox(height: 16),
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: _isPaymentLoading
                                        ? null
                                        : () => _onPayNowClicked(
                                            isGeneralService,
                                          ),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFF2563EB),
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(
                                        vertical: 16,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      elevation: 0,
                                    ),
                                    child: _isPaymentLoading
                                        ? const SizedBox(
                                            height: 20,
                                            width: 20,
                                            child: CircularProgressIndicator(
                                              color: Colors.white,
                                              strokeWidth: 2,
                                            ),
                                          )
                                        : Text(
                                            (isCarWash || isBatteryTire)
                                                ? 'Pay Now to Confirm'
                                                : 'Pay Now',
                                            style: const TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        // Warranty Information - Only for battery/tire
                        if (isBatteryTire &&
                            booking.batteryTire?.warrantyName != null) ...[
                          const SizedBox(height: 24),
                          Text(
                            'Warranty Information',
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: isDark ? Colors.black : Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: isDark
                                    ? Colors.grey.shade900
                                    : const Color(0xFFE5E7EB),
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (booking.batteryTire?.warrantyImage != null)
                                  Container(
                                    width: 80,
                                    height: 80,
                                    margin: const EdgeInsets.only(right: 12),
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(
                                        color: isDark
                                            ? Colors.grey.shade900
                                            : const Color(0xFFE5E7EB),
                                      ),
                                    ),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(11),
                                      child: CachedNetworkImage(
                                        imageUrl: _resolveImageUrl(
                                          booking.batteryTire!.warrantyImage,
                                        )!,
                                        fit: BoxFit.cover,
                                      ),
                                    ),
                                  ),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        booking.batteryTire!.warrantyName!,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodyMedium
                                            ?.copyWith(
                                              fontWeight: FontWeight.w600,
                                            ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Warranty: ${booking.batteryTire!.warrantyMonths} Months',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: isDark
                                                  ? Colors.white70
                                                  : Colors.black54,
                                            ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        'Price: ₹${booking.batteryTire!.warrantyPrice}',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              fontWeight: FontWeight.bold,
                                              color: const Color(0xFF2563EB),
                                            ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPhotoGridSection({
    required String title,
    String? subtitle,
    required List<_PhotoCarouselItem> items,
    required bool isDark,
  }) {
    if (items.isEmpty) return const SizedBox.shrink();
    final visibleItems = items.take(4).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 8),
          Text(
            subtitle,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: isDark ? Colors.white70 : Colors.black54,
            ),
          ),
        ],
        const SizedBox(height: 12),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: visibleItems.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1,
          ),
          itemBuilder: (context, index) {
            final item = visibleItems[index];
            return GestureDetector(
              onTap: () => _showImagePreview(item.url),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    CachedNetworkImage(
                      imageUrl: item.url,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => const Center(
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      errorWidget: (context, url, error) =>
                          const Icon(Icons.broken_image, size: 24),
                    ),
                    Positioned(
                      left: 8,
                      bottom: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          item.label ?? 'Photo ${index + 1}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildCostRow(
    String label,
    String value,
    bool isDark, {
    bool isDiscount = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: isDiscount
                  ? const Color(0xFF4ADE80)
                  : (isDark ? Colors.white60 : Colors.black54),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              color: isDiscount
                  ? const Color(0xFF4ADE80)
                  : (isDark ? Colors.white70 : Colors.black87),
              fontWeight: isDiscount ? FontWeight.w600 : FontWeight.normal,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCalculationBreakdown({
    required Booking booking,
    required bool isDark,
    required bool isGeneralService,
    required double discount,
    required double totalAmount,
    required double finalAmount,
  }) {
    if (discount <= 0) return const SizedBox.shrink();

    // Calculate percentage if not explicitly provided
    final discountPercentage = totalAmount > 0
        ? ((discount / totalAmount) * 100).round()
        : 0;
    final discountFactor = totalAmount > 0
        ? (discount / totalAmount).toStringAsFixed(2)
        : "0.00";

    return Container(
      margin: const EdgeInsets.only(top: 16, bottom: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFDCFCE7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 3,
                height: 12,
                decoration: BoxDecoration(
                  color: const Color(0xFF22C55E),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 8),
              const Text(
                'CALCULATION BREAKDOWN',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF166534),
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildBreakdownRow(
            'Total Amount',
            '₹${formatInrAmount(totalAmount)}',
          ),
          _buildBreakdownRow(
            'Applied Coupon (${booking.couponCode ?? 'DISCOUNT'})',
            '$discountPercentage% Off',
            valueColor: const Color(0xFF16A34A),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 4),
            child: Divider(height: 1, color: Color(0x26166534)),
          ),
          _buildBreakdownRow(
            'Discount Calculation',
            '${formatInrAmount(totalAmount)} × $discountFactor = ₹${formatInrAmount(discount)}',
          ),
          _buildBreakdownRow(
            'Final Payable',
            '${formatInrAmount(totalAmount)} − ${formatInrAmount(discount)} = ₹${formatInrAmount(finalAmount)}',
            isBold: true,
          ),
        ],
      ),
    );
  }

  Widget _buildBreakdownRow(
    String label,
    String value, {
    Color? valueColor,
    bool isBold = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: const Color(0xFF15803D).withValues(alpha: 0.8),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 12,
              fontWeight: isBold ? FontWeight.w800 : FontWeight.w600,
              color: valueColor ?? const Color(0xFF166534),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoCard(
    BuildContext context, {
    required String title,
    required IconData icon,
    String? name,
    String? phone,
    String? subtitle,
    required bool isDark,
    required List<Widget> actions,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E1E1E) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? Colors.grey.shade800 : Colors.grey.shade200,
        ),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.2)
                : Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: isDark
                      ? const Color(0xFF2D2D2D)
                      : const Color(0xFFEEF2FF),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 20, color: const Color(0xFF4F46E5)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: isDark ? Colors.white : Colors.black87,
                  ),
                ),
              ),
            ],
          ),
          if (name != null || subtitle != null) ...[
            const SizedBox(height: 16),
            Divider(
              height: 1,
              thickness: 1,
              color: isDark ? Colors.grey.shade800 : Colors.grey.shade200,
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (name != null)
                        Text(
                          name,
                          style: Theme.of(context).textTheme.bodyLarge
                              ?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: isDark ? Colors.white : Colors.black87,
                              ),
                        ),
                      if (phone != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          phone,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                color: isDark ? Colors.white70 : Colors.black54,
                              ),
                        ),
                      ],
                      if (subtitle != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          subtitle,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                color: isDark ? Colors.white54 : Colors.black45,
                                fontStyle: FontStyle.italic,
                              ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (actions.isNotEmpty)
                  Row(mainAxisSize: MainAxisSize.min, children: actions),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCircleActionButton({
    required IconData icon,
    required Color color,
    required Color bgColor,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(30),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
          child: Icon(icon, size: 22, color: color),
        ),
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  final String label;
  final bool isCompleted;
  final String time;
  final bool isDark;

  const _StatusRow({
    required this.label,
    required this.isCompleted,
    required this.time,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isCompleted ? AppColors.success : AppColors.textMuted,
          ),
          child: Icon(
            isCompleted ? Icons.check : Icons.access_time,
            size: 12,
            color: Colors.white,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: isDark ? Colors.white : Colors.black87,
            ),
          ),
        ),
        Text(
          time,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: isDark ? Colors.white70 : Colors.black54,
          ),
        ),
      ],
    );
  }
}

class _VerticalStepper extends StatelessWidget {
  final List<String> labels;
  final int activeIndex;
  final List<Map<String, String>> statusHistory;
  final Map<String, String> labelToStatus;

  const _VerticalStepper({
    required this.labels,
    required this.activeIndex,
    required this.statusHistory,
    required this.labelToStatus,
  });

  String? _getTimeForStep(String label) {
    final statusKey = labelToStatus[label];
    if (statusKey == null) return null;

    try {
      final historyEntry = statusHistory.firstWhere(
        (entry) => entry['status'] == statusKey,
      );
      final timestamp = historyEntry['timestamp'];
      if (timestamp != null) {
        final dt = DateTime.parse(timestamp).toLocal();
        final date =
            '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
        final hour = dt.hour > 12
            ? dt.hour - 12
            : (dt.hour == 0 ? 12 : dt.hour);
        final ampm = dt.hour >= 12 ? 'PM' : 'AM';
        final min = dt.minute.toString().padLeft(2, '0');
        return '$date • $hour:$min $ampm';
      }
    } catch (_) {
      // Status not found in history
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final barColor = isDark ? const Color(0xFF374151) : const Color(0xFFE5E7EB);
    final inactiveDotFill = isDark ? const Color(0xFF9CA3AF) : Colors.white;
    final inactiveDotBorder = isDark
        ? const Color(0xFF9CA3AF)
        : const Color(0xFFE5E7EB);

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: labels.length,
      itemBuilder: (context, index) {
        final isCompleted = index <= activeIndex;
        final isActive = index == activeIndex;
        final isLast = index == labels.length - 1;
        final timeStr = _getTimeForStep(labels[index]);

        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Timeline Column
              SizedBox(
                width: 40,
                child: Column(
                  children: [
                    // Dot
                    Container(
                      width: 24,
                      height: 24,
                      margin: const EdgeInsets.only(top: 4),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isCompleted
                            ? const Color(0xFF4F46E5)
                            : inactiveDotFill,
                        border: Border.all(
                          color: isCompleted
                              ? const Color(0xFF4F46E5)
                              : inactiveDotBorder,
                          width: 2,
                        ),
                      ),
                      child: isCompleted
                          ? const Icon(
                              Icons.check,
                              size: 14,
                              color: Colors.white,
                            )
                          : null,
                    ),
                    // Line
                    if (!isLast)
                      Expanded(
                        child: Container(
                          width: 2,
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          color: isCompleted
                              ? const Color(0xFF4F46E5)
                              : barColor,
                          constraints: const BoxConstraints(minHeight: 30),
                        ),
                      ),
                  ],
                ),
              ),
              // Content Column
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 24.0, top: 4.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        labels[index],
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: isActive
                              ? FontWeight.bold
                              : FontWeight.w600,
                          color: isCompleted
                              ? (isDark
                                    ? Colors.white
                                    : const Color(0xFF0F172A))
                              : (isDark
                                    ? Colors.white60
                                    : const Color(0xFF94A3B8)),
                        ),
                      ),
                      if (timeStr != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            timeStr,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF64748B),
                              fontWeight: FontWeight.w500,
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
      },
    );
  }
}

class DashedLinePainter extends CustomPainter {
  final Color color;
  DashedLinePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    double dashHeight = 5, dashSpace = 3, startY = 10;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    while (startY < size.height - 10) {
      canvas.drawLine(Offset(0, startY), Offset(0, startY + dashHeight), paint);
      startY += dashHeight + dashSpace;
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
