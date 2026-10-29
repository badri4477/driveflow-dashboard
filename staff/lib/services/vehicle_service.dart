import '../../core/api_client.dart';

class Vehicle {
  final String id;
  final String brand;
  final String model;
  final String number;
  final String? year;
  final String? color;
  final String? ownerName;
  final Map<String, dynamic>? healthIndicators;

  Vehicle({
    required this.id,
    required this.brand,
    required this.model,
    required this.number,
    this.year,
    this.color,
    this.ownerName,
    this.healthIndicators,
  });

  factory Vehicle.fromJson(Map<String, dynamic> json) {
    return Vehicle(
      id: json['_id'] ?? '',
      brand: json['brand'] ?? '',
      model: json['model'] ?? '',
      number: json['number'] ?? '',
      year: json['year']?.toString(),
      color: json['color']?.toString(),
      ownerName: json['user'] is Map ? json['user']['name'] : null,
      healthIndicators: json['healthIndicators'] is Map
          ? Map<String, dynamic>.from(json['healthIndicators'])
          : null,
    );
  }
}

class VehicleService {
  final ApiClient _api = ApiClient();

  /// Vehicle price-list row for a make/model (same endpoint the web uses for
  /// the auto-filled pickup/drop price). Null if no match or on error.
  Future<Map<String, dynamic>?> searchReference({
    required String make,
    required String model,
    String? variant,
    String? fuelType,
  }) async {
    final query = Uri(
      queryParameters: {
        'brand_name': make.trim(),
        'model': model.trim(),
        if ((variant ?? '').trim().isNotEmpty) 'variant': variant!.trim(),
        if ((fuelType ?? '').trim().isNotEmpty) 'fuel_type': fuelType!.trim(),
      },
    ).query;
    try {
      return await _api.getJson('/vehicle-reference/search?$query');
    } catch (_) {
      return null;
    }
  }

  Future<List<Vehicle>> getVehicles() async {
    final response = await _api.getAny('/vehicles/all');
    if (response is List) {
      return response.map((json) => Vehicle.fromJson(json)).toList();
    }
    return [];
  }

  Future<void> updateVehicleHealth(
    String vehicleId,
    Map<String, dynamic> healthIndicators,
  ) async {
    await _api.putJson(
      '/vehicles/$vehicleId/health',
      body: {'healthIndicators': healthIndicators},
    );
  }
}
