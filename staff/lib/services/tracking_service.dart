import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../core/api_client.dart';
import '../core/env.dart';
import '../core/storage.dart';

class TrackingInfo {
  final double? lat;
  final double? lng;
  final DateTime? lastUpdate;
  final DateTime? lastServerSync;

  const TrackingInfo({
    this.lat,
    this.lng,
    this.lastUpdate,
    this.lastServerSync,
  });

  TrackingInfo copyWith({
    double? lat,
    double? lng,
    DateTime? lastUpdate,
    DateTime? lastServerSync,
  }) {
    return TrackingInfo(
      lat: lat ?? this.lat,
      lng: lng ?? this.lng,
      lastUpdate: lastUpdate ?? this.lastUpdate,
      lastServerSync: lastServerSync ?? this.lastServerSync,
    );
  }
}

class StaffTrackingService {
  StaffTrackingService._internal();

  static final StaffTrackingService instance = StaffTrackingService._internal();

  static const double autoStatusDistanceMeters = 100;

  final ApiClient _api = ApiClient();
  final ValueNotifier<TrackingInfo> info = ValueNotifier<TrackingInfo>(
    const TrackingInfo(),
  );

  io.Socket? _socket;
  StreamSubscription<Position>? _positionSub;
  bool _isTracking = false;
  String? _activeBookingId;
  int _lastSocketMs = 0;
  int _lastRestMs = 0;
  double? _targetLat;
  double? _targetLng;
  String? _targetForStatus;

  Timer? _heartbeatTimer;

  bool get isTracking => _isTracking;

  String? get activeBookingId => _activeBookingId;

  Future<void> setActiveBookingId(String? id) async {
    _activeBookingId = id;
  }

  void setAutoStatusTarget({
    required double? lat,
    required double? lng,
    required String? status,
  }) {
    _targetLat = lat;
    _targetLng = lng;
    _targetForStatus = status;
  }

  Future<void> startForJob(String bookingId) async {
    _activeBookingId = bookingId;
    await start();
  }

  Future<void> start() async {
    if (_isTracking) {
      // Re-assert online status even if already tracking
      _updateOnlineStatus(true);
      return;
    }
    _isTracking = true;

    // Immediate online status update without waiting for everything else
    _updateOnlineStatus(true);

    final hasPermission = await _ensurePermissions();
    if (!hasPermission) {
      _isTracking = false;
      _updateOnlineStatus(false);
      return;
    }

    await _ensureSocket();
    await _startPositionStream();

    // Trigger an immediate position update and server sync (after bookingId is wired)
    _triggerImmediateSync();

    // Start periodic heartbeat (every 1 minute instead of 2 for better responsiveness)
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (_isTracking) {
        _updateOnlineStatus(true);
      }
    });
  }

  Future<void> _triggerImmediateSync() async {
    try {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: kIsWeb ? LocationAccuracy.high : LocationAccuracy.best,
        timeLimit: const Duration(seconds: 15),
      );
      await _handlePosition(position);
    } catch (e) {
      debugPrint('TrackingService: Failed to trigger immediate sync: $e');
    }
  }

  Future<void> stop() async {
    _isTracking = false;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    await _positionSub?.cancel();
    _positionSub = null;
    _targetLat = null;
    _targetLng = null;
    _targetForStatus = null;
    await _updateOnlineStatus(false);
  }

  Future<void> _updateOnlineStatus(bool isOnline) async {
    try {
      debugPrint('TrackingService: Updating online status to $isOnline');
      final response = await _api.putAny(
        ApiEndpoints.usersOnlineStatus,
        body: {'isOnline': isOnline},
      );
      debugPrint('TrackingService: Status updated successfully: $response');
    } catch (e) {
      debugPrint('TrackingService: Failed to update online status: $e');
    }
  }

  Future<bool> _ensurePermissions() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      debugPrint(
        'TrackingService: isLocationServiceEnabled=false; continuing if permission allows',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      debugPrint('TrackingService: Location permission denied: $permission');
      return false;
    }

    // Precise location (Android 12+) — Approximate is not enough for job routing.
    if (!kIsWeb && Platform.isAndroid) {
      final accuracy = await Geolocator.getLocationAccuracy();
      if (accuracy == LocationAccuracyStatus.reduced) {
        debugPrint(
          'TrackingService: Reduced accuracy granted, requesting precise location',
        );
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          return false;
        }
      }
    }

    // While-in-use is enough: Android keeps GPS alive via a location FGS while
    // the staff is on an active job (Navigate). Do not request Always —
    // ACCESS_BACKGROUND_LOCATION is not declared (Play / App Store policy).
    return permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;
  }

  Future<void> _ensureSocket() async {
    final token = await AppStorage().getToken();
    final next = io.io(
      Env.baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .enableForceNew()
          .setAuth(token != null && token.isNotEmpty ? {'token': token} : {})
          .build(),
    );
    _socket?.dispose();
    _socket = next;
    next.connect();
  }

  Future<void> _startPositionStream() async {
    await _positionSub?.cancel();
    late final LocationSettings settings;
    if (kIsWeb) {
      settings = const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
      );
    } else if (Platform.isAndroid) {
      settings = AndroidSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
        intervalDuration: const Duration(
          seconds: 3,
        ), // Increased to 3s for better GPS lock stability
      );
    } else if (Platform.isIOS || Platform.isMacOS) {
      settings = AppleSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
        pauseLocationUpdatesAutomatically: false,
        showBackgroundLocationIndicator: true,
      );
    } else {
      settings = const LocationSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
      );
    }

    _positionSub = Geolocator.getPositionStream(locationSettings: settings)
        .listen(
          _handlePosition,
          onError: (error) {
            debugPrint('TrackingService: Position stream error: $error');
          },
          cancelOnError: false,
        );
  }

  Future<void> _handlePosition(dynamic pos) async {
    if (!_isTracking || pos == null) return;

    // On web, sometimes the type system fails with LegacyJavaScriptObject
    // We try to safely extract properties
    Position? position;
    if (pos is Position) {
      position = pos;
    } else {
      try {
        // Fallback for cases where type casting fails on web
        // but the object has the expected properties
        position = Position(
          latitude: (pos.latitude as num).toDouble(),
          longitude: (pos.longitude as num).toDouble(),
          timestamp: pos.timestamp is DateTime ? pos.timestamp : DateTime.now(),
          accuracy: (pos.accuracy as num).toDouble(),
          altitude: (pos.altitude as num).toDouble(),
          heading: (pos.heading as num).toDouble(),
          speed: (pos.speed as num).toDouble(),
          speedAccuracy: (pos.speedAccuracy as num).toDouble(),
          altitudeAccuracy: (pos.altitudeAccuracy as num).toDouble(),
          headingAccuracy: (pos.headingAccuracy as num).toDouble(),
        );
      } catch (e) {
        debugPrint('TrackingService: Error casting position: $e');
        return;
      }
    }

    final now = DateTime.now();
    final nowMs = now.millisecondsSinceEpoch;
    final current = info.value;
    info.value = current.copyWith(
      lat: position.latitude,
      lng: position.longitude,
      lastUpdate: now,
    );

    if (kDebugMode) {
      debugPrint(
        'TrackingService: Position update accuracy=${position.accuracy}m',
      );
    }

    final socket = _socket;
    // Live tracking via socket - every 1 second for real-time accuracy
    if (socket != null && nowMs - _lastSocketMs > 1000) {
      final payload = <String, dynamic>{
        'lat': position.latitude,
        'lng': position.longitude,
        'timestamp': now.toIso8601String(),
      };
      final bookingId = _activeBookingId;
      if (bookingId != null && bookingId.isNotEmpty) {
        payload['bookingId'] = bookingId;
      }
      try {
        socket.emit('location', payload);
        _lastSocketMs = nowMs;
      } catch (e) {
        debugPrint('TrackingService: Socket emit error: $e');
      }
    }

    // Persistent update via REST - every 1 second as a fallback
    if (nowMs - _lastRestMs > 1000) {
      final body = <String, dynamic>{
        'lat': position.latitude,
        'lng': position.longitude,
      };
      final bookingId = _activeBookingId;
      if (bookingId != null && bookingId.isNotEmpty) {
        body['bookingId'] = bookingId;
      }
      try {
        await _api.putJson(ApiEndpoints.trackingUser, body: body);
        final updated = info.value.copyWith(lastServerSync: DateTime.now());
        info.value = updated;
        _lastRestMs = nowMs;
      } catch (e) {
        debugPrint('TrackingService: REST update error: $e');
      }
    }
  }
}
