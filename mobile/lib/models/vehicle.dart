class Vehicle {
  final String id;
  final String make;
  final String model;
  final String? variant;
  final int year;
  final String licensePlate;
  final String? type;
  final String? status;
  final String? image;
  final VehicleInsurance? insurance;
  final List<VehicleDocument> documents;
  final VehicleLocation? location;
  final DateTime? lastService;
  final DateTime? nextService;
  final String? vin;
  final num? mileage;
  final String? fuelType;
  final String? color;
  final String? frontTyres;
  final String? rearTyres;
  final String? batteryDetails;
  final String? pickupDropPrice;
  final Map<String, dynamic>? healthIndicators;
  // Saved from Vahan when the vehicle was added (null for manual entry).
  final String? bodyType;
  final String? manufacturingMonthYear;
  final String? insuranceValidUpto;
  final String? registrationValidUpto;

  Vehicle({
    required this.id,
    required this.make,
    required this.model,
    this.variant,
    required this.year,
    required this.licensePlate,
    this.type,
    this.status,
    this.image,
    this.insurance,
    this.documents = const [],
    this.location,
    this.lastService,
    this.nextService,
    this.vin,
    this.mileage,
    this.fuelType,
    this.color,
    this.frontTyres,
    this.rearTyres,
    this.batteryDetails,
    this.pickupDropPrice,
    this.healthIndicators,
    this.bodyType,
    this.manufacturingMonthYear,
    this.insuranceValidUpto,
    this.registrationValidUpto,
  });

  factory Vehicle.fromJson(Map<String, dynamic> json) {
    return Vehicle(
      id: (json['id'] ?? json['_id'] ?? '').toString(),
      make: (json['make'] ?? '').toString(),
      model: (json['model'] ?? '').toString(),
      variant: json['variant']?.toString(),
      year: (json['year'] is num) ? (json['year'] as num).toInt() : 0,
      licensePlate: (json['licensePlate'] ?? '').toString(),
      type: json['type']?.toString(),
      status: json['status']?.toString(),
      image: json['image']?.toString(),
      vin: json['vin']?.toString(),
      mileage: json['mileage'] is num ? (json['mileage'] as num) : null,
      fuelType: json['fuelType']?.toString(),
      color: json['color']?.toString(),
      frontTyres: json['frontTyres']?.toString(),
      rearTyres: json['rearTyres']?.toString(),
      batteryDetails: json['batteryDetails']?.toString(),
      pickupDropPrice: (json['pickupDropPrice'] ?? json['pickup_drop_price'])
          ?.toString(),
      bodyType: json['bodyType']?.toString(),
      manufacturingMonthYear: json['manufacturingMonthYear']?.toString(),
      insuranceValidUpto: json['insuranceValidUpto']?.toString(),
      registrationValidUpto: json['registrationValidUpto']?.toString(),
      healthIndicators: json['healthIndicators'] is Map
          ? Map<String, dynamic>.from(json['healthIndicators'])
          : null,
      lastService: json['lastService'] != null
          ? DateTime.tryParse(json['lastService'].toString())
          : null,
      nextService: json['nextService'] != null
          ? DateTime.tryParse(json['nextService'].toString())
          : null,
      insurance: json['insurance'] != null
          ? VehicleInsurance.fromJson(
              Map<String, dynamic>.from(json['insurance']),
            )
          : null,
      documents: (json['documents'] as List? ?? [])
          .map((e) => VehicleDocument.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      location: json['location'] != null
          ? VehicleLocation.fromJson(
              Map<String, dynamic>.from(json['location']),
            )
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'make': make,
      'model': model,
      if (variant != null) 'variant': variant,
      'year': year,
      'licensePlate': licensePlate,
      if (type != null) 'type': type,
      if (status != null) 'status': status,
      if (image != null) 'image': image,
      if (vin != null) 'vin': vin,
      if (mileage != null) 'mileage': mileage,
      if (fuelType != null) 'fuelType': fuelType,
      if (color != null) 'color': color,
      if (frontTyres != null) 'frontTyres': frontTyres,
      if (rearTyres != null) 'rearTyres': rearTyres,
      if (batteryDetails != null) 'batteryDetails': batteryDetails,
      if (pickupDropPrice != null) 'pickupDropPrice': pickupDropPrice,
      if (bodyType != null) 'bodyType': bodyType,
      if (manufacturingMonthYear != null)
        'manufacturingMonthYear': manufacturingMonthYear,
      if (insuranceValidUpto != null) 'insuranceValidUpto': insuranceValidUpto,
      if (registrationValidUpto != null)
        'registrationValidUpto': registrationValidUpto,
      if (lastService != null) 'lastService': lastService?.toIso8601String(),
      if (nextService != null) 'nextService': nextService?.toIso8601String(),
      if (insurance != null) 'insurance': insurance!.toJson(),
      'documents': documents.map((e) => e.toJson()).toList(),
      if (location != null) 'location': location!.toJson(),
      if (healthIndicators != null) 'healthIndicators': healthIndicators,
    };
  }
}

class VehicleInsurance {
  final String? policyNumber;
  final String? provider;
  final DateTime? startDate;
  final DateTime? expiryDate;
  final String? status;

  VehicleInsurance({
    this.policyNumber,
    this.provider,
    this.startDate,
    this.expiryDate,
    this.status,
  });

  factory VehicleInsurance.fromJson(Map<String, dynamic> json) {
    return VehicleInsurance(
      policyNumber: json['policyNumber']?.toString(),
      provider: json['provider']?.toString(),
      startDate: json['startDate'] != null
          ? DateTime.tryParse(json['startDate'].toString())
          : null,
      expiryDate: json['expiryDate'] != null
          ? DateTime.tryParse(json['expiryDate'].toString())
          : null,
      status: (json['status'] ?? 'Active').toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'policyNumber': policyNumber,
    'provider': provider,
    'startDate': startDate?.toIso8601String(),
    'expiryDate': expiryDate?.toIso8601String(),
    'status': status,
  };
}

class VehicleDocument {
  final String name;
  final String type;
  final String url;
  final DateTime? expiryDate;
  final DateTime? uploadedAt;

  VehicleDocument({
    required this.name,
    required this.type,
    required this.url,
    this.expiryDate,
    this.uploadedAt,
  });

  factory VehicleDocument.fromJson(Map<String, dynamic> json) {
    return VehicleDocument(
      name: (json['name'] ?? '').toString(),
      type: (json['type'] ?? 'Other').toString(),
      url: (json['url'] ?? '').toString(),
      expiryDate: json['expiryDate'] != null
          ? DateTime.tryParse(json['expiryDate'].toString())
          : null,
      uploadedAt: json['uploadedAt'] != null
          ? DateTime.tryParse(json['uploadedAt'].toString())
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'type': type,
    'url': url,
    'expiryDate': expiryDate?.toIso8601String(),
    'uploadedAt': uploadedAt?.toIso8601String(),
  };
}

class VehicleLocation {
  final String? address;
  final double? lat;
  final double? lng;

  VehicleLocation({this.address, this.lat, this.lng});

  factory VehicleLocation.fromJson(Map<String, dynamic> json) {
    return VehicleLocation(
      address: json['address']?.toString(),
      lat: (json['lat'] as num?)?.toDouble(),
      lng: (json['lng'] as num?)?.toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {'address': address, 'lat': lat, 'lng': lng};
}
