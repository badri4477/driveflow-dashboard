String? _orderNumberFromJson(dynamic value) {
  if (value == null) return null;
  final s = value.toString().trim();
  return s.isEmpty ? null : s;
}

double? _toDouble(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

class BookingSummary {
  final String id;
  final String? orderNumber;
  final String status;
  final String? date;
  final String? createdAt;
  final String? vehicleName;
  final String? vehicleMake;
  final String? vehicleModel;
  final String? licensePlate;
  final String? customerName;
  final String? paymentStatus;
  final String? locationAddress;
  final double? customerLat;
  final double? customerLng;
  final String? serviceName;
  final List<String> serviceNames;
  final List<dynamic>? services;

  BookingSummary({
    required this.id,
    this.orderNumber,
    required this.status,
    this.date,
    this.createdAt,
    this.vehicleName,
    this.vehicleMake,
    this.vehicleModel,
    this.licensePlate,
    this.customerName,
    this.paymentStatus,
    this.locationAddress,
    this.customerLat,
    this.customerLng,
    this.serviceName,
    this.serviceNames = const [],
    this.services,
  });

  factory BookingSummary.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return BookingSummary(id: '', status: 'UNKNOWN');
    }

    // Defensive access to avoid json[$_get] on null
    dynamic getField(String key) {
      try {
        return json[key];
      } catch (_) {
        return null;
      }
    }

    Map<String, dynamic>? vehicle;
    try {
      final v = getField('vehicle');
      if (v is Map<String, dynamic>) {
        vehicle = v;
      } else if (v is Map) {
        vehicle = Map<String, dynamic>.from(v);
      }
    } catch (_) {}

    Map<String, dynamic>? location;
    try {
      final l = getField('location');
      if (l is Map<String, dynamic>) {
        location = l;
      } else if (l is Map) {
        location = Map<String, dynamic>.from(l);
      }
    } catch (_) {}

    final make = vehicle?['make']?.toString();
    final model = vehicle?['model']?.toString();
    final plate = vehicle?['licensePlate']?.toString();
    final vehicleName = [
      if (make != null && make.isNotEmpty) make,
      if (model != null && model.isNotEmpty) model,
      if (plate != null && plate.isNotEmpty) plate,
    ].join(' ');

    Map<String, dynamic>? user;
    try {
      final u = getField('user');
      if (u is Map<String, dynamic>) {
        user = u;
      } else if (u is Map) {
        user = Map<String, dynamic>.from(u);
      }
    } catch (_) {}

    List<dynamic>? allServices;
    final serviceNames = <String>[];
    String serviceName = 'General Service';
    try {
      final services = getField('services');
      if (services is List) {
        allServices = services;
        for (final item in services) {
          if (item is Map) {
            final name = item['name']?.toString();
            if (name != null && name.isNotEmpty) serviceNames.add(name);
          }
        }
      }
      final service = getField('service');
      if (serviceNames.isNotEmpty) {
        serviceName = serviceNames.first;
      } else if (service is Map) {
        serviceName = service['name']?.toString() ?? 'General Service';
        final name = service['name']?.toString();
        if (name != null && name.isNotEmpty) serviceNames.add(name);
      }
    } catch (_) {}

    return BookingSummary(
      id: (getField('id') ?? getField('_id') ?? '').toString(),
      orderNumber: _orderNumberFromJson(getField('orderNumber')),
      status: getField('status')?.toString() ?? '',
      date: getField('date')?.toString(),
      createdAt: getField('createdAt')?.toString(),
      vehicleName: vehicleName.isEmpty ? null : vehicleName,
      vehicleMake: make,
      vehicleModel: model,
      licensePlate: plate,
      customerName: user?['name']?.toString(),
      paymentStatus: getField('paymentStatus')?.toString(),
      locationAddress: location?['address']?.toString(),
      customerLat: _toDouble(location?['lat']),
      customerLng: _toDouble(location?['lng']),
      serviceName: serviceName,
      serviceNames: serviceNames,
      services: allServices,
    );
  }
}

class BookingLocation {
  final String? address;
  final double? lat;
  final double? lng;

  const BookingLocation({this.address, this.lat, this.lng});

  factory BookingLocation.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const BookingLocation();

    // Defensive access to avoid json[$_get] on null
    dynamic getField(String key) {
      try {
        return json[key];
      } catch (_) {
        return null;
      }
    }

    final latRaw = getField('lat');
    final lngRaw = getField('lng');
    return BookingLocation(
      address: (getField('address') ?? '').toString().trim().isEmpty
          ? null
          : (getField('address') ?? '').toString(),
      lat: latRaw is num ? latRaw.toDouble() : null,
      lng: lngRaw is num ? lngRaw.toDouble() : null,
    );
  }
}

class BookingDetail {
  final String id;
  final String? orderNumber;
  final String status;
  final String date;
  final String? createdAt;
  final String? healthSavedAt;
  final List<dynamic>? services;
  final BookingLocation? location;
  final BookingLocation? merchantLocation;
  final String? vehicleName;
  final String? vehicleId;
  final String? vehicleMake;
  final String? vehicleModel;
  final String? vehicleVariant;
  final String? vehicleType;
  final String? vehicleColor;
  final String? vehicleFuel;
  final String? vehicleImage;
  final num? vehicleMileage;
  final Map<String, dynamic>? vehicleHealthIndicators;
  final List<String> prePickupPhotos;
  final String? paymentStatus;
  final num? totalAmount;
  final num? discountAmount;
  final bool pickupRequired;
  final InspectionData? inspection;
  final QCData? qc;
  final ServiceExecutionData? serviceExecution;
  final BillingData? billing;
  final List<PartItem> parts;
  final UserSummary? user;
  final UserSummary? merchant;
  final String? inspectionCompletedAt;
  final num? pickupDropPrice;
  final String? qcCompletedAt;
  final BatteryTireData? batteryTire;
  final CarWashData? carWash;
  final RevisitData? revisit;
  final DelayData? delay;
  final String? notes;

  BookingDetail({
    required this.id,
    this.orderNumber,
    required this.status,
    required this.date,
    this.createdAt,
    this.healthSavedAt,
    this.services,
    this.location,
    this.merchantLocation,
    this.vehicleName,
    this.vehicleId,
    this.vehicleMake,
    this.vehicleModel,
    this.vehicleVariant,
    this.vehicleType,
    this.vehicleColor,
    this.vehicleFuel,
    this.vehicleImage,
    this.vehicleMileage,
    this.vehicleHealthIndicators,
    required this.prePickupPhotos,
    this.paymentStatus,
    this.totalAmount,
    this.discountAmount,
    this.pickupRequired = true,
    this.inspection,
    this.qc,
    this.serviceExecution,
    this.billing,
    this.parts = const [],
    this.user,
    this.merchant,
    this.inspectionCompletedAt,
    this.qcCompletedAt,
    this.batteryTire,
    this.carWash,
    this.revisit,
    this.delay,
    this.notes,
    this.pickupDropPrice,
  });

  static const statusLabels = {
    'CREATED': 'Created',
    'ASSIGNED': 'Assigned',
    'ACCEPTED': 'Accepted',
    'REACHED_CUSTOMER': 'Reached Customer',
    'VEHICLE_PICKED': 'Vehicle Picked',
    'REACHED_MERCHANT': 'Reached Merchant',
    'VEHICLE_AT_MERCHANT': 'At Merchant',
    'SERVICE_STARTED': 'Service Started',
    'SERVICE_COMPLETED': ' Service is completed.',
    'OUT_FOR_DELIVERY': 'Out for Delivery',
    'DELIVERED': 'Delivered',
    'CANCELLED': 'Cancelled',
    'COMPLETED': 'Completed',
    'CAR_WASH_STARTED': 'Car Wash Started',
    'CAR_WASH_COMPLETED': 'Car Wash Completed',
    'STAFF_REACHED_MERCHANT': 'Reached Merchant',
    'PICKUP_BATTERY_TIRE': 'Pickup Part',
    'INSTALLATION': 'Installation',
    'DELIVERY': 'Delivery',
    'ON HOLD': 'On Hold',
  };

  static String getStatusLabel(String status, {List<dynamic>? services}) {
    if (services != null &&
        services.any((s) {
          final category =
              (s is Map ? s['category'] : null)?.toString().toLowerCase() ?? '';
          return category.contains('essentials');
        })) {
      if (status.toUpperCase() == 'CAR_WASH_STARTED') {
        return 'Service Started';
      }
      if (status.toUpperCase() == 'CAR_WASH_COMPLETED') {
        return 'Service Completed';
      }
    }
    return statusLabels[status.toUpperCase()] ?? status;
  }

  BookingDetail copyWith({
    String? id,
    String? orderNumber,
    String? status,
    String? date,
    String? createdAt,
    String? healthSavedAt,
    List<dynamic>? services,
    BookingLocation? location,
    BookingLocation? merchantLocation,
    String? vehicleName,
    String? vehicleId,
    String? vehicleMake,
    String? vehicleModel,
    String? vehicleVariant,
    String? vehicleType,
    String? vehicleColor,
    String? vehicleFuel,
    String? vehicleImage,
    num? vehicleMileage,
    Map<String, dynamic>? vehicleHealthIndicators,
    List<String>? prePickupPhotos,
    String? paymentStatus,
    num? totalAmount,
    num? discountAmount,
    bool? pickupRequired,
    InspectionData? inspection,
    QCData? qc,
    ServiceExecutionData? serviceExecution,
    BillingData? billing,
    List<PartItem>? parts,
    UserSummary? user,
    UserSummary? merchant,
    String? inspectionCompletedAt,
    String? qcCompletedAt,
    BatteryTireData? batteryTire,
    CarWashData? carWash,
    RevisitData? revisit,
    DelayData? delay,
    String? notes,
    num? pickupDropPrice,
  }) {
    return BookingDetail(
      id: id ?? this.id,
      orderNumber: orderNumber ?? this.orderNumber,
      status: status ?? this.status,
      date: date ?? this.date,
      createdAt: createdAt ?? this.createdAt,
      healthSavedAt: healthSavedAt ?? this.healthSavedAt,
      services: services ?? this.services,
      location: location ?? this.location,
      merchantLocation: merchantLocation ?? this.merchantLocation,
      vehicleName: vehicleName ?? this.vehicleName,
      vehicleId: vehicleId ?? this.vehicleId,
      vehicleMake: vehicleMake ?? this.vehicleMake,
      vehicleModel: vehicleModel ?? this.vehicleModel,
      vehicleVariant: vehicleVariant ?? this.vehicleVariant,
      vehicleType: vehicleType ?? this.vehicleType,
      vehicleColor: vehicleColor ?? this.vehicleColor,
      vehicleFuel: vehicleFuel ?? this.vehicleFuel,
      vehicleImage: vehicleImage ?? this.vehicleImage,
      vehicleMileage: vehicleMileage ?? this.vehicleMileage,
      vehicleHealthIndicators:
          vehicleHealthIndicators ?? this.vehicleHealthIndicators,
      prePickupPhotos: prePickupPhotos ?? this.prePickupPhotos,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      totalAmount: totalAmount ?? this.totalAmount,
      discountAmount: discountAmount ?? this.discountAmount,
      pickupRequired: pickupRequired ?? this.pickupRequired,
      inspection: inspection ?? this.inspection,
      qc: qc ?? this.qc,
      serviceExecution: serviceExecution ?? this.serviceExecution,
      billing: billing ?? this.billing,
      parts: parts ?? this.parts,
      user: user ?? this.user,
      merchant: merchant ?? this.merchant,
      inspectionCompletedAt:
          inspectionCompletedAt ?? this.inspectionCompletedAt,
      qcCompletedAt: qcCompletedAt ?? this.qcCompletedAt,
      batteryTire: batteryTire ?? this.batteryTire,
      carWash: carWash ?? this.carWash,
      revisit: revisit ?? this.revisit,
      delay: delay ?? this.delay,
      notes: notes ?? this.notes,
      pickupDropPrice: pickupDropPrice ?? this.pickupDropPrice,
    );
  }

  factory BookingDetail.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return BookingDetail(
        id: '',
        status: 'UNKNOWN',
        date: '',
        prePickupPhotos: [],
      );
    }

    // Defensive access to avoid json[$_get] on null
    dynamic getField(String key) {
      try {
        return json[key];
      } catch (_) {
        return null;
      }
    }

    BookingLocation? location;
    final loc = getField('location');
    if (loc is Map<String, dynamic>) {
      location = BookingLocation.fromJson(loc);
    } else if (loc is Map) {
      location = BookingLocation.fromJson(Map<String, dynamic>.from(loc));
    }

    BookingLocation? merchantLocation;
    try {
      final merchant = getField('merchant');
      if (merchant is Map) {
        final mloc = merchant['location'];
        if (mloc is Map<String, dynamic>) {
          merchantLocation = BookingLocation.fromJson(mloc);
        } else if (mloc is Map) {
          merchantLocation = BookingLocation.fromJson(
            Map<String, dynamic>.from(mloc),
          );
        }
      }
    } catch (_) {}

    Map<String, dynamic>? vehicle;
    try {
      final v = getField('vehicle');
      if (v is Map<String, dynamic>) {
        vehicle = v;
      } else if (v is Map) {
        vehicle = Map<String, dynamic>.from(v);
      }
    } catch (_) {}
    final make = vehicle?['make']?.toString();
    final model = vehicle?['model']?.toString();
    final plate = vehicle?['licensePlate']?.toString();
    final vehicleName = [
      if (make != null && make.isNotEmpty) make,
      if (model != null && model.isNotEmpty) model,
      if (plate != null && plate.isNotEmpty) plate,
    ].join(' ');

    final photos =
        (getField('prePickupPhotos') as List?)?.whereType<String>().toList() ??
        [];

    final inspectionMap = getField('inspection');
    InspectionData? inspection;
    if (inspectionMap is Map) {
      inspection = InspectionData.fromJson(
        Map<String, dynamic>.from(inspectionMap),
      );
      final inspPhotos = inspectionMap['photos'];
      if (inspPhotos is List) {
        for (final p in inspPhotos) {
          final pStr = p?.toString();
          if (pStr != null && !photos.contains(pStr)) {
            photos.add(pStr);
          }
        }
      }
    }

    return BookingDetail(
      id: (getField('id') ?? getField('_id') ?? '').toString(),
      orderNumber: _orderNumberFromJson(getField('orderNumber')),
      status: (getField('status') ?? '').toString(),
      date: (getField('date') ?? '').toString(),
      createdAt: getField('createdAt')?.toString(),
      healthSavedAt: getField('healthSavedAt')?.toString(),
      services: getField('services') as List?,
      location: location,
      merchantLocation: merchantLocation,
      vehicleName: vehicleName.isEmpty ? null : vehicleName,
      vehicleId: vehicle?['_id']?.toString(),
      vehicleMake: _nonEmpty(vehicle?['make']),
      vehicleModel: _nonEmpty(vehicle?['model']),
      vehicleVariant: _nonEmpty(vehicle?['variant']),
      vehicleType: _nonEmpty(vehicle?['type']),
      vehicleColor: _nonEmpty(vehicle?['color']),
      vehicleFuel: _nonEmpty(vehicle?['fuelType']),
      vehicleImage: _nonEmpty(vehicle?['image']),
      vehicleMileage: vehicle?['mileage'] is num
          ? vehicle!['mileage'] as num
          : num.tryParse('${vehicle?['mileage'] ?? ''}'),
      vehicleHealthIndicators: vehicle?['healthIndicators'] is Map
          ? Map<String, dynamic>.from(vehicle!['healthIndicators'] as Map)
          : null,
      prePickupPhotos: photos,
      paymentStatus: getField('paymentStatus')?.toString(),
      totalAmount: getField('totalAmount') is num
          ? getField('totalAmount') as num
          : null,
      discountAmount: getField('discountAmount') is num
          ? getField('discountAmount') as num
          : null,
      pickupRequired: getField('pickupRequired') != false,
      inspection: inspection,
      qc: getField('qc') is Map
          ? QCData.fromJson(Map<String, dynamic>.from(getField('qc')))
          : null,
      serviceExecution: getField('serviceExecution') is Map
          ? ServiceExecutionData.fromJson(
              Map<String, dynamic>.from(getField('serviceExecution')),
            )
          : null,
      billing: getField('billing') is Map
          ? BillingData.fromJson(Map<String, dynamic>.from(getField('billing')))
          : null,
      parts:
          (getField('parts') as List?)
              ?.whereType<Map>()
              .map((p) => PartItem.fromJson(Map<String, dynamic>.from(p)))
              .toList() ??
          [],
      user: getField('user') is Map
          ? UserSummary.fromJson(Map<String, dynamic>.from(getField('user')))
          : null,
      merchant: getField('merchant') is Map
          ? UserSummary.fromJson(
              Map<String, dynamic>.from(getField('merchant')),
            )
          : null,
      inspectionCompletedAt: inspection?.completedAt,
      qcCompletedAt: getField('qc') is Map
          ? getField('qc')['completedAt']?.toString()
          : null,
      batteryTire: getField('batteryTire') is Map
          ? BatteryTireData.fromJson(
              Map<String, dynamic>.from(getField('batteryTire')),
            )
          : null,
      carWash: getField('carWash') is Map
          ? CarWashData.fromJson(Map<String, dynamic>.from(getField('carWash')))
          : null,
      revisit: getField('revisit') is Map
          ? RevisitData.fromJson(Map<String, dynamic>.from(getField('revisit')))
          : null,
      delay: getField('delay') is Map
          ? DelayData.fromJson(Map<String, dynamic>.from(getField('delay')))
          : null,
      notes: getField('notes')?.toString(),
      pickupDropPrice: getField('pickupDropPrice') is num
          ? getField('pickupDropPrice') as num
          : null,
    );
  }
}

class DelayData {
  final bool isDelayed;
  final String? reason;
  final String? note;
  final String? startTime;
  final String? previousStatus;

  DelayData({
    required this.isDelayed,
    this.reason,
    this.note,
    this.startTime,
    this.previousStatus,
  });

  factory DelayData.fromJson(Map<String, dynamic>? json) {
    if (json == null) return DelayData(isDelayed: false);
    return DelayData(
      isDelayed: json['isDelayed'] == true,
      reason: json['reason']?.toString(),
      note: json['note']?.toString(),
      startTime: json['startTime']?.toString(),
      previousStatus: json['previousStatus']?.toString(),
    );
  }
}

class CarWashData {
  final bool isCarWashService;
  final String? staffAssigned;
  final List<String> beforeWashPhotos;
  final List<String> afterWashPhotos;
  final String? washStartedAt;
  final String? washCompletedAt;

  CarWashData({
    required this.isCarWashService,
    this.staffAssigned,
    this.beforeWashPhotos = const [],
    this.afterWashPhotos = const [],
    this.washStartedAt,
    this.washCompletedAt,
  });

  factory CarWashData.fromJson(Map<String, dynamic>? json) {
    if (json == null) return CarWashData(isCarWashService: false);
    return CarWashData(
      isCarWashService: json['isCarWashService'] == true,
      staffAssigned: json['staffAssigned']?.toString(),
      beforeWashPhotos:
          (json['beforeWashPhotos'] as List?)?.whereType<String>().toList() ??
          [],
      afterWashPhotos:
          (json['afterWashPhotos'] as List?)?.whereType<String>().toList() ??
          [],
      washStartedAt: json['washStartedAt']?.toString(),
      washCompletedAt: json['washCompletedAt']?.toString(),
    );
  }
}

class UserSummary {
  final String id;
  final String name;
  final String? email;
  final String? phone;

  UserSummary({required this.id, required this.name, this.email, this.phone});

  factory UserSummary.fromJson(Map<String, dynamic>? json) {
    if (json == null) return UserSummary(id: '', name: 'Guest');
    return UserSummary(
      id: json['_id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Guest',
      email: json['email']?.toString(),
      phone: json['phone']?.toString(),
    );
  }
}

class InspectionData {
  final List<String> photos;
  final String? frontPhoto;
  final String? backPhoto;
  final String? leftPhoto;
  final String? rightPhoto;
  final String? damageReport;
  final String? completedAt;
  final List<AdditionalPart> additionalParts;

  InspectionData({
    this.photos = const [],
    this.frontPhoto,
    this.backPhoto,
    this.leftPhoto,
    this.rightPhoto,
    this.damageReport,
    this.completedAt,
    this.additionalParts = const [],
  });

  factory InspectionData.fromJson(Map<String, dynamic>? json) {
    if (json == null) return InspectionData();
    return InspectionData(
      photos: (json['photos'] as List?)?.whereType<String>().toList() ?? [],
      frontPhoto: json['frontPhoto']?.toString(),
      backPhoto: json['backPhoto']?.toString(),
      leftPhoto: json['leftPhoto']?.toString(),
      rightPhoto: json['rightPhoto']?.toString(),
      damageReport: json['damageReport']?.toString(),
      completedAt: json['completedAt']?.toString(),
      additionalParts:
          (json['additionalParts'] as List?)
              ?.whereType<Map>()
              .map((p) => AdditionalPart.fromJson(Map<String, dynamic>.from(p)))
              .toList() ??
          [],
    );
  }
}

class AdditionalPart {
  final String name;
  final num price;
  final num quantity;
  final bool approved;
  final String? approvalStatus;
  final String? image;
  final String? oldImage;
  final bool? addedDuringService;
  final bool? fromInspection;
  final String? inspectionPartId;

  AdditionalPart({
    required this.name,
    required this.price,
    required this.quantity,
    required this.approved,
    this.approvalStatus,
    this.image,
    this.oldImage,
    this.addedDuringService,
    this.fromInspection,
    this.inspectionPartId,
  });

  factory AdditionalPart.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return AdditionalPart(name: '', price: 0, quantity: 0, approved: false);
    }
    return AdditionalPart(
      name: json['name']?.toString() ?? '',
      price: json['price'] is num ? (json['price'] as num) : 0,
      quantity: json['quantity'] is num ? (json['quantity'] as num) : 0,
      approved: json['approved'] as bool? ?? false,
      approvalStatus: json['approvalStatus']?.toString(),
      image: json['image']?.toString(),
      oldImage: json['oldImage']?.toString(),
      addedDuringService: json['addedDuringService'] as bool?,
      fromInspection: json['fromInspection'] as bool?,
      inspectionPartId: json['inspectionPartId']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'price': price,
      'quantity': quantity,
      'approved': approved,
      'approvalStatus': approvalStatus,
      'image': image,
      'oldImage': oldImage,
      'addedDuringService': addedDuringService,
      'fromInspection': fromInspection,
      'inspectionPartId': inspectionPartId,
    };
  }
}

class QCData {
  final bool testRide;
  final bool safetyChecks;
  final bool noLeaks;
  final bool noErrorLights;
  final String? completedAt;
  final String? notes;

  QCData({
    required this.testRide,
    required this.safetyChecks,
    required this.noLeaks,
    required this.noErrorLights,
    this.completedAt,
    this.notes,
  });

  QCData copyWith({
    bool? testRide,
    bool? safetyChecks,
    bool? noLeaks,
    bool? noErrorLights,
    String? completedAt,
    String? notes,
  }) {
    return QCData(
      testRide: testRide ?? this.testRide,
      safetyChecks: safetyChecks ?? this.safetyChecks,
      noLeaks: noLeaks ?? this.noLeaks,
      noErrorLights: noErrorLights ?? this.noErrorLights,
      completedAt: completedAt ?? this.completedAt,
      notes: notes ?? this.notes,
    );
  }

  factory QCData.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return QCData(
        testRide: false,
        safetyChecks: false,
        noLeaks: false,
        noErrorLights: false,
      );
    }
    return QCData(
      testRide: json['testRide'] as bool? ?? false,
      safetyChecks: json['safetyChecks'] as bool? ?? false,
      noLeaks: json['noLeaks'] as bool? ?? false,
      noErrorLights: json['noErrorLights'] as bool? ?? false,
      completedAt: json['completedAt']?.toString(),
      notes: json['notes']?.toString(),
    );
  }
}

class ServiceExecutionData {
  final String? jobStartTime;
  final String? jobEndTime;
  final List<String> beforePhotos;
  final List<String> duringPhotos;
  final List<String> afterPhotos;
  final String? notes;
  final List<AdditionalPart> serviceParts;

  ServiceExecutionData({
    this.jobStartTime,
    this.jobEndTime,
    this.beforePhotos = const [],
    this.duringPhotos = const [],
    this.afterPhotos = const [],
    this.notes,
    this.serviceParts = const [],
  });

  factory ServiceExecutionData.fromJson(Map<String, dynamic>? json) {
    if (json == null) return ServiceExecutionData();
    return ServiceExecutionData(
      jobStartTime: json['jobStartTime']?.toString(),
      jobEndTime: json['jobEndTime']?.toString(),
      beforePhotos:
          (json['beforePhotos'] as List?)?.whereType<String>().toList() ?? [],
      duringPhotos:
          (json['duringPhotos'] as List?)?.whereType<String>().toList() ?? [],
      afterPhotos:
          (json['afterPhotos'] as List?)?.whereType<String>().toList() ?? [],
      notes: json['notes']?.toString(),
      serviceParts:
          (json['serviceParts'] as List?)
              ?.whereType<Map>()
              .map((p) => AdditionalPart.fromJson(Map<String, dynamic>.from(p)))
              .toList() ??
          [],
    );
  }
}

class BillingData {
  final String? invoiceNumber;
  final String? invoiceDate;
  final String? fileUrl;
  final num labourCost;
  final num gst;
  final num partsTotal;
  final num pickupDropPrice;
  final num total;

  BillingData({
    this.invoiceNumber,
    this.invoiceDate,
    this.fileUrl,
    required this.labourCost,
    required this.gst,
    required this.partsTotal,
    required this.pickupDropPrice,
    required this.total,
  });

  factory BillingData.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return BillingData(
        labourCost: 0,
        gst: 0,
        partsTotal: 0,
        pickupDropPrice: 0,
        total: 0,
      );
    }
    return BillingData(
      invoiceNumber: json['invoiceNumber']?.toString(),
      invoiceDate: json['invoiceDate']?.toString(),
      fileUrl: json['fileUrl']?.toString(),
      labourCost: json['labourCost'] is num ? (json['labourCost'] as num) : 0,
      gst: json['gst'] is num ? (json['gst'] as num) : 0,
      partsTotal: json['partsTotal'] is num ? (json['partsTotal'] as num) : 0,
      pickupDropPrice: json['pickupDropPrice'] is num
          ? (json['pickupDropPrice'] as num)
          : 0,
      total: json['total'] is num ? (json['total'] as num) : 0,
    );
  }
}

class PartItem {
  final String? name;
  final num quantity;
  final num price;

  PartItem({this.name, required this.quantity, required this.price});

  factory PartItem.fromJson(Map<String, dynamic>? json) {
    if (json == null) return PartItem(quantity: 0, price: 0);
    return PartItem(
      name: json['name']?.toString(),
      quantity: json['quantity'] is num ? (json['quantity'] as num) : 0,
      price: json['price'] is num ? (json['price'] as num) : 0,
    );
  }
}

class BatteryTireData {
  final bool isBatteryTireService;
  final MerchantApprovalData? merchantApproval;
  final WarrantyData? warranty;

  BatteryTireData({
    required this.isBatteryTireService,
    this.merchantApproval,
    this.warranty,
  });

  factory BatteryTireData.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return BatteryTireData(isBatteryTireService: false);
    }
    return BatteryTireData(
      isBatteryTireService: json['isBatteryTireService'] == true,
      merchantApproval: json['merchantApproval'] is Map
          ? MerchantApprovalData.fromJson(
              Map<String, dynamic>.from(json['merchantApproval']),
            )
          : null,
      warranty: json['warranty'] is Map
          ? WarrantyData.fromJson(Map<String, dynamic>.from(json['warranty']))
          : null,
    );
  }
}

class MerchantApprovalData {
  final String status;
  final num? price;
  final String? image;
  final String? notes;
  final String? approvedAt;
  final String? rejectedAt;

  MerchantApprovalData({
    required this.status,
    this.price,
    this.image,
    this.notes,
    this.approvedAt,
    this.rejectedAt,
  });

  factory MerchantApprovalData.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return MerchantApprovalData(status: 'PENDING');
    }
    return MerchantApprovalData(
      status: json['status']?.toString() ?? 'PENDING',
      price: json['price'] is num ? (json['price'] as num) : null,
      image: json['image']?.toString(),
      notes: json['notes']?.toString(),
      approvedAt: json['approvedAt']?.toString(),
      rejectedAt: json['rejectedAt']?.toString(),
    );
  }
}

class WarrantyData {
  final String? name;
  final num? price;
  final int? warrantyMonths;
  final String? image;
  final String? addedAt;
  final dynamic addedBy;

  WarrantyData({
    this.name,
    this.price,
    this.warrantyMonths,
    this.image,
    this.addedAt,
    this.addedBy,
  });

  factory WarrantyData.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return WarrantyData();
    }
    return WarrantyData(
      name: json['name']?.toString(),
      price: json['price'] is num ? (json['price'] as num) : null,
      warrantyMonths: json['warrantyMonths'] is num
          ? (json['warrantyMonths'] as num).toInt()
          : null,
      image: json['image']?.toString(),
      addedAt: json['addedAt']?.toString(),
      addedBy: json['addedBy'],
    );
  }
}

class RevisitData {
  final bool isRevisit;
  final String? originalBookingId;
  final String? reason;

  RevisitData({this.isRevisit = false, this.originalBookingId, this.reason});

  factory RevisitData.fromJson(Map<String, dynamic>? json) {
    if (json == null) return RevisitData();
    return RevisitData(
      isRevisit: json['isRevisit'] == true,
      originalBookingId: json['originalBookingId']?.toString(),
      reason: json['reason']?.toString(),
    );
  }
}

String? _nonEmpty(dynamic v) {
  final t = v?.toString().trim();
  return t == null || t.isEmpty ? null : t;
}
