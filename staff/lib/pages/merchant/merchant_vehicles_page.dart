import 'package:flutter/material.dart';
import '../../core/socket_sync.dart';
import '../../services/vehicle_service.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../widgets/states/skeleton.dart';
import '../../widgets/states/state_view.dart';

class MerchantVehiclesPage extends StatefulWidget {
  const MerchantVehiclesPage({super.key});

  @override
  State<MerchantVehiclesPage> createState() => _MerchantVehiclesPageState();
}

class _MerchantVehiclesPageState extends State<MerchantVehiclesPage> {
  final VehicleService _service = VehicleService();
  List<Vehicle> _vehicles = [];
  bool _isLoading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _loadError = null;
      });
    }
    try {
      final data = await _service.getVehicles();
      if (mounted) {
        setState(() {
          _vehicles = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadError =
              'Failed to load vehicles. Check your connection and try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return GlobalSyncRefresh(
      entities: SyncEntities.vehicles,
      onSync: () {
        if (!_isLoading) _load();
      },
      child: MerchantScaffold(
        title: 'Customer Vehicles',
        body: RefreshIndicator(
          onRefresh: _load,
          child: _isLoading
              ? const SkeletonList()
              : _loadError != null
              ? StateView.error(
                  message: _loadError,
                  onRetry: _load,
                  refreshable: true,
                )
              : _vehicles.isEmpty
              ? const StateView.empty(
                  title: 'No vehicles yet',
                  message: 'Customer vehicles you service will show up here.',
                  icon: Icons.directions_car_outlined,
                  refreshable: true,
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _vehicles.length,
                  itemBuilder: (context, index) {
                    final vehicle = _vehicles[index];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                        side: BorderSide(color: Colors.grey[200]!),
                      ),
                      child: ListTile(
                        contentPadding: const EdgeInsets.all(16),
                        leading: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.deepPurple[50],
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(
                            Icons.directions_car,
                            color: Colors.deepPurple,
                          ),
                        ),
                        title: Text(
                          '${vehicle.brand} ${vehicle.model}',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Number: ${vehicle.number}'),
                            if (vehicle.ownerName != null)
                              Text('Owner: ${vehicle.ownerName}'),
                          ],
                        ),
                        trailing: const Icon(Icons.chevron_right),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
