import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_cashfree_pg_sdk/api/cferrorresponse/cferrorresponse.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpayment/cfwebcheckoutpayment.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpaymentgateway/cfpaymentgatewayservice.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfsession/cfsession.dart';
import 'package:flutter_cashfree_pg_sdk/utils/cfenums.dart';

import '../models/service.dart';
import '../core/app_colors.dart';
import '../core/app_styles.dart';
import '../core/env.dart';
import '../core/order_pricing.dart';
import '../core/places_service.dart';
import '../models/vehicle.dart';
import '../models/booking.dart';
import '../models/user.dart';
import '../services/catalog_service.dart';
import '../services/vehicle_service.dart';
import '../services/booking_service.dart';
import '../services/payment_service.dart';
import '../services/coupon_service.dart';
import '../utils/coupon_utils.dart';
import '../utils/location_helper.dart';
import '../state/auth_provider.dart';
import '../state/navigation_provider.dart';
import '../utils/auth_gate.dart';
import '../services/socket_service.dart';
import '../state/global_sync_provider.dart';
import 'payment_status_page.dart';
import '../widgets/global_sync_refresh.dart';
import '../widgets/custom_stepper.dart';
import '../widgets/vehicle_card.dart';
import '../widgets/gradient_button.dart';

/// Earliest customer-bookable calendar day (tomorrow at local midnight).
DateTime _earliestBookableDate([DateTime? from]) {
  final now = from ?? DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  return today.add(const Duration(days: 1));
}

class BookServiceFlowPage extends StatefulWidget {
  final String? initialCategory;

  /// Set when arriving from a vehicle's own detail page ("Book Service"
  /// there) — that vehicle is preselected and the Vehicle step is skipped
  /// instead of asking the customer to pick again.
  final String? initialVehicleId;

  const BookServiceFlowPage({
    super.key,
    this.initialCategory,
    this.initialVehicleId,
  });

  @override
  State<BookServiceFlowPage> createState() => _BookServiceFlowPageState();
}

class _BookServiceFlowPageState extends State<BookServiceFlowPage> {
  int _currentStep = 0;
  bool _loading = false;
  bool _hasAttemptedFetch = false;
  String? _error;
  final _catalogService = CatalogService();
  final _vehicleService = VehicleService();
  final _bookingService = BookingService();
  final _paymentService = PaymentService();
  final _socketService = SocketService();
  final _couponService = CouponService();
  final _cashfreeGateway = CFPaymentGatewayService();
  Map<String, dynamic>? _currentTempBookingData;

  List<dynamic> _availableCoupons = [];
  Map<String, dynamic>? _appliedCoupon;
  bool _loadingCoupons = false;
  bool _validatingCoupon = false;

  List<Vehicle> _vehicles = [];
  List<ServiceItem> _allServices = [];
  String? _initialServiceId;

  String? _selectedVehicleId;
  List<String> _selectedServiceIds = [];
  String? _activeSubCategory;
  final Map<String, String> _tireSizes = {};
  final Map<String, String> _selectedTireBrands = {};
  final Map<String, int> _serviceQuantities = {};
  Map<String, dynamic>? _selectedVehicleReference;
  // Admin-added tyre/battery brand columns from Vehicle Reference Data,
  // and any built-in brands an admin has hidden there — combined with
  // commonTireBrands/commonBatteryBrands below into the brand chips shown.
  // Mirrors dynamicTireBrands/hiddenBuiltinTireBrands in the web frontend.
  List<String> _dynamicTireBrands = const [];
  List<String> _dynamicBatteryBrands = const [];
  Set<String> _hiddenBuiltinTireBrands = const {};
  Set<String> _hiddenBuiltinBatteryBrands = const {};
  /// Display label → Vehicle Data fieldName (handles renamed columns).
  Map<String, String> _tireBrandFields = const {
    'Bridgestone': 'tyre_price_bridgestone',
    'Yokohama': 'tyre_price_yokohama',
    'Apollo': 'tyre_price_apollo',
    'Michelin': 'tyre_price_michelin',
    'Dummy 2': 'tyre_price_dummy2',
    'Dummy': 'tyre_price_dummy',
  };
  Map<String, String> _batteryBrandFields = const {
    'Amaron': 'battery_price_amaron',
    'Exide': 'battery_price_exide',
  };
  final Map<String, bool> _isManualSize = {};
  final Map<String, TextEditingController> _tireSizeControllers = {};
  final Map<String, FocusNode> _tireSizeFocusNodes = {};
  /// When true, also show brands that have no price for this vehicle.
  final Set<String> _showUnavailableBrands = {};
  /// Earliest bookable day is tomorrow (same-day booking not allowed).
  DateTime _selectedDate = _earliestBookableDate();
  String? _selectedTimeSlot;
  List<String> _availableSlots = [];
  List<String> _bookedSlots = [];
  List<String> _blockedSlots = [];
  List<String> _allSlotsForDate = [];
  List<String> _availableServicePincodes = [];
  bool _pincodesReady = false;
  String? _selectedAddress;
  LatLng? _selectedLatLng;
  bool _showCustomLocation = false;
  final _notesController = TextEditingController();
  bool _locating = false;
  bool _resolvingAddress = false;
  bool _hasAutoLocated = false;
  final MapController _mapController = MapController();
  final _locationSearchController = TextEditingController();
  List<PlacePrediction> _locationSearchResults = [];
  bool _locationSearching = false;
  Timer? _locationSearchDebounce;
  String _placesSessionToken = PlacesService.newSessionToken();
  String? _selectedVehicleOEMTire;
  double _pickupDropPrice = 0;
  bool _pickupDropLoading = false;
  Map<String, double> _adjustedPrices = {};
  OrderTotals? _cachedCheckoutTotals;
  List<ServiceItem>? _cachedSelectedServices;
  double? _cachedTotal;

  /// Pincode cache for saved addresses (key: label::lat::lng).
  final Map<String, String?> _savedAddressPincodes = {};

  String? _extractPincode(String? address) {
    if (address == null) return null;
    final match = RegExp(r'(\d{6})(?!\d)').firstMatch(address);
    return match?.group(1);
  }

  bool _isSameCalendarDay(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  bool _isSlotInPastForToday(String slot) {
    final now = DateTime.now();
    if (!_isSameCalendarDay(_selectedDate, now)) return false;
    final m = RegExp(r'^(\d{1,2}):(\d{2})\s([AP]M)$').firstMatch(slot);
    if (m == null) return false;
    var hour = int.tryParse(m.group(1)!);
    final minute = int.tryParse(m.group(2)!);
    final period = m.group(3)!;
    if (hour == null || minute == null) return false;
    if (period == 'PM' && hour < 12) hour += 12;
    if (period == 'AM' && hour == 12) hour = 0;
    final slotTime = DateTime(now.year, now.month, now.day, hour, minute);
    return !slotTime.isAfter(now);
  }

  ({int available, int booked}) _slotBadgeCounts() {
    final catalog = _allSlotsForDate.isNotEmpty
        ? _allSlotsForDate
        : _availableSlots;
    final visible = catalog
        .where((slot) => !_isSlotInPastForToday(slot))
        .toList();
    final serverBooked = visible
        .where(
          (slot) => _bookedSlots.contains(slot) || _blockedSlots.contains(slot),
        )
        .length;
    final serverAvailable = visible
        .where(
          (slot) =>
              _availableSlots.contains(slot) && !_blockedSlots.contains(slot),
        )
        .length;
    final holdsSelection =
        _selectedTimeSlot != null &&
        _availableSlots.contains(_selectedTimeSlot!) &&
        !_blockedSlots.contains(_selectedTimeSlot!);
    return (
      available: holdsSelection ? serverAvailable - 1 : serverAvailable,
      booked: holdsSelection ? serverBooked + 1 : serverBooked,
    );
  }

  void _onGlobalSyncRefresh() {
    final event = context.read<GlobalSyncProvider>().lastEvent;
    if (event == null || !mounted) return;
    _handleGlobalSync({
      'entity': event.entity,
      'action': event.action,
      if (event.data != null) 'data': event.data,
    });
  }

  Future<void> _handleGlobalSync(dynamic data) async {
    if (!mounted || data == null) return;
    try {
      final mapData = data is Map<String, dynamic>
          ? data
          : Map<String, dynamic>.from(data as Map);
      final entity = (mapData['entity'] ?? '').toString().toLowerCase();
      final payload = mapData['data'];
      final payloadMap = payload is Map<String, dynamic>
          ? payload
          : (payload is Map ? Map<String, dynamic>.from(payload) : null);

      if (entity == 'availableservicepincode') {
        final pinsRaw = payloadMap?['availablePincodes'];
        if (pinsRaw is List) {
          setState(() {
            _availableServicePincodes = pinsRaw
                .map((e) => e.toString())
                .toList();
            _pincodesReady = true;
            if (!_isSelectedLocationAllowed) {
              _selectedTimeSlot = null;
            }
          });
        } else {
          final pins = await _bookingService.getAvailableServicePincodes();
          if (!mounted) return;
          setState(() {
            _availableServicePincodes = pins;
            _pincodesReady = true;
            if (!_isSelectedLocationAllowed) {
              _selectedTimeSlot = null;
            }
          });
        }
        return;
      }

      if (entity == 'slotblock') {
        final dateRaw = payloadMap?['date']?.toString();
        if (dateRaw != null && dateRaw.isNotEmpty) {
          final changedDate = DateTime.tryParse(dateRaw);
          if (changedDate != null &&
              _isSameCalendarDay(changedDate, _selectedDate)) {
            await _fetchSlotsForDate(_selectedDate);
          }
        } else {
          await _fetchSlotsForDate(_selectedDate);
        }
        return;
      }

      if (entity == 'booking') {
        final dateRaw = payloadMap?['date']?.toString();
        if (dateRaw == null || dateRaw.isEmpty) {
          await _fetchSlotsForDate(_selectedDate);
          return;
        }
        final changedDate = DateTime.tryParse(dateRaw);
        if (changedDate != null &&
            _isSameCalendarDay(changedDate, _selectedDate)) {
          await _fetchSlotsForDate(_selectedDate);
        }
      }

      if (entity == 'coupon') {
        await _fetchCoupons();
      }
    } catch (_) {}
  }

  String _savedAddressKey(SavedAddress addr) =>
      '${addr.label}::${addr.lat}::${addr.lng}';

  String? _getSavedAddressPin(SavedAddress addr) {
    final cached = _savedAddressPincodes[_savedAddressKey(addr)];
    if (cached != null && cached.isNotEmpty) return cached;
    return _extractPincode(addr.address);
  }

  String? _pincodeForCurrentSelection() {
    if (_selectedAddress == null) return null;
    final user = context.read<AuthProvider>().user;
    if (user != null) {
      for (final addr in user.addresses) {
        if (addr.address == _selectedAddress) {
          return _getSavedAddressPin(addr);
        }
      }
    }
    return _extractPincode(_selectedAddress);
  }

  bool _isAddressBlocked(SavedAddress addr) {
    if (!_pincodesReady) return false;
    final pin = _getSavedAddressPin(addr);
    if (_availableServicePincodes.isEmpty) return true;
    if (pin == null) return true;
    return !_availableServicePincodes.contains(pin);
  }

  bool get _isSelectedLocationAllowed {
    final pin = _pincodeForCurrentSelection();
    if (pin == null) return false;
    if (!_pincodesReady) return true;
    if (_availableServicePincodes.isEmpty) return false;
    return _availableServicePincodes.contains(pin);
  }

  Future<String?> _reverseGeocodePincode(LatLng latLng) async {
    try {
      final uri = Uri.https('nominatim.openstreetmap.org', '/reverse', {
        'format': 'jsonv2',
        'lat': latLng.latitude.toString(),
        'lon': latLng.longitude.toString(),
      });
      final res = await http.get(
        uri,
        headers: const {'User-Agent': 'CarzziMobile/1.0'},
      );
      if (res.statusCode != 200) return null;
      final decoded = jsonDecode(res.body);
      if (decoded is! Map) return null;
      final address = decoded['address'];
      if (address is Map) {
        final postcode = address['postcode']?.toString();
        if (postcode != null) {
          final pin = _extractPincode(postcode);
          if (pin != null) return pin;
        }
      }
      final display = decoded['display_name']?.toString();
      if (display != null) return _extractPincode(display);
    } catch (_) {}
    return null;
  }

  Future<void> _prefetchSavedAddressPincodes() async {
    final addresses = context.read<AuthProvider>().user?.addresses ?? [];
    if (addresses.isEmpty) return;

    var changed = false;
    for (final addr in addresses) {
      final key = _savedAddressKey(addr);
      if (_savedAddressPincodes.containsKey(key)) continue;

      var pin = _extractPincode(addr.address);
      if (pin == null && addr.lat != 0 && addr.lng != 0) {
        pin = await _reverseGeocodePincode(LatLng(addr.lat, addr.lng));
      }
      _savedAddressPincodes[key] = pin;
      changed = true;
    }

    if (changed && mounted) setState(() {});
  }

  DateTime? _composeBookingDateTime() {
    final slot = _selectedTimeSlot;
    if (slot == null || slot.isEmpty) return null;
    final m = RegExp(r'^(\d{1,2}):(\d{2})\s([AP]M)$').firstMatch(slot);
    if (m == null) return null;
    var hour = int.tryParse(m.group(1)!);
    final minute = int.tryParse(m.group(2)!);
    final period = m.group(3)!;
    if (hour == null || minute == null) return null;
    if (period == 'PM' && hour < 12) hour += 12;
    if (period == 'AM' && hour == 12) hour = 0;
    return DateTime(
      _selectedDate.year,
      _selectedDate.month,
      _selectedDate.day,
      hour,
      minute,
    );
  }

  String _getBookingCategory() {
    if (_selectedServiceIds.isEmpty) return 'All';
    final selectedServices = _allServices
        .where((s) => _selectedServiceIds.contains(s.id))
        .toList();
    if (selectedServices.isEmpty) return 'All';

    final categories = selectedServices.map((s) => s.category).toList();

    if (categories.any((c) => c == 'Car Wash' || c == 'Wash')) {
      return 'Car Wash';
    }
    if (categories.any(
      (c) => c == 'Tyres' || c == 'Battery' || c == 'Tyre & Battery',
    )) {
      return 'Tyres & Battery';
    }
    if (categories.any((c) => c == 'Essentials')) {
      return 'Essentials';
    }

    return 'General Services';
  }

  Future<List<String>> _fetchSlotsForDate(DateTime date) async {
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(date);
      final category = _getBookingCategory();
      final availability = await _bookingService.getSlotAvailability(
        dateStr,
        category: category,
      );
      var slots = List<String>.from(availability.availableSlots);

      final now = DateTime.now();
      if (_isSameCalendarDay(date, now)) {
        slots = slots.where((slot) {
          final m = RegExp(r'^(\d{1,2}):(\d{2})\s([AP]M)$').firstMatch(slot);
          if (m == null) return true;
          var hour = int.tryParse(m.group(1)!);
          final minute = int.tryParse(m.group(2)!);
          final period = m.group(3)!;
          if (hour == null || minute == null) return true;
          if (period == 'PM' && hour < 12) hour += 12;
          if (period == 'AM' && hour == 12) hour = 0;

          final slotTime = DateTime(now.year, now.month, now.day, hour, minute);
          return slotTime.isAfter(now);
        }).toList();
      }

      if (!mounted) return slots;
      setState(() {
        _availableSlots = slots;
        _bookedSlots = availability.bookedSlots;
        _blockedSlots = availability.blockedSlots;
        _allSlotsForDate = availability.allSlots;
        if (_selectedTimeSlot != null &&
            !_availableSlots.contains(_selectedTimeSlot)) {
          _selectedTimeSlot = null;
        }
      });
      return slots;
    } catch (_) {
      if (!mounted) return const [];
      setState(() {
        _availableSlots = [];
        _bookedSlots = [];
        _blockedSlots = [];
        _allSlotsForDate = [];
        _selectedTimeSlot = null;
      });
      return const [];
    }
  }

  Future<void> _fetchCoupons() async {
    setState(() => _loadingCoupons = true);
    try {
      final coupons = await _couponService.getCoupons();
      if (!mounted) return;
      final authProvider = context.read<AuthProvider>();
      final user = authProvider.user;
      final serviceType = _getSelectedServiceType();

      setState(() {
        _availableCoupons = filterCouponsForUser(
          coupons: coupons,
          user: user,
          serviceType: serviceType,
        );
        _loadingCoupons = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingCoupons = false);
    }
  }

  Future<void> _applyCouponByCode(String code, double totalAmount) async {
    setState(() => _validatingCoupon = true);
    try {
      final authProvider = context.read<AuthProvider>();
      final user = authProvider.user;

      final result = await _couponService.validateCoupon(
        code,
        totalAmount,
        serviceType: _getSelectedServiceType(),
        email: user?.email,
        mobile: user?.phone,
        serviceIds: _selectedServiceIds,
      );
      if (mounted) {
        if (result['valid'] == true && result['coupon'] != null) {
          setState(() {
            _appliedCoupon = result['coupon'];
            _cachedCheckoutTotals = null;
            _cachedSelectedServices = null;
            _cachedTotal = null;
            if (_currentStep == 3) {
              _precomputeConfirmStepData();
            }
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Coupon applied successfully!')),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(result['message'] ?? 'Invalid coupon')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.toString().replaceAll(
                'Exception: Failed to validate coupon: ',
                '',
              ),
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _validatingCoupon = false);
      }
    }
  }

  String? _getSelectedServiceType() {
    if (_selectedServiceIds.isEmpty) return null;

    final service = _allServices.firstWhere(
      (s) => s.id == _selectedServiceIds.first,
      orElse: () => _allServices.first,
    );

    return mapCategoryToCouponServiceType(
      service.category,
      serviceName: service.name,
    );
  }

  static const List<String> commonTireBrands = [
    'Bridgestone',
    'Yokohama',
    'Apollo',
    'Michelin',
    'Dummy',
    'Dummy 2',
  ];

  static const List<String> commonBatteryBrands = ['Amaron', 'Exide'];

  /// Tyre brand chips actually offered: built-ins minus any an admin has
  /// hidden in Vehicle Reference Data, plus any admin-added tyre columns.
  /// Matches tireBrandOptions in the web frontend.
  List<String> get _tireBrandOptions => [
    ...commonTireBrands.where((b) => !_hiddenBuiltinTireBrands.contains(b)),
    ..._dynamicTireBrands,
  ];

  /// Same as _tireBrandOptions, for battery brands.
  List<String> get _batteryBrandOptions => [
    ...commonBatteryBrands.where(
      (b) => !_hiddenBuiltinBatteryBrands.contains(b),
    ),
    ..._dynamicBatteryBrands,
  ];

  /// Brand chips for [isBatteryService], with brands available for the
  /// selected vehicle listed first (stable within each group — original
  /// order preserved), so a customer isn't scrolling past a wall of
  /// disabled brands to find one they can actually pick.
  List<String> _sortedBrandOptions(bool isBatteryService) {
    final options = isBatteryService
        ? _batteryBrandOptions
        : _tireBrandOptions;
    final available = <String>[];
    final unavailable = <String>[];
    for (final brand in options) {
      final isNa = _isBrandNaUnavailable(isBatteryService, brand);
      (isNa ? unavailable : available).add(brand);
    }
    return [...available, ...unavailable];
  }

  Future<void> _fetchBrandColumns() async {
    final results = await Future.wait([
      _vehicleService.getReferenceColumns('tyre'),
      _vehicleService.getReferenceColumns('battery'),
      _vehicleService.getBuiltinColumns('tyre'),
      _vehicleService.getBuiltinColumns('battery'),
    ]);
    if (!mounted) return;
    final dynamicTire =
        results[0] as List<({String label, String fieldName})>;
    final dynamicBattery =
        results[1] as List<({String label, String fieldName})>;
    final builtinTire =
        results[2] as List<({String label, String fieldName, bool hidden})>;
    final builtinBattery =
        results[3] as List<({String label, String fieldName, bool hidden})>;

    final tireFields = <String, String>{
      'Bridgestone': 'tyre_price_bridgestone',
      'Yokohama': 'tyre_price_yokohama',
      'Apollo': 'tyre_price_apollo',
      'Michelin': 'tyre_price_michelin',
      'Dummy 2': 'tyre_price_dummy2',
      'Dummy': 'tyre_price_dummy',
    };
    for (final c in builtinTire) {
      tireFields[c.label] = c.fieldName;
    }
    for (final c in dynamicTire) {
      tireFields[c.label] = c.fieldName;
    }

    final batteryFields = <String, String>{
      'Amaron': 'battery_price_amaron',
      'Exide': 'battery_price_exide',
    };
    for (final c in builtinBattery) {
      batteryFields[c.label] = c.fieldName;
    }
    for (final c in dynamicBattery) {
      batteryFields[c.label] = c.fieldName;
    }

    setState(() {
      _dynamicTireBrands = dynamicTire.map((c) => c.label).toList();
      _dynamicBatteryBrands = dynamicBattery.map((c) => c.label).toList();
      _hiddenBuiltinTireBrands = builtinTire
          .where((c) => c.hidden)
          .map((c) => c.label)
          .toSet();
      _hiddenBuiltinBatteryBrands = builtinBattery
          .where((c) => c.hidden)
          .map((c) => c.label)
          .toSet();
      _tireBrandFields = tireFields;
      _batteryBrandFields = batteryFields;
    });
  }

  String _brandFieldName(bool isBattery, String brand) {
    final map = isBattery ? _batteryBrandFields : _tireBrandFields;
    if (map.containsKey(brand)) return map[brand]!;
    final ci = map.entries.where(
      (e) => e.key.toLowerCase() == brand.toLowerCase(),
    );
    if (ci.isNotEmpty) return ci.first.value;
    return '${isBattery ? 'battery_price' : 'tyre_price'}_${brand.toLowerCase().replaceAll(RegExp(r'\s+'), '')}';
  }

  dynamic _brandRaw(bool isBattery, String brand) {
    final ref = _selectedVehicleReference;
    if (ref == null) return null;
    final field = _brandFieldName(isBattery, brand);
    final direct = ref[field];
    if (direct != null && direct.toString().trim().isNotEmpty) return direct;

    final prefix = isBattery ? 'battery_price_' : 'tyre_price_';
    final brandSlug = brand.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
    for (final entry in ref.entries) {
      final key = entry.key.toString();
      if (!key.startsWith(prefix)) continue;
      final keySlug = key
          .substring(prefix.length)
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]'), '');
      if (keySlug == brandSlug) return entry.value;
    }
    return direct;
  }

  bool _isBlankOrNaPrice(dynamic raw) {
    final trimmed = raw?.toString().trim() ?? '';
    if (trimmed.isEmpty) return true;
    final upper = trimmed.toUpperCase();
    return upper == 'NA' ||
        upper == 'N/A' ||
        upper == '-' ||
        upper == 'NULL' ||
        upper == 'NOT AVAILABLE' ||
        upper == 'UNAVAILABLE';
  }

  /// Non-numeric Vehicle Data note (e.g. "Contact Carzzi Team…").
  /// Null when the cell is a real price, blank, or NA.
  String? _brandPriceNote(bool isBattery, String brand) {
    final raw = _brandRaw(isBattery, brand);
    if (raw == null || _isBlankOrNaPrice(raw)) return null;
    final price = double.tryParse(raw.toString().trim());
    if (price != null && price > 0) return null;
    return raw.toString().trim();
  }

  /// True only for blank / NA cells — these stay in the "unavailable" bucket.
  /// Brands with a free-text note are treated as available visually.
  bool _isBrandNaUnavailable(bool isBattery, String brand) {
    if (_selectedVehicleReference == null) return false;
    return _isBlankOrNaPrice(_brandRaw(isBattery, brand));
  }

  /// Non-numeric Vehicle Data cell for this service's price column, if any.
  String? _servicePriceNote(ServiceItem service) {
    final ref = _selectedVehicleReference;
    if (ref == null) return null;

    String? asNote(dynamic raw) {
      if (raw == null || _isBlankOrNaPrice(raw)) return null;
      final trimmed = raw.toString().trim();
      final price = double.tryParse(trimmed);
      if (price != null && price > 0) return null;
      return trimmed;
    }

    final cat = (service.category ?? '').toLowerCase();
    final nameLower = service.name.toLowerCase();
    final isBattery =
        cat.contains('battery') || service.vehiclePricingColumn == 'battery_brand';
    final isTire =
        cat.contains('tyre') ||
        cat.contains('tire') ||
        service.vehiclePricingColumn == 'tyre_brand';
    final isGeneral =
        cat == 'periodic' ||
        cat == 'services' ||
        nameLower.contains('general service');
    final isWash =
        cat == 'car wash' || cat == 'wash' || cat == 'detailing';

    final column = service.vehiclePricingColumn;
    if (column != null &&
        column != 'tyre_brand' &&
        column != 'battery_brand') {
      return asNote(ref[column]);
    }

    if (isGeneral) {
      return asNote(ref['general_service_price']);
    }

    if (isWash) {
      dynamic raw;
      if ((nameLower.contains('exterior wash') ||
              nameLower.contains('exterior only')) &&
          !nameLower.contains('interior')) {
        raw = ref['car_wash_exterior_price'];
      } else if (nameLower.contains('interior + exterior') &&
          !nameLower.contains('underbody')) {
        raw = ref['car_wash_interior_exterior_price'];
      } else if (nameLower.contains('underbody wash') ||
          (nameLower.contains('interior') &&
              nameLower.contains('exterior') &&
              nameLower.contains('underbody'))) {
        raw = ref['car_wash_interior_exterior_underbody_price'];
      }
      final rawStr = raw?.toString().trim() ?? '';
      if (rawStr.isEmpty) {
        raw = ref['car_wash_price'];
      }
      return asNote(raw);
    }

    if (isTire || isBattery) return null;
    return null;
  }

  /// Price for the given brand on the currently selected vehicle, or null
  /// when there's no vehicle reference match (nothing to show — the brand
  /// itself isn't necessarily unavailable, we just don't have vehicle-
  /// specific pricing). A brand that's actually unavailable never reaches
  /// here, since _brandUnavailableReason blocks selecting it in the first
  /// place.
  double? _getBrandPrice(bool isBattery, String brand) {
    final raw = _brandRaw(isBattery, brand);
    final price = double.tryParse(raw?.toString().trim() ?? '');
    return (price != null && price > 0) ? price : null;
  }

  double _getServicePrice(ServiceItem service) {
    if (_adjustedPrices.containsKey(service.id)) {
      return _adjustedPrices[service.id]!;
    }

    final cat = service.category?.toLowerCase() ?? '';
    final isBattery =
        cat.contains('battery') || service.vehiclePricingColumn == 'battery_brand';
    final isTire =
        cat.contains('tyre') ||
        cat.contains('tire') ||
        service.vehiclePricingColumn == 'tyre_brand';

    final isGeneral =
        cat == 'periodic' ||
        cat == 'services' ||
        service.name.toLowerCase().contains('general service');
    if (isGeneral && _selectedVehicleReference != null) {
      final refPrice = double.tryParse(
        _selectedVehicleReference!['general_service_price']?.toString() ?? '',
      );
      if (refPrice != null && refPrice > 0) {
        return refPrice;
      }
    }

    if ((isTire || isBattery) &&
        _selectedTireBrands.containsKey(service.id) &&
        _selectedVehicleReference != null) {
      final brand = _selectedTireBrands[service.id]!;
      final brandPrice = _getBrandPrice(isBattery, brand);
      if (brandPrice != null && brandPrice > 0) {
        return brandPrice;
      }
    }

    return service.price.toDouble();
  }

  /// True when this service is expected to have a vehicle-specific price
  /// (General Service, Car Wash, or any category with an admin-set
  /// vehiclePricingColumn — includes Essentials when configured that way)
  /// but the matched Vehicle Reference Data row has no valid positive
  /// number for it (blank, "NA", or a non-numeric note). Used to show "NA"
  /// instead of silently falling back to the generic catalog price, and to
  /// block selecting the service until an admin fills the price in.
  bool _hasMissingVehiclePrice(ServiceItem service) {
    final ref = _selectedVehicleReference;
    if (ref == null) return false;

    double? parsePositive(dynamic raw) {
      if (raw == null) return null;
      final trimmed = raw.toString().trim();
      if (trimmed.isEmpty) return null;
      final n = double.tryParse(trimmed);
      return (n != null && n > 0) ? n : null;
    }

    final cat = (service.category ?? '').toLowerCase();
    final nameLower = service.name.toLowerCase();
    final isGeneral =
        cat == 'periodic' ||
        cat == 'services' ||
        nameLower.contains('general service');
    final isWash = cat == 'car wash' || cat == 'wash' || cat == 'detailing';
    final column = service.vehiclePricingColumn;
    final hasDirectColumn =
        column != null && column != 'tyre_brand' && column != 'battery_brand';

    if (hasDirectColumn) {
      return parsePositive(ref[column]) == null;
    }
    if (isGeneral) {
      return parsePositive(ref['general_service_price']) == null;
    }
    if (isWash) {
      dynamic raw;
      if ((nameLower.contains('exterior wash') ||
              nameLower.contains('exterior only')) &&
          !nameLower.contains('interior')) {
        raw = ref['car_wash_exterior_price'];
      } else if (nameLower.contains('interior + exterior') &&
          !nameLower.contains('underbody')) {
        raw = ref['car_wash_interior_exterior_price'];
      } else if (nameLower.contains('underbody wash') ||
          (nameLower.contains('interior') &&
              nameLower.contains('exterior') &&
              nameLower.contains('underbody'))) {
        raw = ref['car_wash_interior_exterior_underbody_price'];
      }
      if (parsePositive(raw) != null) return false;
      return parsePositive(ref['car_wash_price']) == null;
    }
    // No configured pricing column and not general/wash — nothing to
    // validate (e.g. an Essentials service always priced from the catalog).
    return false;
  }

  Widget _buildSelectedServicePrice(ServiceItem service) {
    // Step-2 cards show vehicle-matched price for Services, Car Wash, and Essentials.
    // Tyres/Battery stay brand-driven (price appears on brand chips instead).
    final flow = widget.initialCategory;
    final isWashFlow = flow == 'Wash' || flow == 'Car Wash';
    final isEssentialsFlow = flow == 'Essentials';
    final isServicesFlow = flow == 'Periodic' || flow == 'Services';
    final isTireBatteryFlow =
        flow == 'Tyres' || flow == 'Battery' || flow == 'Tyre & Battery';

    if (isTireBatteryFlow) return const SizedBox.shrink();

    if (flow != null && !isServicesFlow && !isWashFlow && !isEssentialsFlow) {
      return const SizedBox.shrink();
    }

    if (flow == null) {
      final cat = (service.category ?? '').toLowerCase();
      final isWash =
          cat == 'car wash' || cat == 'wash' || cat == 'detailing';
      final isEssentials = cat == 'essentials';
      if (!isGeneralServiceItem(service) && !isWash && !isEssentials) {
        return const SizedBox.shrink();
      }
    }

    if (_hasMissingVehiclePrice(service)) {
      return const Padding(
        padding: EdgeInsets.only(top: 4),
        child: Text(
          'NA',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.error,
          ),
        ),
      );
    }

    final qty = _serviceQuantities[service.id] ?? 1;
    final unit = _getServicePrice(service);
    final total = unit * qty;
    if (total <= 0) return const SizedBox.shrink();

    final label = qty > 1
        ? '₹${formatInrAmount(total)}  ($qty × ₹${formatInrAmount(unit)})'
        : '₹${formatInrAmount(total)}';

    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: AppColors.primaryBlue,
        ),
      ),
    );
  }

  /// Only one service can be booked at a time — selecting a new one
  /// replaces whatever was selected before, rather than adding to it.
  /// Tapping the already-selected service deselects it.
  void _toggleServiceSelection(ServiceItem service) {
    final alreadySelected = _selectedServiceIds.contains(service.id);
    if (!alreadySelected) {
      final note = _servicePriceNote(service);
      if (note != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(note)),
        );
        return;
      }
      if (_hasMissingVehiclePrice(service)) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Price not available for this vehicle yet. Please check back once it has been added.',
            ),
          ),
        );
        return;
      }
    }

    setState(() {
      _selectedServiceIds.clear();
      _serviceQuantities.clear();
      _tireSizes.clear();
      _selectedTireBrands.clear();
      _isManualSize.clear();

      if (alreadySelected) return;

      _selectedServiceIds = [service.id];
      _serviceQuantities[service.id] = 1;

      // Pre-fill tire size if vehicle is selected
      if (_selectedVehicleId != null) {
        final vehicle = _vehicles.firstWhere(
          (v) => v.id == _selectedVehicleId,
          orElse: () => _vehicles.first,
        );
        if (_selectedVehicleOEMTire != null &&
            _selectedVehicleOEMTire!.isNotEmpty) {
          _tireSizes[service.id] = _selectedVehicleOEMTire!;
          if (_tireSizeControllers.containsKey(service.id)) {
            _tireSizeControllers[service.id]!.text =
                _selectedVehicleOEMTire!;
          }
        }
        _autoFillTireSize(service.id, vehicle);
      }
    });
  }

  double _calculateTotal() {
    final selectedServices = _allServices
        .where((s) => _selectedServiceIds.contains(s.id))
        .toList();

    final isGeneralService = selectedServices.any((s) {
      final cat = s.category;
      final name = s.name.toLowerCase();
      return cat == 'Periodic' ||
          cat == 'Services' ||
          name.contains('general service');
    });

    final double baseTotal = selectedServices.fold<double>(
      0,
      (sum, item) =>
          sum + (_getServicePrice(item) * (_serviceQuantities[item.id] ?? 1)),
    );

    return baseTotal + (isGeneralService ? _pickupDropPrice : 0);
  }

  void _removeCoupon() {
    setState(() {
      _appliedCoupon = null;
      _cachedCheckoutTotals = null;
      _cachedSelectedServices = null;
      _cachedTotal = null;
      if (_currentStep == 3) {
        _precomputeConfirmStepData();
      }
    });
  }

  Future<void> _autoFillTireSize(String serviceId, Vehicle vehicle) async {
    String format(String v) {
      var s = v.trim();
      s = s.replaceAll(RegExp(r'\s*/\s*'), '/');
      s = s.replaceAll(RegExp(r'\s+'), ' ');
      s = s.replaceAllMapped(
        RegExp(r'(\d{2,3})/(\d{2})\s*R\s*(\d{2})'),
        (m) => '${m[1]}/${m[2]} R${m[3]}',
      );
      return s;
    }

    String clean(String? v) {
      if (v == null) return '';
      var s = v.replaceAll(RegExp(r'\[[^\]]*\]'), '');
      s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
      return s;
    }

    const overrides = {'tata|nexon|xe': '195/60 R16'};

    if (_allServices.isEmpty) return;

    final service = _allServices.firstWhere(
      (s) => s.id == serviceId,
      orElse: () => _allServices.first,
    );
    final isTireService =
        service.name.toLowerCase().contains('change') ||
        service.name.toLowerCase().contains('size');

    if (!isTireService) return;

    String? tireSize;

    // Always try reference first with cleaned brand, model, and variant
    try {
      final ref = await _vehicleService.searchReference(
        make: clean(vehicle.make),
        model: clean(vehicle.model),
        // Not bracket-stripped: the backend matches variant against the
        // full brand_model value verbatim (e.g. "2023 [ X-Line ]"), which
        // is exactly what's saved on the vehicle. Stripping the bracket
        // here (as `clean` does for make/model noise) throws away the
        // actual trim, so the exact-variant match always misses and this
        // silently falls back to matching any row for the model/year —
        // showing a different trim's tyre size entirely.
        variant: vehicle.variant != null && vehicle.variant!.trim().isNotEmpty
            ? vehicle.variant!.trim()
            : null,
        fuelType: vehicle.fuelType,
      );
      if (ref != null) {
        tireSize = (ref['front_tyres'] ?? ref['rear_tyres'])?.toString();
      }
    } catch (e) {
      debugPrint('Failed to auto-fetch tire size from reference: $e');
    }

    // Fallback to vehicle-saved tyres if reference not found
    tireSize ??= vehicle.frontTyres ?? vehicle.rearTyres;

    if (tireSize != null && tireSize.isNotEmpty) {
      tireSize = format(tireSize);
    }

    final b = clean(vehicle.make).toLowerCase();
    final m = clean(vehicle.model).toLowerCase();
    final v = (vehicle.variant != null && vehicle.variant!.trim().isNotEmpty)
        ? clean(vehicle.variant).toLowerCase()
        : null;
    final k1 = v != null && v.isNotEmpty ? '$b|$m|$v' : '$b|$m';
    if (overrides.containsKey(k1)) {
      tireSize = overrides[k1];
    } else if (overrides.containsKey('$b|$m')) {
      tireSize = overrides['$b|$m'];
    }

    if (tireSize != null && tireSize.isNotEmpty) {
      final nonNullTireSize = tireSize;
      setState(() {
        _tireSizes[serviceId] = nonNullTireSize;

        // Update controller if it exists
        if (_tireSizeControllers.containsKey(serviceId)) {
          _tireSizeControllers[serviceId]!.text = nonNullTireSize;
        }
      });
    }
  }

  Future<void> _loadPickupDropPrice(Vehicle vehicle) async {
    if (!mounted) return;
    setState(() => _pickupDropLoading = true);
    try {
      await _prefetchVehicleTire(vehicle);
    } finally {
      if (mounted) setState(() => _pickupDropLoading = false);
    }
  }

  Future<void> _prefetchVehicleTire(Vehicle vehicle) async {
    String format(String v) {
      var s = v.trim();
      s = s.replaceAll(RegExp(r'\s*/\s*'), '/');
      s = s.replaceAll(RegExp(r'\s+'), ' ');
      s = s.replaceAllMapped(
        RegExp(r'(\d{2,3})/(\d{2})\s*R\s*(\d{2})'),
        (m) => '${m[1]}/${m[2]} R${m[3]}',
      );
      return s;
    }

    String clean(String? v) {
      if (v == null) return '';
      var s = v.replaceAll(RegExp(r'\[[^\]]*\]'), '');
      s = s.replaceAll(RegExp(r'\s+'), ' ').trim();
      return s;
    }

    try {
      final ref = await _vehicleService.searchReference(
        make: clean(vehicle.make),
        model: clean(vehicle.model),
        // See the comment on the same call in _autoFillTireSize: the
        // backend matches variant against the full brand_model value
        // verbatim, so it must not be bracket-stripped here.
        variant: vehicle.variant != null && vehicle.variant!.trim().isNotEmpty
            ? vehicle.variant!.trim()
            : null,
        fuelType: vehicle.fuelType,
      );

      double pickupPrice = 0;
      final storedPickup = vehicle.pickupDropPrice?.trim();
      if (storedPickup != null && storedPickup.isNotEmpty) {
        pickupPrice = double.tryParse(storedPickup) ?? 0;
      }
      if (ref != null && ref['pickup_drop_price'] != null) {
        final fromRef = double.tryParse(ref['pickup_drop_price'].toString());
        if (fromRef != null && fromRef >= 0) pickupPrice = fromRef;
      }

      final Map<String, double> newAdjustedPrices = {};
      if (ref != null) {
        for (final service in _allServices) {
          final cat = (service.category ?? '').toLowerCase();
          final nameLower = service.name.toLowerCase();

          // Admin-selected pricing column (Add/Edit Service) takes priority
          // over every heuristic below — matches calculateServicesTotal in
          // backend/controllers/bookingController.js, and doesn't depend on
          // how the service happens to be worded. 'tyre_brand'/
          // 'battery_brand' are sentinels resolved by brand selection
          // elsewhere, not a direct column here.
          final column = service.vehiclePricingColumn;
          final isDirectPricingColumn =
              column != null &&
              column != 'tyre_brand' &&
              column != 'battery_brand';
          if (isDirectPricingColumn) {
            final columnPrice = double.tryParse(
              ref[column]?.toString() ?? '',
            );
            if (columnPrice != null && columnPrice > 0) {
              newAdjustedPrices[service.id] = columnPrice;
              continue;
            }
          }

          final isGeneral =
              cat == 'periodic' ||
              cat == 'services' ||
              nameLower.contains('general service');
          if (isGeneral && ref['general_service_price'] != null) {
            final generalPrice = double.tryParse(
              ref['general_service_price'].toString(),
            );
            if (generalPrice != null && generalPrice > 0) {
              newAdjustedPrices[service.id] = generalPrice;
            }
          }
          final isWash = cat == 'car wash' || cat == 'wash';
          if (isWash) {
            final sName = service.name.toLowerCase();
            double? washPrice;

            if ((sName.contains('exterior wash') ||
                    sName.contains('exterior only')) &&
                !sName.contains('interior')) {
              washPrice = double.tryParse(
                ref['car_wash_exterior_price']?.toString() ?? '',
              );
            } else if (sName.contains('interior + exterior') &&
                !sName.contains('underbody')) {
              washPrice = double.tryParse(
                ref['car_wash_interior_exterior_price']?.toString() ?? '',
              );
            } else if (sName.contains('interior + exterior + underbody') ||
                (sName.contains('interior') &&
                    sName.contains('exterior') &&
                    sName.contains('underbody'))) {
              washPrice = double.tryParse(
                ref['car_wash_interior_exterior_underbody_price']?.toString() ??
                    '',
              );
            }

            if (washPrice != null && washPrice > 0) {
              newAdjustedPrices[service.id] = washPrice;
            }
          }
        }
      }

      setState(() {
        _pickupDropPrice = pickupPrice;
        _adjustedPrices = newAdjustedPrices;
        _selectedVehicleReference = ref;
      });

      String? tireSize = (ref?['front_tyres'] ?? ref?['rear_tyres'])
          ?.toString();
      tireSize ??= vehicle.frontTyres ?? vehicle.rearTyres;
      if (tireSize != null && tireSize.isNotEmpty) {
        final formatted = format(tireSize);
        setState(() {
          _selectedVehicleOEMTire = formatted;
          for (final sid in _selectedServiceIds) {
            _tireSizes[sid] = formatted;
            if (_tireSizeControllers.containsKey(sid)) {
              _tireSizeControllers[sid]!.text = formatted;
            }
          }
        });
      }
    } catch (_) {}
  }

  String _formatTireSizeLabel(String v) {
    var s = v.trim();
    s = s.replaceAll(RegExp(r'\s*/\s*'), '/');
    s = s.replaceAll(RegExp(r'\s+'), ' ');
    s = s.replaceAllMapped(
      RegExp(r'(\d{2,3})/(\d{2})\s*R\s*(\d{2})'),
      (m) => '${m[1]}/${m[2]} R${m[3]}',
    );
    return s;
  }

  /// Catalog used for manual-entry autocomplete suggestions.
  static const List<String> _allTireSizeSuggestions = [
    '145/70 R12',
    '155/80 R13',
    '165/80 R14',
    '175/65 R14',
    '185/65 R15',
    '195/60 R16',
    '195/55 R16',
    '205/55 R16',
    '215/60 R16',
    '225/45 R17',
    '235/45 R18',
  ];

  InputDecoration _appInputDecoration({
    required bool isDark,
    required String hintText,
  }) {
    final borderColor = isDark
        ? AppColors.borderColor
        : AppColors.borderColorLight;
    return InputDecoration(
      hintText: hintText,
      hintStyle: TextStyle(
        color: isDark ? AppColors.textMuted : AppColors.textMutedLight,
      ),
      filled: true,
      fillColor: isDark
          ? AppColors.backgroundSecondary
          : AppColors.backgroundSecondaryLight,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: borderColor),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: borderColor),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.primaryBlue, width: 2),
      ),
    );
  }

  List<String> _tireSizeSuggestionsForQuery(String raw, {required bool focused}) {
    if (!focused) return const [];
    final q = raw.trim().toLowerCase();
    if (q.isEmpty) return List<String>.from(_allTireSizeSuggestions);
    return _allTireSizeSuggestions
        .where((s) => s.toLowerCase().contains(q))
        .where((s) => s.toLowerCase() != q)
        .toList();
  }

  Widget _buildManualTireSizeField({
    required ServiceItem service,
    required bool isDark,
  }) {
    final controller = _tireSizeControllers.putIfAbsent(
      service.id,
      () => TextEditingController(text: _tireSizes[service.id] ?? ''),
    );
    final focusNode = _tireSizeFocusNodes.putIfAbsent(
      service.id,
      () {
        final node = FocusNode();
        node.addListener(() {
          if (mounted) setState(() {});
        });
        return node;
      },
    );
    final suggestions = _tireSizeSuggestionsForQuery(
      controller.text,
      focused: focusNode.hasFocus,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: controller,
          focusNode: focusNode,
          style: TextStyle(
            color: isDark ? AppColors.textPrimary : Colors.black87,
            fontSize: 15,
            fontWeight: FontWeight.w500,
          ),
          onChanged: (val) => setState(() => _tireSizes[service.id] = val),
          textInputAction: TextInputAction.done,
          decoration: _appInputDecoration(
            isDark: isDark,
            hintText: 'Enter size (e.g. 185/65 R15)',
          ),
        ),
        if (suggestions.isNotEmpty) ...[
          const SizedBox(height: 6),
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxHeight: 220),
            decoration: BoxDecoration(
              color: isDark
                  ? AppColors.backgroundSecondary
                  : AppColors.backgroundSecondaryLight,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isDark
                    ? AppColors.borderColor
                    : AppColors.borderColorLight,
              ),
            ),
            child: ListView.separated(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              itemCount: suggestions.length,
              separatorBuilder: (context, index) => Divider(
                height: 1,
                color: isDark
                    ? Colors.white12
                    : Colors.black.withValues(alpha: 0.06),
              ),
              itemBuilder: (context, i) {
                final size = suggestions[i];
                return InkWell(
                  onTap: () {
                    setState(() {
                      _tireSizes[service.id] = size;
                      controller.text = size;
                      controller.selection = TextSelection.collapsed(
                        offset: size.length,
                      );
                    });
                    focusNode.unfocus();
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.tire_repair_outlined,
                          size: 16,
                          color: AppColors.primaryBlue,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            size,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: isDark
                                  ? AppColors.textPrimary
                                  : Colors.black87,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ],
    );
  }

  /// Tyre sizes for the currently selected vehicle (front/rear from reference
  /// data and the vehicle record). Used instead of the full common list.
  List<String> _vehicleTireSizeOptions() {
    final sizes = <String>{};

    void addRaw(String? raw) {
      final trimmed = raw?.trim();
      if (trimmed == null || trimmed.isEmpty) return;
      sizes.add(_formatTireSizeLabel(trimmed));
    }

    // Prefer the live-matched Vehicle Reference Data row for this exact
    // vehicle/variant — it's the current source of truth. The vehicle's own
    // saved frontTyres/rearTyres (set once, e.g. at registration time) can
    // go stale relative to it, so it's only used as a fallback when there's
    // no reference match at all, rather than always being unioned in —
    // otherwise a vehicle could show an unrelated variant's stale size
    // alongside the correct current one (or as the wrongly pre-selected
    // default).
    final ref = _selectedVehicleReference;
    if (ref != null) {
      addRaw(ref['front_tyres']?.toString());
      addRaw(ref['rear_tyres']?.toString());
    } else {
      Vehicle? vehicle;
      final selectedId = _selectedVehicleId;
      if (selectedId != null) {
        for (final v in _vehicles) {
          if (v.id == selectedId) {
            vehicle = v;
            break;
          }
        }
      }
      if (vehicle != null) {
        addRaw(vehicle.frontTyres);
        addRaw(vehicle.rearTyres);
      }
    }

    addRaw(_selectedVehicleOEMTire);

    return sizes.toList();
  }

  @override
  void initState() {
    super.initState();

    // Initialize Cashfree EARLY for better performance
    if (!kIsWeb) {
      _cashfreeGateway.setCallback(_handlePaymentSuccess, _handlePaymentError);
    }

    _fetchInitialData();
    _fetchBrandColumns();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      await _socketService.init(context.read<AuthProvider>().user);
    });

    if (widget.initialCategory == 'Battery') {
      _activeSubCategory = 'Battery';
    } else if (widget.initialCategory == 'Tyres' ||
        widget.initialCategory == 'Tyre & Battery') {
      _activeSubCategory = 'Tyres'; // Default to Tyres
    } else {
      _activeSubCategory = 'All';
    }

    // Check for arguments from NavigationProvider
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _checkArguments();
        context.read<NavigationProvider>().addListener(_onNavChanged);
      }
    });
  }

  void _onNavChanged() {
    if (!mounted) return;
    final nav = context.read<NavigationProvider>();
    final Map<String, int> tabMapping = {
      'Wash': 0,
      'Periodic': 1,
      'Tyres': 3,
      'Battery': 4,
    };
    if (tabMapping[widget.initialCategory] == nav.selectedIndex) {
      _checkArguments();
    }
  }

  void _checkArguments() {
    if (!mounted) return;
    final nav = context.read<NavigationProvider>();
    if (nav.arguments != null && nav.arguments is ServiceItem) {
      final service = nav.arguments as ServiceItem;
      setState(() {
        _initialServiceId = service.id;
        _selectedServiceIds = [service.id];
        _currentStep = 0;

        // Auto-set subcategory for Tyres/Battery flow
        if (widget.initialCategory == 'Tyres' ||
            widget.initialCategory == 'Battery' ||
            widget.initialCategory == 'Tyre & Battery') {
          if (service.category?.toLowerCase().contains('battery') == true) {
            _activeSubCategory = 'Battery';
          } else {
            _activeSubCategory = 'Tyres';
          }
        }
      });
      nav.clearArguments();
    }
  }

  @override
  void dispose() {
    try {
      context.read<NavigationProvider>().removeListener(_onNavChanged);
    } catch (_) {}
    _notesController.dispose();
    for (final controller in _tireSizeControllers.values) {
      controller.dispose();
    }
    for (final node in _tireSizeFocusNodes.values) {
      node.dispose();
    }
    _locationSearchDebounce?.cancel();
    _locationSearchController.dispose();
    super.dispose();
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
        'tempBookingData': _currentTempBookingData,
      };

      final result = await _verifyPaymentWithRetry(verifyData);

      if (mounted) {
        Navigator.pop(context); // Close loading dialog

        final data = result['data'] as Map<String, dynamic>?;
        final paymentStatus = data?['status'] as String? ?? 'unknown';
        final isPaid = result['success'] == true && paymentStatus == 'paid';

        if (isPaid) {
          final booking = data?['booking'];
          final newBookingId = booking is Map
              ? booking['_id']?.toString()
              : data?['bookingId']?.toString();
          final hasBooking = newBookingId != null && newBookingId.isNotEmpty;
          Navigator.of(context).pushReplacementNamed(
            '/payment-status',
            arguments: PaymentStatusPage(
              success: true,
              title: 'Payment successful',
              message:
                  'Your payment was received and the booking has been created successfully.',
              primaryButtonLabel: hasBooking ? 'View booking' : 'Go to home',
              primaryRoute: hasBooking ? '/track' : '/customer',
              primaryArguments: hasBooking ? newBookingId : null,
              clearStackOnPrimary: true,
              secondaryButtonLabel: 'View bookings',
              secondaryRoute: '/bookings',
              clearStackOnSecondary: true,
            ),
          );
          context.read<SocketService>().sendEvent('booking_created');
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
              primaryButtonLabel: 'Try again',
              onPrimaryPressed: _restoreCheckoutAfterPaymentFailure,
              secondaryButtonLabel: 'Go to home',
              secondaryRoute: '/customer',
              clearStackOnSecondary: true,
            ),
          );
        } else {
          // Any other status (e.g. "pending" — no payment attempt was ever
          // recorded, which is exactly what happens when the checkout is
          // cancelled before reaching Cashfree) is NOT a success. Showing
          // "Payment received" here regardless of what actually happened
          // was the bug — a cancelled payment displayed as received.
          Navigator.of(context).pushNamed(
            '/payment-status',
            arguments: PaymentStatusPage(
              success: false,
              title: 'Payment not confirmed',
              message:
                  'We could not confirm this payment (status: $paymentStatus). If you completed the payment, it will be confirmed shortly — check My Bookings. Otherwise, please try again.',
              primaryButtonLabel: 'Try again',
              onPrimaryPressed: _restoreCheckoutAfterPaymentFailure,
              secondaryButtonLabel: 'Go to home',
              secondaryRoute: '/customer',
              clearStackOnSecondary: true,
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
            primaryButtonLabel: 'Try again',
            onPrimaryPressed: _restoreCheckoutAfterPaymentFailure,
            secondaryButtonLabel: 'Go to home',
            secondaryRoute: '/customer',
            clearStackOnSecondary: true,
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

  void _resetBookingWizard() {
    setState(() {
      _currentStep = 0;
      _selectedServiceIds = [];
      _selectedTimeSlot = null;
      _selectedAddress = null;
      _selectedLatLng = null;
      _appliedCoupon = null;
      _pickupDropPrice = 0;
      _pickupDropLoading = false;
    });
    _notesController.clear();
  }

  void _restoreCheckoutAfterPaymentFailure() {
    if (!mounted) return;
    Navigator.of(context).pop();
    setState(() => _currentStep = 3);
  }

  void _navigateToHomeAfterBooking() {
    if (!mounted) return;
    context.read<NavigationProvider>().goHomeAfterBooking();

    final routeName = ModalRoute.of(context)?.settings.name;
    if (routeName == '/book') {
      Navigator.of(
        context,
        rootNavigator: true,
      ).pushNamedAndRemoveUntil('/customer', (route) => false);
    }

    // Reset wizard after switching away so user does not land on step 1 when revisiting a tab
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _resetBookingWizard();
    });
  }

  void _handlePaymentError(CFErrorResponse response, String orderId) {
    Navigator.of(context).pushNamed(
      '/payment-status',
      arguments: PaymentStatusPage(
        success: false,
        title: 'Payment failed',
        message: '${response.getMessage()} (Order: $orderId)',
        primaryButtonLabel: 'Try again',
        onPrimaryPressed: _restoreCheckoutAfterPaymentFailure,
        secondaryButtonLabel: 'Go to home',
        secondaryRoute: '/customer',
        clearStackOnSecondary: true,
      ),
    );
  }

  @override
  void didUpdateWidget(BookServiceFlowPage oldWidget) {
    super.didUpdateWidget(oldWidget);
  }

  Future<void> _fetchInitialData({bool forceRefresh = false}) async {
    if (!mounted) return;

    // Only show full loading if we have no data yet
    final isFirstLoad = _vehicles.isEmpty && _allServices.isEmpty;
    if (isFirstLoad || forceRefresh) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final isAuthed = context.read<AuthProvider>().isAuthenticated;
      final List<dynamic> results = await Future.wait([
        isAuthed
            ? _vehicleService.listMyVehicles(forceRefresh: forceRefresh).catchError((
                e,
              ) {
                debugPrint('Error fetching vehicles: $e');
                return <Vehicle>[];
              })
            : Future<List<Vehicle>>.value(const <Vehicle>[]),
        _catalogService.listServices(forceRefresh: forceRefresh).catchError((
          e,
        ) {
          debugPrint('Error fetching services: $e');
          return <ServiceItem>[];
        }),
        isAuthed
            ? _bookingService.getAvailableServicePincodes().catchError((e) {
                debugPrint('Error fetching available service pincodes: $e');
                return <String>[];
              })
            : Future<List<String>>.value(const <String>[]),
      ]);

      final List<Vehicle> vehicles = results[0] as List<Vehicle>;
      final List<ServiceItem> services = results[1] as List<ServiceItem>;
      final List<String> availablePincodes = results[2] as List<String>;

      if (mounted) {
        if (vehicles.isEmpty && services.isEmpty && forceRefresh) {
          // If both failed and it was a force refresh, show error
          setState(() {
            _error = 'Failed to load data. Please check your connection.';
            _loading = false;
          });
          return;
        }

        setState(() {
          _vehicles = List<Vehicle>.from(vehicles);
          _allServices = services;
          _availableServicePincodes = availablePincodes;
          _pincodesReady = true;
          _hasAttemptedFetch = true;
          _error =
              null; // Clear any previous errors if we got at least something

          if (_vehicles.isNotEmpty && _selectedVehicleId == null) {
            final preselected = widget.initialVehicleId != null
                ? _vehicles.where((v) => v.id == widget.initialVehicleId)
                : const Iterable<Vehicle>.empty();
            final vehicle = preselected.isNotEmpty
                ? preselected.first
                : _vehicles.first;
            _selectedVehicleId = vehicle.id;
            if (preselected.isNotEmpty && _currentStep == 0) {
              _currentStep = 1;
            }

            // Auto-fill tire size for the default selected vehicle
            _loadPickupDropPrice(vehicle);
            for (final serviceId in _selectedServiceIds) {
              _autoFillTireSize(serviceId, vehicle);
            }
          }

          // Pre-populate location from default saved address
          final user = context.read<AuthProvider>().user;
          if (user != null &&
              user.addresses.isNotEmpty &&
              _selectedAddress == null) {
            final defaultAddr = user.addresses.firstWhere(
              (a) => a.isDefault,
              orElse: () => user.addresses.first,
            );
            _selectedAddress = defaultAddr.address;
            _selectedLatLng = LatLng(defaultAddr.lat, defaultAddr.lng);
          }

          _loading = false;
        });
        await _fetchCoupons();
        if (isAuthed) {
          await _fetchSlotsForDate(_selectedDate);
          await _prefetchSavedAddressPincodes();
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _hasAttemptedFetch = true;
        });
      }
    }
  }

  final List<String> _steps = ['Vehicle', 'Service', 'Schedule', 'Confirm'];

  void _showSlotPicker(bool isDark) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          return Container(
            height: MediaQuery.of(context).size.height * 0.5,
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF1A1A1A) : Colors.white,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(28),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.2),
                  blurRadius: 20,
                  offset: const Offset(0, -5),
                ),
              ],
            ),
            child: Column(
              children: [
                const SizedBox(height: 12),
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white10 : Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Row(
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Select Time Slot',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                              color: isDark ? Colors.white : Colors.black,
                              letterSpacing: -0.5,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            DateFormat('EEEE, MMMM d').format(_selectedDate),
                            style: TextStyle(
                              fontSize: 13,
                              color: isDark ? Colors.white38 : Colors.black38,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                      const Spacer(),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: Icon(
                          Icons.close_rounded,
                          color: isDark ? Colors.white38 : Colors.black38,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Builder(
                    builder: (context) {
                      final counts = _slotBadgeCounts();
                      return Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.primaryBlue.withValues(
                                alpha: 0.12,
                              ),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              '${counts.available} available',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: isDark
                                    ? AppColors.primaryBlue
                                    : const Color(0xFF1D4ED8),
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: isDark
                                  ? Colors.white.withValues(alpha: 0.08)
                                  : Colors.grey.shade200,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              '${counts.booked} booked',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: isDark ? Colors.white70 : Colors.black54,
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: _availableSlots.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.event_busy_rounded,
                                color: isDark
                                    ? Colors.white10
                                    : Colors.grey.shade200,
                                size: 48,
                              ),
                              const SizedBox(height: 16),
                              Text(
                                'No slots available for this date',
                                style: TextStyle(
                                  color: isDark
                                      ? Colors.white24
                                      : Colors.grey.shade400,
                                ),
                              ),
                            ],
                          ),
                        )
                      : SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
                          child: Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 12,
                            runSpacing: 12,
                            children: _availableSlots.map((slot) {
                              final isSelected = _selectedTimeSlot == slot;
                              return GestureDetector(
                                onTap: () {
                                  setState(() {
                                    _selectedTimeSlot = slot;
                                  });
                                  setModalState(() {});
                                  Future.delayed(
                                    const Duration(milliseconds: 150),
                                    () {
                                      if (context.mounted) {
                                        Navigator.pop(context);
                                      }
                                    },
                                  );
                                },
                                child: AnimatedContainer(
                                  duration: const Duration(milliseconds: 200),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 20,
                                    vertical: 14,
                                  ),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? AppColors.primaryBlue
                                        : (isDark
                                              ? Colors.white.withValues(
                                                  alpha: 0.05,
                                                )
                                              : Colors.grey.shade100),
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(
                                      color: isSelected
                                          ? AppColors.primaryBlue
                                          : (isDark
                                                ? Colors.white.withValues(
                                                    alpha: 0.05,
                                                  )
                                                : Colors.grey.shade200),
                                      width: 1.5,
                                    ),
                                    boxShadow: [
                                      if (isSelected)
                                        BoxShadow(
                                          color: AppColors.primaryBlue
                                              .withValues(alpha: 0.3),
                                          blurRadius: 12,
                                          offset: const Offset(0, 6),
                                        ),
                                    ],
                                  ),
                                  child: Text(
                                    slot,
                                    style: TextStyle(
                                      color: isSelected
                                          ? Colors.white
                                          : (isDark
                                                ? Colors.white70
                                                : Colors.black87),
                                      fontWeight: isSelected
                                          ? FontWeight.w900
                                          : FontWeight.w600,
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<NavigationProvider>();
    final currentIdx = nav.selectedIndex;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // Check if this page's tab is active and if we should refresh
    final Map<String, int> tabMapping = {
      'Wash': 0,
      'Periodic': 1,
      'Tyres': 3,
      'Battery': 4,
    };

    if (tabMapping[widget.initialCategory] == currentIdx) {
      // If we are on the active tab, and data is missing and we haven't tried fetching yet
      if ((_vehicles.isEmpty || _allServices.isEmpty) &&
          !_loading &&
          !_hasAttemptedFetch &&
          _error == null) {
        Future.microtask(() => _fetchInitialData());
      }
    }

    return GlobalSyncRefresh(
      entities: const [
        'availableservicepincode',
        'slotblock',
        'booking',
        'coupon',
        'service',
      ],
      onSync: _onGlobalSyncRefresh,
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          _onBackPressed();
        },
        child: Scaffold(
          backgroundColor: isDark
              ? AppColors.backgroundPrimary
              : AppStyles.softBackground,
          appBar: AppBar(
            leading: IconButton(
              icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
              onPressed: _onBackPressed,
            ),
            title: Text(
              () {
                final cat = widget.initialCategory;
                if (cat == 'Battery') {
                  return 'Book a Battery Service';
                }
                if (cat == 'Tyres') {
                  return 'Book a Tyre';
                }
                if (cat == 'Tyre & Battery') {
                  return 'Book a Tires & Battery Service';
                }
                if (cat == 'Periodic') {
                  return 'Book a Periodic Service';
                }
                if (cat == 'Services') {
                  return 'Book a General Service';
                }
                if (cat == 'Wash' || cat == 'Car Wash') {
                  return 'Book a Car Wash Service';
                }
                if (cat == 'Essentials') {
                  return 'Book an Essentials Service';
                }
                if (cat != null && cat.isNotEmpty) {
                  return 'Book a $cat Service';
                }
                return 'Book a Service';
              }(),
              style: AppStyles.headingStyle.copyWith(
                color: isDark ? AppColors.textPrimary : const Color(0xFF222222),
              ),
            ),
            backgroundColor: Colors.transparent,
            elevation: 0,
            centerTitle: true,
            iconTheme: IconThemeData(
              color: isDark ? AppColors.textPrimary : Colors.black,
            ),
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : Stack(
                  children: [
                    Positioned.fill(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 20, 20, 120),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            RepaintBoundary(
                              child: CustomStepper(
                                steps: _steps,
                                currentStep: _currentStep,
                              ),
                            ),
                            const SizedBox(height: 32),
                            RepaintBoundary(
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 250),
                                switchInCurve: Curves.easeOutCubic,
                                switchOutCurve: Curves.easeInCubic,
                                transitionBuilder:
                                    (
                                      Widget child,
                                      Animation<double> animation,
                                    ) {
                                      return FadeTransition(
                                        opacity: animation,
                                        child: SlideTransition(
                                          position: Tween<Offset>(
                                            begin: const Offset(0.05, 0),
                                            end: Offset.zero,
                                          ).animate(animation),
                                          child: child,
                                        ),
                                      );
                                    },
                                child: KeyedSubtree(
                                  key: ValueKey(_currentStep),
                                  child: _buildStepContent(),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      bottom: 20,
                      left: 20,
                      right: 20,
                      child: RepaintBoundary(child: _buildBottomButtons()),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  /// Equal-width option tile used by size / brand / quantity grids.
  Widget _buildSelectionTile({
    required String label,
    String? subtitle,
    required bool selected,
    required bool enabled,
    required VoidCallback? onTap,
    bool compact = false,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final borderColor = selected
        ? AppColors.primaryBlue
        : enabled
        ? (isDark ? Colors.white24 : Colors.black26)
        : (isDark ? Colors.white10 : Colors.black12);
    final labelColor = !enabled
        ? (isDark ? Colors.white38 : Colors.black38)
        : selected
        ? (isDark ? Colors.white : Colors.black87)
        : (isDark ? Colors.white70 : Colors.black87);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        // Keep muted styling via [enabled], but still allow taps so unavailable
        // brands can surface the Vehicle Data note in a snackbar.
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          width: double.infinity,
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 6 : 8,
            vertical: compact
                ? 10
                : subtitle != null
                ? 8
                : 10,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primaryBlue.withAlpha(isDark ? 70 : 40)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: borderColor, width: selected ? 1.5 : 1),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                selected ? '✓ $label' : label,
                maxLines: compact ? 1 : 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: compact ? 13 : 11.5,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: labelColor,
                  height: 1.15,
                ),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w600,
                    height: 1.1,
                    color: enabled
                        ? AppColors.primaryBlue
                        : (isDark ? Colors.white30 : Colors.black38),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOptionGrid({
    required List<Widget> children,
    int crossAxisCount = 2,
    double childAspectRatio = 2.6,
  }) {
    return GridView.count(
      crossAxisCount: crossAxisCount,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: childAspectRatio,
      children: children,
    );
  }

  /// Size / brand / quantity panel for tyre & battery services.
  Widget _buildTireBatteryOptionsPanel({
    required ServiceItem service,
    required bool showSizeSelection,
    required bool showBrandSelection,
    required bool isBatteryService,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final brands = _sortedBrandOptions(isBatteryService);
    final availableBrands = brands
        .where((b) => !_isBrandNaUnavailable(isBatteryService, b))
        .toList();
    final unavailableBrands = brands
        .where((b) => _isBrandNaUnavailable(isBatteryService, b))
        .toList();
    final showUnavailable = _showUnavailableBrands.contains(service.id);
    final brandsToShow = showUnavailable
        ? [...availableBrands, ...unavailableBrands]
        : availableBrands;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showSizeSelection) ...[
            Builder(
              builder: (context) {
                final vehicleSizes = _vehicleTireSizeOptions();
                final forceManual = vehicleSizes.isEmpty;
                final isManual =
                    forceManual || (_isManualSize[service.id] ?? false);

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Select Size',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        if (!forceManual)
                          TextButton(
                            onPressed: () {
                              setState(() {
                                final nextManual =
                                    !(_isManualSize[service.id] ?? false);
                                _isManualSize[service.id] = nextManual;
                                if (nextManual) {
                                  _tireSizes[service.id] = '';
                                } else if (vehicleSizes.length == 1) {
                                  _tireSizes[service.id] = vehicleSizes.first;
                                } else {
                                  _tireSizes[service.id] = '';
                                }
                              });
                            },
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding: EdgeInsets.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            child: Text(
                              isManual ? 'Vehicle sizes' : 'Manual Entry',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (isManual)
                      _buildManualTireSizeField(
                        service: service,
                        isDark: isDark,
                      )
                    else
                      _buildOptionGrid(
                        crossAxisCount: 2,
                        childAspectRatio: 3.1,
                        children: vehicleSizes.map((size) {
                          final isSelected = _tireSizes[service.id] == size;
                          return _buildSelectionTile(
                            label: size,
                            selected: isSelected,
                            enabled: true,
                            compact: true,
                            onTap: () => setState(
                              () => _tireSizes[service.id] = size,
                            ),
                          );
                        }).toList(),
                      ),
                  ],
                );
              },
            ),
          ],
          if (showBrandSelection) ...[
            if (showSizeSelection) ...[
              const SizedBox(height: 12),
              Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12),
              const SizedBox(height: 10),
            ],
            const Text(
              'Select Brand',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 8),
            if (brandsToShow.isEmpty)
              Text(
                'No brands available for this vehicle.',
                style: TextStyle(
                  fontSize: 12,
                  color: isDark ? Colors.white54 : Colors.black54,
                ),
              )
            else
              _buildOptionGrid(
                crossAxisCount: 2,
                childAspectRatio: 1.5,
                children: brandsToShow.map((brand) {
                  final isSelected = _selectedTireBrands[service.id] == brand;
                  final isNaUnavailable =
                      _isBrandNaUnavailable(isBatteryService, brand);
                  final priceNote = _brandPriceNote(isBatteryService, brand);
                  final brandPrice = isSelected
                      ? _getBrandPrice(isBatteryService, brand)
                      : null;
                  // A brand can only ever be selected once it resolves to a
                  // real price — blank/NA and non-numeric-note brands (e.g.
                  // "Contact Carzzi Team…") are shown but not selectable,
                  // with the reason shown inline in the tile itself rather
                  // than a toast.
                  final isSelectable = !isNaUnavailable && priceNote == null;
                  return _buildSelectionTile(
                    label: brand,
                    subtitle: isNaUnavailable
                        ? 'Not available'
                        : priceNote != null
                        ? priceNote
                        : brandPrice != null
                        ? '₹${brandPrice.toStringAsFixed(0)} /${isBatteryService ? 'battery' : 'tyre'}'
                        : null,
                    selected: isSelected,
                    enabled: isSelectable,
                    onTap: !isSelectable
                        ? null
                        : () {
                            setState(() {
                              if (isSelected) {
                                _selectedTireBrands.remove(service.id);
                              } else {
                                _selectedTireBrands[service.id] = brand;
                              }
                            });
                          },
                  );
                }).toList(),
              ),
            if (unavailableBrands.isNotEmpty) ...[
              const SizedBox(height: 4),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () {
                    setState(() {
                      if (showUnavailable) {
                        _showUnavailableBrands.remove(service.id);
                      } else {
                        _showUnavailableBrands.add(service.id);
                      }
                    });
                  },
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: Text(
                    showUnavailable
                        ? 'Hide unavailable brands'
                        : 'Show ${unavailableBrands.length} unavailable',
                    style: TextStyle(
                      fontSize: 12,
                      color: isDark ? Colors.white60 : Colors.black54,
                    ),
                  ),
                ),
              ),
            ],
          ],
          if (!isBatteryService) ...[
            const SizedBox(height: 12),
            Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12),
            const SizedBox(height: 10),
            const Text(
              'Select Quantity',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 8),
            Row(
              children: [1, 2, 3, 4, 5].map((qty) {
                final isSelected =
                    (_serviceQuantities[service.id] ?? 1) == qty;
                return Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(right: qty == 5 ? 0 : 8),
                    child: _buildSelectionTile(
                      label: '$qty',
                      selected: isSelected,
                      enabled: true,
                      compact: true,
                      onTap: () => setState(
                        () => _serviceQuantities[service.id] = qty,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBottomButtons() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_loading) ...[
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: isDark ? Colors.white10 : Colors.black.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2.2),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Preparing secure checkout...',
                    style: TextStyle(
                      color: isDark ? Colors.white70 : Colors.black87,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        Row(
          children: [
            if (_currentStep > 0) ...[
              Expanded(
                flex: 1,
                child: TextButton(
                  onPressed: _loading ? null : _onBackPressed,
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 18),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(30),
                      side: BorderSide(
                        color: isDark
                            ? Colors.grey.shade800
                            : Colors.grey.shade300,
                      ),
                    ),
                    backgroundColor: isDark
                        ? AppColors.backgroundSecondary
                        : Colors.white,
                  ),
                  child: Text(
                    'Back',
                    style: TextStyle(
                      color: isDark
                          ? AppColors.textPrimary
                          : const Color(0xFF555555),
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
            ],
            Expanded(
              flex: 2,
              child: GradientButton(
                text: _loading
                    ? 'Preparing payment'
                    : !context.watch<AuthProvider>().isAuthenticated
                    ? 'Log in to book'
                    : _currentStep == _steps.length - 1
                    ? 'Confirm Booking'
                    : 'Continue',
                icon: _loading ? null : Icons.arrow_forward_rounded,
                onPressed: _loading ? null : _handleNext,
                isLoading: _loading,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _handleNext() async {
    final auth = context.read<AuthProvider>();
    if (!auth.isAuthenticated) {
      final loggedIn = await ensureLoggedIn(context);
      if (!loggedIn || !mounted) return;
      await _fetchInitialData(forceRefresh: true);
      if (!mounted) return;
      setState(() => _currentStep = 0);
      return;
    }

    if (_currentStep == 1) {
      if (_selectedServiceIds.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select at least one service')),
        );
        return;
      }
      for (final service in _allServices) {
        if (!_selectedServiceIds.contains(service.id)) continue;
        final cat = (service.category ?? '').toLowerCase();
        final isBattery =
            cat.contains('battery') ||
            service.vehiclePricingColumn == 'battery_brand';
        final isTire =
            cat.contains('tyre') ||
            cat.contains('tire') ||
            service.vehiclePricingColumn == 'tyre_brand';
        if (isTire || isBattery) {
          final selectedBrand = _selectedTireBrands[service.id];
          // A brand only counts as selected once it resolves to a real
          // price — the brand grid already blocks tapping blank/NA/
          // note-only brands, but this guards against a stale selection
          // (e.g. the reference data changed after the brand was picked).
          final hasPrice = selectedBrand != null &&
              (_getBrandPrice(isBattery, selectedBrand) ?? 0) > 0;
          if (!hasPrice) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Please select a ${isBattery ? 'battery' : 'tyre'} brand',
                ),
              ),
            );
            return;
          }
        } else if (_hasMissingVehiclePrice(service)) {
          // Defense in depth: the service card already blocks selecting a
          // service with no vehicle-specific price, but a selection made
          // before the reference data finished loading could still slip
          // through — never let checkout proceed with one.
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Price not available for this vehicle yet. Please check back once it has been added.',
              ),
            ),
          );
          return;
        }
      }
    }
    if (_currentStep == 2) {
      if (_selectedTimeSlot == null || _selectedAddress == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select slot and location')),
        );
        return;
      }
      if (!_isSelectedLocationAllowed) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Service booking is not enabled for this pincode. Please choose another location.',
            ),
          ),
        );
        return;
      }
      final latestAvailable = await _fetchSlotsForDate(_selectedDate);
      if (_selectedTimeSlot == null ||
          !latestAvailable.contains(_selectedTimeSlot)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Selected slot is no longer available. Please choose another slot.',
            ),
          ),
        );
        return;
      }
    }
    if (_currentStep < _steps.length - 1) {
      final enteringConfirm = _currentStep == 2;
      setState(() => _currentStep++);
      if (enteringConfirm) {
        // Precompute pricing data when entering confirm step for better performance
        _precomputeConfirmStepData();
        if (_selectedVehicleId != null) {
          for (final v in _vehicles) {
            if (v.id == _selectedVehicleId) {
              _loadPickupDropPrice(v);
              break;
            }
          }
        }
      }
    } else {
      _submitBooking();
    }
  }

  void _precomputeConfirmStepData() {
    final selectedServices = _allServices
        .where((s) => _selectedServiceIds.contains(s.id))
        .toList();
    final total = _calculateTotal();
    final isGeneralService = selectedServices.any((s) {
      final cat = s.category;
      final name = s.name.toLowerCase();
      return cat == 'Periodic' ||
          cat == 'Services' ||
          name.contains('general service');
    });
    final isCarWash = selectedServices.any((s) {
      final cat = s.category;
      return cat == 'Car Wash' || cat == 'Wash' || cat == 'Detailing';
    });
    final isBatteryTire = selectedServices.any((s) {
      final cat = s.category;
      return cat == 'Battery' || cat == 'Tyres' || cat == 'Tyre & Battery';
    });
    final isEssentials = selectedServices.any(
      (s) => s.category == 'Essentials',
    );
    final requiresCheckoutGst =
        !isGeneralService && (isCarWash || isBatteryTire || isEssentials);
    final requiresPrepaid = isCarWash || isBatteryTire || isEssentials;
    final couponDiscount = requiresPrepaid
        ? (_appliedCoupon?['discountAmount'] ?? 0).toDouble()
        : 0.0;
    final checkoutTotals = calculateOrderTotals(
      total,
      couponDiscount,
      requiresCheckoutGst,
    );

    setState(() {
      _cachedSelectedServices = selectedServices;
      _cachedTotal = total;
      _cachedCheckoutTotals = checkoutTotals;
      if (!requiresPrepaid && _appliedCoupon != null) {
        _appliedCoupon = null;
      }
    });
  }

  /// Leaves the booking flow: pops a pushed route (e.g. from My Vehicles),
  /// otherwise returns to the home tab when this page is embedded in the
  /// bottom-nav shell.
  void _exitBookingFlow() {
    if (!mounted) return;
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
      return;
    }
    context.read<NavigationProvider>().setTab(2);
  }

  void _onBackPressed() {
    if (_loading) return;

    // Vehicle was already chosen before opening this flow — don't send the
    // user back to the vehicle picker; leave the flow instead.
    if (_currentStep == 1 && widget.initialVehicleId != null) {
      _exitBookingFlow();
      return;
    }

    if (_currentStep > 0) {
      _handleBack();
      return;
    }

    _exitBookingFlow();
  }

  void _handleBack() {
    if (_currentStep > 0) {
      setState(() {
        // Only the combined "Tyre & Battery" entry point has a chooser to
        // re-pick Tires/Battery after going back — dedicated "Book a Tyre"
        // / "Book a Battery" flows have no such control, so clearing
        // _activeSubCategory there would strand the service list filter
        // with nothing to match, showing "No services found".
        if (widget.initialCategory == 'Tyre & Battery') {
          _activeSubCategory = null;
          _selectedServiceIds = [];
        }
        _currentStep--;
      });
    }
  }

  Widget _buildStepContent() {
    switch (_currentStep) {
      case 0:
        return _buildVehicleStep();
      case 1:
        return _buildServiceStep();
      case 2:
        return _buildScheduleStep();
      case 3:
        return _buildConfirmStep();
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildVehicleStep() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isGuest = !context.watch<AuthProvider>().isAuthenticated;
    if (_vehicles.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.car_repair,
              size: 64,
              color: isDark ? Colors.grey.shade600 : Colors.grey,
            ),
            const SizedBox(height: 16),
            Text(
              isGuest ? 'Log in to fetch your vehicles' : 'No vehicles found',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              isGuest
                  ? 'Sign in to load your vehicles and continue booking.'
                  : 'Please add a vehicle to your profile first.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            Container(
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.primaryBlue, AppColors.primaryBlueDark],
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: ElevatedButton(
                onPressed: () async {
                  if (isGuest) {
                    final ok = await ensureLoggedIn(context);
                    if (ok && mounted) await _fetchInitialData(forceRefresh: true);
                    return;
                  }
                  Navigator.pushNamed(
                    context,
                    '/add-vehicle',
                  ).then((_) => _fetchInitialData());
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  foregroundColor: AppColors.textPrimary,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text(isGuest ? 'Log in' : 'Add Vehicle'),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Select Vehicle',
              style: AppStyles.headingStyle.copyWith(fontSize: 18),
            ),
            TextButton.icon(
              onPressed: () => Navigator.pushNamed(
                context,
                '/add-vehicle',
              ).then((_) => _fetchInitialData()),
              icon: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: AppStyles.primaryBlue.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.add,
                  color: AppStyles.primaryBlue,
                  size: 14,
                ),
              ),
              label: const Text(
                'Add Another Vehicle',
                style: TextStyle(
                  color: AppStyles.primaryBlue,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        ..._vehicles.map(
          (v) => VehicleCard(
            vehicle: v,
            isSelected: _selectedVehicleId == v.id,
            onTap: () {
              setState(() {
                _selectedVehicleId = v.id;
                for (final serviceId in _selectedServiceIds) {
                  _autoFillTireSize(serviceId, v);
                }
              });
              _loadPickupDropPrice(v);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildServiceStep() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final Map<String, List<String>> categoryMap = {
      'Periodic': ['Services', 'Periodic', 'Repair', 'AC'],
      'Wash': ['Car Wash', 'Wash', 'Detailing'],
      // Keep this aligned with web app logic
      'Tyres': ['Tyre & Battery', 'Tyres', 'Battery'],
      'Essentials': ['Essentials', 'Insurance'],
      'Other': ['Other', 'Painting', 'Denting', 'Accessories'],
    };

    List<String> categoriesToDisplay;

    if (widget.initialCategory != null &&
        categoryMap.containsKey(widget.initialCategory)) {
      categoriesToDisplay = categoryMap[widget.initialCategory!]!;
    } else if (widget.initialCategory != null) {
      categoriesToDisplay = [widget.initialCategory!];
    } else {
      categoriesToDisplay = categoryMap.values.expand((e) => e).toList();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_initialServiceId != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(
              'Service Selection',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: isDark ? AppColors.textMuted : Colors.grey.shade600,
              ),
            ),
          ),

        // Category-specific tabs — only shown for the combined "Tyre &
        // Battery" entry point. Dedicated "Book a Tyre" / "Book a Battery"
        // flows already know their category, so there's nothing to choose.
        if (widget.initialCategory == 'Tyre & Battery')
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      if (_activeSubCategory != 'Tyres') {
                        setState(() {
                          _activeSubCategory = 'Tyres';
                          _selectedServiceIds =
                              []; // Clear selection when switching
                        });
                      }
                    },
                    icon: const Icon(Icons.circle_outlined),
                    label: const Text('Tires'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _activeSubCategory == 'Tyres'
                          ? AppColors.primaryBlue
                          : (isDark
                                ? AppColors.backgroundSurface
                                : Colors.grey.shade100),
                      foregroundColor: _activeSubCategory == 'Tyres'
                          ? AppColors.textPrimary
                          : (isDark
                                ? AppColors.textSecondary
                                : Colors.grey.shade700),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () {
                      if (_activeSubCategory != 'Battery') {
                        setState(() {
                          _activeSubCategory = 'Battery';
                          _selectedServiceIds =
                              []; // Clear selection when switching
                        });
                      }
                    },
                    icon: const Icon(Icons.battery_charging_full),
                    label: const Text('Battery'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _activeSubCategory == 'Battery'
                          ? AppColors.primaryBlue
                          : (isDark
                                ? AppColors.backgroundSurface
                                : Colors.grey.shade100),
                      foregroundColor: _activeSubCategory == 'Battery'
                          ? AppColors.textPrimary
                          : (isDark
                                ? AppColors.textSecondary
                                : Colors.grey.shade700),
                    ),
                  ),
                ),
              ],
            ),
          ),

        if (_activeSubCategory == null &&
            widget.initialCategory == 'Tyre & Battery')
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: isDark ? Colors.grey.shade900 : Colors.grey.shade100,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isDark ? Colors.grey.shade800 : Colors.grey.shade300,
                style: BorderStyle.solid,
              ),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.touch_app_outlined,
                  size: 48,
                  color: isDark ? Colors.grey.shade700 : Colors.grey.shade400,
                ),
                const SizedBox(height: 16),
                Text(
                  'Please select a category',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.white70 : Colors.grey.shade600,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Choose Tires or Battery to see available services',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    color: isDark ? Colors.grey.shade400 : Colors.grey.shade600,
                  ),
                ),
              ],
            ),
          ),

        const SizedBox(height: 16),
        ...(() {
          // If we have initialCategory (tabbed view)
          if (widget.initialCategory != null) {
            List<ServiceItem> services;

            if (widget.initialCategory == 'Tyres' ||
                widget.initialCategory == 'Battery' ||
                widget.initialCategory == 'Tyre & Battery') {
              services = _allServices.where((s) {
                final cat = s.category?.toLowerCase() ?? '';
                if (_activeSubCategory == 'Tyres') {
                  return cat.contains('tyre') || cat.contains('tire');
                } else if (_activeSubCategory == 'Battery') {
                  return cat.contains('battery');
                }
                return false;
              }).toList();
            } else {
              // Non-tyre categories: keep original category grouping behavior
              final filteredCategories = categoriesToDisplay;
              services = _allServices
                  .where((s) => filteredCategories.contains(s.category))
                  .toList();
            }

            if (_initialServiceId != null) {
              services = services
                  .where((s) => s.id == _initialServiceId)
                  .toList();
            }

            if (services.isEmpty) {
              return [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(32),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.grey.shade900 : Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    children: [
                      Icon(
                        Icons.search_off_outlined,
                        size: 48,
                        color: isDark
                            ? Colors.grey.shade700
                            : Colors.grey.shade400,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'No services found',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: isDark ? Colors.white70 : Colors.grey.shade600,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Try selecting another category or check back later.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: isDark
                              ? Colors.grey.shade400
                              : Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
              ];
            }

            return [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ...services.map((service) {
                    final selected = _selectedServiceIds.contains(service.id);
                    final isTireService =
                        service.category?.toLowerCase().contains('tyre') ==
                            true ||
                        service.category?.toLowerCase().contains('tire') ==
                            true;
                    final isBatteryService =
                        service.category?.toLowerCase().contains('battery') ==
                        true;

                    // Any tyre-category service gets size selection
                    // (matches the web frontend's `category === 'Tyres'`
                    // fallback) — previously this required "change" or
                    // "size" literally in the service name, which missed
                    // services like "Car Tyre Replacement".
                    final showSizeSelection =
                        selected &&
                        (isTireService ||
                            service.name.toLowerCase().contains('change') ||
                            service.name.toLowerCase().contains('size'));

                    final showBrandSelection =
                        selected && (isTireService || isBatteryService);

                    return Column(
                      children: [
                        GestureDetector(
                          onTap: () => _toggleServiceSelection(service),
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: isDark
                                  ? AppColors.backgroundSecondary
                                  : Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: selected
                                    ? AppColors.primaryBlue
                                    : isDark
                                    ? AppColors.borderColor
                                    : AppColors.borderColorLight,
                                width: selected ? 2 : 1,
                              ),
                              boxShadow: [
                                if (selected)
                                  BoxShadow(
                                    color: AppColors.primaryBlue.withAlpha(25),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                              ],
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 56,
                                  height: 56,
                                  decoration: BoxDecoration(
                                    color: isDark
                                        ? AppColors.backgroundSurface
                                        : Colors.grey.shade50,
                                    borderRadius: BorderRadius.circular(12),
                                    image:
                                        (service.image != null &&
                                            service.image!.isNotEmpty)
                                        ? DecorationImage(
                                            image: NetworkImage(service.image!),
                                            fit: BoxFit.contain,
                                          )
                                        : null,
                                  ),
                                  child:
                                      (service.image == null ||
                                          service.image!.isEmpty)
                                      ? const Icon(
                                          Icons.build_circle,
                                          color: AppColors.primaryBlue,
                                        )
                                      : null,
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        service.name,
                                        style: TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.bold,
                                          color: isDark
                                              ? AppColors.textPrimary
                                              : AppColors.textPrimaryLight,
                                        ),
                                      ),
                                      if (!isGeneralServiceItem(
                                        service,
                                      )) ...[
                                        const SizedBox(height: 4),
                                        Text(
                                          'Time: ${service.estimatedMinutes} mins',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: isDark
                                                ? AppColors.textSecondary
                                                : AppColors
                                                      .textSecondaryLight,
                                          ),
                                        ),
                                      ],
                                      _buildSelectedServicePrice(service),
                                    ],
                                  ),
                                ),
                                if (selected)
                                  const Icon(
                                    Icons.check_circle,
                                    color: AppColors.primaryBlue,
                                  )
                                else
                                  Icon(
                                    Icons.add_circle_outline,
                                    color: isDark
                                        ? AppColors.textMuted
                                        : Colors.grey.shade300,
                                  ),
                              ],
                            ),
                          ),
                        ),
                        if (showSizeSelection || showBrandSelection)
                          _buildTireBatteryOptionsPanel(
                            service: service,
                            showSizeSelection: showSizeSelection,
                            showBrandSelection: showBrandSelection,
                            isBatteryService: isBatteryService,
                          ),
                      ],
                    );
                  }),
                ],
              ),
            ];
          }

          // Fallback for when no initialCategory is provided (show all with headers)
          final filteredCategories = categoriesToDisplay;
          return filteredCategories.map((category) {
            var services = _allServices
                .where((s) => s.category == category)
                .toList();

            if (_initialServiceId != null) {
              services = services
                  .where((s) => s.id == _initialServiceId)
                  .toList();
            }

            if (services.isEmpty) return const SizedBox.shrink();

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    category,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF2563EB),
                    ),
                  ),
                ),
                ...services.map((service) {
                  final selected = _selectedServiceIds.contains(service.id);
                  final isTireService =
                      service.category?.toLowerCase().contains('tyre') ==
                          true ||
                      service.category?.toLowerCase().contains('tire') == true;
                  final isBatteryService =
                      service.category?.toLowerCase().contains('battery') ==
                      true;

                  // Any tyre-category service gets size selection (matches
                  // the web frontend's `category === 'Tyres'` fallback).
                  final showSizeSelection =
                      selected &&
                      (isTireService ||
                          service.name.toLowerCase().contains('change') ||
                          service.name.toLowerCase().contains('size'));

                  final showBrandSelection =
                      selected && (isTireService || isBatteryService);

                  return Column(
                    children: [
                      GestureDetector(
                        onTap: () => _toggleServiceSelection(service),
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isDark
                                ? AppColors.backgroundSecondary
                                : Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: selected
                                  ? AppColors.primaryBlue
                                  : isDark
                                  ? AppColors.borderColor
                                  : AppColors.borderColorLight,
                              width: selected ? 2 : 1,
                            ),
                            boxShadow: [
                              if (selected)
                                BoxShadow(
                                  color: AppColors.primaryBlue.withAlpha(25),
                                  blurRadius: 10,
                                  offset: const Offset(0, 4),
                                ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 56,
                                height: 56,
                                decoration: BoxDecoration(
                                  color: isDark
                                      ? AppColors.backgroundSurface
                                      : Colors.grey.shade50,
                                  borderRadius: BorderRadius.circular(12),
                                  image:
                                      (service.image != null &&
                                          service.image!.isNotEmpty)
                                      ? DecorationImage(
                                          image: NetworkImage(service.image!),
                                          fit: BoxFit.contain,
                                        )
                                      : null,
                                ),
                                child:
                                    (service.image == null ||
                                        service.image!.isEmpty)
                                    ? const Icon(
                                        Icons.build_circle,
                                        color: AppColors.primaryBlue,
                                      )
                                    : null,
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      service.name,
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.bold,
                                        color: isDark
                                            ? AppColors.textPrimary
                                            : AppColors.textPrimaryLight,
                                      ),
                                    ),
                                    if (!isGeneralServiceItem(service)) ...[
                                      const SizedBox(height: 4),
                                      Text(
                                        'Time: ${service.estimatedMinutes} mins',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: isDark
                                              ? AppColors.textSecondary
                                              : AppColors.textSecondaryLight,
                                        ),
                                      ),
                                    ],
                                    _buildSelectedServicePrice(service),
                                  ],
                                ),
                              ),
                              if (selected)
                                const Icon(
                                  Icons.check_circle,
                                  color: AppColors.primaryBlue,
                                )
                              else
                                Icon(
                                  Icons.add_circle_outline,
                                  color: isDark
                                      ? AppColors.textMuted
                                      : Colors.grey.shade300,
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (showSizeSelection || showBrandSelection)
                        _buildTireBatteryOptionsPanel(
                          service: service,
                          showSizeSelection: showSizeSelection,
                          showBrandSelection: showBrandSelection,
                          isBatteryService: isBatteryService,
                        ),
                    ],
                  );
                }),
              ],
            );
          }).toList();
        })(),
      ],
    );
  }

  Widget _buildScheduleStep() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _prefetchSavedAddressPincodes();
    });
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Location Section
        Text(
          'Service Location',
          style: AppStyles.headingStyle.copyWith(fontSize: 18),
        ),
        const SizedBox(height: 12),
        _buildLocationPickerContent(),

        const SizedBox(height: 24),

        Text(
          'Schedule & Location',
          style: AppStyles.headingStyle.copyWith(fontSize: 16),
        ),
        const SizedBox(height: 24),

        // Date & Time Selection Card
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: isDark
                ? AppColors.backgroundSecondary
                : AppColors.backgroundPrimaryLight,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [AppStyles.cardShadow],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.calendar_month_rounded,
                    color: AppStyles.primaryBlue,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Select Date & Time',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: isDark
                          ? AppColors.textPrimary
                          : const Color(0xFF1E293B),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () async {
                        final earliest = _earliestBookableDate();
                        final initial = _selectedDate.isBefore(earliest)
                            ? earliest
                            : _selectedDate;
                        final date = await showDatePicker(
                          context: context,
                          initialDate: initial,
                          firstDate: earliest,
                          lastDate: DateTime.now().add(
                            const Duration(days: 90),
                          ),
                        );
                        if (date != null) {
                          setState(() {
                            _selectedDate = date;
                            _selectedTimeSlot = null;
                          });
                          await _fetchSlotsForDate(date);
                        }
                      },
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          vertical: 14,
                          horizontal: 16,
                        ),
                        decoration: BoxDecoration(
                          color: isDark
                              ? Colors.grey.shade900
                              : AppStyles.softBackground,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: isDark
                                ? AppColors.borderColor
                                : Colors.grey.shade200,
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Date', style: AppStyles.captionStyle),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                Icon(
                                  Icons.calendar_month_rounded,
                                  size: 14,
                                  color: isDark
                                      ? Colors.white38
                                      : Colors.black38,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  DateFormat(
                                    'EEE, MMM d',
                                  ).format(_selectedDate),
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 14,
                                    color: isDark
                                        ? AppColors.textPrimary
                                        : Colors.black,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InkWell(
                      onTap: () => _showSlotPicker(isDark),
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          vertical: 14,
                          horizontal: 16,
                        ),
                        decoration: BoxDecoration(
                          color: isDark
                              ? Colors.grey.shade900
                              : AppStyles.softBackground,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: isDark
                                ? AppColors.borderColor
                                : Colors.grey.shade200,
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Slot', style: AppStyles.captionStyle),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                Icon(
                                  Icons.access_time_rounded,
                                  size: 14,
                                  color: isDark
                                      ? Colors.white38
                                      : Colors.black38,
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    _selectedTimeSlot ?? 'Select slot',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                      fontSize: 14,
                                      color: isDark
                                          ? (_selectedTimeSlot != null
                                                ? AppColors.textPrimary
                                                : Colors.white38)
                                          : (_selectedTimeSlot != null
                                                ? Colors.black
                                                : Colors.black38),
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
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
        ),
      ],
    );
  }

  Widget _buildLocationPickerContent() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark
        ? AppColors.textPrimary
        : AppColors.textPrimaryLight;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Saved Addresses
        if (context.read<AuthProvider>().user?.addresses.isNotEmpty ??
            false) ...[
          SizedBox(
            height: 50,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: context.read<AuthProvider>().user!.addresses.length,
              separatorBuilder: (context, index) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final addr = context
                    .read<AuthProvider>()
                    .user!
                    .addresses[index];
                final pin = _getSavedAddressPin(addr);
                final isBlockedAddress = _isAddressBlocked(addr);
                final selected = _selectedAddress == addr.address;
                return ChoiceChip(
                  label: Text(addr.label),
                  selected: selected,
                  selectedColor: AppStyles.primaryBlue.withValues(alpha: 0.2),
                  labelStyle: TextStyle(
                    color: isBlockedAddress
                        ? Colors.red
                        : (selected ? AppStyles.primaryBlue : textColor),
                    fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                  ),
                  onSelected: (v) {
                    if (!v) return;
                    if (isBlockedAddress) {
                      final message = pin == null
                          ? '${addr.label}: could not detect pincode. Edit the address in Profile or use the map.'
                          : '${addr.label}: service is not available for pincode $pin.';
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text(message)));
                      return;
                    }
                    setState(() {
                      _selectedLatLng = LatLng(addr.lat, addr.lng);
                      _selectedAddress = addr.address;
                      _showCustomLocation = false;
                    });
                  },
                );
              },
            ),
          ),
          const SizedBox(height: 12),
        ],

        if (!_showCustomLocation && _selectedAddress != null) ...[
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark
                  ? AppStyles.primaryBlue.withValues(alpha: 0.1)
                  : const Color(0xFFEFF6FF),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isDark
                    ? AppStyles.primaryBlue.withValues(alpha: 0.3)
                    : const Color(0xFFBFDBFE),
              ),
            ),
            child: Row(
              children: [
                const Icon(Icons.location_on, color: AppStyles.primaryBlue),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _selectedAddress!,
                    style: TextStyle(
                      fontSize: 14,
                      color: isDark
                          ? AppColors.textPrimary
                          : const Color(0xFF1E40AF),
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => setState(() => _showCustomLocation = true),
                  child: const Text(
                    'Change',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
          if (!_isSelectedLocationAllowed)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _availableServicePincodes.isEmpty
                    ? 'Service is currently unavailable for this area.'
                    : (_extractPincode(_selectedAddress) == null
                          ? 'Address must include a valid 6-digit pincode.'
                          : 'Service booking is not enabled for this pincode.'),
                style: const TextStyle(color: Colors.red, fontSize: 12),
              ),
            ),
        ] else ...[
          Builder(
            builder: (context) {
              if (!_hasAutoLocated && _selectedLatLng == null) {
                _hasAutoLocated = true;
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  _useCurrentLocation(silent: true);
                });
              }
              return const SizedBox.shrink();
            },
          ),
          TextField(
            controller: _locationSearchController,
            onChanged: _onLocationSearchChanged,
            decoration: InputDecoration(
              labelText: 'Search for a place',
              hintText: 'e.g. Star Hills Enclave',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _locationSearching
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : (_locationSearchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              _locationSearchController.clear();
                              _locationSearchDebounce?.cancel();
                              setState(() => _locationSearchResults = []);
                            },
                          )
                        : null),
              border: const OutlineInputBorder(),
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Align(
              alignment: Alignment.centerRight,
              child: Text(
                'Powered by Google',
                style: TextStyle(fontSize: 11, color: Colors.grey),
              ),
            ),
          ),
          if (_locationSearchResults.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              constraints: const BoxConstraints(maxHeight: 220),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isDark ? Colors.white10 : Colors.grey[300]!,
                ),
              ),
              child: ListView.separated(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: _locationSearchResults.length,
                separatorBuilder: (_, _) => Divider(
                  height: 1,
                  color: isDark ? Colors.white10 : Colors.grey[300],
                ),
                itemBuilder: (context, i) {
                  final prediction = _locationSearchResults[i];
                  return ListTile(
                    dense: true,
                    leading: const Icon(Icons.place_outlined),
                    title: Text(
                      prediction.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () => _selectLocationPrediction(prediction),
                  );
                },
              ),
            ),
          ],
          const SizedBox(height: 12),
          Container(
            height: 200,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isDark ? Colors.grey.shade700 : Colors.grey.shade300,
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Stack(
                children: [
                  FlutterMap(
                    mapController: _mapController,
                    options: MapOptions(
                      initialCenter:
                          _selectedLatLng ?? const LatLng(12.9716, 77.5946),
                      initialZoom: 14,
                      onTap: (_, latLng) => _setSelectedLocation(latLng),
                    ),
                    children: [
                      TileLayer(
                        urlTemplate:
                            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: Env.userAgent,
                        tileProvider: CancellableNetworkTileProvider(),
                      ),
                      if (_selectedLatLng != null)
                        MarkerLayer(
                          markers: [
                            Marker(
                              point: _selectedLatLng!,
                              width: 40,
                              height: 40,
                              child: const Icon(
                                Icons.location_on,
                                color: Colors.red,
                                size: 40,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                  Positioned(
                    bottom: 12,
                    right: 12,
                    child: FloatingActionButton.small(
                      onPressed: _useCurrentLocation,
                      child: _locating
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.my_location),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _resolvingAddress == true
                ? 'Resolving address...'
                : (_selectedAddress ?? 'Tap on map to select location'),
            style: TextStyle(
              color: isDark ? Colors.grey.shade400 : Colors.grey.shade600,
              fontSize: 12,
            ),
          ),
          if (_selectedAddress != null && !_isSelectedLocationAllowed)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _availableServicePincodes.isEmpty
                    ? 'Service is currently unavailable for this area.'
                    : (_extractPincode(_selectedAddress) == null
                          ? 'Address must include a valid 6-digit pincode.'
                          : 'Service booking is not enabled for this pincode.'),
                style: const TextStyle(color: Colors.red, fontSize: 12),
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildConfirmStep() {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Vehicle? selectedVehicle;
    if (_selectedVehicleId != null) {
      for (final v in _vehicles) {
        if (v.id == _selectedVehicleId) {
          selectedVehicle = v;
          break;
        }
      }
    }

    // Use cached data if available, otherwise compute (fallback)
    final selectedServices =
        _cachedSelectedServices ??
        _allServices.where((s) => _selectedServiceIds.contains(s.id)).toList();
    final total = _cachedTotal ?? _calculateTotal();
    final checkoutTotals =
        _cachedCheckoutTotals ??
        (() {
          final isGeneralService = selectedServices.any((s) {
            final cat = s.category;
            final name = s.name.toLowerCase();
            return cat == 'Periodic' ||
                cat == 'Services' ||
                name.contains('general service');
          });
          final isCarWash = selectedServices.any((s) {
            final cat = s.category;
            return cat == 'Car Wash' || cat == 'Wash' || cat == 'Detailing';
          });
          final isBatteryTire = selectedServices.any((s) {
            final cat = s.category;
            return cat == 'Battery' ||
                cat == 'Tyres' ||
                cat == 'Tyre & Battery';
          });
          final isEssentials = selectedServices.any(
            (s) => s.category == 'Essentials',
          );
          final requiresCheckoutGst =
              !isGeneralService && (isCarWash || isBatteryTire || isEssentials);
          final requiresPrepaid = isCarWash || isBatteryTire || isEssentials;
          final couponDiscount = requiresPrepaid
              ? (_appliedCoupon?['discountAmount'] ?? 0).toDouble()
              : 0.0;
          return calculateOrderTotals(
            total,
            couponDiscount,
            requiresCheckoutGst,
          );
        })();

    final isGeneralService = selectedServices.any((s) {
      final cat = s.category;
      final name = s.name.toLowerCase();
      return cat == 'Periodic' ||
          cat == 'Services' ||
          name.contains('general service');
    });

    final isCarWash = selectedServices.any((s) {
      final cat = s.category;
      return cat == 'Car Wash' || cat == 'Wash' || cat == 'Detailing';
    });
    final isBatteryTire = selectedServices.any((s) {
      final cat = s.category;
      return cat == 'Battery' || cat == 'Tyres' || cat == 'Tyre & Battery';
    });
    final isEssentials = selectedServices.any(
      (s) => s.category == 'Essentials',
    );
    final requiresCheckoutGst =
        !isGeneralService && (isCarWash || isBatteryTire || isEssentials);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Confirm Booking',
          style: AppStyles.headingStyle.copyWith(fontSize: 18),
        ),
        const SizedBox(height: 24),

        // Summary Card
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: isDark
                ? AppColors.backgroundSecondary
                : AppColors.backgroundPrimaryLight,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [AppStyles.cardShadow],
          ),
          child: Column(
            children: [
              if (selectedVehicle != null)
                _buildSummaryRow(
                  'Vehicle',
                  '${selectedVehicle.make} ${selectedVehicle.model}',
                  Icons.directions_car_filled_rounded,
                  trailing: selectedVehicle.licensePlate.toUpperCase(),
                ),
              const Divider(height: 32),
              _buildSummaryRow(
                'Schedule',
                DateFormat('EEE, MMM d').format(_selectedDate),
                Icons.calendar_today_rounded,
                trailing: _selectedTimeSlot ?? 'Not selected',
              ),
              const Divider(height: 32),
              _buildSummaryRow(
                'Location',
                _selectedAddress ?? 'Not selected',
                Icons.location_on_rounded,
              ),
              if (_notesController.text.isNotEmpty) ...[
                const Divider(height: 32),
                _buildSummaryRow(
                  'Notes',
                  _notesController.text,
                  Icons.notes_rounded,
                ),
              ],
            ],
          ),
        ),

        const SizedBox(height: 24),

        // Services List Card
        Text(
          'Selected Services',
          style: AppStyles.headingStyle.copyWith(fontSize: 16),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: isDark
                ? AppColors.backgroundSecondary
                : AppColors.backgroundPrimaryLight,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [AppStyles.cardShadow],
          ),
          child: Column(
            children: [
              ...selectedServices.map((s) {
                final qty = _serviceQuantities[s.id] ?? 1;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          qty > 1 ? '${s.name} x $qty' : s.name,
                          style: const TextStyle(fontWeight: FontWeight.w500),
                        ),
                      ),
                      Text(
                        '₹${formatInrAmount(_getServicePrice(s) * qty)}',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                );
              }),
              if (isGeneralService)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Expanded(
                        child: Text(
                          'Pickup & Drop Charges',
                          style: TextStyle(fontWeight: FontWeight.w500),
                        ),
                      ),
                      _pickupDropLoading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(
                              '₹${formatInrAmount(_pickupDropPrice)}',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ],
                  ),
                ),
              const Divider(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Subtotal',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  Text(
                    '₹${formatInrAmount(checkoutTotals.subtotal)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
              if (_appliedCoupon != null) ...[
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Discount',
                      style: TextStyle(
                        fontWeight: FontWeight.w500,
                        color: Colors.green,
                      ),
                    ),
                    Text(
                      '-₹${formatInrAmount(checkoutTotals.discountAmount)}',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: Colors.green,
                      ),
                    ),
                  ],
                ),
              ],
              if (requiresCheckoutGst) ...[
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Tax (GST 18%)',
                      style: TextStyle(fontWeight: FontWeight.w500),
                    ),
                    Text(
                      '₹${formatInrAmount(checkoutTotals.tax)}',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ],
              const Divider(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Total payable',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                  ),
                  Text(
                    '₹${formatInrAmount(requiresCheckoutGst ? checkoutTotals.total : total - checkoutTotals.discountAmount)}',
                    style: const TextStyle(
                      color: AppStyles.primaryBlue,
                      fontWeight: FontWeight.w900,
                      fontSize: 22,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        if (isCarWash || isBatteryTire || isEssentials) ...[
          const SizedBox(height: 24),

          // Coupon Section
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Apply Coupon',
                style: AppStyles.headingStyle.copyWith(fontSize: 16),
              ),
              if (_availableCoupons.isNotEmpty)
                TextButton(
                  onPressed: () => Navigator.pushNamed(context, '/coupons'),
                  child: const Text('View All'),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: isDark
                  ? AppColors.backgroundSecondary
                  : AppColors.backgroundPrimaryLight,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [AppStyles.cardShadow],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_loadingCoupons)
                  const Center(child: CircularProgressIndicator())
                else if (_availableCoupons.isNotEmpty) ...[
                  () {
                    final eligibleCoupons = _availableCoupons.where((c) {
                      final minRequired = (c['minOrderAmount'] ?? 0) as num;
                      return minRequired == 0 || total >= minRequired;
                    }).toList();

                    if (eligibleCoupons.isEmpty) {
                      return const Padding(
                        padding: EdgeInsets.symmetric(vertical: 10),
                        child: Text(
                          'No eligible coupons for this amount',
                          style: TextStyle(fontSize: 13, color: Colors.grey),
                        ),
                      );
                    }

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Available coupons:',
                          style: TextStyle(fontSize: 14, color: Colors.grey),
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          height: 140,
                          child: ListView.builder(
                            scrollDirection: Axis.horizontal,
                            itemCount: eligibleCoupons.length,
                            itemBuilder: (context, index) {
                              final coupon = eligibleCoupons[index];
                              final isSelected =
                                  _appliedCoupon?['_id'] == coupon['_id'];

                              return _buildCouponTicket(
                                coupon,
                                isSelected,
                                true, // Already filtered for min order
                                total,
                              );
                            },
                          ),
                        ),
                      ],
                    );
                  }(),
                  if (_appliedCoupon != null) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: isDark
                            ? Colors.green.withValues(alpha: 0.1)
                            : Colors.green.shade50,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: Colors.green.shade300,
                          width: 1.5,
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.green.shade600,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Icon(
                                  Icons.check,
                                  color: Colors.white,
                                  size: 20,
                                ),
                              ),
                              const SizedBox(width: 16),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _appliedCoupon!['code'],
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 16,
                                      color: Colors.green.shade700,
                                      letterSpacing: 1.2,
                                    ),
                                  ),
                                  Text(
                                    'Coupon Applied',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: Colors.green.shade600,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          TextButton(
                            onPressed: _removeCoupon,
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.red,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 8,
                              ),
                              backgroundColor: Colors.red.withValues(
                                alpha: 0.1,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: const Text(
                              'REMOVE',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ] else
                  const Text(
                    'No coupons available at this time',
                    style: TextStyle(color: Colors.grey),
                  ),
              ],
            ),
          ),
        ],

        if (isCarWash || isBatteryTire) ...[
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppStyles.primaryBlue.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: AppStyles.primaryBlue.withValues(alpha: 0.1),
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.info_outline_rounded,
                  color: AppStyles.primaryBlue,
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Payment is required to confirm this booking.',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: isDark
                          ? Colors.blue.shade200
                          : const Color(0xFF1E40AF),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildSummaryRow(
    String title,
    String value,
    IconData icon, {
    String? trailing,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppStyles.primaryBlue.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppStyles.primaryBlue, size: 18),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppStyles.captionStyle),
              const SizedBox(height: 2),
              Text(
                value,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                  color: isDark
                      ? AppColors.textPrimary
                      : const Color(0xFF1E293B),
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        if (trailing != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              trailing,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 12,
                color: isDark ? Colors.grey.shade300 : Colors.grey.shade700,
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _runLocationSearch(String query) async {
    final q = query.trim();
    if (q.isEmpty) {
      if (mounted) setState(() => _locationSearchResults = []);
      return;
    }
    if (mounted) setState(() => _locationSearching = true);
    try {
      final results = await PlacesService.autocomplete(
        q,
        sessionToken: _placesSessionToken,
        near: _selectedLatLng,
      );
      if (!mounted) return;
      setState(() {
        _locationSearchResults = results;
        _locationSearching = false;
      });
    } on PlacesApiException catch (e) {
      if (!mounted) return;
      setState(() => _locationSearching = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Place search failed: ${e.status}')),
      );
    } catch (e) {
      debugPrint('[Places] search error: $e');
      if (!mounted) return;
      setState(() => _locationSearching = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Place search failed: $e')));
    }
  }

  Future<void> _selectLocationPrediction(PlacePrediction prediction) async {
    FocusManager.instance.primaryFocus?.unfocus();
    _locationSearchController.text = prediction.description;
    setState(() => _locationSearchResults = []);
    final details = await PlacesService.getPlaceDetails(
      prediction.placeId,
      sessionToken: _placesSessionToken,
    );
    // Start a fresh session token now that this search-and-select is done.
    _placesSessionToken = PlacesService.newSessionToken();
    if (details == null) return;
    setState(() {
      _selectedLatLng = details.location;
      _selectedAddress = details.formattedAddress.isNotEmpty
          ? details.formattedAddress
          : prediction.description;
    });
    _moveLocationMap(details.location, 17);
    final pin = await _reverseGeocodePincode(details.location);
    if (pin != null) {
      _savedAddressPincodes['map::${details.location.latitude}::${details.location.longitude}'] =
          pin;
    }
  }

  void _onLocationSearchChanged(String query) {
    _locationSearchDebounce?.cancel();
    _locationSearchDebounce = Timer(
      const Duration(milliseconds: 450),
      () => _runLocationSearch(query),
    );
  }

  void _moveLocationMap(LatLng point, [double? zoom]) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      try {
        _mapController.move(point, zoom ?? _mapController.camera.zoom);
      } catch (_) {
        // Controller not attached yet (e.g. still animating in).
      }
    });
  }

  Future<void> _setSelectedLocation(LatLng latLng, {double? zoom}) async {
    setState(() {
      _selectedLatLng = latLng;
      _resolvingAddress = true;
    });
    _moveLocationMap(latLng, zoom);
    try {
      final uri = Uri.https('nominatim.openstreetmap.org', '/reverse', {
        'format': 'jsonv2',
        'lat': latLng.latitude.toString(),
        'lon': latLng.longitude.toString(),
      });
      final res = await http.get(
        uri,
        headers: const {'User-Agent': 'CarzziMobile/1.0'},
      );
      if (res.statusCode == 200) {
        final decoded = jsonDecode(res.body);
        final name = decoded['display_name'];
        if (name is String && name.trim().isNotEmpty) {
          setState(() {
            _selectedAddress = name;
          });
        }
        final pin = await _reverseGeocodePincode(latLng);
        if (pin != null) {
          _savedAddressPincodes['map::${latLng.latitude}::${latLng.longitude}'] =
              pin;
        }
      }
    } catch (e) {
      // Handle error
    } finally {
      setState(() => _resolvingAddress = false);
    }
  }

  Future<void> _useCurrentLocation({bool silent = false}) async {
    if (_locating) return;
    setState(() => _locating = true);
    try {
      bool granted;
      if (silent) {
        final p = await Geolocator.checkPermission();
        granted =
            p == LocationPermission.always || p == LocationPermission.whileInUse;
      } else {
        if (!mounted) return;
        granted = await LocationHelper.ensureLocationAccess(context);
      }
      if (!granted) {
        return;
      }

      // Check for precise location (Android 12+)
      if (!kIsWeb && Platform.isAndroid) {
        final accuracy = await Geolocator.getLocationAccuracy();
        if (accuracy == LocationAccuracyStatus.reduced) {
          debugPrint(
            'MobileApp: Reduced accuracy granted, requesting precise location',
          );
          final permission = await Geolocator.requestPermission();
          if (permission == LocationPermission.denied ||
              permission == LocationPermission.deniedForever) {
            return;
          }
        }
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.best,
        timeLimit: const Duration(seconds: 15),
      );
      final latLng = LatLng(pos.latitude, pos.longitude);
      _setSelectedLocation(latLng, zoom: 15);
    } catch (e) {
      debugPrint('Error getting current location: $e');
    } finally {
      if (mounted) {
        setState(() => _locating = false);
      }
    }
  }

  Future<void> _submitBooking() async {
    if (_selectedVehicleId == null ||
        _selectedServiceIds.isEmpty ||
        _selectedAddress == null ||
        _selectedTimeSlot == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please complete all steps')),
      );
      return;
    }

    setState(() => _loading = true);
    try {
      final selectedServices = _allServices
          .where((s) => _selectedServiceIds.contains(s.id))
          .toList();

      final notesWithSizes = selectedServices
          .map((service) {
            final size = _tireSizes[service.id];
            final brand = _selectedTireBrands[service.id];
            final qty = _serviceQuantities[service.id] ?? 1;
            String note = service.name;
            if (qty > 1) note += ' (Qty: $qty)';
            if (size != null && size.isNotEmpty) note += ' - Size: $size';
            if (brand != null && brand.isNotEmpty) note += ' - Brand: $brand';
            return note;
          })
          .join(', ');

      final fullNotes = _notesController.text.isNotEmpty
          ? '${_notesController.text}\nServices: $notesWithSizes'
          : notesWithSizes;

      final bookingDateTime = _composeBookingDateTime();
      if (bookingDateTime == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select a valid slot')),
        );
        return;
      }
      if (_selectedLatLng == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select a valid map location')),
        );
        return;
      }
      if (!_isSelectedLocationAllowed) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Service booking is not enabled for this pincode. Please choose another location.',
            ),
          ),
        );
        return;
      }

      final res = await _bookingService.createBooking(
        vehicleId: _selectedVehicleId!,
        serviceIds: _selectedServiceIds,
        date: bookingDateTime,
        location: BookingLocation(
          address: _selectedAddress!,
          lat: _selectedLatLng!.latitude,
          lng: _selectedLatLng!.longitude,
        ),
        notes: fullNotes,
        selectedBrands: _selectedTireBrands,
        serviceQuantities: _serviceQuantities,
      );

      if (!mounted) return;

      if (res is Map<String, dynamic> && res['requiresPayment'] == true) {
        // Special handling for payment-required services (Car Wash, Battery, Tyres)
        final tempBookingId = res['tempBookingId'];
        if (tempBookingId != null) {
          res['requiresPaymentService'] = true;

          // Calculate the same way as shown on the confirm screen
          final double total = _calculateTotal();
          final double discountAmount = _appliedCoupon != null
              ? (_appliedCoupon!['discountAmount'] ?? 0).toDouble()
              : 0;
          final applyTax = !isGeneralServiceList(selectedServices);
          final pricing = calculateOrderTotals(total, discountAmount, applyTax);
          res['subtotal'] = pricing.subtotal;
          res['totalAmount'] = pricing.total;
          res['discountAmount'] = pricing.discountAmount;
          res['gstAmount'] = pricing.tax;
          res['finalAmount'] = pricing.total;
          res['applyCheckoutGst'] = applyTax;
          if (_appliedCoupon != null) {
            res['coupon'] = _appliedCoupon!['_id'];
          }
          await _processPayment(tempBookingData: res);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Payment setup error: missing temporary booking id. Please try again.',
              ),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }

      // Send a socket event to trigger a refresh on the dashboard
      context.read<SocketService>().sendEvent('booking_created');

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Booking confirmed! We have scheduled your service.'),
        ),
      );

      _navigateToHomeAfterBooking();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to create booking: $e')));
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _processPayment({Map<String, dynamic>? tempBookingData}) async {
    // Show loading dialog immediately
    if (!mounted) return;
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
                  onEnd: () {},
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
      // Create order
      final orderData = await _paymentService.createOrder(
        tempBookingData: tempBookingData,
      );

      if (!mounted) {
        closeLoadingDialog();
        return;
      }

      _currentTempBookingData = tempBookingData;
      final orderId =
          (orderData['orderId'] ??
                  orderData['order_id'] ??
                  orderData['id'] ??
                  '')
              .toString();
      final paymentSessionId = (orderData['paymentSessionId'] ?? '').toString();
      final environment = (orderData['environment'] ?? 'sandbox').toString();

      if (orderId.isEmpty || paymentSessionId.isEmpty) {
        closeLoadingDialog();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Payment setup failed. Please try again.'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      if (kIsWeb) {
        closeLoadingDialog();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Payments are only available on mobile'),
          ),
        );
      } else {
        // Build and launch payment immediately without extra delays
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

        // Launch payment immediately
        _cashfreeGateway.doPayment(cfPayment);
        closeLoadingDialog();
      }
    } catch (e) {
      if (mounted) {
        closeLoadingDialog();
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Payment initiation error: $e')));
      }
    }
  }

  Widget _buildCouponTicket(
    Map<String, dynamic> coupon,
    bool isSelected,
    bool meetsMinOrder,
    double total,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final code = coupon['code']?.toString() ?? '';
    final discount = '${coupon['discountPercentage']}% OFF';
    final minAmount = coupon['minOrderAmount'] ?? 0;

    final Color primaryColor = isSelected
        ? AppColors.primaryBlue
        : (meetsMinOrder ? const Color(0xFF6366F1) : Colors.grey);

    return Container(
      width: 260,
      margin: const EdgeInsets.only(right: 16, bottom: 8, top: 4),
      child: Stack(
        children: [
          Container(
            decoration: BoxDecoration(
              color: isDark
                  ? AppColors.backgroundSecondary
                  : AppColors.backgroundPrimaryLight,
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: primaryColor.withValues(alpha: isSelected ? 0.3 : 0.1),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
              border: Border.all(
                color: isSelected
                    ? primaryColor
                    : (isDark ? Colors.white10 : Colors.grey.shade200),
                width: isSelected ? 2 : 1,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 60,
                  decoration: BoxDecoration(
                    color: primaryColor.withValues(alpha: 0.1),
                    borderRadius: const BorderRadius.horizontal(
                      left: Radius.circular(14),
                    ),
                  ),
                  child: RotatedBox(
                    quarterTurns: 3,
                    child: Center(
                      child: Text(
                        code,
                        style: TextStyle(
                          color: primaryColor,
                          fontWeight: FontWeight.w900,
                          fontSize: 14,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                  ),
                ),
                CustomPaint(
                  size: const Size(1, double.infinity),
                  painter: DashedLinePainter(
                    color: isDark ? Colors.white10 : Colors.grey.shade300,
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          discount,
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            color: isDark ? Colors.white : Colors.black87,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Min. order ₹$minAmount',
                          style: TextStyle(
                            fontSize: 12,
                            color: isDark ? Colors.white38 : Colors.black38,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const Spacer(),
                        InkWell(
                          onTap: !meetsMinOrder || _validatingCoupon
                              ? null
                              : () => _applyCouponByCode(code, total),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              vertical: 8,
                              horizontal: 12,
                            ),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? Colors.green
                                  : (meetsMinOrder
                                        ? primaryColor
                                        : (isDark
                                              ? Colors.white10
                                              : Colors.grey.shade100)),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Center(
                              child: Text(
                                isSelected
                                    ? 'APPLIED'
                                    : (meetsMinOrder ? 'APPLY' : 'LOCKED'),
                                style: TextStyle(
                                  color: meetsMinOrder
                                      ? Colors.white
                                      : (isDark ? Colors.white24 : Colors.grey),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            left: 54,
            top: -10,
            child: Container(
              width: 12,
              height: 20,
              decoration: BoxDecoration(
                color: isDark
                    ? AppColors.backgroundSurface
                    : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(10),
              ),
            ),
          ),
          Positioned(
            left: 54,
            bottom: -10,
            child: Container(
              width: 12,
              height: 20,
              decoration: BoxDecoration(
                color: isDark
                    ? AppColors.backgroundSurface
                    : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(10),
              ),
            ),
          ),
        ],
      ),
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
