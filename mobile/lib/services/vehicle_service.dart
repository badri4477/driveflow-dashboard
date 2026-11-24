import '../core/api_client.dart';
import '../core/env.dart';
import '../models/vehicle.dart';

class VehicleService {
  final ApiClient _api = ApiClient();

  static List<Vehicle>? _cachedVehicles;
  static DateTime? _lastFetchAt;
  static Future<List<Vehicle>>? _activeFetch;
  static const Duration _cacheDuration = Duration(minutes: 5);

  static List<Map<String, dynamic>>? _cachedReferences;
  static DateTime? _lastReferencesFetchAt;
  static Future<List<Map<String, dynamic>>>? _activeReferencesFetch;

  Future<List<Vehicle>> listMyVehicles({bool forceRefresh = false}) async {
    final now = DateTime.now();

    // Check cache
    if (!forceRefresh &&
        _cachedVehicles != null &&
        _lastFetchAt != null &&
        now.difference(_lastFetchAt!) < _cacheDuration) {
      return _cachedVehicles!;
    }

    // Return active fetch if one is in progress
    if (_activeFetch != null && !forceRefresh) {
      return _activeFetch!;
    }

    _activeFetch = _doFetch(forceRefresh);
    try {
      return await _activeFetch!;
    } finally {
      _activeFetch = null;
    }
  }

  Future<List<Vehicle>> _doFetch(bool forceRefresh) async {
    final res = await _api.getAny(ApiEndpoints.vehicles);
    final items = <Vehicle>[];
    if (res is List) {
      for (final e in res) {
        if (e is Map<String, dynamic>) {
          items.add(Vehicle.fromJson(e));
        } else if (e is Map) {
          items.add(Vehicle.fromJson(Map<String, dynamic>.from(e)));
        }
      }
    }
    _cachedVehicles = items;
    _lastFetchAt = DateTime.now();
    return items;
  }

  void clearCache() {
    _cachedVehicles = null;
    _lastFetchAt = null;
    _activeFetch = null;
  }

  /// Full vehicle reference catalog (brand/model/variant/fuel type/prices),
  /// used to drive the Brand → Model → Variant → Fuel Type dropdowns on Add
  /// Vehicle instead of free-text entry.
  Future<List<Map<String, dynamic>>> listAllReferences({
    bool forceRefresh = false,
  }) async {
    final now = DateTime.now();

    if (!forceRefresh &&
        _cachedReferences != null &&
        _lastReferencesFetchAt != null &&
        now.difference(_lastReferencesFetchAt!) < _cacheDuration) {
      return _cachedReferences!;
    }

    if (_activeReferencesFetch != null && !forceRefresh) {
      return _activeReferencesFetch!;
    }

    _activeReferencesFetch = _doFetchReferences();
    try {
      return await _activeReferencesFetch!;
    } finally {
      _activeReferencesFetch = null;
    }
  }

  Future<List<Map<String, dynamic>>> _doFetchReferences() async {
    final res = await _api.getAny(ApiEndpoints.vehicleReference);
    final items = <Map<String, dynamic>>[];
    if (res is List) {
      for (final e in res) {
        if (e is Map<String, dynamic>) {
          items.add(e);
        } else if (e is Map) {
          items.add(Map<String, dynamic>.from(e));
        }
      }
    }
    _cachedReferences = items;
    _lastReferencesFetchAt = DateTime.now();
    return items;
  }

  Future<Vehicle> getVehicleById(String id) async {
    final res = await _api.getAny(ApiEndpoints.vehicleById(id));
    if (res is Map<String, dynamic>) return Vehicle.fromJson(res);
    if (res is Map) return Vehicle.fromJson(Map<String, dynamic>.from(res));
    throw ApiException(statusCode: 500, message: 'Unexpected response type');
  }

  Future<Vehicle> addVehicle({
    required String licensePlate,
    required String make,
    required String model,
    String? variant,
    int? year,
    String type = 'Car',
    String? vin,
    num? mileage,
    String? fuelType,
    String? color,
    String? frontTyres,
    String? rearTyres,
    String? batteryDetails,
    String? pickupDropPrice,
  }) async {
    final res = await _api.postAny(
      ApiEndpoints.vehicles,
      body: {
        'licensePlate': licensePlate,
        'make': make,
        'model': model,
        'variant': variant,
        'year': year,
        'type': type,
        'vin': vin,
        'mileage': mileage,
        'fuelType': fuelType,
        'color': color,
        'frontTyres': frontTyres,
        'rearTyres': rearTyres,
        'batteryDetails': batteryDetails,
        'pickupDropPrice': pickupDropPrice,
      }..removeWhere((k, v) => v == null),
    );
    if (res is Map<String, dynamic>) return Vehicle.fromJson(res);
    if (res is Map) return Vehicle.fromJson(Map<String, dynamic>.from(res));
    throw ApiException(statusCode: 500, message: 'Unexpected response type');
  }

  Future<Vehicle> updateVehicle(
    String id, {
    String? licensePlate,
    String? make,
    String? model,
    String? variant,
    int? year,
    String? fuelType,
    String? color,
    String? frontTyres,
    String? rearTyres,
    String? batteryDetails,
    String? pickupDropPrice,
  }) async {
    final res = await _api.putAny(
      ApiEndpoints.vehicleById(id),
      body: {
        'licensePlate': licensePlate,
        'make': make,
        'model': model,
        'variant': variant,
        'year': ?year,
        'fuelType': fuelType,
        'color': color,
        'frontTyres': frontTyres,
        'rearTyres': rearTyres,
        'batteryDetails': batteryDetails,
        'pickupDropPrice': pickupDropPrice,
      }..removeWhere((k, v) => v == null),
    );
    clearCache();
    if (res is Map<String, dynamic>) return Vehicle.fromJson(res);
    if (res is Map) return Vehicle.fromJson(Map<String, dynamic>.from(res));
    throw ApiException(statusCode: 500, message: 'Unexpected response type');
  }

  Future<void> deleteVehicle(String id) async {
    await _api.deleteAny(ApiEndpoints.vehicleById(id));
    clearCache();
  }

  Future<Map<String, dynamic>?> searchReference({
    required String make,
    required String model,
    String? variant,
    String? fuelType,
  }) async {
    try {
      final m = make.trim();
      final md = model.trim();
      if (m.isEmpty || md.isEmpty) return null;
      final queryParams = <String, String>{'brand_name': m, 'model': md};
      final v = (variant ?? '').trim();
      if (v.isNotEmpty) queryParams['variant'] = v;
      final f = (fuelType ?? '').trim();
      if (f.isNotEmpty) queryParams['fuel_type'] = f;

      final queryString = queryParams.entries
          .map(
            (e) =>
                '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value)}',
          )
          .join('&');

      final res = await _api.getAny(
        '${ApiEndpoints.vehicleReferenceSearch}?$queryString',
      );
      if (res is Map<String, dynamic>) return res;
      if (res is Map) return Map<String, dynamic>.from(res);
      return null;
    } catch (e) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> fetchDetails(String licensePlate) async {
    try {
      final res = await _api.postAny(
        ApiEndpoints.fetchVehicleDetails,
        body: {'licensePlate': licensePlate},
      );
      if (res is Map<String, dynamic>) return res;
      if (res is Map) return Map<String, dynamic>.from(res);
      return null;
    } catch (e) {
      return null;
    }
  }

  /// Whether the backend has Vahan (Parivahan) lookup configured.
  Future<bool> vahanEnabled() async {
    try {
      final res = await _api.getAny(ApiEndpoints.vahanStatus);
      return res is Map && res['enabled'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Vahan lookup by registration number, or by chassis + engine number.
  /// Throws [ApiException] with a user-facing message on failure.
  Future<Map<String, dynamic>> vahanLookup({
    String? regnNo,
    String? chasiNo,
    String? engNo,
  }) async {
    final body = <String, dynamic>{
      'regnNo': ?regnNo,
      'chasiNo': ?chasiNo,
      'engNo': ?engNo,
    };
    final res = await _api.postAny(ApiEndpoints.vahanLookup, body: body);
    if (res is Map) return Map<String, dynamic>.from(res);
    throw ApiException(statusCode: 500, message: 'Unexpected response');
  }

  List<Map<String, dynamic>> _asMapList(dynamic res) {
    if (res is! List) return const [];
    return res
        .map((e) {
          if (e is Map<String, dynamic>) return e;
          if (e is Map) return Map<String, dynamic>.from(e);
          return null;
        })
        .whereType<Map<String, dynamic>>()
        .toList();
  }

  /// Admin-added price columns from Vehicle Reference Data (e.g. a brand
  /// beyond the built-in Bridgestone/Yokohama/... or Amaron/Exide list),
  /// filtered to [category] ('tyre' or 'battery'). Returns label + fieldName
  /// so renamed display labels still resolve to the correct Vehicle Data key.
  Future<List<({String label, String fieldName})>> getReferenceColumns(
    String category,
  ) async {
    try {
      final res = await _api.getAny(ApiEndpoints.vehicleReferenceColumns);
      return _asMapList(res)
          .where((c) => c['category'] == category)
          .map((c) {
            final label = c['label']?.toString() ?? '';
            final fieldName = c['fieldName']?.toString() ?? '';
            return (label: label, fieldName: fieldName);
          })
          .where((c) => c.label.isNotEmpty && c.fieldName.isNotEmpty)
          .toList();
    } catch (e) {
      return const [];
    }
  }

  Future<List<String>> getReferenceColumnLabels(String category) async {
    final cols = await getReferenceColumns(category);
    return cols.map((c) => c.label).toList();
  }

  /// Built-in brand columns for [category], including label/fieldName/hidden.
  Future<List<({String label, String fieldName, bool hidden})>>
  getBuiltinColumns(String category) async {
    try {
      final res = await _api.getAny(
        ApiEndpoints.vehicleReferenceBuiltinColumns,
      );
      return _asMapList(res)
          .where((c) => c['category'] == category)
          .map((c) {
            final label = c['label']?.toString() ?? '';
            final fieldName = c['fieldName']?.toString() ?? '';
            final hidden = c['hidden'] == true;
            return (label: label, fieldName: fieldName, hidden: hidden);
          })
          .where((c) => c.label.isNotEmpty && c.fieldName.isNotEmpty)
          .toList();
    } catch (e) {
      return const [];
    }
  }

  /// Built-in brand columns (of [category]) an admin has hidden in Vehicle
  /// Reference Data — these shouldn't be offered here either. Mirrors
  /// getVehicleReferenceBuiltinColumns() in the web frontend.
  Future<Set<String>> getHiddenBuiltinColumnLabels(String category) async {
    final cols = await getBuiltinColumns(category);
    return cols.where((c) => c.hidden).map((c) => c.label).toSet();
  }
}
