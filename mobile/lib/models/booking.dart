import 'service.dart';
import 'vehicle.dart';

class BookingLocation {
  final String? address;
  final double? lat;
  final double? lng;

  const BookingLocation({this.address, this.lat, this.lng});

  factory BookingLocation.fromJson(Map<String, dynamic> json) {
    final latRaw = json['lat'];
    final lngRaw = json['lng'];
    final addressStr = json['address']?.toString().trim();
    return BookingLocation(
      address: (addressStr == null || addressStr.isEmpty) ? null : addressStr,
      lat: latRaw is num ? latRaw.toDouble() : null,
      lng: lngRaw is num ? lngRaw.toDouble() : null,
    );
  }

  Map<String, dynamic> toJson() => {
    if (address != null && address!.trim().isNotEmpty)
      'address': address!.trim(),
    if (lat != null) 'lat': lat,
    if (lng != null) 'lng': lng,
  };
}

class DeliveryOtp {
  final String code;
  final String? expiresAt;
  final bool verified;

  const DeliveryOtp({
    required this.code,
    this.expiresAt,
    required this.verified,
  });

  factory DeliveryOtp.fromJson(Map<String, dynamic> json) {
    final rawCode = (json['code'] ?? '').toString();
    final rawExpires = (json['expiresAt'] ?? '').toString();
    return DeliveryOtp(
      code: rawCode,
      expiresAt: rawExpires.trim().isEmpty ? null : rawExpires,
      verified: json['verified'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'code': code,
      if (expiresAt != null) 'expiresAt': expiresAt,
      'verified': verified,
    };
  }
}

class CarWashDetails {
  final bool isCarWashService;
  final List<String> beforeWashPhotos;
  final List<String> afterWashPhotos;
  final String? washStartedAt;
  final String? washCompletedAt;
  final String? staffName;
  final String? staffPhone;

  const CarWashDetails({
    this.isCarWashService = false,
    this.beforeWashPhotos = const [],
    this.afterWashPhotos = const [],
    this.washStartedAt,
    this.washCompletedAt,
    this.staffName,
    this.staffPhone,
  });

  factory CarWashDetails.fromJson(Map<String, dynamic> json) {
    final staff = json['staffAssigned'];
    return CarWashDetails(
      isCarWashService: json['isCarWashService'] == true,
      beforeWashPhotos: (json['beforeWashPhotos'] as List? ?? [])
          .map((e) => e.toString())
          .toList(),
      afterWashPhotos: (json['afterWashPhotos'] as List? ?? [])
          .map((e) => e.toString())
          .toList(),
      washStartedAt: json['washStartedAt']?.toString(),
      washCompletedAt: json['washCompletedAt']?.toString(),
      staffName: staff is Map ? staff['name']?.toString() : null,
      staffPhone: staff is Map ? staff['phone']?.toString() : null,
    );
  }
}

class BatteryTireDetails {
  final bool isBatteryTireService;
  final String? merchantApprovalStatus;
  final num? merchantPrice;
  final String? merchantImage;
  final String? merchantNotes;
  final String? warrantyName;
  final num? warrantyPrice;
  final int? warrantyMonths;
  final String? warrantyImage;

  const BatteryTireDetails({
    this.isBatteryTireService = false,
    this.merchantApprovalStatus,
    this.merchantPrice,
    this.merchantImage,
    this.merchantNotes,
    this.warrantyName,
    this.warrantyPrice,
    this.warrantyMonths,
    this.warrantyImage,
  });

  factory BatteryTireDetails.fromJson(Map<String, dynamic> json) {
    final approval = json['merchantApproval'];
    final warranty = json['warranty'];
    return BatteryTireDetails(
      isBatteryTireService: json['isBatteryTireService'] == true,
      merchantApprovalStatus: approval is Map
          ? approval['status']?.toString()
          : null,
      merchantPrice: approval is Map ? approval['price'] as num? : null,
      merchantImage: approval is Map ? approval['image']?.toString() : null,
      merchantNotes: approval is Map ? approval['notes']?.toString() : null,
      warrantyName: warranty is Map ? warranty['name']?.toString() : null,
      warrantyPrice: warranty is Map ? warranty['price'] as num? : null,
      warrantyMonths: warranty is Map
          ? warranty['warrantyMonths'] as int?
          : null,
      warrantyImage: warranty is Map ? warranty['image']?.toString() : null,
    );
  }
}

class ServicePart {
  final String name;
  final num price;
  final int quantity;
  final String? approvalStatus;
  final bool approved;
  final String? image;
  final String? oldImage;
  final bool fromInspection;

  ServicePart({
    required this.name,
    required this.price,
    required this.quantity,
    this.approvalStatus,
    this.approved = false,
    this.image,
    this.oldImage,
    this.fromInspection = false,
  });

  factory ServicePart.fromJson(Map<String, dynamic> json) {
    return ServicePart(
      name: (json['name'] ?? '').toString(),
      price: json['price'] is num ? (json['price'] as num) : 0,
      quantity: json['quantity'] is num ? (json['quantity'] as num).toInt() : 1,
      approvalStatus: json['approvalStatus']?.toString(),
      approved: json['approved'] == true,
      image: json['image']?.toString(),
      oldImage: json['oldImage']?.toString(),
      fromInspection: json['fromInspection'] == true,
    );
  }
}

class InspectionDetails {
  final String? frontPhoto;
  final String? backPhoto;
  final String? leftPhoto;
  final String? rightPhoto;
  final String? damageReport;
  final List<String> photos;

  InspectionDetails({
    this.frontPhoto,
    this.backPhoto,
    this.leftPhoto,
    this.rightPhoto,
    this.damageReport,
    this.photos = const [],
  });

  factory InspectionDetails.fromJson(Map<String, dynamic> json) {
    return InspectionDetails(
      frontPhoto: json['frontPhoto']?.toString(),
      backPhoto: json['backPhoto']?.toString(),
      leftPhoto: json['leftPhoto']?.toString(),
      rightPhoto: json['rightPhoto']?.toString(),
      damageReport: json['damageReport']?.toString(),
      photos: (json['photos'] as List? ?? []).map((e) => e.toString()).toList(),
    );
  }
}

class DelayDetails {
  final bool isDelayed;
  final String? reason;
  final String? note;
  final String? startTime;

  const DelayDetails({
    this.isDelayed = false,
    this.reason,
    this.note,
    this.startTime,
  });

  factory DelayDetails.fromJson(Map<String, dynamic> json) {
    return DelayDetails(
      isDelayed: json['isDelayed'] == true,
      reason: json['reason']?.toString(),
      note: json['note']?.toString(),
      startTime: json['startTime']?.toString(),
    );
  }
}

class RevisitDetails {
  final bool isRevisit;
  final String? originalBookingId;
  final String? reason;

  const RevisitDetails({
    this.isRevisit = false,
    this.originalBookingId,
    this.reason,
  });

  factory RevisitDetails.fromJson(Map<String, dynamic> json) {
    return RevisitDetails(
      isRevisit: json['isRevisit'] == true,
      originalBookingId: json['originalBookingId']?.toString(),
      reason: json['reason']?.toString(),
    );
  }
}

class BookingBilling {
  final String? invoiceNumber;
  final String? invoiceDate;
  final String? fileUrl;
  final num total;
  final num? partsTotal;
  final num? labourCost;
  final num? gst;
  final num? pickupDropPrice;
  final num? discount;

  const BookingBilling({
    this.invoiceNumber,
    this.invoiceDate,
    this.fileUrl,
    required this.total,
    this.partsTotal,
    this.labourCost,
    this.gst,
    this.pickupDropPrice,
    this.discount,
  });

  factory BookingBilling.fromJson(Map<String, dynamic> json) {
    return BookingBilling(
      invoiceNumber: json['invoiceNumber']?.toString(),
      invoiceDate: json['invoiceDate']?.toString(),
      fileUrl: json['fileUrl']?.toString(),
      total: json['total'] is num ? (json['total'] as num) : 0,
      partsTotal: json['partsTotal'] is num ? (json['partsTotal'] as num) : 0,
      labourCost: json['labourCost'] is num ? (json['labourCost'] as num) : 0,
      gst: json['gst'] is num ? (json['gst'] as num) : 0,
      pickupDropPrice: json['pickupDropPrice'] is num
          ? (json['pickupDropPrice'] as num)
          : 0,
      discount: json['discount'] is num ? (json['discount'] as num) : 0,
    );
  }

  Map<String, dynamic> toJson() => {
    if (invoiceNumber != null) 'invoiceNumber': invoiceNumber,
    if (invoiceDate != null) 'invoiceDate': invoiceDate,
    if (fileUrl != null) 'fileUrl': fileUrl,
    'total': total,
    if (partsTotal != null) 'partsTotal': partsTotal,
    if (labourCost != null) 'labourCost': labourCost,
    if (gst != null) 'gst': gst,
    if (discount != null) 'discount': discount,
  };
}

String? _orderNumberFromJson(dynamic value) {
  if (value == null) return null;
  final s = value.toString().trim();
  return s.isEmpty ? null : s;
}

class Booking {
  final String id;
  final String? orderNumber;
  final String status;
  final String date;
  final num totalAmount;
  final num? finalAmount;
  final num? gstAmount;
  final num? discountAmount;
  final String? couponCode;
  final Vehicle? vehicle;
  final List<ServiceItem> services;
  final BookingLocation? location;
  final String? notes;
  final String? paymentStatus;
  final String? createdAt;
  final BookingLocation? merchantLocation;
  final String? merchantName;
  final String? merchantPhone;
  final Map<String, dynamic>? merchant;
  final DeliveryOtp? deliveryOtp;
  final List<String> prePickupPhotos;
  final List<String> beforeServicePhotos;
  final List<String> duringServicePhotos;
  final List<String> postServicePhotos;
  final List<ServicePart> serviceParts;
  final String? invoiceUrl;
  final String? driverName;
  final String? driverPhone;
  final String? technicianName;
  final String? technicianPhone;
  final bool pickupRequired;
  final String? inspectionCompletedAt;
  final String? qcCompletedAt;
  final String? assignedAt;
  final CarWashDetails? carWash;
  final BatteryTireDetails? batteryTire;
  final InspectionDetails? inspection;
  final DelayDetails? delay;
  final RevisitDetails? revisit;
  final List<Map<String, String>> statusHistory;
  final BookingBilling? billing;
  final num? pickupDropPrice;
  /// Merchant-set base service price; null = catalogue price.
  final num? baseServiceAmountOverride;

  Booking({
    required this.id,
    this.orderNumber,
    required this.status,
    required this.date,
    required this.totalAmount,
    this.finalAmount,
    this.gstAmount,
    this.discountAmount,
    this.couponCode,
    required this.vehicle,
    required this.services,
    required this.location,
    required this.notes,
    required this.paymentStatus,
    required this.createdAt,
    this.merchantLocation,
    this.merchantName,
    this.merchantPhone,
    this.merchant,
    this.deliveryOtp,
    this.prePickupPhotos = const [],
    this.beforeServicePhotos = const [],
    this.duringServicePhotos = const [],
    this.postServicePhotos = const [],
    this.serviceParts = const [],
    this.invoiceUrl,
    this.driverName,
    this.driverPhone,
    this.technicianName,
    this.technicianPhone,
    this.pickupRequired = true,
    this.inspectionCompletedAt,
    this.qcCompletedAt,
    this.assignedAt,
    this.carWash,
    this.batteryTire,
    this.inspection,
    this.delay,
    this.revisit,
    this.statusHistory = const [],
    this.billing,
    this.pickupDropPrice,
    this.baseServiceAmountOverride,
  });

  num get calculatedTotal {
    if (finalAmount != null && finalAmount! > 0) {
      return finalAmount!;
    }
    num base = totalAmount;
    if (billing != null && billing!.total > 0) {
      base = billing!.total;
    }
    final disc = discountAmount ?? 0;
    final gst = gstAmount ?? billing?.gst ?? 0;
    return base - disc + gst;
  }

  num get baseServiceTotal {
    num total = 0;
    for (final s in services) {
      total += s.price;
    }
    return total;
  }

  num get partsAndOtherTotal {
    num total = 0;
    for (final p in serviceParts) {
      if (p.approved || p.fromInspection) {
        total += (p.price * p.quantity);
      }
    }
    if (batteryTire?.warrantyPrice != null) {
      total += batteryTire!.warrantyPrice!;
    }
    return total > 0 ? total : totalAmount;
  }

  static const statusLabels = {
    'CREATED': 'Booked',
    'ASSIGNED': 'Assigned',
    'ACCEPTED': 'Accepted',
    'REACHED_CUSTOMER': 'Reached Customer',
    'VEHICLE_PICKED': 'Vehicle Picked',
    'REACHED_MERCHANT': 'Reached Merchant',
    'VEHICLE_AT_MERCHANT': 'At Garage',
    'SERVICE_STARTED': 'Servicing',
    'SERVICE_COMPLETED': ' Service is completed.',
    'OUT_FOR_DELIVERY': 'Out for Delivery',
    'DELIVERED': 'Delivered',
    'COMPLETED': 'Service Completed',
    'CANCELLED': 'Cancelled',
    'MERCHANT_INSPECTION': 'Inspecting',
    'PENDING_APPROVAL': 'Waiting for Approval',
    // Car wash specific statuses
    'CAR_WASH_STARTED': 'Car Wash Started',
    'CAR_WASH_COMPLETED': 'Car Wash Completed',
    // Battery and Tire specific statuses
    'STAFF_REACHED_MERCHANT': 'Staff Reached Merchant',
    'PICKUP_BATTERY_TIRE': 'Pickup Battery/Tire',
    'INSTALLATION': 'Installation',
    'DELIVERY': 'Delivery',
  };

  static const pickupFlowOrder = [
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

  static const carWashFlowOrder = [
    'CREATED',
    'ASSIGNED',
    'REACHED_CUSTOMER',
    'CAR_WASH_STARTED',
    'CAR_WASH_COMPLETED',
    'DELIVERED',
  ];

  static const batteryTireFlowOrder = [
    'CREATED',
    'ASSIGNED',
    'STAFF_REACHED_MERCHANT',
    'PICKUP_BATTERY_TIRE',
    'REACHED_CUSTOMER',
    'INSTALLATION',
    'DELIVERY',
    'COMPLETED',
  ];

  static const noPickupFlowOrder = [
    'CREATED',
    'ASSIGNED',
    'ACCEPTED',
    'MERCHANT_INSPECTION',
    'PENDING_APPROVAL',
    'SERVICE_STARTED',
    'SERVICE_COMPLETED',
    'DELIVERED',
  ];

  static String getStatusLabel(String status, [List<dynamic>? services]) {
    if (services != null &&
        services.any((s) {
          final cat = (s.category ?? '').toString().toLowerCase();
          return cat.contains('essentials');
        })) {
      if (status == 'CAR_WASH_STARTED') return 'Service Started';
      if (status == 'CAR_WASH_COMPLETED') return 'Service Completed';
    }
    return statusLabels[status.toUpperCase()] ?? status;
  }

  static List<String> getFlowForBooking(Booking? booking) {
    if (booking == null || booking.services.isEmpty) {
      return pickupFlowOrder;
    }

    final services = booking.services;

    // Check if it's a car wash or essentials service
    final isCarWash = services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('car wash') ||
          cat.contains('wash') ||
          cat.contains('essentials');
    });

    // Check if it's a battery or tire service
    final isBatteryOrTire = services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('battery') ||
          cat.contains('tire') ||
          cat.contains('tyre');
    });

    if (isCarWash) {
      return carWashFlowOrder;
    } else if (isBatteryOrTire) {
      return batteryTireFlowOrder;
    } else {
      // Determine if it's a pickup service based on category
      const pickupCategories = [
        'Services',
        'Periodic',
        'Repair',
        'Painting',
        'Denting',
        'AC',
        'Detailing',
      ];
      const noPickupCategories = [
        'Insurance',
        'Essentials',
        'Accessories',
        'Other',
      ];

      final hasPickupService = services.any(
        (s) => pickupCategories.contains(s.category),
      );
      final hasNoPickupService = services.any(
        (s) => noPickupCategories.contains(s.category),
      );

      if (hasNoPickupService && !hasPickupService) {
        return noPickupFlowOrder;
      }

      return pickupFlowOrder;
    }
  }

  /// Last step before DELIVERED, or before COMPLETED when the flow has no DELIVERED.
  static String? preTerminalDeliveryStatus(List<String> flow) {
    final deliveredIdx = flow.indexOf('DELIVERED');
    if (deliveredIdx > 0) return flow[deliveredIdx - 1];
    final completedIdx = flow.indexOf('COMPLETED');
    if (completedIdx > 0) return flow[completedIdx - 1];
    return null;
  }

  /// Matches web `canCustomerSeeDeliveryOtp` — OTP visible on pre-delivery step only.
  bool get canCustomerSeeDeliveryOtp {
    final pre = preTerminalDeliveryStatus(getFlowForBooking(this));
    if (pre == null) return false;
    return status.toUpperCase() == pre.toUpperCase();
  }

  bool get shouldShowCustomerDeliveryOtp {
    final code = deliveryOtp?.code.trim();
    if (code == null || code.isEmpty) return false;
    return canCustomerSeeDeliveryOtp;
  }

  /// Periodic / general workshop (not car wash, not battery/tire).
  bool get isGeneralWorkshopService {
    if (batteryTire?.isBatteryTireService == true) return false;
    if (carWash?.isCarWashService == true) return false;
    final isCarWash = services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('car wash') ||
          cat.contains('wash') ||
          cat.contains('essentials');
    });
    if (isCarWash) return false;
    final isBatteryOrTire = services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('battery') ||
          cat.contains('tyre') ||
          cat.contains('tire');
    });
    if (isBatteryOrTire) return false;
    return services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      final name = s.name.toLowerCase();
      return cat == 'periodic' ||
          cat == 'services' ||
          name.contains('general service');
    });
  }

  /// Battery / tire bookings (dedicated flag or by service category).
  bool get isBatteryTireBooking {
    if (batteryTire?.isBatteryTireService == true) return true;
    return services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('battery') || cat.contains('tyre') || cat.contains('tire');
    });
  }

  /// Tire-specific bookings (by service category).
  bool get isTireBooking {
    return services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('tyre') || cat.contains('tire');
    });
  }

  /// Battery-specific bookings (by service category).
  bool get isBatteryBooking {
    return services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('battery');
    });
  }

  /// Track page app bar: general → after DELIVERED; others → after payment.
  ///
  /// [invoiceSettings] is the admin-configurable per-category toggle from
  /// `BookingService.getInvoiceSettings()` (keys: general, carWash, tyres,
  /// battery). Pass null while it hasn't loaded yet — this falls back to
  /// the pre-toggle defaults (general/tyres/battery blocked, everything
  /// else allowed) rather than assuming a category is enabled.
  bool get isEssentialsBooking {
    return services.any((s) {
      final cat = (s.category ?? '').toLowerCase();
      return cat.contains('essentials');
    });
  }

  bool canShowInvoiceDownload([Map<String, dynamic>? invoiceSettings]) {
    bool flag(String key, bool fallback) {
      final v = invoiceSettings?[key];
      return v is bool ? v : fallback;
    }

    if (isTireBooking) return flag('tyres', false);
    if (isBatteryBooking) return flag('battery', false);
    if (isEssentialsBooking) {
      return (paymentStatus ?? '').toLowerCase() == 'paid';
    }

    // For every other category, the invoice must actually have been
    // generated (invoiceUrl present) before the download icon appears —
    // payment/delivery status alone isn't enough.
    final hasInvoice = invoiceUrl != null && invoiceUrl!.trim().isNotEmpty;
    if (!hasInvoice) return false;

    final st = status.toUpperCase();
    if (isGeneralWorkshopService) {
      return st == 'DELIVERED' && flag('general', true);
    }
    if (carWash?.isCarWashService == true) {
      return (paymentStatus ?? '').toLowerCase() == 'paid' && flag('carWash', true);
    }
    return (paymentStatus ?? '').toLowerCase() == 'paid';
  }

  factory Booking.fromJson(Map<String, dynamic>? map) {
    if (map == null) {
      throw ArgumentError('Booking.fromJson: map must be a non-null Map');
    }
    Vehicle? vehicle;
    final v = map['vehicle'];
    if (v is Map) {
      try {
        final vehicleMap = v is Map<String, dynamic>
            ? v
            : Map<String, dynamic>.from(v);
        vehicle = Vehicle.fromJson(vehicleMap);
      } catch (_) {}
    }

    final services = <ServiceItem>[];
    final s = map['services'];
    if (s is List) {
      for (final e in s) {
        if (e is Map) {
          try {
            final serviceMap = e is Map<String, dynamic>
                ? e
                : Map<String, dynamic>.from(e);
            services.add(ServiceItem.fromJson(serviceMap));
          } catch (_) {}
        }
      }
    }

    BookingLocation? location;
    final loc = map['location'];
    if (loc is Map) {
      try {
        final locMap = loc is Map<String, dynamic>
            ? loc
            : Map<String, dynamic>.from(loc);
        location = BookingLocation.fromJson(locMap);
      } catch (_) {}
    }

    BookingLocation? merchantLocation;
    String? merchantName;
    String? merchantPhone;
    Map<String, dynamic>? merchant;
    final m = map['merchant'];
    if (m is Map) {
      try {
        final mm = m is Map<String, dynamic> ? m : Map<String, dynamic>.from(m);
        merchant = mm;
        final mLoc = mm['location'];
        if (mLoc is Map) {
          try {
            final merchantLocMap = mLoc is Map<String, dynamic>
                ? mLoc
                : Map<String, dynamic>.from(mLoc);
            merchantLocation = BookingLocation.fromJson(merchantLocMap);
          } catch (_) {}
        }
        final nameRaw = mm['name'];
        final phoneRaw = mm['phone'];
        final nameStr = nameRaw?.toString().trim();
        final phoneStr = phoneRaw?.toString().trim();
        merchantName = nameStr != null && nameStr.isNotEmpty ? nameStr : null;
        merchantPhone = phoneStr != null && phoneStr.isNotEmpty
            ? phoneStr
            : null;
      } catch (_) {}
    } else if (m is String && m.isNotEmpty) {
      merchant = {'_id': m};
    }

    DeliveryOtp? deliveryOtp;
    final d = map['deliveryOtp'];
    if (d is Map) {
      try {
        final dMap = d is Map<String, dynamic>
            ? d
            : Map<String, dynamic>.from(d);
        deliveryOtp = DeliveryOtp.fromJson(dMap);
      } catch (_) {}
    }

    final prePickupPhotos = <String>[];
    if (map['prePickupPhotos'] is List) {
      for (final p in map['prePickupPhotos']) {
        if (p != null) prePickupPhotos.add(p.toString());
      }
    }

    final beforeServicePhotos = <String>[];
    final duringServicePhotos = <String>[];
    final postServicePhotos = <String>[];
    final serviceParts = <ServicePart>[];

    final inspectionMap = map['inspection'];
    InspectionDetails? inspection;
    if (inspectionMap is Map) {
      inspection = InspectionDetails.fromJson(
        Map<String, dynamic>.from(inspectionMap),
      );
      final inspPhotos = inspectionMap['photos'];
      if (inspPhotos is List) {
        for (final p in inspPhotos) {
          if (p != null && !prePickupPhotos.contains(p.toString())) {
            prePickupPhotos.add(p.toString());
          }
        }
      }
    }

    final execution = map['serviceExecution'];
    if (execution is Map) {
      final beforePhotos = execution['beforePhotos'];
      if (beforePhotos is List) {
        for (final p in beforePhotos) {
          if (p != null) beforeServicePhotos.add(p.toString());
        }
      }
      final duringPhotos = execution['duringPhotos'];
      if (duringPhotos is List) {
        for (final p in duringPhotos) {
          if (p != null) duringServicePhotos.add(p.toString());
        }
      }
      final afterPhotos = execution['afterPhotos'];
      if (afterPhotos is List) {
        for (final p in afterPhotos) {
          if (p != null) postServicePhotos.add(p.toString());
        }
      }
      final parts = execution['serviceParts'];
      if (parts is List) {
        for (final p in parts) {
          if (p is Map) {
            serviceParts.add(
              ServicePart.fromJson(Map<String, dynamic>.from(p)),
            );
          }
        }
      }
    }

    BookingBilling? billing;
    final b = map['billing'];
    if (b is Map) {
      try {
        final bMap = b is Map<String, dynamic>
            ? b
            : Map<String, dynamic>.from(b);
        billing = BookingBilling.fromJson(bMap);
      } catch (_) {}
    }
    // Aggressive search for invoice/document URL
    String? invoiceUrl;

    // 1. Check billing object
    if (b is Map) {
      invoiceUrl =
          (b['fileUrl'] ??
                  b['invoiceUrl'] ??
                  b['invoice'] ??
                  b['invoicePath'] ??
                  b['pdfUrl'] ??
                  b['receiptUrl'] ??
                  b['file'] ??
                  b['invoiceFile'])
              ?.toString();
    }

    // 2. Check top level map
    invoiceUrl ??=
        (map['invoiceUrl'] ??
                map['invoice'] ??
                map['invoice_url'] ??
                map['invoicePath'] ??
                map['pdfUrl'] ??
                map['receiptUrl'] ??
                map['invoiceFile'])
            ?.toString();

    // 3. Check for a list of invoices
    final invoices = map['invoices'];
    if (invoiceUrl == null && invoices is List && invoices.isNotEmpty) {
      final first = invoices.first;
      if (first is Map) {
        invoiceUrl = (first['fileUrl'] ?? first['url'] ?? first['path'])
            ?.toString();
      } else {
        invoiceUrl = first.toString();
      }
    }

    // 4. Check nested objects
    invoiceUrl ??= (map['payment'] is Map
        ? map['payment']['invoiceUrl']?.toString()
        : null);
    invoiceUrl ??= (map['carWash'] is Map
        ? (map['carWash']['fileUrl'] ?? map['carWash']['invoiceUrl'])
              ?.toString()
        : null);
    invoiceUrl ??= (map['batteryTire'] is Map
        ? (map['batteryTire']['fileUrl'] ?? map['batteryTire']['invoiceUrl'])
              ?.toString()
        : null);
    invoiceUrl ??= (map['essentials'] is Map
        ? (map['essentials']['fileUrl'] ??
                  map['essentials']['invoiceUrl'] ??
                  map['essentials']['invoice'])
              ?.toString()
        : null);
    invoiceUrl ??= (map['insurance'] is Map
        ? (map['insurance']['fileUrl'] ??
                  map['insurance']['invoiceUrl'] ??
                  map['insurance']['invoice'])
              ?.toString()
        : null);

    // 5. Final desperate fallback: scan all top-level keys for something that looks like an invoice URL
    if (invoiceUrl == null) {
      map.forEach((key, value) {
        if (invoiceUrl == null && value != null) {
          final k = key.toString().toLowerCase();
          final v = value.toString();
          if (k.contains('invoice') &&
              (v.startsWith('http') ||
                  v.contains('.pdf') ||
                  v.contains('storage') ||
                  v.startsWith('/'))) {
            invoiceUrl = v;
          }
        }
      });
    }

    final inspectionObj = map['inspection'];
    final inspectionCompletedAt = inspectionObj is Map
        ? inspectionObj['completedAt']?.toString()
        : null;

    final qcObj = map['qc'];
    final qcCompletedAt = qcObj is Map
        ? qcObj['completedAt']?.toString()
        : null;

    String? driverName;
    String? driverPhone;
    final driver = map['pickupDriver'];
    if (driver is Map) {
      driverName = driver['name']?.toString();
      driverPhone = driver['phone']?.toString();
    }

    String? technicianName;
    String? technicianPhone;
    final tech = map['technician'];
    if (tech is Map) {
      technicianName = tech['name']?.toString();
      technicianPhone = tech['phone']?.toString();
    }

    final carWash = map['carWash'] is Map
        ? CarWashDetails.fromJson(Map<String, dynamic>.from(map['carWash']))
        : null;
    final batteryTire = map['batteryTire'] is Map
        ? BatteryTireDetails.fromJson(
            Map<String, dynamic>.from(map['batteryTire']),
          )
        : null;

    final delay = map['delay'] is Map
        ? DelayDetails.fromJson(Map<String, dynamic>.from(map['delay']))
        : null;
    final revisit = map['revisit'] is Map
        ? RevisitDetails.fromJson(Map<String, dynamic>.from(map['revisit']))
        : null;

    final statusHistory = (map['statusHistory'] as List? ?? [])
        .map((e) => Map<String, String>.from(e as Map))
        .toList();

    return Booking(
      id: (map['_id'] ?? '').toString(),
      orderNumber: _orderNumberFromJson(map['orderNumber']),
      status: (map['status'] ?? 'PENDING').toString(),
      date: (map['date'] ?? '').toString(),
      totalAmount: map['totalAmount'] is num ? (map['totalAmount'] as num) : 0,
      finalAmount: map['finalAmount'] is num ? (map['finalAmount'] as num) : null,
      gstAmount: map['gstAmount'] is num ? (map['gstAmount'] as num) : null,
      discountAmount: map['discountAmount'] is num
          ? (map['discountAmount'] as num)
          : null,
      couponCode:
          map['couponCode']?.toString() ??
          (map['coupon'] is Map ? map['coupon']['code']?.toString() : null),
      vehicle: vehicle,
      services: services,
      location: location,
      notes: map['notes']?.toString(),
      paymentStatus: (map['paymentStatus'] ?? 'PENDING').toString(),
      createdAt: map['createdAt']?.toString(),
      merchantLocation: merchantLocation,
      merchantName: merchantName,
      merchantPhone: merchantPhone,
      merchant: merchant,
      deliveryOtp: deliveryOtp,
      prePickupPhotos: prePickupPhotos,
      beforeServicePhotos: beforeServicePhotos,
      duringServicePhotos: duringServicePhotos,
      postServicePhotos: postServicePhotos,
      serviceParts: serviceParts,
      invoiceUrl: invoiceUrl,
      driverName: driverName,
      driverPhone: driverPhone,
      technicianName: technicianName,
      technicianPhone: technicianPhone,
      pickupRequired: map['pickupRequired'] != false,
      inspectionCompletedAt: inspectionCompletedAt,
      qcCompletedAt: qcCompletedAt,
      assignedAt: map['assignedAt']?.toString(),
      carWash: carWash,
      batteryTire: batteryTire,
      inspection: inspection,
      delay: delay,
      revisit: revisit,
      statusHistory: statusHistory,
      billing: billing,
      pickupDropPrice: map['pickupDropPrice'] is num
          ? (map['pickupDropPrice'] as num)
          : null,
      baseServiceAmountOverride: map['baseServiceAmountOverride'] is num
          ? (map['baseServiceAmountOverride'] as num)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'id': id,
      if (orderNumber != null) 'orderNumber': orderNumber,
      'status': status,
      'date': date,
      'totalAmount': totalAmount,
      if (vehicle != null) 'vehicle': vehicle!.toJson(),
      'services': services.map((s) => s.toJson()).toList(),
      if (location != null) 'location': location!.toJson(),
      if (notes != null) 'notes': notes,
      if (paymentStatus != null) 'paymentStatus': paymentStatus,
      if (createdAt != null) 'createdAt': createdAt,
    };

    final merchant = <String, dynamic>{};
    if (merchantLocation != null) {
      final loc = merchantLocation!.toJson();
      if (loc.isNotEmpty) {
        merchant['location'] = loc;
      }
    }
    if (merchantName != null && merchantName!.trim().isNotEmpty) {
      merchant['name'] = merchantName;
    }
    if (merchantPhone != null && merchantPhone!.trim().isNotEmpty) {
      merchant['phone'] = merchantPhone;
    }
    if (merchant.isNotEmpty) {
      map['merchant'] = merchant;
    }

    if (deliveryOtp != null) {
      map['deliveryOtp'] = deliveryOtp!.toJson();
    }

    return map;
  }
}
