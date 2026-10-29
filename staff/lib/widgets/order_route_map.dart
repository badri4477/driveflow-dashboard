import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

import '../core/env.dart';

/// OSM map with a driving route from the staff location to the job destination.
class OrderRouteMap extends StatefulWidget {
  final double? originLat;
  final double? originLng;
  final double? destLat;
  final double? destLng;
  final double bottomInset;

  const OrderRouteMap({
    super.key,
    required this.originLat,
    required this.originLng,
    required this.destLat,
    required this.destLng,
    this.bottomInset = 0,
  });

  @override
  State<OrderRouteMap> createState() => _OrderRouteMapState();
}

class _OrderRouteMapState extends State<OrderRouteMap> {
  static const _distance = Distance();
  final MapController _mapController = MapController();

  List<LatLng> _routePoints = const [];
  LatLng? _fittedOrigin;
  LatLng? _fittedDest;
  bool _mapReady = false;

  LatLng? get _origin {
    if (widget.originLat == null || widget.originLng == null) return null;
    return LatLng(widget.originLat!, widget.originLng!);
  }

  LatLng? get _dest {
    if (widget.destLat == null || widget.destLng == null) return null;
    return LatLng(widget.destLat!, widget.destLng!);
  }

  @override
  void initState() {
    super.initState();
    _refreshRoute();
  }

  @override
  void didUpdateWidget(covariant OrderRouteMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final originMoved = _moved(
      oldWidget.originLat,
      oldWidget.originLng,
      widget.originLat,
      widget.originLng,
      40,
    );
    final destMoved = _moved(
      oldWidget.destLat,
      oldWidget.destLng,
      widget.destLat,
      widget.destLng,
      8,
    );
    if (originMoved || destMoved) {
      _refreshRoute();
    }
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  bool _moved(
    double? oldLat,
    double? oldLng,
    double? newLat,
    double? newLng,
    double meters,
  ) {
    if (oldLat == null || oldLng == null || newLat == null || newLng == null) {
      return oldLat != newLat || oldLng != newLng;
    }
    return _distance.as(
          LengthUnit.Meter,
          LatLng(oldLat, oldLng),
          LatLng(newLat, newLng),
        ) >=
        meters;
  }

  Future<void> _refreshRoute() async {
    final origin = _origin;
    final dest = _dest;
    if (dest == null && origin == null) {
      if (mounted) setState(() => _routePoints = const []);
      return;
    }
    if (origin == null || dest == null) {
      final points = <LatLng>[?origin, ?dest];
      if (mounted) {
        setState(() => _routePoints = points);
        _fitToRoute();
      }
      return;
    }

    if (_fittedOrigin != null &&
        _fittedDest != null &&
        _routePoints.length > 1 &&
        _distance.as(LengthUnit.Meter, _fittedOrigin!, origin) < 40 &&
        _distance.as(LengthUnit.Meter, _fittedDest!, dest) < 8) {
      return;
    }

    final routed = await _fetchDrivingRoute(origin, dest);
    if (!mounted) return;
    setState(() {
      _routePoints = routed ?? [origin, dest];
      _fittedOrigin = origin;
      _fittedDest = dest;
    });
    _fitToRoute();
  }

  Future<List<LatLng>?> _fetchDrivingRoute(LatLng origin, LatLng dest) async {
    try {
      final uri = Uri.parse(
        'https://router.project-osrm.org/route/v1/driving/'
        '${origin.longitude},${origin.latitude};'
        '${dest.longitude},${dest.latitude}'
        '?overview=full&geometries=geojson',
      );
      final res = await http
          .get(uri, headers: {'User-Agent': Env.userAgent})
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return null;
      final decoded = jsonDecode(res.body);
      if (decoded is! Map) return null;
      final routes = decoded['routes'];
      if (routes is! List || routes.isEmpty) return null;
      final geometry = routes.first is Map ? routes.first['geometry'] : null;
      final coords = geometry is Map ? geometry['coordinates'] : null;
      if (coords is! List || coords.isEmpty) return null;
      return coords
          .whereType<List>()
          .where((c) => c.length >= 2)
          .map(
            (c) => LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble()),
          )
          .toList();
    } catch (_) {
      return null;
    }
  }

  void _fitToRoute() {
    final points = <LatLng>[..._routePoints, ?_origin, ?_dest];
    if (points.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_mapReady) return;
      try {
        if (points.length == 1) {
          _mapController.move(points.first, 15);
          return;
        }
        _mapController.fitCamera(
          CameraFit.bounds(
            bounds: LatLngBounds.fromPoints(points),
            padding: EdgeInsets.fromLTRB(48, 48, 48, widget.bottomInset + 24),
            maxZoom: 16,
          ),
        );
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final origin = _origin;
    final dest = _dest;
    final center = dest ?? origin ?? const LatLng(17.3850, 78.4867);

    if (origin == null && dest == null) {
      return ColoredBox(
        color: isDark ? const Color(0xFF111827) : const Color(0xFFF3F4F6),
        child: Center(
          child: Text(
            'Location not available',
            style: TextStyle(
              color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
            ),
          ),
        ),
      );
    }

    return FlutterMap(
      mapController: _mapController,
      options: MapOptions(
        initialCenter: center,
        initialZoom: 14,
        onMapReady: () {
          _mapReady = true;
          _fitToRoute();
        },
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: Env.mapTileUrlTemplate,
          subdomains: Env.mapTileSubdomains,
          userAgentPackageName: 'com.carzzi.staff',
        ),
        if (_routePoints.length >= 2)
          PolylineLayer(
            polylines: [
              Polyline(
                points: _routePoints,
                strokeWidth: 5.5,
                color: const Color(0xFF7C3AED),
                borderStrokeWidth: 2,
                borderColor: Colors.white,
              ),
            ],
          ),
        MarkerLayer(
          markers: [
            if (origin != null)
              Marker(
                point: origin,
                width: 40,
                height: 40,
                child: const Icon(
                  Icons.person_pin_circle,
                  color: Color(0xFF2563EB),
                  size: 38,
                ),
              ),
            if (dest != null)
              Marker(
                point: dest,
                width: 40,
                height: 40,
                child: const Icon(
                  Icons.location_on,
                  color: Color(0xFFDC2626),
                  size: 38,
                ),
              ),
          ],
        ),
      ],
    );
  }
}
