import '../../core/api_client.dart';
import '../../core/env.dart';

class ReviewVehicleInfo {
  final String? make;
  final String? model;
  final String? licensePlate;

  const ReviewVehicleInfo({this.make, this.model, this.licensePlate});

  factory ReviewVehicleInfo.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const ReviewVehicleInfo();
    return ReviewVehicleInfo(
      make: json['make']?.toString(),
      model: json['model']?.toString(),
      licensePlate: json['licensePlate']?.toString(),
    );
  }
}

class Review {
  final String id;
  final String? bookingId;
  final String? reviewerName;
  final String? merchantId;
  final int rating;
  final String comment;
  final String? createdAt;
  final ReviewVehicleInfo? vehicle;
  final List<String> serviceNames;

  Review({
    required this.id,
    this.bookingId,
    this.reviewerName,
    this.merchantId,
    required this.rating,
    required this.comment,
    this.createdAt,
    this.vehicle,
    this.serviceNames = const [],
  });

  factory Review.fromJson(Map<String, dynamic> json) {
    final reviewer = json['reviewer'];
    String? reviewerName;
    if (reviewer is Map) {
      reviewerName = reviewer['name']?.toString();
    } else if (reviewer != null) {
      reviewerName = reviewer.toString();
    }

    final user = json['user'];
    if (reviewerName == null || reviewerName.isEmpty) {
      if (user is Map) {
        reviewerName = user['name']?.toString();
      } else if (user != null) {
        reviewerName = user.toString();
      }
    }

    ReviewVehicleInfo? vehicle;
    final List<String> serviceNames = [];
    final booking = json['booking'];
    if (booking is Map) {
      final bookingMap = booking is Map<String, dynamic>
          ? booking
          : Map<String, dynamic>.from(booking);
      final vehicleJson = bookingMap['vehicle'];
      if (vehicleJson is Map) {
        vehicle = ReviewVehicleInfo.fromJson(
          vehicleJson is Map<String, dynamic>
              ? vehicleJson
              : Map<String, dynamic>.from(vehicleJson),
        );
      }
      final services = bookingMap['services'];
      if (services is List) {
        for (final s in services) {
          if (s is Map) {
            final name = s['name']?.toString();
            if (name != null && name.isNotEmpty) serviceNames.add(name);
          }
        }
      }
    }

    return Review(
      id: json['_id']?.toString() ?? '',
      bookingId: json['booking'] is Map
          ? (json['booking']['_id'] ?? json['booking']['id'])?.toString()
          : json['booking']?.toString(),
      reviewerName: reviewerName,
      merchantId: json['merchant']?.toString(),
      rating: (json['rating'] as num?)?.toInt() ?? 0,
      comment: json['comment']?.toString() ?? '',
      createdAt: json['createdAt']?.toString(),
      vehicle: vehicle,
      serviceNames: serviceNames,
    );
  }
}

class ReviewService {
  final ApiClient _api = ApiClient();

  Future<List<Review>> getMerchantReviews(String merchantId) async {
    final response = await _api.getAny(
      '${ApiEndpoints.reviews}/target/$merchantId',
    );
    if (response is List) {
      return response.map((json) => Review.fromJson(json)).toList();
    }
    return [];
  }
}
