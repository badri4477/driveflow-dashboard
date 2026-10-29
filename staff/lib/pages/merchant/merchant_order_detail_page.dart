import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../../core/app_colors.dart';
import '../../models/booking.dart';
import '../../core/storage.dart';
import '../../services/booking_service.dart';
import '../../core/socket_sync.dart';
import '../../services/socket_service.dart';
import '../../services/vehicle_service.dart';
import '../../utils/chat_seen_store.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/order_route_map.dart';
import '../../widgets/states/status_feedback.dart';
import '../../widgets/states/skeleton.dart';
import '../../widgets/states/state_view.dart';
import '../../widgets/image_source_sheet.dart';
import '../../widgets/image_viewer.dart';

class MerchantOrderDetailPage extends StatefulWidget {
  const MerchantOrderDetailPage({super.key});

  @override
  State<MerchantOrderDetailPage> createState() =>
      _MerchantOrderDetailPageState();
}

class _MerchantOrderDetailPageState extends State<MerchantOrderDetailPage>
    with SingleTickerProviderStateMixin {
  final BookingService _service = BookingService();
  final VehicleService _vehicleService = VehicleService();
  final SocketService _socketService = SocketService();
  final ImagePicker _picker = ImagePicker();

  BookingDetail? _booking;
  bool _isLoading = true;
  bool _isSaving = false;
  TabController? _tabController;
  bool _serviceStartedLocally = false;
  bool _serviceStartingOverlay = false;
  double? _staffLat;
  double? _staffLng;

  // Inspection State
  String? _frontPhoto;
  String? _backPhoto;
  String? _leftPhoto;
  String? _rightPhoto;
  final TextEditingController _damageReportController = TextEditingController();

  // Service Execution State
  final TextEditingController _extraCostReasonController =
      TextEditingController();
  final TextEditingController _extraCostAmountController =
      TextEditingController();
  final List<Map<String, dynamic>> _newServiceParts = [];
  final List<String> _sentInspectionPartIds = [];
  final List<XFile> _newAfterPhotos = [];

  // Billing State
  final TextEditingController _invoiceNumberController =
      TextEditingController();
  final TextEditingController _partsCostController = TextEditingController();
  final TextEditingController _labourCostController = TextEditingController();
  final TextEditingController _gstController = TextEditingController();
  final TextEditingController _pickupDropPriceController =
      TextEditingController();
  final TextEditingController _invoiceDateController = TextEditingController();
  DateTime? _selectedInvoiceDate;
  XFile? _billFile;

  // QC State
  bool _testRideChecked = false;
  bool _safetyChecksChecked = false;
  bool _noLeaksChecked = false;
  bool _noErrorLightsChecked = false;

  // Warranty State (Battery/Tire)
  final TextEditingController _warrantyNameController = TextEditingController();
  final TextEditingController _warrantyPriceController =
      TextEditingController();
  final TextEditingController _warrantyMonthsController =
      TextEditingController();
  String? _warrantyImage;
  bool _isUploading = false;
  final Map<String, _HealthDraft> _healthDraft = {};
  int _unreadChatCount = 0;
  bool _isChatOpen = false;

  @override
  void initState() {
    super.initState();
    _socketService.on('receiveMessage', _handleIncomingChatForBadge);
    _socketService.on('loadMessages', _handleLoadMessagesForBadge);
    _socketService.on('liveLocation', _handleLiveLocation);
    _socketService.on('bookingUpdated', _handleBookingUpdated);
  }

  @override
  void dispose() {
    if (_booking != null) {
      _socketService.leaveRoom('booking_${_booking!.id}');
    }
    _socketService.off('liveLocation', _handleLiveLocation);
    _socketService.off('bookingUpdated', _handleBookingUpdated);
    _tabController?.dispose();
    _extraCostReasonController.dispose();
    _extraCostAmountController.dispose();
    _invoiceNumberController.dispose();
    _partsCostController.dispose();
    _labourCostController.dispose();
    _gstController.dispose();
    _pickupDropPriceController.dispose();
    _invoiceDateController.dispose();
    _warrantyNameController.dispose();
    _warrantyPriceController.dispose();
    _warrantyMonthsController.dispose();
    _socketService.off('receiveMessage', _handleIncomingChatForBadge);
    _socketService.off('loadMessages', _handleLoadMessagesForBadge);
    super.dispose();
  }

  // Seed the chat badge from history: messages from others since this
  // device last opened the chat (persists across leaving the screen).
  Future<void> _handleLoadMessagesForBadge(dynamic data) async {
    if (!mounted || _booking == null || _isChatOpen || data is! List) return;
    final bookingId = _booking!.id;
    if (data.isNotEmpty &&
        data.first is Map &&
        (data.first as Map)['bookingId']?.toString() != bookingId) {
      return;
    }
    final lastSeen = await ChatSeenStore.lastSeen(bookingId);
    final userJson = await AppStorage().getUserJson();
    String? selfId;
    if (userJson != null) {
      final user = jsonDecode(userJson);
      selfId = (user['_id'] ?? user['id'])?.toString();
    }
    if (!mounted) return;
    setState(
      () =>
          _unreadChatCount = ChatSeenStore.countUnread(data, lastSeen, selfId),
    );
  }

  void _handleIncomingChatForBadge(dynamic data) {
    if (!mounted || _booking == null || _isChatOpen) return;
    if (data == null || data is! Map) return;
    final bookingId = data['bookingId']?.toString();
    if (bookingId != _booking!.id) return;
    setState(() => _unreadChatCount += 1);
  }

  void _handleLiveLocation(dynamic data) {
    if (!mounted || data is! Map) return;
    final lat = data['lat'];
    final lng = data['lng'];
    if (lat == null || lng == null) return;
    final latVal = lat is num
        ? lat.toDouble()
        : double.tryParse(lat.toString());
    final lngVal = lng is num
        ? lng.toDouble()
        : double.tryParse(lng.toString());
    if (latVal == null || lngVal == null) return;
    setState(() {
      _staffLat = latVal;
      _staffLng = lngVal;
    });
  }

  void _handleBookingUpdated(dynamic data) {
    if (!mounted || _booking == null || data is! Map) return;
    final updatedId = (data['_id'] ?? data['id'])?.toString();
    if (updatedId != _booking!.id) return;
    _load(_booking!.id);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is String && _booking == null) {
      _load(args);
    }
  }

  // Last requested booking id + load failure, for the inline error state.
  String? _requestedId;
  String? _loadError;

  Future<void> _load(String id) async {
    _requestedId = id;
    // Only show full loading if we don't have a booking yet
    if (_booking == null) {
      if (mounted) {
        setState(() {
          _isLoading = true;
          _loadError = null;
        });
      }
    }

    try {
      final previousBooking = _booking;
      final data = await _service.getBookingById(id);
      if (mounted) {
        // Auto-return only when payment completion happens while this page is open.
        final shouldAutoReturnToPrevious =
            _booking != null &&
            !_isPaidAndCompleted(_booking!) &&
            _isPaidAndCompleted(data);

        if (shouldAutoReturnToPrevious) {
          StatusFeedback.auto('Payment completed. Returning to home.');
          Navigator.pushNamedAndRemoveUntil(
            context,
            '/merchant-dashboard',
            (route) => false,
          );
          return;
        }

        setState(() {
          _booking = data;
          _isLoading = false;
          _syncHealthDraft(data);
          if (data.status.trim().toUpperCase() == 'SERVICE_STARTED') {
            _serviceStartedLocally = true;
          }

          // Sync inspection data
          _frontPhoto = data.inspection?.frontPhoto;
          _backPhoto = data.inspection?.backPhoto;
          _leftPhoto = data.inspection?.leftPhoto;
          _rightPhoto = data.inspection?.rightPhoto;
          _damageReportController.text = data.inspection?.damageReport ?? '';

          // Sync controllers with loaded data
          _invoiceNumberController.text = data.billing?.invoiceNumber ?? '';
          // Same initial values as web BillUploadPanel: empty instead of
          // "0" (so typing doesn't give "0100"), parts from recorded parts.
          final recordedParts = _recordedPartsTotal(data);
          _partsCostController.text = recordedParts > 0
              ? _amountText(recordedParts)
              : '';
          final labour = data.billing?.labourCost ?? 0;
          _labourCostController.text = labour > 0 ? _amountText(labour) : '';
          final gst = data.billing?.gst ?? 0;
          _gstController.text = gst > 0 ? _amountText(gst) : '';
          _pickupDropPriceController.text = _amountText(_pickupDropFor(data));
          if (data.billing?.invoiceDate != null) {
            _selectedInvoiceDate = DateTime.parse(data.billing!.invoiceDate!);
            _invoiceDateController.text = DateFormat(
              'yyyy-MM-dd',
            ).format(_selectedInvoiceDate!);
          } else {
            _selectedInvoiceDate = DateTime.now();
            _invoiceDateController.text = DateFormat(
              'yyyy-MM-dd',
            ).format(_selectedInvoiceDate!);
          }

          // Sync QC checklist
          _testRideChecked = data.qc?.testRide ?? false;
          _safetyChecksChecked = data.qc?.safetyChecks ?? false;
          _noLeaksChecked = data.qc?.noLeaks ?? false;
          _noErrorLightsChecked = data.qc?.noErrorLights ?? false;

          // Sync warranty fields
          _warrantyNameController.text = data.batteryTire?.warranty?.name ?? '';
          _warrantyPriceController.text =
              data.batteryTire?.warranty?.price?.toString() ?? '';
          _warrantyMonthsController.text =
              data.batteryTire?.warranty?.warrantyMonths?.toString() ?? '';
          _warrantyImage = data.batteryTire?.warranty?.image;

          // Sync sent inspection parts: saved ones + ones already in the
          // upload list (so a refresh doesn't re-enable "Send" → duplicates).
          _sentInspectionPartIds
            ..clear()
            ..addAll(
              (data.serviceExecution?.serviceParts ?? const [])
                  .where((part) => part.fromInspection == true)
                  .map((part) => part.inspectionPartId ?? '')
                  .where((id) => id.isNotEmpty),
            )
            ..addAll(
              _newServiceParts
                  .map((p) => (p['inspectionPartId'] ?? '').toString())
                  .where((id) => id.isNotEmpty),
            );
          // Same as web: approved inspection parts go straight into the
          // service parts list, ready for their after image.
          for (final entry in _approvedInspectionParts(data)) {
            final id = 'inspection_${entry.key}';
            if (_sentInspectionPartIds.contains(id)) continue;
            _newServiceParts.add(_servicePartFromInspection(entry.value, id));
            _sentInspectionPartIds.add(id);
          }
        });
        final bool isBattery =
            _booking?.batteryTire?.isBatteryTireService == true;
        final bool isCarWash = _booking?.carWash?.isCarWashService == true;
        final bool hasApprovedParts = _hasApprovedParts(data);
        unawaited(_loadPickupDropFromReference(data));
        final bool showFullTabs =
            !isBattery && (!isCarWash || hasApprovedParts);

        final int desiredLength = isBattery ? 2 : (showFullTabs ? 6 : 1);
        final int maxUnlockedIndex = _maxUnlockedTabIndex(data);

        if (_tabController == null || _tabController!.length != desiredLength) {
          _tabController?.dispose();
          _tabController = TabController(length: desiredLength, vsync: this);
          if (showFullTabs) {
            _tabController!.index = maxUnlockedIndex;
          }
        } else {
          if (showFullTabs) {
            final hadInspectionCompleted =
                previousBooking?.inspection?.completedAt != null;
            final hasInspectionCompleted = data.inspection?.completedAt != null;
            final hadServiceSaved =
                previousBooking != null &&
                _hasServiceDataSaved(previousBooking);
            final hasServiceSaved = _hasServiceDataSaved(data);
            final hadQcCompleted = previousBooking?.qc?.completedAt != null;
            final hasQcCompleted = data.qc?.completedAt != null;

            if (!hadInspectionCompleted && hasInspectionCompleted) {
              _tabController!.index = 2; // Service
            } else if (!hadServiceSaved && hasServiceSaved && !hasQcCompleted) {
              _tabController!.index = 3; // QC CHECK
            } else if (!hadQcCompleted && hasQcCompleted) {
              _tabController!.index = 4; // Health after final confirmation
            } else if (previousBooking != null &&
                previousBooking.status.trim().toUpperCase() !=
                    'SERVICE_STARTED' &&
                data.status.trim().toUpperCase() == 'SERVICE_STARTED' &&
                !isBattery) {
              _tabController!.index = 1; // Inspection — same as web
            } else if (_tabController!.index > maxUnlockedIndex) {
              _tabController!.index = maxUnlockedIndex;
            }
          }
        }
        _socketService.joinRoom('booking_$id');
        _socketService.emit('getMessages', {'bookingId': id});
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          if (_booking == null) {
            _loadError =
                'Failed to load order details. Check your connection and try again.';
          }
        });
        if (_booking != null) {
          StatusFeedback.error('Could not refresh this order');
        }
      }
    }
  }

  bool _isPaidAndCompleted(BookingDetail booking) {
    return booking.paymentStatus == 'paid' &&
        (booking.status == 'SERVICE_COMPLETED' ||
            booking.status == 'CAR_WASH_COMPLETED' ||
            booking.status == 'COMPLETED' ||
            booking.status == 'DELIVERED');
  }

  bool _hasApprovedParts(BookingDetail booking) {
    final parts =
        booking.inspection?.additionalParts ?? const <AdditionalPart>[];
    return parts.any(
      (p) => p.approved || p.approvalStatus?.toLowerCase() == 'approved',
    );
  }

  bool _isGeneralWorkshopOrder(BookingDetail booking) {
    if (booking.batteryTire?.isBatteryTireService == true) return false;
    if (booking.carWash?.isCarWashService == true) return false;
    final services = booking.services;
    if (services == null) return false;
    return services.any((raw) {
      if (raw is! Map) return false;
      final cat = raw['category']?.toString() ?? '';
      final name = (raw['name']?.toString() ?? '').toLowerCase();
      return cat == 'Periodic' ||
          cat == 'Services' ||
          name.contains('general service');
    });
  }

  bool _shouldHideMerchantChat(BookingDetail booking) {
    final payment = (booking.paymentStatus ?? '').toLowerCase();
    final status = booking.status.trim();
    if (payment == 'paid') return true;
    if ([
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
    ].contains(status.toUpperCase())) {
      return true;
    }
    if (!_isGeneralWorkshopOrder(booking)) return false;
    const visible = {
      'SERVICE_STARTED',
      'SERVICE_COMPLETED',
      'OUT_FOR_DELIVERY',
      'ON HOLD',
      'QC_PENDING',
    };
    return !visible.contains(status.toUpperCase());
  }

  /// True only after "Save Service Data" (it records jobEndTime). Auto-saved
  /// part/after images don't count, so QC stays locked until the merchant
  /// actually saves — same as web.
  bool _hasServiceDataSaved(BookingDetail booking) {
    final end = booking.serviceExecution?.jobEndTime;
    return end != null && end.isNotEmpty;
  }

  int _maxUnlockedTabIndex(BookingDetail booking) {
    if (booking.qc?.completedAt != null) return 5;
    if (_hasServiceDataSaved(booking)) return 3; // Unlock QC
    if (booking.inspection?.completedAt != null) return 2; // Unlock Service
    final normalizedStatus = booking.status.trim().toUpperCase();
    if (_serviceStartedLocally || normalizedStatus == 'SERVICE_STARTED') {
      return 1; // Unlock Inspection
    }
    return 0; // Only Overview
  }

  /// Health indicators live on the vehicle. They're shown only once health
  /// was saved on THIS order (booking.healthSavedAt); a new order for the same
  /// car starts empty. (The vehicle's lastUpdated can't be used — completing
  /// any general service re-stamps it.)
  bool _isHealthFromThisOrder(BookingDetail booking, Map<String, dynamic> m) =>
      booking.healthSavedAt != null;

  /// Edited since the last save → "Save Health Stats" is active again.
  bool _healthDirty = false;

  void _syncHealthDraft(BookingDetail booking) {
    const keys = [
      'generalService',
      'brakePads',
      'tires',
      'battery',
      'wiperBlade',
    ];
    _healthDraft.clear();
    for (final key in keys) {
      final data = booking.vehicleHealthIndicators?[key];
      final map = data is Map
          ? Map<String, dynamic>.from(data)
          : <String, dynamic>{};
      if (!_isHealthFromThisOrder(booking, map)) {
        _healthDraft[key] = const _HealthDraft(
          value: 0,
          fixedKm: 0,
          fixedDays: 0,
        );
        continue;
      }
      _healthDraft[key] = _HealthDraft(
        value: (map['value'] is num) ? (map['value'] as num).toDouble() : 0,
        fixedKm: (map['fixedKm'] is num) ? (map['fixedKm'] as num).toInt() : 0,
        fixedDays: (map['fixedDays'] is num)
            ? (map['fixedDays'] as num).toInt()
            : 0,
        lastUpdated: map['lastUpdated']?.toString(),
      );
    }
  }

  Future<void> _saveHealthIndicators() async {
    if (_booking == null || (_booking!.vehicleId ?? '').isEmpty) {
      StatusFeedback.auto('Vehicle not found for this booking');
      return;
    }

    setState(() => _isSaving = true);
    try {
      final nowIso = DateTime.now().toIso8601String();
      final payload = <String, dynamic>{};
      _healthDraft.forEach((key, draft) {
        final fixedKm = draft.fixedKm < 0 ? 0 : draft.fixedKm;
        final fixedDays = draft.fixedDays < 0 ? 0 : draft.fixedDays;
        payload[key] = {
          'value': draft.value.round().clamp(0, 100),
          'fixedKm': fixedKm,
          'fixedDays': fixedDays,
          'lastUpdated': draft.lastUpdated ?? nowIso,
        };
      });

      await _vehicleService.updateVehicleHealth(_booking!.vehicleId!, payload);
      // Mark health as saved on this order (keeps fields filled for it).
      await _service.updateBookingDetails(_booking!.id, {'healthSaved': true});
      _healthDirty = false;
      await _load(_booking!.id);
      if (mounted) {
        StatusFeedback.success('Vehicle health saved');
        // Same as web: after health → Billing.
        final controller = _tabController;
        if (controller != null && controller.length > 5) {
          controller.animateTo(5);
        }
      }
    } catch (_) {
      if (mounted) {
        StatusFeedback.auto('Failed to update vehicle health');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<String?> _pickAndUploadImage(ImageSource source) async {
    final XFile? photo = await pickImageSafely(
      _picker,
      source: source,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 50,
    );
    if (photo == null) {
      return null;
    }

    if (!mounted) {
      return null;
    }
    setState(() => _isSaving = true);
    try {
      final files = await _service.uploadFiles([photo]);
      if (files.isNotEmpty) {
        return files.first;
      }
    } catch (e) {
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Failed to upload image');
        }
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
    return null;
  }

  Future<XFile?> _pickImageFileSafely(ImageSource source) async {
    try {
      return await pickImageSafely(
        _picker,
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 55,
      );
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Unable to open image picker. Please try Gallery.');
      }
      return null;
    }
  }

  Future<void> _pickBillFile() async {
    final source = await chooseImageSource(context);
    if (source == null) return;
    final XFile? photo = await pickImageSafely(
      _picker,
      source: source,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 50,
    );
    if (photo != null) {
      setState(() => _billFile = photo);
    }
  }

  Future<void> _updateStatus(String newStatus) async {
    if (_booking == null) {
      return;
    }

    // Validation
    if (newStatus == 'SERVICE_COMPLETED') {
      if (!(_booking!.inspection?.completedAt != null)) {
        StatusFeedback.auto('Please complete inspection first');
        return;
      }
      if (!(_booking!.qc?.completedAt != null)) {
        StatusFeedback.auto('Please complete QC first');
        return;
      }
      if (_booking!.billing?.fileUrl == null) {
        StatusFeedback.auto('Please upload invoice in Billing tab');
        return;
      }
    }

    if (newStatus == 'OUT_FOR_DELIVERY') {
      if (_booking!.paymentStatus != 'paid') {
        StatusFeedback.auto('Waiting for customer payment');
        return;
      }
    }

    final showStartingOverlay = newStatus == 'SERVICE_STARTED';
    if (showStartingOverlay) {
      setState(() => _serviceStartingOverlay = true);
    } else {
      setState(() => _isSaving = true);
    }
    try {
      await _service.updateBookingStatus(_booking!.id, newStatus);
      await _load(_booking!.id);
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Status updated to $newStatus');
        }
      }
    } catch (e) {
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Failed to update status');
        }
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
          _serviceStartingOverlay = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return GlobalSyncRefresh(
      entities: SyncEntities.bookings,
      onSync: () {
        if (_isLoading || _booking == null) return;
        _load(_booking!.id);
      },
      child: _buildPage(context),
    );
  }

  Widget _buildPage(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    if (_isLoading) {
      return Scaffold(
        backgroundColor: isDark ? AppColors.backgroundPrimary : Colors.white,
        body: const SkeletonList(itemCount: 5, showLeading: false),
      );
    }
    if (_booking == null) {
      final retryId = _requestedId;
      return Scaffold(
        backgroundColor: isDark ? AppColors.backgroundPrimary : Colors.white,
        appBar: AppBar(title: const Text('Order Details')),
        body: _loadError != null && retryId != null
            ? StateView.error(
                message: _loadError,
                onRetry: () => _load(retryId),
              )
            : StateView.wrong(
                title: 'Order not found',
                message: 'This order may have been removed or reassigned.',
                actionLabel: 'Go back',
                onAction: () => Navigator.of(context).maybePop(),
              ),
      );
    }

    final bool isBattery = _booking!.batteryTire?.isBatteryTireService == true;
    final bool isCarWash = _booking!.carWash?.isCarWashService == true;
    final bool hasApprovedParts = _hasApprovedParts(_booking!);
    final bool showFullTabs = !isBattery && (!isCarWash || hasApprovedParts);
    final int maxUnlockedIndex = showFullTabs
        ? _maxUnlockedTabIndex(_booking!)
        : 0;

    final String orderNum =
        _booking!.orderNumber?.toString() ??
        _booking!.id.substring(_booking!.id.length - 6).toUpperCase();
    final paymentStatus = (_booking!.paymentStatus ?? 'pending').toLowerCase();
    final isPaid = paymentStatus == 'paid';

    // Opened with nothing behind it (e.g. from a notification): Back goes to
    // Orders instead of closing the app.
    return PopScope(
      canPop: Navigator.of(context).canPop(),
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        Navigator.of(context).pushReplacementNamed('/merchant-orders');
      },
      child: Stack(
        children: [
          Scaffold(
            backgroundColor: isDark
                ? AppColors.backgroundPrimary
                : Colors.white,
            appBar: AppBar(
              elevation: 0,
              toolbarHeight: 104,
              backgroundColor: isDark
                  ? AppColors.backgroundPrimary
                  : Colors.white,
              foregroundColor: isDark ? Colors.white : Colors.black,
              leading: IconButton(
                icon: const Icon(Icons.arrow_back_rounded, size: 26),
                tooltip: 'Back',
                // maybePop so the PopScope fallback below also applies.
                onPressed: () => Navigator.maybePop(context),
              ),
              titleSpacing: 4,
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Order #$orderNum',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 22,
                      letterSpacing: -0.3,
                      color: isDark ? Colors.white : const Color(0xFF111827),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _formatOrderDate(_booking!.date),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w400,
                      color: isDark
                          ? Colors.grey[400]
                          : const Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      _overviewPill(
                        label: BookingDetail.getStatusLabel(
                          _booking!.status,
                          services: _booking?.services,
                        ),
                        icon: Icons.local_shipping_rounded,
                      ),
                      _overviewPill(
                        label: isPaid
                            ? 'Paid'
                            : paymentStatus[0].toUpperCase() +
                                  paymentStatus.substring(1),
                        icon: isPaid
                            ? Icons.check_circle_rounded
                            : Icons.schedule_rounded,
                        color: isPaid ? null : AppColors.warning,
                      ),
                    ],
                  ),
                ],
              ),
            ),
            body: _tabController == null
                ? const SizedBox.shrink()
                : Column(
                    children: [
                      _buildStatusControl(),
                      Container(
                        margin: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: isDark
                              ? AppColors.backgroundSecondary
                              : const Color(0xFFF3F4F6),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: TabBar(
                          controller: _tabController!,
                          isScrollable: showFullTabs,
                          padding: EdgeInsets.zero,
                          tabAlignment: showFullTabs
                              ? TabAlignment.start
                              : TabAlignment.fill,
                          indicator: BoxDecoration(
                            color: isDark
                                ? AppColors.primaryPurple
                                : const Color(0xFF7C3AED),
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color:
                                    (isDark
                                            ? AppColors.primaryPurple
                                            : const Color(0xFF7C3AED))
                                        .withValues(alpha: 0.2),
                                blurRadius: 4,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          labelColor: Colors.white,
                          unselectedLabelColor: isDark
                              ? Colors.grey[400]
                              : const Color(0xFF6B7280),
                          labelStyle: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                          unselectedLabelStyle: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                          indicatorSize: TabBarIndicatorSize.tab,
                          tabs: isBattery
                              ? [
                                  _iconTab(Icons.dashboard_rounded, 'Overview'),
                                  _iconTab(Icons.verified_rounded, 'Warranty'),
                                ]
                              : (showFullTabs
                                    ? [
                                        _iconTab(
                                          Icons.dashboard_rounded,
                                          'Overview',
                                        ),
                                        _iconTab(
                                          Icons.assignment_rounded,
                                          'Inspection',
                                        ),
                                        _iconTab(
                                          Icons.build_rounded,
                                          'Service',
                                          locked: maxUnlockedIndex < 2,
                                        ),
                                        _iconTab(
                                          Icons.verified_user_rounded,
                                          'QC Check',
                                          locked: maxUnlockedIndex < 3,
                                        ),
                                        _iconTab(
                                          Icons.health_and_safety_rounded,
                                          'Health',
                                          locked: maxUnlockedIndex < 4,
                                        ),
                                        _iconTab(
                                          Icons.receipt_long_rounded,
                                          'Billing',
                                          locked: maxUnlockedIndex < 5,
                                        ),
                                      ]
                                    : [
                                        _iconTab(
                                          Icons.dashboard_rounded,
                                          'Overview',
                                        ),
                                      ]),
                          onTap: (index) {
                            if (!showFullTabs) return;
                            if (index > maxUnlockedIndex) {
                              _tabController!.index = _tabController!
                                  .previousIndex
                                  .clamp(0, maxUnlockedIndex)
                                  .toInt();
                              StatusFeedback.auto(
                                maxUnlockedIndex == 0
                                    ? 'Start service to unlock Inspection tab.'
                                    : maxUnlockedIndex == 1
                                    ? 'Confirm inspection to unlock Service tab.'
                                    : maxUnlockedIndex == 2
                                    ? 'Save service data to unlock QC Check tab.'
                                    : 'Confirm QC to unlock remaining tabs.',
                              );
                              return;
                            }
                          },
                        ),
                      ),
                      Expanded(
                        child: TabBarView(
                          controller: _tabController!,
                          physics: const NeverScrollableScrollPhysics(),
                          children: isBattery
                              ? [_buildOverview(), _buildWarranty()]
                              : (showFullTabs
                                    ? [
                                        _buildOverview(),
                                        _buildInspection(),
                                        _buildServiceExecution(),
                                        _buildQC(),
                                        _buildHealth(),
                                        _buildBilling(),
                                      ]
                                    : [_buildOverview()]),
                        ),
                      ),
                    ],
                  ),
            floatingActionButton: _buildChatButton(),
          ),
          if (_serviceStartingOverlay)
            Positioned.fill(
              child: ColoredBox(
                color: Colors.black.withValues(alpha: 0.45),
                child: Center(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 32),
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: isDark
                          ? AppColors.backgroundSecondary
                          : Colors.white,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(),
                        const SizedBox(height: 16),
                        Text(
                          'Starting service…',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                            color: isDark ? Colors.white : Colors.black87,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Please wait while we update this order.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 13,
                            color: isDark ? Colors.grey[400] : Colors.grey[600],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildChatButton() {
    final booking = _booking;
    if (booking == null) return const SizedBox.shrink();
    if (_shouldHideMerchantChat(booking)) return const SizedBox.shrink();

    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        FloatingActionButton(
          heroTag: null,
          onPressed: _showChatDialog,
          backgroundColor: isDark
              ? AppColors.primaryPurple
              : const Color(0xFF7C3AED),
          child: const Icon(Icons.chat_bubble_outline, color: Colors.white),
        ),
        if (_unreadChatCount > 0)
          Positioned(
            right: -2,
            top: -2,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: const BoxDecoration(
                color: Color(0xFFEF4444),
                borderRadius: BorderRadius.all(Radius.circular(999)),
              ),
              constraints: const BoxConstraints(minWidth: 18),
              child: Text(
                _unreadChatCount > 99 ? '99+' : '$_unreadChatCount',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
      ],
    );
  }

  /// Remaining life % — same rule as web (frontend/src/lib/vehicleHealthRemaining.ts):
  /// with Fixed KM/Days it's 100% until a last service date exists, then it
  /// decays by whichever interval is used up faster; otherwise manual value.
  int _remainingHealthPercent(_HealthDraft draft, Map<String, dynamic> raw) {
    if (draft.fixedKm <= 0 && draft.fixedDays <= 0) {
      return draft.value.clamp(0, 100).round();
    }
    final lastDate = DateTime.tryParse('${raw['lastServiceDate'] ?? ''}');
    if (lastDate == null) return 100;

    final now = DateTime.now();
    final diffDays = DateTime(now.year, now.month, now.day)
        .difference(DateTime(lastDate.year, lastDate.month, lastDate.day))
        .inDays
        .abs();
    final lastKm = (raw['lastServiceKm'] as num?) ?? 0;
    final currentKm = _booking?.vehicleMileage ?? 0;
    final diffKm = (currentKm - lastKm).clamp(0, double.infinity);

    final usedDays = draft.fixedDays > 0
        ? (diffDays / draft.fixedDays * 100).clamp(0, 100)
        : 0;
    final usedKm = draft.fixedKm > 0
        ? (diffKm / draft.fixedKm * 100).clamp(0, 100)
        : 0;
    final used = usedDays > usedKm ? usedDays : usedKm;
    return (100 - used).clamp(0, 100).round();
  }

  Widget _buildHealth() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final health = _booking?.vehicleHealthIndicators;

    final indicators = [
      _HealthIndicatorMeta(
        keyName: 'generalService',
        label: 'General Service (Oil and Filter)',
        icon: Icons.build_circle_outlined,
      ),
      _HealthIndicatorMeta(
        keyName: 'brakePads',
        label: 'Brake Pads',
        icon: Icons.car_repair_outlined,
      ),
      _HealthIndicatorMeta(
        keyName: 'tires',
        label: 'Tire Condition',
        icon: Icons.tire_repair_outlined,
      ),
      _HealthIndicatorMeta(
        keyName: 'battery',
        label: 'Battery Health',
        icon: Icons.battery_charging_full_rounded,
      ),
      _HealthIndicatorMeta(
        keyName: 'wiperBlade',
        label: 'Wiper Blade',
        icon: Icons.opacity_outlined,
      ),
    ];

    if (health == null || health.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, _fabClearance),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: isDark ? AppColors.backgroundSecondary : Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
              ),
            ),
            child: Text(
              'No health indicators available for this vehicle.',
              style: TextStyle(
                color: isDark ? Colors.grey[300] : const Color(0xFF6B7280),
                fontSize: 14,
              ),
            ),
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, _fabClearance),
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: _cardDecoration(isDark),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _sectionTitle(
                    Icons.health_and_safety_rounded,
                    'Vehicle Health Indicators',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              ...indicators.map((meta) {
                final data = health[meta.keyName];
                final map = data is Map
                    ? Map<String, dynamic>.from(data)
                    : <String, dynamic>{};
                final fromThisOrder = _isHealthFromThisOrder(_booking!, map);
                final draft =
                    _healthDraft[meta.keyName] ??
                    (!fromThisOrder
                        ? const _HealthDraft(value: 0, fixedKm: 0, fixedDays: 0)
                        : null) ??
                    _HealthDraft(
                      value: (map['value'] is num)
                          ? (map['value'] as num).toDouble()
                          : 0,
                      fixedKm: (map['fixedKm'] is num)
                          ? (map['fixedKm'] as num).toInt()
                          : 0,
                      fixedDays: (map['fixedDays'] is num)
                          ? (map['fixedDays'] as num).toInt()
                          : 0,
                      lastUpdated: map['lastUpdated']?.toString(),
                    );
                _healthDraft[meta.keyName] = draft;

                final remaining = _remainingHealthPercent(draft, map);
                final normalized = remaining / 100;
                final valueColor = remaining <= 20
                    ? AppColors.error
                    : remaining <= 50
                    ? AppColors.warning
                    : AppColors.success;

                return Container(
                  margin: const EdgeInsets.only(bottom: 14),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: isDark
                        ? AppColors.backgroundSurface
                        : const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isDark
                          ? AppColors.borderColor
                          : const Color(0xFFE5E7EB),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(meta.icon, size: 20, color: valueColor),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              meta.label,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: isDark
                                    ? Colors.white
                                    : const Color(0xFF111827),
                              ),
                            ),
                          ),
                          Text(
                            '$remaining%',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: valueColor,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: normalized,
                          minHeight: 7,
                          backgroundColor: isDark
                              ? Colors.white.withValues(alpha: 0.08)
                              : const Color(0xFFE5E7EB),
                          valueColor: AlwaysStoppedAnimation<Color>(valueColor),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              initialValue: draft.fixedKm == 0
                                  ? ''
                                  : draft.fixedKm.toString(),
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                              ],
                              textInputAction: TextInputAction.done,
                              decoration: const InputDecoration(
                                labelText: 'Fixed KM',
                                hintText: 'e.g. 10000',
                                isDense: true,
                              ),
                              onChanged: (v) {
                                // setState so remaining % updates live.
                                setState(() {
                                  _healthDirty = true;
                                  _healthDraft[meta.keyName] = draft.copyWith(
                                    fixedKm: int.tryParse(v) ?? 0,
                                  );
                                });
                              },
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              initialValue: draft.fixedDays == 0
                                  ? ''
                                  : draft.fixedDays.toString(),
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                              ],
                              textInputAction: TextInputAction.done,
                              decoration: const InputDecoration(
                                labelText: 'Fixed Days',
                                hintText: 'e.g. 180',
                                isDense: true,
                              ),
                              onChanged: (v) {
                                // setState so remaining % updates live.
                                setState(() {
                                  _healthDirty = true;
                                  _healthDraft[meta.keyName] = draft.copyWith(
                                    fixedDays: int.tryParse(v) ?? 0,
                                  );
                                });
                              },
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 14,
                        runSpacing: 6,
                        children: [
                          Text(
                            'Fixed KM: ${draft.fixedKm}',
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark
                                  ? Colors.grey[400]
                                  : const Color(0xFF6B7280),
                            ),
                          ),
                          Text(
                            'Fixed Days: ${draft.fixedDays}',
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark
                                  ? Colors.grey[400]
                                  : const Color(0xFF6B7280),
                            ),
                          ),
                          Text(
                            'Updated: ${_formatHealthDate(draft.lastUpdated)}',
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark
                                  ? Colors.grey[400]
                                  : const Color(0xFF6B7280),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              }),
              const SizedBox(height: 4),
              Align(
                alignment: Alignment.centerRight,
                child: Builder(
                  builder: (context) {
                    final saved =
                        _booking?.healthSavedAt != null && !_healthDirty;
                    return ElevatedButton.icon(
                      onPressed: _isSaving || saved
                          ? null
                          : _saveHealthIndicators,
                      icon: saved
                          ? const Icon(Icons.check_circle_rounded)
                          : const SizedBox.shrink(),
                      label: Text(
                        _isSaving
                            ? 'Saving...'
                            : saved
                            ? 'Health Stats Saved'
                            : 'Save Health Stats',
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primaryPurple,
                        foregroundColor: Colors.white,
                        disabledBackgroundColor: saved
                            ? AppColors.success.withValues(alpha: 0.15)
                            : null,
                        disabledForegroundColor: saved
                            ? AppColors.success
                            : null,
                        minimumSize: const Size(0, 48),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatHealthDate(String? raw) {
    if (raw == null || raw.isEmpty) return 'Never';
    final dt = DateTime.tryParse(raw);
    if (dt == null) return 'Never';
    final d = dt.toLocal();
    final day = d.day.toString().padLeft(2, '0');
    final month = d.month.toString().padLeft(2, '0');
    final year = d.year.toString();
    return '$day/$month/$year';
  }

  // ---------------------------------------------------------------------------
  // Overview tab — card layout (header tile + content), purple accent.
  // ---------------------------------------------------------------------------

  static const Color _accent = Color(0xFF7C3AED);

  /// Bottom space on every tab so the last button (Save / Submit) can scroll
  /// clear of the floating chat button (56 + 16 margin + gap).
  static const double _fabClearance = 104;

  Color _accentFor(bool isDark) => isDark ? AppColors.primaryPurple : _accent;

  String _formatOrderDate(String raw) {
    final d = DateTime.tryParse(raw)?.toLocal();
    if (d == null) return raw;
    return DateFormat('dd MMM yyyy, hh:mm a').format(d);
  }

  /// Tab with icon + label; locked tabs are dimmed (tap shows why).
  Widget _iconTab(IconData icon, String label, {bool locked = false}) {
    return Tab(
      height: 48,
      child: Opacity(
        opacity: locked ? 0.45 : 1,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(locked ? Icons.lock_outline_rounded : icon, size: 20),
              const SizedBox(width: 8),
              Text(label),
            ],
          ),
        ),
      ),
    );
  }

  // ---- Billing (mirrors web BillUploadPanel) ----

  bool _pickupDropLoading = false;
  String? _pickupDropRefKey;

  /// Web auto-fills Pickup/Drop from the vehicle price list (brand + model);
  /// falls back to the booking's stored price. Looked up once per vehicle.
  Future<void> _loadPickupDropFromReference(BookingDetail b) async {
    final make = b.vehicleMake, model = b.vehicleModel;
    if (make == null || model == null) return;
    final key = '$make|$model|${b.vehicleVariant ?? ''}|${b.vehicleFuel ?? ''}';
    if (key == _pickupDropRefKey) return;
    _pickupDropRefKey = key;
    if (mounted) setState(() => _pickupDropLoading = true);
    final ref = await _vehicleService.searchReference(
      make: make,
      model: model,
      variant: b.vehicleVariant,
      fuelType: b.vehicleFuel,
    );
    if (!mounted) return;
    final fromRef = num.tryParse('${ref?['pickup_drop_price'] ?? ''}');
    setState(() {
      _pickupDropLoading = false;
      final price = (fromRef != null && fromRef >= 0)
          ? fromRef
          : _pickupDropFor(b);
      _pickupDropPriceController.text = _amountText(price);
    });
  }

  String _amountText(num v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  /// Parts already on the booking: billing.partsTotal, else sum of parts.
  num _recordedPartsTotal(BookingDetail b) {
    final fromBilling = b.billing?.partsTotal ?? 0;
    if (fromBilling > 0) return fromBilling;
    return b.parts.fold<num>(0, (acc, p) => acc + p.price * p.quantity);
  }

  num _pickupDropFor(BookingDetail b) {
    final fromBilling = b.billing?.pickupDropPrice ?? 0;
    if (fromBilling > 0) return fromBilling;
    return b.pickupDropPrice ?? 0;
  }

  /// Base service amount = booking total minus everything else already on
  /// it (web's getBaseServiceAmount fallback).
  num _baseServiceAmount(BookingDetail b) {
    final total = b.totalAmount ?? 0;
    final rest =
        _recordedPartsTotal(b) +
        (b.billing?.labourCost ?? 0) +
        (b.billing?.gst ?? 0) +
        _pickupDropFor(b);
    return (total - rest).clamp(0, double.infinity);
  }

  num _billingTotal() {
    num n(TextEditingController c) => num.tryParse(c.text) ?? 0;
    return _baseServiceAmount(_booking!) +
        n(_partsCostController) +
        n(_labourCostController) +
        n(_gstController) +
        n(_pickupDropPriceController);
  }

  /// Same rules as web; returns an error message or null.
  String? _validateBilling() {
    final invoice = _invoiceNumberController.text.trim();
    if (invoice.isEmpty) return 'Invoice Number is required';
    if (!RegExp(r'^[A-Za-z0-9]+$').hasMatch(invoice)) {
      return 'Invoice Number must contain only letters and digits (no special characters)';
    }
    if (invoice.length > 20) {
      return 'Invoice Number cannot exceed 20 characters';
    }
    final date = _selectedInvoiceDate;
    if (date == null) return 'Please enter a valid invoice date';
    final now = DateTime.now();
    if (DateTime(
      date.year,
      date.month,
      date.day,
    ).isAfter(DateTime(now.year, now.month, now.day))) {
      return 'Invoice date cannot be a future date';
    }
    for (final (label, c) in [
      ('Parts Cost', _partsCostController),
      ('Labour Cost', _labourCostController),
      ('GST', _gstController),
    ]) {
      final t = c.text.trim();
      if (t.isEmpty) continue;
      if (!RegExp(r'^\d+$').hasMatch(t)) {
        return '$label must contain only digits';
      }
      if (t.length > 6) return '$label cannot exceed 6 digits';
    }
    return null;
  }

  /// Card surface shared by every tab (same as the Overview cards).
  BoxDecoration _cardDecoration(bool isDark) {
    final accent = _accentFor(isDark);
    return BoxDecoration(
      color: isDark ? AppColors.backgroundSecondary : Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(
        color: isDark ? AppColors.borderColor : const Color(0xFFEDE9FE),
      ),
      boxShadow: [
        BoxShadow(
          color: isDark
              ? Colors.black.withValues(alpha: 0.3)
              : accent.withValues(alpha: 0.06),
          blurRadius: 16,
          offset: const Offset(0, 6),
        ),
      ],
    );
  }

  /// Section heading for every tab: purple icon tile + title (Overview style).
  Widget _sectionTitle(IconData icon, String title) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = _accentFor(isDark);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: accent.withValues(alpha: isDark ? 0.18 : 0.1),
          ),
          child: Icon(icon, color: accent, size: 20),
        ),
        const SizedBox(width: 12),
        Text(
          title,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: isDark ? Colors.white : const Color(0xFF111827),
          ),
        ),
      ],
    );
  }

  Widget _overviewCard({
    required IconData icon,
    required String title,
    String? subtitle,
    Widget? trailing,
    required Widget child,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = _accentFor(isDark);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSecondary : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? AppColors.borderColor : const Color(0xFFEDE9FE),
        ),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.3)
                : accent.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: accent.withValues(alpha: isDark ? 0.18 : 0.1),
                ),
                child: Icon(icon, color: accent, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: isDark ? Colors.white : const Color(0xFF111827),
                      ),
                    ),
                    if (subtitle != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          subtitle,
                          style: TextStyle(
                            fontSize: 13,
                            color: isDark
                                ? Colors.grey[400]
                                : const Color(0xFF6B7280),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }

  /// Tinted pill — static label, or a button when [onTap] is set.
  Widget _overviewPill({
    required String label,
    IconData? icon,
    Color? color,
    VoidCallback? onTap,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final c = color ?? _accentFor(isDark);
    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: c),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: c,
            ),
          ),
        ],
      ),
    );
    return Material(
      color: c.withValues(alpha: isDark ? 0.18 : 0.1),
      borderRadius: BorderRadius.circular(12),
      child: onTap == null
          ? content
          : InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: onTap,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Center(widthFactor: 1, child: content),
              ),
            ),
    );
  }

  Widget _overviewField(String label, String value) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: isDark ? Colors.white : const Color(0xFF111827),
          ),
        ),
      ],
    );
  }

  Widget _buildOverview() {
    final bool isBattery = _booking!.batteryTire?.isBatteryTireService == true;
    final bool isCarWash = _booking!.carWash?.isCarWashService == true;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = _accentFor(isDark);
    final booking = _booking!;

    List<String> flow = [
      'CREATED',
      'ASSIGNED',
      'REACHED_CUSTOMER',
      'VEHICLE_PICKED',
      'REACHED_MERCHANT',
      'SERVICE_STARTED',
      'SERVICE_COMPLETED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];

    if (isCarWash) {
      flow = [
        'CREATED',
        'ASSIGNED',
        'REACHED_CUSTOMER',
        'CAR_WASH_STARTED',
        'CAR_WASH_COMPLETED',
        'DELIVERED',
      ];
    } else if (isBattery) {
      flow = [
        'CREATED',
        'ASSIGNED',
        'STAFF_REACHED_MERCHANT',
        'PICKUP_BATTERY_TIRE',
        'REACHED_CUSTOMER',
        'INSTALLATION',
        'DELIVERY',
        'COMPLETED',
      ];
    }

    final int currentIndex = flow.indexOf(booking.status.toUpperCase());
    final statusLabel = BookingDetail.getStatusLabel(
      booking.status,
      services: booking.services,
    );
    final muted = isDark ? AppColors.borderColor : const Color(0xFFE5E7EB);

    final hasCoords =
        booking.location?.lat != null && booking.location?.lng != null;
    final phone = booking.user?.phone;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, _fabClearance),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Order Status & Workflow
          _overviewCard(
            icon: Icons.show_chart_rounded,
            title: 'Order Status & Workflow',
            subtitle: 'Track the progress of this order',
            trailing: currentIndex >= 0
                ? _overviewPill(
                    label: 'Step ${currentIndex + 1}/${flow.length}',
                  )
                : null,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: flow.asMap().entries.map((entry) {
                  final index = entry.key;
                  final isDone = index <= currentIndex;
                  final isActive = index == currentIndex;
                  final isLast = index == flow.length - 1;
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 88,
                        child: Column(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: isDone
                                    ? accent
                                    : (isDark
                                          ? AppColors.backgroundSurface
                                          : const Color(0xFFF3F4F6)),
                                border: isActive
                                    ? Border.all(
                                        color: accent.withValues(alpha: 0.25),
                                        width: 4,
                                      )
                                    : null,
                              ),
                              child: Center(
                                child: isDone
                                    ? const Icon(
                                        Icons.check_rounded,
                                        size: 20,
                                        color: Colors.white,
                                      )
                                    : Text(
                                        '${index + 1}',
                                        style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w700,
                                          color: Color(0xFF9CA3AF),
                                        ),
                                      ),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              BookingDetail.getStatusLabel(
                                entry.value,
                                services: booking.services,
                              ),
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 12,
                                height: 1.3,
                                fontWeight: isDone
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: isDone
                                    ? (isDark
                                          ? Colors.white
                                          : const Color(0xFF111827))
                                    : const Color(0xFF9CA3AF),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (!isLast)
                        Container(
                          width: 28,
                          height: 3,
                          margin: const EdgeInsets.only(top: 18.5),
                          decoration: BoxDecoration(
                            color: index < currentIndex ? accent : muted,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ),

          if (booking.status == 'SERVICE_COMPLETED' &&
              (booking.paymentStatus ?? '').toLowerCase() != 'paid')
            _overviewBanner(
              icon: Icons.info_outline_rounded,
              color: AppColors.warning,
              title: 'Waiting for customer payment',
              message:
                  '₹${(booking.totalAmount ?? 0).toStringAsFixed(0)} due. Cannot move to Out For Delivery yet.',
            ),
          if (booking.revisit?.isRevisit == true)
            _overviewBanner(
              icon: Icons.warning_amber_rounded,
              color: AppColors.error,
              title: 'Revisit Order',
              message: booking.revisit?.reason ?? 'No reason provided',
            ),
          if (booking.delay?.isDelayed == true)
            _overviewBanner(
              icon: Icons.pause_circle_filled_rounded,
              color: AppColors.warning,
              title: 'Order On Hold',
              message: [
                booking.delay?.reason ?? 'No reason provided',
                if ((booking.delay?.note ?? '').isNotEmpty)
                  booking.delay!.note!,
              ].join('\n'),
            ),

          // Live Staff Location — not needed once the order is finished.
          if (!const {
            'DELIVERED',
            'COMPLETED',
            'CANCELLED',
          }.contains(booking.status.toUpperCase()))
            _overviewCard(
              icon: Icons.location_on_rounded,
              title: 'Live Staff Location',
              trailing: _overviewPill(
                label: statusLabel,
                icon: Icons.check_circle_rounded,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                // Road route from the staff member's live position to where
                // they're heading (same destination rule as the staff app).
                child: SizedBox(
                  height: 260,
                  child: OrderRouteMap(
                    originLat: _staffLat,
                    originLng: _staffLng,
                    destLat: _routeDestination(booking)?.lat,
                    destLng: _routeDestination(booking)?.lng,
                  ),
                ),
              ),
            ),

          // Vehicle Details
          _overviewCard(
            icon: Icons.directions_car_rounded,
            title: 'Vehicle Details',
            trailing: _overviewPill(
              label: statusLabel,
              icon: Icons.check_circle_rounded,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: Container(
                        width: 96,
                        height: 72,
                        color: accent.withValues(alpha: isDark ? 0.18 : 0.08),
                        child: booking.vehicleImage != null
                            ? ViewableImage(
                                url: booking.vehicleImage!,
                                child: CachedNetworkImage(
                                  imageUrl: booking.vehicleImage!,
                                  fit: BoxFit.cover,
                                  errorWidget: (_, _, _) => Icon(
                                    Icons.directions_car_rounded,
                                    color: accent,
                                    size: 36,
                                  ),
                                ),
                              )
                            : Icon(
                                Icons.directions_car_rounded,
                                color: accent,
                                size: 36,
                              ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: _overviewField(
                        'Vehicle',
                        [
                          booking.vehicleName ?? 'N/A',
                          if (booking.vehicleVariant != null)
                            booking.vehicleVariant!,
                        ].join(' · '),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _overviewField('Type', booking.vehicleType ?? '—'),
                    ),
                    Expanded(
                      child: _overviewField(
                        'Color',
                        booking.vehicleColor ?? '—',
                      ),
                    ),
                    Expanded(
                      child: _overviewField(
                        'Fuel Type',
                        booking.vehicleFuel ?? '—',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Customer Details
          _overviewCard(
            icon: Icons.person_rounded,
            title: 'Customer Details',
            trailing: (phone != null && phone.isNotEmpty)
                ? _overviewPill(
                    label: 'Call',
                    icon: Icons.call_rounded,
                    onTap: () => launchUrl(Uri(scheme: 'tel', path: phone)),
                  )
                : null,
            child: Row(
              children: [
                Expanded(
                  child: _overviewField('Name', booking.user?.name ?? 'Guest'),
                ),
                Expanded(child: _overviewField('Phone', phone ?? 'N/A')),
              ],
            ),
          ),

          // Service Location
          _overviewCard(
            icon: Icons.place_rounded,
            title: 'Service Location',
            trailing: hasCoords
                ? _overviewPill(
                    label: 'Get Directions',
                    icon: Icons.near_me_rounded,
                    onTap: () {
                      final lat = booking.location!.lat!;
                      final lng = booking.location!.lng!;
                      launchUrl(
                        Uri.parse('google.navigation:q=$lat,$lng'),
                        mode: LaunchMode.externalApplication,
                      );
                    },
                  )
                : null,
            child: _overviewTintedRow(
              Icons.apartment_rounded,
              booking.location?.address ?? 'No address provided',
            ),
          ),
        ],
      ),
    );
  }

  /// Customer address until the vehicle is picked up, then the workshop.
  BookingLocation? _routeDestination(BookingDetail booking) {
    const atWorkshop = {
      'VEHICLE_PICKED',
      'REACHED_MERCHANT',
      'VEHICLE_AT_MERCHANT',
      'SERVICE_STARTED',
      'SERVICE_COMPLETED',
    };
    if (atWorkshop.contains(booking.status.toUpperCase())) {
      return booking.merchantLocation ?? booking.location;
    }
    return booking.location;
  }

  Widget _overviewTintedRow(IconData icon, String text) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final accent = _accentFor(isDark);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: isDark ? 0.12 : 0.05),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: accent),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 14,
                height: 1.45,
                color: isDark ? Colors.grey[300] : const Color(0xFF374151),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _overviewBanner({
    required IconData icon,
    required Color color,
    required String title,
    required String message,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: isDark ? 0.14 : 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(color: color, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  message,
                  style: TextStyle(
                    fontSize: 13,
                    color: isDark ? Colors.grey[300] : const Color(0xFF374151),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInspection() {
    final inspection = _booking!.inspection;
    final isCompleted = inspection?.completedAt != null;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, _fabClearance),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header matching frontend
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark ? AppColors.backgroundSecondary : Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
              ),
              boxShadow: [
                BoxShadow(
                  color: isDark
                      ? Colors.black.withValues(alpha: 0.3)
                      : Colors.black.withValues(alpha: 0.03),
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
                    _sectionTitle(
                      Icons.assignment_rounded,
                      'Vehicle Inspection',
                    ),
                    const Spacer(),
                    if (isCompleted)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: isDark
                              ? const Color(0xFF166534).withValues(alpha: 0.2)
                              : const Color(0xFFDCFCE7),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.check_circle,
                              size: 14,
                              color: Color(0xFF166534),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'Confirmed',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: isDark
                                    ? Colors.green[300]
                                    : const Color(0xFF166534),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                Text(
                  'Damage Report / Findings',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.grey[300] : const Color(0xFF374151),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _damageReportController,
                  maxLines: 4,
                  enabled: !isCompleted,
                  style: TextStyle(
                    fontSize: 14,
                    color: isDark ? Colors.white : Colors.black,
                  ),
                  decoration: InputDecoration(
                    hintText:
                        'Describe any damages or findings from the initial inspection...',
                    hintStyle: TextStyle(
                      color: isDark ? Colors.grey[600] : Colors.grey[400],
                      fontSize: 13,
                    ),
                    filled: true,
                    fillColor: isCompleted
                        ? (isDark
                              ? AppColors.backgroundSurface
                              : const Color(0xFFF9FAFB))
                        : (isDark ? AppColors.backgroundSurface : Colors.white),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? AppColors.borderColor
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? AppColors.borderColor
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    disabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? AppColors.borderColor
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'Vehicle Photos (4 Sides Required)',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.grey[300] : const Color(0xFF374151),
                  ),
                ),
                const SizedBox(height: 12),
                GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisCount: 2,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 1.3,
                  children: [
                    _buildSidePhotoSlot(
                      'Front',
                      _frontPhoto,
                      (url) => setState(() => _frontPhoto = url),
                    ),
                    _buildSidePhotoSlot(
                      'Back',
                      _backPhoto,
                      (url) => setState(() => _backPhoto = url),
                    ),
                    _buildSidePhotoSlot(
                      'Left',
                      _leftPhoto,
                      (url) => setState(() => _leftPhoto = url),
                    ),
                    _buildSidePhotoSlot(
                      'Right',
                      _rightPhoto,
                      (url) => setState(() => _rightPhoto = url),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                if (!isCompleted)
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _isSaving
                              ? null
                              : () => _saveInspection(isFinal: false),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                            side: BorderSide(
                              color: isDark
                                  ? Colors.white.withValues(alpha: 0.2)
                                  : const Color(0xFFE5E7EB),
                            ),
                          ),
                          child: Text(
                            _isSaving ? 'Saving...' : 'Save Draft',
                            style: TextStyle(
                              color: isDark
                                  ? Colors.white
                                  : const Color(0xFF374151),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: _isSaving
                              ? null
                              : () => _saveInspection(isFinal: true),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF16A34A),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                          child: Text(
                            _isSaving ? 'Processing...' : 'Confirm Inspection',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSidePhotoSlot(
    String side,
    String? url,
    Function(String) onUpload,
  ) {
    final isCompleted = _booking?.inspection?.completedAt != null;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(
          '$side side',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.bold,
            color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 6),
        Expanded(
          child: InkWell(
            onTap: isCompleted
                ? null
                : () async {
                    final newUrl = await _showImageSourceSheet();
                    if (newUrl != null) onUpload(newUrl);
                  },
            child: Container(
              width: double.infinity,
              decoration: BoxDecoration(
                border: Border.all(
                  color: isDark
                      ? AppColors.borderColor
                      : const Color(0xFFE5E7EB),
                  width: 1.5,
                ),
                borderRadius: BorderRadius.circular(12),
                color: isDark
                    ? AppColors.backgroundSurface
                    : const Color(0xFFF9FAFB),
              ),
              child: url != null && url.isNotEmpty
                  ? Stack(
                      fit: StackFit.expand,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: ViewableImage(
                            url: url,
                            child: CachedNetworkImage(
                              imageUrl: url,
                              fit: BoxFit.cover,
                            ),
                          ),
                        ),
                        if (!isCompleted)
                          Positioned(
                            top: 6,
                            right: 6,
                            child: InkWell(
                              onTap: () => onUpload(''),
                              child: Container(
                                padding: const EdgeInsets.all(4),
                                decoration: const BoxDecoration(
                                  color: Color(0xFFEF4444),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.delete_outline,
                                  size: 14,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                      ],
                    )
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.cloud_upload_outlined,
                          color: isDark ? Colors.grey[600] : Colors.grey[400],
                          size: 24,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'UPLOAD ${side.toUpperCase()}',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: isDark ? Colors.grey[500] : Colors.grey[500],
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ],
    );
  }

  Future<String?> _showImageSourceSheet() async {
    final source = await chooseImageSource(context);
    if (source != null) {
      return _pickAndUploadImage(source);
    }
    return null;
  }

  Future<void> _saveInspection({required bool isFinal}) async {
    if (_booking == null) return;

    if (isFinal) {
      if (_frontPhoto == null ||
          _backPhoto == null ||
          _leftPhoto == null ||
          _rightPhoto == null) {
        StatusFeedback.auto('Please upload all 4 sides of photos');
        return;
      }
    }

    setState(() => _isSaving = true);
    try {
      final existingParts = _booking!.inspection?.additionalParts ?? [];

      final Map<String, dynamic> inspectionData = {
        'additionalParts': existingParts.map((p) => p.toJson()).toList(),
        'frontPhoto': _frontPhoto,
        'backPhoto': _backPhoto,
        'leftPhoto': _leftPhoto,
        'rightPhoto': _rightPhoto,
        'damageReport': _damageReportController.text,
      };

      if (isFinal) {
        inspectionData['completedAt'] = DateTime.now().toIso8601String();
      }

      await _service.updateBookingDetails(_booking!.id, {
        'inspection': inspectionData,
      });

      await _load(_booking!.id);

      if (mounted) {
        StatusFeedback.auto(
          isFinal ? 'Inspection completed' : 'Inspection saved as draft',
        );
      }
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to save inspection');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _requestExtraCost() async {
    final amountText = _extraCostAmountController.text.trim();
    final reasonText = _extraCostReasonController.text.trim();
    final amount = double.tryParse(amountText);

    if (_booking == null || amountText.isEmpty || reasonText.isEmpty) {
      if (mounted) {
        StatusFeedback.auto('Amount and reason are required');
      }
      return;
    }
    if (amount == null || amount <= 0) {
      if (mounted) {
        StatusFeedback.auto('Enter a valid amount greater than 0');
      }
      return;
    }
    if (reasonText.length < 5) {
      if (mounted) {
        StatusFeedback.auto('Reason should be at least 5 characters');
      }
      return;
    }
    setState(() => _isSaving = true);
    try {
      await _service.createApproval({
        'type': 'ExtraCost',
        'relatedId': _booking!.id,
        'relatedModel': 'Booking',
        'data': {'amount': amount, 'reason': reasonText},
      });
      _extraCostAmountController.clear();
      _extraCostReasonController.clear();
      if (mounted) {
        StatusFeedback.auto('Extra cost approval requested');
      }
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to request approval');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _buildServiceExecution() {
    final execution = _booking!.serviceExecution;
    final status = _booking!.status;
    final isReadOnly =
        status == 'SERVICE_COMPLETED' ||
        status == 'OUT_FOR_DELIVERY' ||
        status == 'DELIVERED' ||
        status == 'COMPLETED' ||
        _booking!.paymentStatus == 'paid';

    final approvedInspectionParts = _approvedInspectionParts(_booking!);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, _fabClearance),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Approved Inspection Parts
          if (!isReadOnly && approvedInspectionParts.isNotEmpty)
            _buildApprovedInspectionPartsSection(approvedInspectionParts),

          const SizedBox(height: 24),

          // 2. Service Parts Section
          _buildServicePartsSection(execution, isReadOnly),

          const SizedBox(height: 24),

          // 3. After Service Photos
          _buildAfterServicePhotosSection(execution, isReadOnly),

          // "Request Extra Cost Approval" removed from the app; extra parts
          // go through inspection approval instead.
          const SizedBox(height: 32),

          // 5. Save Button
          if (!isReadOnly)
            Builder(
              builder: (context) {
                // Already saved and nothing new since → show as done; it
                // becomes active again as soon as a part/photo is added.
                final savedAndClean =
                    _hasServiceDataSaved(_booking!) &&
                    _newServiceParts.isEmpty &&
                    _newAfterPhotos.isEmpty;
                return SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _isSaving || savedAndClean
                        ? null
                        : _saveServiceData,
                    icon: savedAndClean
                        ? const Icon(Icons.check_circle_rounded)
                        : const SizedBox.shrink(),
                    label: Text(
                      _isSaving
                          ? 'Saving...'
                          : savedAndClean
                          ? 'Service Data Saved'
                          : 'Save Service Data',
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryPurple,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: savedAndClean
                          ? AppColors.success.withValues(alpha: 0.15)
                          : null,
                      disabledForegroundColor: savedAndClean
                          ? AppColors.success
                          : null,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildApprovedInspectionPartsSection(
    List<MapEntry<int, AdditionalPart>> parts,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _sectionTitle(
                Icons.fact_check_rounded,
                'Approved Inspection Parts',
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Customer approved these. Send to service and upload after images.',
            style: TextStyle(
              fontSize: 12,
              color: isDark ? Colors.green[200] : const Color(0xFF15803D),
            ),
          ),
          const SizedBox(height: 16),
          ...parts.map((entry) {
            final part = entry.value;
            // Index in the full additionalParts list — same id as the web.
            final inspectionPartId = 'inspection_${entry.key}';
            final alreadySent = _sentInspectionPartIds.contains(
              inspectionPartId,
            );

            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isDark ? AppColors.backgroundSurface : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : const Color(0xFFDCFCE7),
                ),
              ),
              child: Row(
                children: [
                  if (part.image != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: ViewableImage(
                        url: part.image!,
                        child: CachedNetworkImage(
                          imageUrl: part.image!,
                          width: 50,
                          height: 50,
                          fit: BoxFit.cover,
                        ),
                      ),
                    )
                  else
                    Container(
                      width: 50,
                      height: 50,
                      decoration: BoxDecoration(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.05)
                            : Colors.grey[100],
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(
                        Icons.image,
                        color: isDark ? Colors.grey[600] : Colors.grey,
                      ),
                    ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          part.name,
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: isDark ? Colors.white : Colors.black,
                          ),
                        ),
                        Text(
                          'Qty: ${part.quantity} • ₹${part.price}',
                          style: TextStyle(
                            fontSize: 12,
                            color: isDark ? Colors.grey[400] : Colors.grey[600],
                          ),
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton(
                    onPressed: alreadySent
                        ? null
                        : () => _sendInspectionPartToService(
                            part,
                            inspectionPartId,
                          ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: alreadySent
                          ? (isDark ? Colors.grey[800] : Colors.grey[200])
                          : Colors.green,
                      foregroundColor: alreadySent ? Colors.grey : Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: Text(
                      alreadySent ? 'Sent' : 'Send',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  /// Approved inspection parts keyed by their index in the full
  /// additionalParts list (matches the web's `inspection_<originalIndex>`).
  List<MapEntry<int, AdditionalPart>> _approvedInspectionParts(
    BookingDetail booking,
  ) {
    final all = booking.inspection?.additionalParts ?? const [];
    return [
      for (var i = 0; i < all.length; i++)
        if (all[i].approvalStatus?.toLowerCase() == 'approved' ||
            all[i].approved)
          MapEntry(i, all[i]),
    ];
  }

  Map<String, dynamic> _servicePartFromInspection(
    AdditionalPart part,
    String id,
  ) => {
    'name': part.name,
    'price': part.price,
    'quantity': part.quantity,
    'oldImage': part.image,
    'fromInspection': true,
    'inspectionPartId': id,
    'approved': true,
    'approvalStatus': 'Approved',
    'needsNewImage': true,
  };

  void _sendInspectionPartToService(AdditionalPart part, String id) {
    if (_sentInspectionPartIds.contains(id)) return;

    setState(() {
      _newServiceParts.add(_servicePartFromInspection(part, id));
      _sentInspectionPartIds.add(id);
    });

    StatusFeedback.auto('${part.name} sent to service');
  }

  Widget _buildServicePartsSection(
    ServiceExecutionData? execution,
    bool isReadOnly,
  ) {
    final existingParts = execution?.serviceParts ?? [];
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _sectionTitle(Icons.build_rounded, 'Service Parts'),
              // "New Discovery" hidden — new parts go through inspection
              // approval instead. _addNewDiscovery kept for re-enabling.
            ],
          ),
          const SizedBox(height: 16),
          if (existingParts.isEmpty && _newServiceParts.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Column(
                  children: [
                    Icon(
                      Icons.camera_alt,
                      color: isDark ? Colors.grey[800] : Colors.grey[300],
                      size: 48,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'No service parts yet',
                      style: TextStyle(
                        color: isDark ? Colors.grey[600] : Colors.grey[400],
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ),

          // Existing Parts
          ...existingParts.map(
            (part) => _buildExistingServicePartItem(part, isReadOnly),
          ),

          // New Parts
          ..._newServiceParts.asMap().entries.map(
            (entry) => _buildNewServicePartItem(entry.key, entry.value),
          ),
        ],
      ),
    );
  }

  Widget _buildExistingServicePartItem(AdditionalPart part, bool isReadOnly) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: part.fromInspection == true
            ? (isDark
                  ? const Color(0xFF166534).withValues(alpha: 0.1)
                  : const Color(0xFFF0FDF4))
            : (isDark
                  ? Colors.white.withValues(alpha: 0.05)
                  : const Color(0xFFF8FAFC)),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: part.fromInspection == true
              ? (isDark
                    ? const Color(0xFF166534).withValues(alpha: 0.3)
                    : const Color(0xFFDCFCE7))
              : (isDark
                    ? Colors.white.withValues(alpha: 0.1)
                    : const Color(0xFFE2E8F0)),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      part.name,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isDark ? Colors.white : Colors.black,
                      ),
                    ),
                    Text(
                      'Qty: ${part.quantity} • ₹${part.price}',
                      style: TextStyle(
                        fontSize: 12,
                        color: isDark ? Colors.grey[400] : Colors.grey[600],
                      ),
                    ),
                    Text(
                      part.fromInspection == true
                          ? '✓ From Inspection'
                          : '⚡ New Discovery',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: part.fromInspection == true
                            ? Colors.green
                            : _accent,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: part.approvalStatus == 'Approved'
                      ? (isDark
                            ? Colors.green[900]?.withValues(alpha: 0.3)
                            : Colors.green[100])
                      : (isDark
                            ? Colors.yellow[900]?.withValues(alpha: 0.3)
                            : Colors.yellow[100]),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  part.approvalStatus ?? 'Pending',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: part.approvalStatus == 'Approved'
                        ? (isDark ? Colors.green[300] : Colors.green[800])
                        : (isDark ? Colors.yellow[300] : Colors.yellow[800]),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              if (part.oldImage != null)
                Expanded(
                  child: Column(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: ViewableImage(
                          url: part.oldImage!,
                          child: CachedNetworkImage(
                            imageUrl: part.oldImage!,
                            height: 80,
                            width: double.infinity,
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                      Text(
                        'Before',
                        style: TextStyle(
                          fontSize: 10,
                          color: isDark ? Colors.grey[400] : Colors.black,
                        ),
                      ),
                    ],
                  ),
                ),
              if (part.oldImage != null) const SizedBox(width: 8),
              if (part.image != null)
                Expanded(
                  child: Column(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: ViewableImage(
                          url: part.image!,
                          child: CachedNetworkImage(
                            imageUrl: part.image!,
                            height: 80,
                            width: double.infinity,
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                      Text(
                        'After',
                        style: TextStyle(
                          fontSize: 10,
                          color: isDark ? Colors.grey[400] : Colors.black,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNewServicePartItem(int index, Map<String, dynamic> part) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSecondary : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: part['fromInspection'] == true
                    ? Text(
                        part['name'],
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: isDark ? Colors.white : Colors.black,
                        ),
                      )
                    : TextField(
                        style: TextStyle(
                          color: isDark ? Colors.white : Colors.black,
                        ),
                        decoration: InputDecoration(
                          hintText: 'Part Name',
                          hintStyle: TextStyle(
                            color: isDark ? Colors.grey[600] : Colors.grey[400],
                          ),
                          isDense: true,
                        ),
                        onChanged: (v) => part['name'] = v,
                        controller: TextEditingController(text: part['name']),
                      ),
              ),
              IconButton(
                onPressed: () {
                  setState(() {
                    if (part['fromInspection'] == true) {
                      _sentInspectionPartIds.remove(part['inspectionPartId']);
                    }
                    _newServiceParts.removeAt(index);
                  });
                },
                icon: const Icon(
                  Icons.delete_outline,
                  color: Colors.red,
                  size: 20,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: part['fromInspection'] == true
                    ? Text(
                        'Price: ₹${part['price']}',
                        style: TextStyle(
                          fontSize: 12,
                          color: isDark ? Colors.grey[400] : Colors.black,
                        ),
                      )
                    : TextField(
                        style: TextStyle(
                          color: isDark ? Colors.white : Colors.black,
                        ),
                        decoration: InputDecoration(
                          hintText: 'Price',
                          hintStyle: TextStyle(
                            color: isDark ? Colors.grey[600] : Colors.grey[400],
                          ),
                          isDense: true,
                        ),
                        keyboardType: TextInputType.number,
                        onChanged: (v) =>
                            part['price'] = double.tryParse(v) ?? 0.0,
                        controller: TextEditingController(
                          text: part['price'].toString(),
                        ),
                      ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: part['fromInspection'] == true
                    ? Text(
                        'Qty: ${part['quantity']}',
                        style: TextStyle(
                          fontSize: 12,
                          color: isDark ? Colors.grey[400] : Colors.black,
                        ),
                      )
                    : TextField(
                        style: TextStyle(
                          color: isDark ? Colors.white : Colors.black,
                        ),
                        decoration: InputDecoration(
                          hintText: 'Qty',
                          hintStyle: TextStyle(
                            color: isDark ? Colors.grey[600] : Colors.grey[400],
                          ),
                          isDense: true,
                        ),
                        keyboardType: TextInputType.number,
                        onChanged: (v) =>
                            part['quantity'] = int.tryParse(v) ?? 1,
                        controller: TextEditingController(
                          text: part['quantity'].toString(),
                        ),
                      ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              if (part['oldImage'] != null)
                Expanded(
                  child: Column(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: part['oldImage'] is String
                            ? ViewableImage(
                                url: part['oldImage'],
                                child: CachedNetworkImage(
                                  imageUrl: part['oldImage'],
                                  height: 80,
                                  width: double.infinity,
                                  fit: BoxFit.cover,
                                ),
                              )
                            : (part['oldImage'] is XFile
                                  ? (kIsWeb
                                        ? Image.network(
                                            (part['oldImage'] as XFile).path,
                                            height: 80,
                                            width: double.infinity,
                                            fit: BoxFit.cover,
                                          )
                                        : Image.file(
                                            File(
                                              (part['oldImage'] as XFile).path,
                                            ),
                                            height: 80,
                                            width: double.infinity,
                                            fit: BoxFit.cover,
                                          ))
                                  : const SizedBox.shrink()),
                      ),
                      Text(
                        'Before',
                        style: TextStyle(
                          fontSize: 10,
                          color: isDark ? Colors.grey[400] : Colors.black,
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(width: 8),
              Expanded(
                child: InkWell(
                  onTap: () async {
                    final source = await chooseImageSource(context);
                    if (source == null) return;
                    final XFile? file = await _pickImageFileSafely(source);
                    if (file != null) {
                      setState(() => part['image'] = file);
                      await _autoSavePartImage(part);
                    }
                  },
                  child: Container(
                    height: 80,
                    decoration: BoxDecoration(
                      color: isDark
                          ? Colors.white.withValues(alpha: 0.05)
                          : Colors.grey[50],
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : Colors.grey[300]!,
                      ),
                    ),
                    child: part['image'] != null
                        ? ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: kIsWeb
                                ? Image.network(
                                    (part['image'] as XFile).path,
                                    fit: BoxFit.cover,
                                  )
                                : Image.file(
                                    File((part['image'] as XFile).path),
                                    fit: BoxFit.cover,
                                  ),
                          )
                        : Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.camera_alt,
                                color: isDark ? Colors.grey[600] : Colors.grey,
                              ),
                              Text(
                                'After Image',
                                style: TextStyle(
                                  fontSize: 10,
                                  color: isDark
                                      ? Colors.grey[600]
                                      : Colors.grey,
                                ),
                              ),
                            ],
                          ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ignore: unused_element — button hidden for now, kept for re-enabling.
  void _addNewDiscovery() {
    setState(() {
      _newServiceParts.add({
        'name': '',
        'price': 0.0,
        'quantity': 1,
        'approved': false,
        'approvalStatus': 'Pending',
        'addedDuringService': true,
        'fromInspection': false,
      });
    });
  }

  Widget _buildAfterServicePhotosSection(
    ServiceExecutionData? execution,
    bool isReadOnly,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final existingAfter = execution?.afterPhotos ?? [];
    final totalPhotos = existingAfter.length + _newAfterPhotos.length;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: _cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _sectionTitle(
                Icons.photo_library_rounded,
                'After Service Photos',
              ),
              Text(
                '$totalPhotos/4 Photos',
                style: TextStyle(
                  fontSize: 12,
                  color: isDark ? Colors.grey[600] : Colors.grey[500],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 100,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                ...existingAfter.map(
                  (url) => _buildPhotoItem(url, gallery: existingAfter),
                ),
                ..._newAfterPhotos.map((file) => _buildFilePhotoItem(file)),
                if (!isReadOnly && totalPhotos < 4)
                  InkWell(
                    onTap: () async {
                      final source = await chooseImageSource(context);
                      if (source == null) return;
                      final XFile? file = await _pickImageFileSafely(source);
                      if (file != null) {
                        setState(() => _newAfterPhotos.add(file));
                      }
                    },
                    child: Container(
                      width: 100,
                      decoration: BoxDecoration(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.05)
                            : Colors.grey[50],
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isDark
                              ? Colors.white.withValues(alpha: 0.1)
                              : Colors.grey[300]!,
                        ),
                      ),
                      child: Icon(
                        Icons.add_a_photo,
                        color: isDark ? Colors.grey[600] : Colors.grey,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPhotoItem(String url, {List<String>? gallery}) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: ViewableImage(
          url: url,
          gallery: gallery,
          child: CachedNetworkImage(
            imageUrl: url,
            width: 100,
            height: 100,
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }

  Widget _buildFilePhotoItem(XFile file) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: kIsWeb
                ? Image.network(
                    file.path,
                    width: 100,
                    height: 100,
                    fit: BoxFit.cover,
                  )
                : Image.file(
                    File(file.path),
                    width: 100,
                    height: 100,
                    fit: BoxFit.cover,
                  ),
          ),
          Positioned(
            top: 4,
            right: 4,
            child: InkWell(
              onTap: () => setState(() => _newAfterPhotos.remove(file)),
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: isDark
                      ? Colors.black.withValues(alpha: 0.7)
                      : Colors.black54,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.close, size: 12, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ignore: unused_element — section hidden for now, kept for re-enabling.
  Widget _buildExtraCostSection(bool isReadOnly) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSurface : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark
              ? Colors.white.withValues(alpha: 0.1)
              : const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Request Extra Cost Approval',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
              color: isDark ? Colors.white : Colors.black,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _extraCostReasonController,
                  enabled: !isReadOnly,
                  style: TextStyle(color: isDark ? Colors.white : Colors.black),
                  decoration: InputDecoration(
                    hintText: 'Reason',
                    hintStyle: TextStyle(
                      color: isDark ? Colors.grey[600] : Colors.grey[400],
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _extraCostAmountController,
                  enabled: !isReadOnly,
                  keyboardType: TextInputType.number,
                  style: TextStyle(color: isDark ? Colors.white : Colors.black),
                  decoration: InputDecoration(
                    hintText: 'Amount',
                    hintStyle: TextStyle(
                      color: isDark ? Colors.grey[600] : Colors.grey[400],
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (!isReadOnly)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSaving ? null : _requestExtraCost,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.orange,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text('Request Approval'),
              ),
            ),
        ],
      ),
    );
  }

  // Auto-save: upload a part's after image and persist the part right away,
  // so leaving/reloading the screen doesn't lose it (parity with web).
  Future<void> _autoSavePartImage(Map<String, dynamic> part) async {
    if (_booking == null) return;
    final name = (part['name'] ?? '').toString().trim();
    final price = num.tryParse('${part['price']}') ?? 0;
    final qty = num.tryParse('${part['quantity']}') ?? 0;
    // Incomplete part: keep the file locally until Save Service Data.
    if (name.isEmpty || price <= 0 || qty <= 0) return;

    setState(() => _isSaving = true);
    try {
      final uploaded = await _service.uploadFiles([part['image']]);
      if (uploaded.isEmpty) throw Exception('Upload failed');

      final existingExecution = _booking!.serviceExecution;
      await _service.updateBookingDetails(_booking!.id, {
        'serviceExecution': {
          if (existingExecution != null) ...{
            'jobStartTime': existingExecution.jobStartTime,
            'jobEndTime': existingExecution.jobEndTime,
            'beforePhotos': existingExecution.beforePhotos,
            'duringPhotos': existingExecution.duringPhotos,
          },
          'afterPhotos': existingExecution?.afterPhotos ?? [],
          'serviceParts': [
            ...existingExecution?.serviceParts.map((p) => p.toJson()) ?? [],
            {
              'name': part['name'],
              'price': part['price'],
              'quantity': part['quantity'],
              'image': uploaded.first,
              'oldImage': part['oldImage'],
              'approved': part['approved'],
              'approvalStatus': part['approvalStatus'],
              'addedDuringService': part['addedDuringService'],
              'fromInspection': part['fromInspection'],
              'inspectionPartId': part['inspectionPartId'],
            },
          ],
        },
      });

      setState(() => _newServiceParts.remove(part));
      await _load(_booking!.id);
      if (mounted) {
        StatusFeedback.auto('After image saved for $name');
      }
    } catch (e) {
      debugPrint('Auto-save part image error: $e');
      if (mounted) {
        StatusFeedback.auto('Failed to save image');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _saveServiceData() async {
    if (_booking == null) return;

    setState(() => _isSaving = true);
    try {
      // 1. Upload images for new service parts
      final List<Map<String, dynamic>> processedParts = [];
      for (final part in _newServiceParts) {
        String? imageUrl;
        if (part['image'] != null) {
          final uploadedFiles = await _service.uploadFiles([part['image']]);
          if (uploadedFiles.isNotEmpty) {
            imageUrl = uploadedFiles.first;
          }
        }

        processedParts.add({
          'name': part['name'],
          'price': part['price'],
          'quantity': part['quantity'],
          'image': imageUrl,
          'oldImage': part['oldImage'],
          'approved': part['approved'],
          'approvalStatus': part['approvalStatus'],
          'addedDuringService': part['addedDuringService'],
          'fromInspection': part['fromInspection'],
          'inspectionPartId': part['inspectionPartId'],
        });
      }

      // 2. Upload new after photos one-by-one (prevents 413 payload too large)
      List<String> afterPhotoUrls = [];
      if (_newAfterPhotos.isNotEmpty) {
        for (final file in _newAfterPhotos) {
          final uploaded = await _service.uploadFiles([file]);
          if (uploaded.isNotEmpty) {
            afterPhotoUrls.addAll(uploaded);
          }
        }
      }

      final existingExecution = _booking!.serviceExecution;
      final finalAfterPhotos = [
        ...existingExecution?.afterPhotos ?? [],
        ...afterPhotoUrls,
      ];
      final finalServiceParts = [
        ...existingExecution?.serviceParts.map((p) => p.toJson()) ?? [],
        ...processedParts,
      ];

      await _service.updateBookingDetails(_booking!.id, {
        'serviceExecution': {
          // Marks service data as saved → unlocks QC Check.
          'jobEndTime': DateTime.now().toUtc().toIso8601String(),
          if (existingExecution != null) ...{
            'jobStartTime': existingExecution.jobStartTime,
            'beforePhotos': existingExecution.beforePhotos,
            'duringPhotos': existingExecution.duringPhotos,
          },
          'afterPhotos': finalAfterPhotos,
          'serviceParts': finalServiceParts,
        },
      });

      // Clear local state
      setState(() {
        _newServiceParts.clear();
        _newAfterPhotos.clear();
      });

      await _load(_booking!.id);

      if (mounted) {
        StatusFeedback.success('Service data saved');
        // Saved → go to QC Check (same as web), unless QC is already done.
        final controller = _tabController;
        if (controller != null &&
            controller.length > 3 &&
            _booking?.qc?.completedAt == null) {
          controller.animateTo(3);
        }
      }
    } catch (e) {
      debugPrint('Save error: $e');
      if (mounted) {
        String msg = 'Failed to save service data';
        if (e.toString().contains('400')) {
          msg = 'Validation error. Please check your inputs.';
        } else if (e.toString().contains('413')) {
          msg = 'Files are too large. Please upload smaller images.';
        }
        StatusFeedback.auto(msg);
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _buildQC() {
    final qc = _booking!.qc;
    final isQCCompleted = qc?.completedAt != null;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, _fabClearance),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionTitle(Icons.verified_user_rounded, 'Quality Check (QC)'),
          const SizedBox(height: 16),
          _buildQCCheckbox(
            'Test Ride',
            _testRideChecked,
            (v) => setState(() => _testRideChecked = v),
          ),
          _buildQCCheckbox(
            'Safety Checks',
            _safetyChecksChecked,
            (v) => setState(() => _safetyChecksChecked = v),
          ),
          _buildQCCheckbox(
            'No Leaks',
            _noLeaksChecked,
            (v) => setState(() => _noLeaksChecked = v),
          ),
          _buildQCCheckbox(
            'No Error Lights',
            _noErrorLightsChecked,
            (v) => setState(() => _noErrorLightsChecked = v),
          ),
          const SizedBox(height: 16),
          if (isQCCompleted)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isDark
                    ? Colors.green.withValues(alpha: 0.1)
                    : Colors.green[50],
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: isDark
                      ? Colors.green.withValues(alpha: 0.2)
                      : Colors.green[100]!,
                ),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'QC Completed at: ${DateFormat('dd MMM yyyy, hh:mm a').format(DateTime.parse(qc!.completedAt!))}',
                      style: const TextStyle(
                        color: Colors.green,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed:
                    (_isSaving ||
                        !(_testRideChecked &&
                            _safetyChecksChecked &&
                            _noLeaksChecked &&
                            _noErrorLightsChecked))
                    ? null
                    : _confirmQC,
                style: ElevatedButton.styleFrom(
                  backgroundColor:
                      (_testRideChecked &&
                          _safetyChecksChecked &&
                          _noLeaksChecked &&
                          _noErrorLightsChecked)
                      ? Colors.green
                      : (isDark ? Colors.grey[800] : Colors.grey),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text('Confirm QC Completion'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildQCCheckbox(String label, bool value, Function(bool) onChanged) {
    final isCompleted = _booking!.qc?.completedAt != null;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return CheckboxListTile(
      title: Text(
        label,
        style: TextStyle(
          color: isCompleted
              ? (isDark ? Colors.grey[600] : Colors.grey)
              : (isDark ? Colors.white : Colors.black),
        ),
      ),
      value: value,
      onChanged: isCompleted ? null : (v) => onChanged(v ?? false),
      activeColor: AppColors.primaryPurple,
      checkColor: Colors.white,
    );
  }

  Future<void> _confirmQC() async {
    if (_booking == null) return;

    if (!(_testRideChecked &&
        _safetyChecksChecked &&
        _noLeaksChecked &&
        _noErrorLightsChecked)) {
      if (mounted) {
        StatusFeedback.auto('Please complete all QC checks');
      }
      return;
    }

    setState(() => _isSaving = true);
    try {
      await _service.updateBookingDetails(_booking!.id, {
        'qc': {
          'testRide': _testRideChecked,
          'safetyChecks': _safetyChecksChecked,
          'noLeaks': _noLeaksChecked,
          'noErrorLights': _noErrorLightsChecked,
          'completedAt': DateTime.now().toIso8601String(),
        },
      });
      await _load(_booking!.id);
      if (mounted) {
        StatusFeedback.auto('QC completed successfully');
      }
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to complete QC');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _buildBilling() {
    final billing = _booking!.billing;
    final isUploaded = billing?.fileUrl != null;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    // Bill is final once the service is completed / delivered / paid
    // (merchant can't change status after completion either).
    final billLocked =
        (_booking!.paymentStatus ?? '').toLowerCase() == 'paid' ||
        const {
          'SERVICE_COMPLETED',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'COMPLETED',
        }.contains(_booking!.status.toUpperCase());

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, _fabClearance),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionTitle(Icons.receipt_long_rounded, 'Invoice Details'),
          const SizedBox(height: 16),
          TextField(
            controller: _invoiceNumberController,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
              LengthLimitingTextInputFormatter(20),
            ],
            style: TextStyle(color: isDark ? Colors.white : Colors.black),
            decoration: InputDecoration(
              labelText: 'Invoice Number',
              labelStyle: TextStyle(
                color: isDark ? Colors.grey[400] : Colors.grey[700],
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : const Color(0xFFE5E7EB),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          InkWell(
            onTap: () async {
              final DateTime? picked = await showDatePicker(
                context: context,
                initialDate: _selectedInvoiceDate ?? DateTime.now(),
                firstDate: DateTime(2020),
                lastDate: DateTime(2100),
              );
              if (picked != null) {
                setState(() {
                  _selectedInvoiceDate = picked;
                  _invoiceDateController.text = DateFormat(
                    'yyyy-MM-dd',
                  ).format(picked);
                });
              }
            },
            child: TextField(
              controller: _invoiceDateController,
              enabled: false,
              style: TextStyle(color: isDark ? Colors.white : Colors.black),
              decoration: InputDecoration(
                labelText: 'Invoice Date',
                labelStyle: TextStyle(
                  color: isDark ? Colors.grey[400] : Colors.grey[700],
                ),
                suffixIcon: const Icon(Icons.calendar_today),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                disabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(
                    color: isDark
                        ? Colors.white.withValues(alpha: 0.1)
                        : const Color(0xFFE5E7EB),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _partsCostController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  onChanged: (_) => setState(() {}),
                  style: TextStyle(color: isDark ? Colors.white : Colors.black),
                  decoration: InputDecoration(
                    labelText: 'Parts Cost',
                    labelStyle: TextStyle(
                      color: isDark ? Colors.grey[400] : Colors.grey[700],
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextField(
                  controller: _labourCostController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  onChanged: (_) => setState(() {}),
                  style: TextStyle(color: isDark ? Colors.white : Colors.black),
                  decoration: InputDecoration(
                    labelText: 'Labour Cost',
                    labelStyle: TextStyle(
                      color: isDark ? Colors.grey[400] : Colors.grey[700],
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _gstController,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  onChanged: (_) => setState(() {}),
                  style: TextStyle(color: isDark ? Colors.white : Colors.black),
                  decoration: InputDecoration(
                    labelText: 'GST',
                    labelStyle: TextStyle(
                      color: isDark ? Colors.grey[400] : Colors.grey[700],
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _pickupDropPriceController,
                  keyboardType: TextInputType.number,
                  readOnly: true,
                  enabled: false,
                  style: TextStyle(color: isDark ? Colors.white : Colors.black),
                  decoration: InputDecoration(
                    labelText: 'Pickup/Drop Price',
                    labelStyle: TextStyle(
                      color: isDark ? Colors.grey[400] : Colors.grey[700],
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 4),
            child: Row(
              children: [
                if (_pickupDropLoading) ...[
                  const SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 1.5),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: Text(
                    _pickupDropLoading
                        ? 'Looking up price for this vehicle…'
                        : 'Auto-filled from vehicle brand & model (not editable)',
                    style: TextStyle(
                      fontSize: 12,
                      color: isDark
                          ? Colors.grey[500]
                          : const Color(0xFF6B7280),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          // Total Amount — read-only, live (base service + parts + labour +
          // GST + pickup/drop), same as web.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: _accentFor(isDark).withValues(alpha: isDark ? 0.14 : 0.06),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: _accentFor(isDark).withValues(alpha: 0.25),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Total Amount',
                        style: TextStyle(
                          fontSize: 13,
                          color: isDark
                              ? Colors.grey[400]
                              : const Color(0xFF6B7280),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Includes base service ₹${_amountText(_baseServiceAmount(_booking!))}',
                        style: TextStyle(
                          fontSize: 12,
                          color: isDark
                              ? Colors.grey[500]
                              : const Color(0xFF9CA3AF),
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  '₹${_amountText(_billingTotal())}',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: isDark ? Colors.white : const Color(0xFF111827),
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _sectionTitle(Icons.upload_file_rounded, 'Bill / Invoice File'),
          const SizedBox(height: 8),
          if (isUploaded && _billFile == null)
            Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isDark
                        ? _accent.withValues(alpha: 0.1)
                        : const Color(0xFFF5F3FF),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isDark
                          ? _accent.withValues(alpha: 0.2)
                          : const Color(0xFFEDE9FE),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.file_present, color: _accent),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Invoice document uploaded',
                          style: TextStyle(
                            color: isDark
                                ? const Color(0xFFDDD6FE)
                                : const Color(0xFF5B21B6),
                          ),
                        ),
                      ),
                      if (!billLocked)
                        TextButton(
                          onPressed: () => _pickBillFile(),
                          child: const Text('Change'),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: () =>
                      openDocumentInApp(context, billing!.fileUrl!),
                  icon: const Icon(Icons.visibility),
                  label: const Text('View Document'),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.primaryPurple,
                  ),
                ),
              ],
            )
          else
            InkWell(
              onTap: _pickBillFile,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 32),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: isDark
                        ? Colors.white.withValues(alpha: 0.1)
                        : Colors.grey[300]!,
                    style: BorderStyle.solid,
                  ),
                  borderRadius: BorderRadius.circular(12),
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.05)
                      : Colors.grey[50],
                ),
                child: Column(
                  children: [
                    Icon(
                      _billFile != null
                          ? Icons.check_circle
                          : Icons.upload_file,
                      size: 48,
                      color: _billFile != null ? Colors.green : Colors.grey,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _billFile != null
                          ? 'File Selected: ${_billFile!.name}'
                          : 'Tap to select Invoice (Image/PDF)',
                      style: TextStyle(
                        color: isDark ? Colors.grey[400] : Colors.grey[600],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 32),
          if (billLocked)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.success.withValues(
                  alpha: isDark ? 0.14 : 0.08,
                ),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: AppColors.success.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.check_circle_rounded,
                    color: AppColors.success,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Bill submitted and service completed. The bill can no longer be changed.',
                      style: TextStyle(
                        fontSize: 14,
                        color: isDark
                            ? Colors.grey[300]
                            : const Color(0xFF374151),
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSaving ? null : _submitBilling,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryPurple,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text(
                  _isSaving
                      ? 'Submitting...'
                      : 'Submit Bill & Complete Service',
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _submitBilling() async {
    if (_booking == null) return;

    // Validate
    if (!(_booking!.inspection?.completedAt != null)) {
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Please complete inspection first');
        }
      }
      return;
    }
    if (!(_booking!.qc?.completedAt != null)) {
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Please complete QC first');
        }
      }
      return;
    }
    final billingError = _validateBilling();
    if (billingError != null) {
      StatusFeedback.warning(billingError);
      return;
    }

    if (_billFile == null && _booking!.billing?.fileUrl == null) {
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Please upload invoice file');
        }
      }
      return;
    }

    setState(() => _isSaving = true);
    try {
      String? fileUrl = _booking!.billing?.fileUrl;
      if (_billFile != null) {
        final uploaded = await _service.uploadFiles([_billFile!]);
        if (uploaded.isNotEmpty) fileUrl = uploaded.first;
      }

      final partsCost = double.tryParse(_partsCostController.text) ?? 0.0;
      final labourCost = double.tryParse(_labourCostController.text) ?? 0.0;
      final gst = double.tryParse(_gstController.text) ?? 0.0;
      final pickupDropPrice =
          double.tryParse(_pickupDropPriceController.text) ?? 0.0;
      final total =
          _baseServiceAmount(_booking!) +
          partsCost +
          labourCost +
          gst +
          pickupDropPrice;

      await _service.updateBookingDetails(_booking!.id, {
        'billing': {
          'invoiceNumber': _invoiceNumberController.text.trim(),
          'invoiceDate':
              _selectedInvoiceDate?.toIso8601String() ??
              DateTime.now().toIso8601String(),
          'partsTotal': partsCost,
          'labourCost': labourCost,
          'gst': gst,
          'pickupDropPrice': pickupDropPrice,
          'total': total,
          'fileUrl': fileUrl,
        },
        'serviceExecution': {'jobEndTime': DateTime.now().toIso8601String()},
      });

      // Same as web: saving the bill already moves SERVICE_STARTED →
      // SERVICE_COMPLETED on the backend; calling the status endpoint again
      // is rejected (merchant can't change status after completion) and made
      // a successful submit show "Failed to submit bill".
      final statusBefore = _booking!.status.toUpperCase();
      const doneStatuses = {
        'SERVICE_STARTED',
        'SERVICE_COMPLETED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'COMPLETED',
      };
      if (!doneStatuses.contains(statusBefore)) {
        await _service.updateBookingStatus(_booking!.id, 'SERVICE_COMPLETED');
      }

      await _load(_booking!.id);
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Bill submitted and service completed');
        }
      }
    } catch (e) {
      if (mounted) {
        final messenger = ScaffoldMessenger.maybeOf(context);
        if (messenger != null) {
          StatusFeedback.auto('Failed to submit bill');
        }
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _buildStatusControl() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final String status = _booking!.status.toUpperCase();
    final bool isOnHold = status == 'ON HOLD';
    final bool showMoveToServiceStarted =
        status == 'REACHED_MERCHANT' && !_serviceStartedLocally;
    // "Mark Delay / Hold" removed (app + web); Resume Work stays for orders
    // that are already on hold.
    if (!isOnHold && !showMoveToServiceStarted) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSecondary : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark
              ? Colors.white.withValues(alpha: 0.08)
              : const Color(0xFFE5E7EB),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.12 : 0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isOnHold)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: isDark
                    ? const Color(0xFF7C2D12).withValues(alpha: 0.2)
                    : Colors.orange[50],
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isDark
                      ? const Color(0xFFF59E0B).withValues(alpha: 0.35)
                      : Colors.orange[100]!,
                ),
              ),
              child: Row(
                children: [
                  const Icon(Icons.pause_circle_filled, color: Colors.orange),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Order is On Hold: ${_booking!.delay?.reason ?? 'No reason provided'}',
                      style: TextStyle(
                        color: isDark
                            ? const Color(0xFFFCD34D)
                            : Colors.orange[900],
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              if (showMoveToServiceStarted)
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isSaving
                          ? null
                          : () async {
                              await _updateStatus('SERVICE_STARTED');
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF7C3AED),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _isSaving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text(
                              'Start Service',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ),
                  ),
                ),
              if (isOnHold) ...[
                if (showMoveToServiceStarted) const SizedBox(width: 12),
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isSaving ? null : _resumeWork,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: const Text(
                        'Resume Work',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  // ignore: unused_element — delay/hold button removed, kept for re-enabling.
  Future<void> _showDelayDialog() async {
    final List<String> reasons = [
      'Waiting for parts',
      'Customer approval pending',
      'Other',
    ];
    String selectedReason = reasons[0];
    final noteController = TextEditingController();

    await showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Mark Order as Delayed'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: selectedReason,
                items: reasons
                    .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                    .toList(),
                onChanged: (v) => setState(() => selectedReason = v!),
                decoration: const InputDecoration(labelText: 'Reason'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: noteController,
                decoration: const InputDecoration(
                  labelText: 'Notes (Optional)',
                ),
                maxLines: 2,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () async {
                Navigator.pop(context);
                await _markDelay(selectedReason, noteController.text);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.orange,
                foregroundColor: Colors.white,
              ),
              child: const Text('Mark Delay'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _markDelay(String reason, String note) async {
    setState(() => _isSaving = true);
    try {
      await _service.updateBookingDetails(_booking!.id, {
        'delay': {
          'isDelayed': true,
          'reason': reason,
          'note': note,
          'startTime': DateTime.now().toIso8601String(),
          'previousStatus': _booking!.status,
        },
      });
      await _service.updateBookingStatus(_booking!.id, 'On Hold');
      await _load(_booking!.id);
      if (mounted) {
        StatusFeedback.auto('Order marked as On Hold');
      }
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to mark delay');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _resumeWork() async {
    setState(() => _isSaving = true);
    try {
      final previousStatus =
          _booking!.delay?.previousStatus ?? 'SERVICE_STARTED';
      await _service.updateBookingStatus(_booking!.id, previousStatus);
      // Clear delay info?
      await _service.updateBookingDetails(_booking!.id, {
        'delay': {'isDelayed': false},
      });
      await _load(_booking!.id);
      if (mounted) {
        StatusFeedback.auto('Work resumed');
      }
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to resume work');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Widget _buildWarranty() {
    final warranty = _booking!.batteryTire?.warranty;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (warranty?.name != null && warranty!.name!.isNotEmpty) {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, _fabClearance),
        child: Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(
              color: isDark
                  ? Colors.green.withValues(alpha: 0.2)
                  : Colors.green[200]!,
            ),
          ),
          color: isDark
              ? Colors.green.withValues(alpha: 0.1)
              : Colors.green[50],
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _sectionTitle(
                      Icons.verified_rounded,
                      'Warranty Information',
                    ),
                    Text(
                      warranty.addedAt ?? '',
                      style: TextStyle(
                        color: isDark ? Colors.green[300] : Colors.green[700],
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (warranty.image != null && warranty.image!.isNotEmpty)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.network(
                      warranty.image!,
                      height: 180,
                      width: double.infinity,
                      fit: BoxFit.cover,
                    ),
                  ),
                const SizedBox(height: 12),
                _kv('Product', warranty.name ?? '-', isDark),
                _kv('Price', '₹${warranty.price ?? 0}', isDark),
                _kv(
                  'Warranty',
                  '${warranty.warrantyMonths ?? 0} months',
                  isDark,
                ),
              ],
            ),
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, _fabClearance),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Add Warranty Information',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 18,
              color: isDark ? Colors.white : Colors.black,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _warrantyNameController,
            style: TextStyle(color: isDark ? Colors.white : Colors.black),
            decoration: InputDecoration(
              labelText: 'Product Name',
              labelStyle: TextStyle(
                color: isDark ? Colors.grey[400] : Colors.grey[700],
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : const Color(0xFFE5E7EB),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _warrantyPriceController,
            keyboardType: TextInputType.number,
            style: TextStyle(color: isDark ? Colors.white : Colors.black),
            decoration: InputDecoration(
              labelText: 'Price (₹)',
              labelStyle: TextStyle(
                color: isDark ? Colors.grey[400] : Colors.grey[700],
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : const Color(0xFFE5E7EB),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _warrantyMonthsController,
            keyboardType: TextInputType.number,
            style: TextStyle(color: isDark ? Colors.white : Colors.black),
            decoration: InputDecoration(
              labelText: 'Warranty Months',
              labelStyle: TextStyle(
                color: isDark ? Colors.grey[400] : Colors.grey[700],
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : const Color(0xFFE5E7EB),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          InkWell(
            onTap: _isUploading ? null : _pickWarrantyImage,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 24),
              decoration: BoxDecoration(
                border: Border.all(
                  color: isDark
                      ? Colors.white.withValues(alpha: 0.1)
                      : Colors.grey[300]!,
                ),
                borderRadius: BorderRadius.circular(12),
                color: isDark
                    ? Colors.white.withValues(alpha: 0.05)
                    : Colors.grey[50],
              ),
              child: Column(
                children: [
                  Icon(
                    _warrantyImage != null
                        ? Icons.check_circle
                        : Icons.image_outlined,
                    size: 40,
                    color: _warrantyImage != null ? Colors.green : Colors.grey,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _warrantyImage != null
                        ? 'Image Selected'
                        : 'Tap to upload product image',
                    style: TextStyle(
                      color: isDark ? Colors.grey[400] : Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _isSaving || _isUploading ? null : _submitWarranty,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primaryPurple,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: Text(_isSaving ? 'Submitting...' : 'Add Warranty'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _kv(String k, String v, bool isDark) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            k,
            style: TextStyle(color: isDark ? Colors.grey[400] : Colors.grey),
          ),
          Text(
            v,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: isDark ? Colors.white : Colors.black,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickWarrantyImage() async {
    final source = await chooseImageSource(context);
    if (source == null) return;
    final XFile? photo = await pickImageSafely(
      _picker,
      source: source,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 60,
    );
    if (photo == null) return;
    setState(() => _isUploading = true);
    try {
      final urls = await _service.uploadFiles([photo]);
      if (urls.isNotEmpty) {
        setState(() => _warrantyImage = urls.first);
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  Future<void> _submitWarranty() async {
    if (_booking == null) return;
    if (_warrantyNameController.text.trim().isEmpty) {
      StatusFeedback.auto('Please enter product name');
      return;
    }
    final price = double.tryParse(_warrantyPriceController.text);
    final months = int.tryParse(_warrantyMonthsController.text);
    if (price == null || price <= 0 || months == null || months <= 0) {
      StatusFeedback.auto('Enter valid price and months');
      return;
    }
    setState(() => _isSaving = true);
    try {
      await _service.addWarranty(
        _booking!.id,
        name: _warrantyNameController.text.trim(),
        price: price,
        warrantyMonths: months,
        image: _warrantyImage,
      );
      await _load(_booking!.id);
      if (mounted) {
        StatusFeedback.auto('Warranty added successfully');
      }
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to add warranty');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  void _showChatDialog({bool openEmpty = false}) async {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    setState(() {
      _isChatOpen = true;
      _unreadChatCount = 0;
    });
    if (_booking != null) await ChatSeenStore.markSeen(_booking!.id);
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.8,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (_, scrollController) => Container(
          decoration: BoxDecoration(
            color: isDark ? AppColors.backgroundSecondary : Colors.white,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: _ChatDialog(
            bookingId: _booking!.id,
            merchantId: _booking!.merchant?.id ?? '',
            merchantName: _booking!.merchant?.name ?? 'Merchant',
            service: _service,
            openEmpty: openEmpty,
          ),
        ),
      ),
    );
    if (!mounted) return;
    // Messages read while the sheet was open count as seen.
    if (_booking != null) await ChatSeenStore.markSeen(_booking!.id);
    if (!mounted) return;
    setState(() => _isChatOpen = false);
  }
}

class _ChatDialog extends StatefulWidget {
  final String bookingId;
  final String merchantId;
  final String merchantName;
  final BookingService service;
  final bool openEmpty;

  const _ChatDialog({
    required this.bookingId,
    required this.merchantId,
    required this.merchantName,
    required this.service,
    this.openEmpty = false,
  });

  @override
  State<_ChatDialog> createState() => _ChatDialogState();
}

class _ChatDialogState extends State<_ChatDialog> {
  final SocketService _socketService = SocketService();
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<Map<String, dynamic>> _messages = [];
  bool _isLoading = true;
  String? _currentUserId;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onComposerChanged);
    _loadCurrentUser();
    _socketService.on('receiveMessage', _handleReceiveMessage);
    _socketService.on('loadMessages', _handleLoadMessages);
    _socketService.on('newApproval', (data) {
      if (mounted) {
        _socketService.emit('getMessages', {'bookingId': widget.bookingId});
      }
    });
    _socketService.joinRoom('booking_${widget.bookingId}');
    if (widget.openEmpty) {
      _isLoading = false;
    } else {
      _socketService.emit('getMessages', {'bookingId': widget.bookingId});
    }
  }

  Future<void> _loadCurrentUser() async {
    final userJson = await AppStorage().getUserJson();
    if (userJson != null) {
      final user = jsonDecode(userJson);
      if (mounted) {
        setState(() {
          _currentUserId = user['_id'] ?? user['id'];
        });
      }
    }
  }

  @override
  void dispose() {
    _socketService.off('receiveMessage', _handleReceiveMessage);
    _socketService.off('loadMessages', _handleLoadMessages);
    _socketService.off('newApproval');
    _controller.removeListener(_onComposerChanged);
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onComposerChanged() {
    if (mounted) setState(() {});
  }

  void _handleReceiveMessage(dynamic data) {
    if (widget.openEmpty) return;
    if (data == null) return;
    if (data['bookingId'] == widget.bookingId) {
      if (mounted) {
        setState(() {
          // Check if message already exists
          final existingIndex = _messages.indexWhere(
            (m) => m['_id'] == data['_id'],
          );
          if (existingIndex != -1) {
            _messages[existingIndex] = data;
          } else {
            // Check if it's an update for an optimistic message
            final tempIndex = _messages.indexWhere(
              (m) =>
                  m['_id'].toString().startsWith('temp_') &&
                  m['text'] == data['text'] &&
                  (m['sender']?['_id'] == data['sender']?['_id'] ||
                      m['senderId'] == data['sender']?['_id']),
            );

            if (tempIndex != -1) {
              _messages[tempIndex] = data;
            } else {
              _messages.add(data);
            }
          }
        });
        _scrollToBottom();
      }
    }
  }

  void _handleLoadMessages(dynamic data) {
    if (widget.openEmpty) return;
    if (data is List) {
      if (mounted) {
        setState(() {
          _messages.clear();
          _messages.addAll(List<Map<String, dynamic>>.from(data));
          _isLoading = false;
        });
        _scrollToBottom();
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _sendMessage() {
    if (_controller.text.trim().isEmpty) return;

    final text = _controller.text.trim();

    _socketService.emit('sendMessage', {
      'bookingId': widget.bookingId,
      'text': text,
    });

    // Optimistic update
    if (mounted) {
      setState(() {
        _messages.add({
          '_id': 'temp_${DateTime.now().millisecondsSinceEpoch}',
          'bookingId': widget.bookingId,
          'text': text,
          'sender': {'_id': _currentUserId, 'name': 'You', 'role': 'merchant'},
          'createdAt': DateTime.now().toIso8601String(),
        });
      });
      _scrollToBottom();
    }

    _controller.clear();
  }

  Future<void> _showAddPartDialog() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) =>
          _AddPartDialog(bookingId: widget.bookingId, service: widget.service),
    );

    if (result == true) {
      // Refresh messages or wait for socket?
      // Socket should push the new message automatically.
    }
  }

  Widget _buildApprovalMessage(Map<String, dynamic> msg, bool isMe) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final approval = msg['approval'];
    if (approval == null) return const SizedBox.shrink();

    final status = approval['status'] ?? 'pending';
    final partName = approval['partName'] ?? 'Part';
    final amount = approval['amount'] ?? 0;
    final image = approval['image'];

    Color statusColor = Colors.orange;
    if (status == 'approved') statusColor = Colors.green;
    if (status == 'rejected') statusColor = Colors.red;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: isMe
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          Container(
            width: 240,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isDark ? AppColors.backgroundSurface : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isDark
                    ? Colors.white.withValues(alpha: 0.1)
                    : statusColor.withValues(alpha: 0.3),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (image != null && image.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: ViewableImage(
                        url: image,
                        child: CachedNetworkImage(
                          imageUrl: image,
                          height: 120,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                  ),
                Text(
                  partName,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: isDark ? Colors.white : Colors.black,
                  ),
                ),
                Text(
                  'Amount: ₹$amount',
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                ),
                Divider(
                  height: 16,
                  color: isDark ? Colors.white.withValues(alpha: 0.1) : null,
                ),
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: statusColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      status.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: statusColor,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: isDark
                    ? Colors.white.withValues(alpha: 0.1)
                    : Colors.grey[200]!,
              ),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color:
                      (isDark
                              ? AppColors.primaryPurple
                              : const Color(0xFF7C3AED))
                          .withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Icon(
                    Icons.support_agent,
                    color: isDark
                        ? AppColors.primaryPurple
                        : const Color(0xFF7C3AED),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Support Chat',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: isDark ? Colors.white : Colors.black,
                      ),
                    ),
                    Text(
                      'Order #${widget.bookingId.substring(widget.bookingId.length - 6).toUpperCase()}',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: Icon(
                  Icons.close,
                  color: isDark ? Colors.white : Colors.black,
                ),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        ),

        // Messages
        Expanded(
          child: _isLoading
              ? Center(
                  child: CircularProgressIndicator(
                    color: isDark
                        ? AppColors.primaryPurple
                        : const Color(0xFF7C3AED),
                  ),
                )
              : _messages.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.chat_bubble_outline,
                        size: 48,
                        color: isDark ? Colors.grey[700] : Colors.grey[300],
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'No messages yet',
                        style: TextStyle(
                          color: isDark ? Colors.grey[500] : Colors.grey,
                        ),
                      ),
                    ],
                  ),
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    final msg = _messages[index];
                    final bool isMe =
                        msg['sender']?['_id'] == _currentUserId ||
                        msg['senderId'] == _currentUserId;
                    final String text = msg['text'] ?? '';
                    final String time = msg['createdAt'] != null
                        ? DateFormat(
                            'hh:mm a',
                          ).format(DateTime.parse(msg['createdAt']))
                        : '';
                    final String senderName =
                        msg['sender']?['name'] ?? msg['senderName'] ?? '';

                    if (msg['type'] == 'approval') {
                      return _buildApprovalMessage(msg, isMe);
                    }

                    return Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Column(
                        crossAxisAlignment: isMe
                            ? CrossAxisAlignment.end
                            : CrossAxisAlignment.start,
                        children: [
                          if (!isMe)
                            Padding(
                              padding: const EdgeInsets.only(
                                left: 4,
                                bottom: 4,
                              ),
                              child: Text(
                                senderName,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: isDark
                                      ? Colors.grey[400]
                                      : Colors.grey,
                                ),
                              ),
                            ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 10,
                            ),
                            decoration: BoxDecoration(
                              color: isMe
                                  ? (isDark
                                        ? AppColors.primaryPurple
                                        : const Color(0xFF7C3AED))
                                  : (isDark
                                        ? AppColors.backgroundSurface
                                        : const Color(0xFFF3F4F6)),
                              borderRadius: BorderRadius.only(
                                topLeft: const Radius.circular(16),
                                topRight: const Radius.circular(16),
                                bottomLeft: isMe
                                    ? const Radius.circular(16)
                                    : Radius.zero,
                                bottomRight: isMe
                                    ? Radius.zero
                                    : const Radius.circular(16),
                              ),
                              border: isMe || !isDark
                                  ? null
                                  : Border.all(
                                      color: Colors.white.withValues(
                                        alpha: 0.1,
                                      ),
                                    ),
                            ),
                            child: Text(
                              text,
                              style: TextStyle(
                                color: isMe
                                    ? Colors.white
                                    : (isDark ? Colors.white : Colors.black87),
                                fontSize: 14,
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.only(
                              top: 4,
                              left: 4,
                              right: 4,
                            ),
                            child: Text(
                              time,
                              style: TextStyle(
                                fontSize: 9,
                                color: isDark ? Colors.grey[500] : Colors.grey,
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),

        // Input
        Container(
          padding: EdgeInsets.fromLTRB(
            12,
            10,
            12,
            10 +
                (MediaQuery.viewInsetsOf(context).bottom > 0
                    ? MediaQuery.viewInsetsOf(context).bottom
                    : MediaQuery.paddingOf(context).bottom),
          ),
          decoration: BoxDecoration(
            color: isDark ? AppColors.backgroundSecondary : Colors.white,
            border: Border(
              top: BorderSide(
                color: isDark
                    ? Colors.white.withValues(alpha: 0.1)
                    : const Color(0xFFE5E7EB),
              ),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Material(
                color: isDark
                    ? AppColors.backgroundSurface
                    : const Color(0xFFF3F4F6),
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _showAddPartDialog,
                  child: SizedBox(
                    width: 44,
                    height: 44,
                    child: Icon(
                      Icons.add,
                      color: isDark
                          ? AppColors.primaryPurple
                          : const Color(0xFF7C3AED),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _controller,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 2000,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _sendMessage(),
                  style: TextStyle(
                    fontSize: 15,
                    color: isDark ? Colors.white : const Color(0xFF111827),
                  ),
                  decoration: InputDecoration(
                    hintText: 'Type a message...',
                    hintStyle: TextStyle(
                      fontSize: 15,
                      color: isDark
                          ? Colors.grey[500]
                          : const Color(0xFF9CA3AF),
                    ),
                    counterText: '',
                    isDense: true,
                    filled: true,
                    fillColor: isDark
                        ? AppColors.backgroundSurface
                        : const Color(0xFFF3F4F6),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 12,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: BorderSide(
                        color: isDark
                            ? AppColors.borderColor
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: BorderSide(
                        color: isDark
                            ? AppColors.borderColor
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: BorderSide(
                        color:
                            (isDark
                                    ? AppColors.primaryPurple
                                    : const Color(0xFF7C3AED))
                                .withValues(alpha: 0.45),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Material(
                color: _controller.text.trim().isEmpty
                    ? (isDark
                          ? Colors.white.withValues(alpha: 0.12)
                          : const Color(0xFFD1D5DB))
                    : (isDark
                          ? AppColors.primaryPurple
                          : const Color(0xFF7C3AED)),
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _controller.text.trim().isEmpty ? null : _sendMessage,
                  child: const SizedBox(
                    width: 44,
                    height: 44,
                    child: Icon(
                      Icons.send_rounded,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AddPartDialog extends StatefulWidget {
  final String bookingId;
  final BookingService service;

  const _AddPartDialog({required this.bookingId, required this.service});

  @override
  State<_AddPartDialog> createState() => _AddPartDialogState();
}

class _AddPartDialogState extends State<_AddPartDialog> {
  final _nameController = TextEditingController();
  final _priceController = TextEditingController();
  final _qtyController = TextEditingController(text: '1');
  String? _imageUrl;
  bool _loading = false;
  final _picker = ImagePicker();

  static const _accent = Color(0xFF7C3AED);

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    _qtyController.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final source = await chooseImageSource(context);
    if (source == null) return;
    final XFile? photo = await pickImageSafely(
      _picker,
      source: source,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 60,
    );
    if (photo == null) return;
    setState(() => _loading = true);
    try {
      final urls = await widget.service.uploadFiles([photo]);
      if (urls.isNotEmpty) {
        setState(() => _imageUrl = urls.first);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    if (_nameController.text.isEmpty || _priceController.text.isEmpty) {
      StatusFeedback.auto('Please fill in all fields');
      return;
    }
    setState(() => _loading = true);
    try {
      await widget.service.createApproval({
        'type': 'PartReplacement',
        'relatedId': widget.bookingId,
        'relatedModel': 'Booking',
        'data': {
          'name': _nameController.text,
          'price': double.tryParse(_priceController.text) ?? 0,
          'quantity': int.tryParse(_qtyController.text) ?? 1,
          'image': _imageUrl,
        },
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        StatusFeedback.auto('Failed to send approval request');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final fill = isDark ? AppColors.backgroundSurface : const Color(0xFFF3F4F6);
    final labelColor = isDark ? Colors.grey[400] : const Color(0xFF6B7280);
    final textColor = isDark ? Colors.white : const Color(0xFF111827);
    final radius = BorderRadius.circular(14);
    final fieldBorder = OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(
        color: isDark ? AppColors.borderColor : const Color(0xFFE5E7EB),
      ),
    );
    final focusedBorder = OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(
        color: (isDark ? AppColors.primaryPurple : _accent).withValues(
          alpha: 0.7,
        ),
      ),
    );

    InputDecoration deco({String? hint, String? prefix}) {
      return InputDecoration(
        hintText: hint,
        prefixText: prefix,
        hintStyle: TextStyle(
          color: isDark ? Colors.grey[600] : const Color(0xFF9CA3AF),
        ),
        filled: true,
        fillColor: fill,
        isDense: true,
        counterText: '',
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
        border: fieldBorder,
        enabledBorder: fieldBorder,
        focusedBorder: focusedBorder,
      );
    }

    Widget labeled(String label, Widget field) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: labelColor,
            ),
          ),
          const SizedBox(height: 8),
          field,
        ],
      );
    }

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      backgroundColor: isDark ? AppColors.backgroundSecondary : Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      // Dialog already lifts itself above the keyboard; adding viewInsets
      // padding here counted the keyboard twice and squashed the form.
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Add Additional Part',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: textColor,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: _loading ? null : () => Navigator.pop(context),
                    icon: Icon(
                      Icons.close_rounded,
                      color: isDark
                          ? Colors.grey[400]
                          : const Color(0xFF6B7280),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              labeled(
                'Part Name',
                TextField(
                  controller: _nameController,
                  minLines: 1,
                  maxLines: 3,
                  textCapitalization: TextCapitalization.sentences,
                  style: TextStyle(color: textColor, fontSize: 15),
                  decoration: deco(hint: 'Enter part name'),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: labeled(
                      'Quantity',
                      TextField(
                        controller: _qtyController,
                        keyboardType: TextInputType.number,
                        style: TextStyle(color: textColor, fontSize: 15),
                        decoration: deco(hint: '1'),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: labeled(
                      'Price',
                      TextField(
                        controller: _priceController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        style: TextStyle(color: textColor, fontSize: 15),
                        decoration: deco(hint: '0', prefix: '₹ '),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              labeled(
                'Part Image (Optional)',
                InkWell(
                  onTap: _loading ? null : _pickImage,
                  borderRadius: radius,
                  child: Container(
                    width: double.infinity,
                    constraints: const BoxConstraints(minHeight: 108),
                    decoration: BoxDecoration(
                      color: fill,
                      borderRadius: radius,
                      border: Border.all(
                        color: isDark
                            ? AppColors.borderColor
                            : const Color(0xFFE5E7EB),
                      ),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: _imageUrl != null
                        ? Stack(
                            children: [
                              SizedBox(
                                height: 140,
                                width: double.infinity,
                                child: ViewableImage(
                                  url: _imageUrl!,
                                  child: CachedNetworkImage(
                                    imageUrl: _imageUrl!,
                                    fit: BoxFit.cover,
                                  ),
                                ),
                              ),
                              Positioned(
                                right: 8,
                                top: 8,
                                child: Material(
                                  color: Colors.black54,
                                  shape: const CircleBorder(),
                                  child: InkWell(
                                    customBorder: const CircleBorder(),
                                    onTap: _loading
                                        ? null
                                        : () =>
                                              setState(() => _imageUrl = null),
                                    child: const Padding(
                                      padding: EdgeInsets.all(6),
                                      child: Icon(
                                        Icons.close_rounded,
                                        size: 16,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          )
                        : Padding(
                            padding: const EdgeInsets.symmetric(vertical: 22),
                            child: Column(
                              children: [
                                Icon(
                                  Icons.add_a_photo_outlined,
                                  size: 28,
                                  color: isDark
                                      ? Colors.grey[500]
                                      : const Color(0xFF9CA3AF),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  _loading ? 'Uploading…' : 'Tap to upload',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: isDark
                                        ? Colors.grey[400]
                                        : const Color(0xFF6B7280),
                                  ),
                                ),
                              ],
                            ),
                          ),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              Row(
                children: [
                  TextButton(
                    onPressed: _loading ? null : () => Navigator.pop(context),
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.primaryPurple : _accent,
                      ),
                    ),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _loading ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: _accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 12,
                      ),
                      shape: const StadiumBorder(),
                    ),
                    child: _loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            'Send for Approval',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HealthIndicatorMeta {
  final String keyName;
  final String label;
  final IconData icon;

  const _HealthIndicatorMeta({
    required this.keyName,
    required this.label,
    required this.icon,
  });
}

class _HealthDraft {
  final double value;
  final int fixedKm;
  final int fixedDays;
  final String? lastUpdated;

  const _HealthDraft({
    required this.value,
    required this.fixedKm,
    required this.fixedDays,
    this.lastUpdated,
  });

  _HealthDraft copyWith({
    double? value,
    int? fixedKm,
    int? fixedDays,
    String? lastUpdated,
  }) {
    return _HealthDraft(
      value: value ?? this.value,
      fixedKm: fixedKm ?? this.fixedKm,
      fixedDays: fixedDays ?? this.fixedDays,
      lastUpdated: lastUpdated ?? this.lastUpdated,
    );
  }
}
