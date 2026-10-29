import 'package:flutter/material.dart';
import '../../core/socket_sync.dart';
import '../../services/service_service.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../widgets/states/skeleton.dart';
import '../../widgets/states/state_view.dart';

class MerchantServicesPage extends StatefulWidget {
  const MerchantServicesPage({super.key});

  @override
  State<MerchantServicesPage> createState() => _MerchantServicesPageState();
}

class _MerchantServicesPageState extends State<MerchantServicesPage> {
  final ServiceService _service = ServiceService();
  List<ServiceModel> _services = [];
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
      final data = await _service.getServices();
      if (mounted) {
        setState(() {
          _services = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadError =
              'Failed to load services. Check your connection and try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return GlobalSyncRefresh(
      entities: SyncEntities.services,
      onSync: () {
        if (!_isLoading) _load();
      },
      child: MerchantScaffold(
        title: 'Our Services',
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
              : _services.isEmpty
              ? const StateView.empty(
                  title: 'No services found',
                  message: 'Services you offer will show up here.',
                  icon: Icons.design_services_outlined,
                  refreshable: true,
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _services.length,
                  itemBuilder: (context, index) {
                    final service = _services[index];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                        side: BorderSide(color: Colors.grey[200]!),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    service.name,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 16,
                                    ),
                                  ),
                                ),
                                Text(
                                  '₹${service.price}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 16,
                                    color: Colors.deepPurple,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              service.description,
                              style: TextStyle(
                                fontSize: 13,
                                color: Colors.grey[600],
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                _infoChip(Icons.category, service.category),
                                const SizedBox(width: 8),
                                _infoChip(
                                  Icons.timer,
                                  '${service.duration} min',
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }

  Widget _infoChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.grey[100],
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, size: 14, color: Colors.grey[600]),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[700])),
        ],
      ),
    );
  }
}
