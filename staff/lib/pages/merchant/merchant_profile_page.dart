import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_client.dart';
import '../../core/socket_sync.dart';
import '../../services/auth_service.dart';
import '../../widgets/global_sync_refresh.dart';
import '../../models/user.dart';
import '../../widgets/merchant/merchant_nav.dart';
import '../../core/app_colors.dart';
import '../../state/theme_provider.dart';
import '../../widgets/appearance_settings.dart';
import 'package:provider/provider.dart';
import '../../widgets/states/status_feedback.dart';
import '../../widgets/states/skeleton.dart';

class MerchantProfilePage extends StatefulWidget {
  const MerchantProfilePage({super.key});

  @override
  State<MerchantProfilePage> createState() => _MerchantProfilePageState();
}

class _MerchantProfilePageState extends State<MerchantProfilePage> {
  final AuthService _authService = AuthService();
  final ApiClient _api = ApiClient();
  StaffUser? _user;
  bool _isLoading = true;

  Future<UserLocation?> _pickCurrentLocationAddress() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw ApiException(
        statusCode: 400,
        message: 'Location services are disabled',
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw ApiException(
        statusCode: 403,
        message: 'Location permission denied',
      );
    }

    final position = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
    );

    String address = '${position.latitude}, ${position.longitude}';
    try {
      final reverse = await _api.getAny(
        '/tracking/reverse?lat=${position.latitude}&lng=${position.longitude}',
      );
      if (reverse is Map && reverse['display_name'] != null) {
        address = reverse['display_name'].toString();
      }
    } catch (_) {}

    return UserLocation(
      address: address,
      lat: position.latitude,
      lng: position.longitude,
    );
  }

  Future<void> _showEditProfileDialog() async {
    if (_user == null) return;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final nameController = TextEditingController(text: _user!.name);
    final phoneController = TextEditingController(text: _user!.phone ?? '');
    final addressController = TextEditingController(
      text: _user!.location?.address ?? '',
    );
    double? selectedLat = _user!.location?.lat;
    double? selectedLng = _user!.location?.lng;
    bool isPickingLocation = false;

    final didSave =
        await showModalBottomSheet<bool>(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          backgroundColor: isDark ? const Color(0xFF0B1220) : Colors.white,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          builder: (context) => StatefulBuilder(
            builder: (context, setModalState) => Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 8,
                bottom: MediaQuery.of(context).viewInsets.bottom + 16,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Edit Profile',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: isDark ? Colors.white : const Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: nameController,
                      style: TextStyle(
                        color: isDark ? Colors.white : const Color(0xFF111827),
                        fontSize: 16,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Shop/Owner Name',
                        labelStyle: TextStyle(
                          color: isDark
                              ? Colors.grey[400]
                              : const Color(0xFF6B7280),
                        ),
                        filled: true,
                        fillColor: isDark
                            ? const Color(0xFF111827)
                            : const Color(0xFFF9FAFB),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: isDark
                                ? const Color(0xFF374151)
                                : const Color(0xFFE5E7EB),
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(
                            color: Color(0xFF2563EB),
                            width: 1.4,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phoneController,
                      keyboardType: TextInputType.phone,
                      style: TextStyle(
                        color: isDark ? Colors.white : const Color(0xFF111827),
                        fontSize: 16,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Phone Number',
                        labelStyle: TextStyle(
                          color: isDark
                              ? Colors.grey[400]
                              : const Color(0xFF6B7280),
                        ),
                        filled: true,
                        fillColor: isDark
                            ? const Color(0xFF111827)
                            : const Color(0xFFF9FAFB),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: isDark
                                ? const Color(0xFF374151)
                                : const Color(0xFFE5E7EB),
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(
                            color: Color(0xFF2563EB),
                            width: 1.4,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: addressController,
                      style: TextStyle(
                        color: isDark ? Colors.white : const Color(0xFF111827),
                        fontSize: 16,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Address',
                        labelStyle: TextStyle(
                          color: isDark
                              ? Colors.grey[400]
                              : const Color(0xFF6B7280),
                        ),
                        filled: true,
                        fillColor: isDark
                            ? const Color(0xFF111827)
                            : const Color(0xFFF9FAFB),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: isDark
                                ? const Color(0xFF374151)
                                : const Color(0xFFE5E7EB),
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(
                            color: Color(0xFF2563EB),
                            width: 1.4,
                          ),
                        ),
                        suffixIcon: IconButton(
                          tooltip: 'Use current location',
                          onPressed: isPickingLocation
                              ? null
                              : () async {
                                  setModalState(() => isPickingLocation = true);
                                  try {
                                    final location =
                                        await _pickCurrentLocationAddress();
                                    if (location != null) {
                                      addressController.text =
                                          location.address ?? '';
                                      selectedLat = location.lat;
                                      selectedLng = location.lng;
                                    }
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    final message = e is ApiException
                                        ? e.message
                                        : 'Failed to fetch current location';
                                    StatusFeedback.auto(message);
                                  } finally {
                                    if (context.mounted) {
                                      setModalState(
                                        () => isPickingLocation = false,
                                      );
                                    }
                                  }
                                },
                          icon: isPickingLocation
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  Icons.my_location_rounded,
                                  color: isDark
                                      ? const Color(0xFF93C5FD)
                                      : const Color(0xFF2563EB),
                                ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => Navigator.pop(context, false),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: isDark
                                  ? Colors.white
                                  : const Color(0xFF1F2937),
                              side: BorderSide(
                                color: isDark
                                    ? const Color(0xFF6B7280)
                                    : const Color(0xFFD1D5DB),
                              ),
                            ),
                            child: const Text('Cancel'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: () => Navigator.pop(context, true),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF2563EB),
                              foregroundColor: Colors.white,
                            ),
                            child: const Text('Save'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ) ??
        false;

    if (!didSave) return;
    setState(() => _isLoading = true);
    try {
      final trimmedName = nameController.text.trim();
      final trimmedPhone = phoneController.text.trim();
      final trimmedAddress = addressController.text.trim();
      final payload = <String, dynamic>{
        if (trimmedName.isNotEmpty) 'name': trimmedName,
        'phone': trimmedPhone,
        'location': {
          'address': trimmedAddress,
          'lat': selectedLat,
          'lng': selectedLng,
        },
      };
      await _authService.updateProfile(payload);
      await _load();
      if (!mounted) return;
      StatusFeedback.auto('Profile updated');
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      final message = e is ApiException
          ? e.message
          : 'Failed to update profile';
      StatusFeedback.auto(message);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _isLoading = true);
    try {
      final user = await _authService.getCurrentUser(forceRefresh: true);
      if (mounted) {
        setState(() {
          _user = user;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GlobalSyncRefresh(
      entities: SyncEntities.profile,
      onSync: () {
        if (!_isLoading) _load();
      },
      child: MerchantScaffold(
        title: 'Merchant Profile',
        actions: [
          IconButton(
            tooltip: 'Edit Profile',
            onPressed: _isLoading ? null : _showEditProfileDialog,
            icon: const Icon(Icons.edit_outlined),
          ),
        ],
        body: _isLoading
            ? const SkeletonList(itemCount: 4, showLeading: false)
            : _user == null
            ? Center(
                child: Text(
                  'User not found',
                  style: TextStyle(
                    fontSize: 16,
                    color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
                  ),
                ),
              )
            : SingleChildScrollView(
                // Extra bottom space so the floating bottom bar never covers
                // the Logout button.
                padding: EdgeInsets.fromLTRB(
                  16,
                  8,
                  16,
                  120 + MediaQuery.paddingOf(context).bottom,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Profile header
                    _ProfileCard(
                      isDark: isDark,
                      padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
                      child: Column(
                        children: [
                          Container(
                            width: 84,
                            height: 84,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: _profileAccent(
                                isDark,
                              ).withValues(alpha: isDark ? 0.18 : 0.1),
                            ),
                            child: Icon(
                              Icons.store_rounded,
                              size: 40,
                              color: _profileAccent(isDark),
                            ),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            _user!.name,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.3,
                              color: isDark
                                  ? Colors.white
                                  : const Color(0xFF111827),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _ProfileChip(
                                label:
                                    _user!.role[0].toUpperCase() +
                                    _user!.role.substring(1),
                                icon: Icons.verified_rounded,
                                isDark: isDark,
                                filled: true,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Business details
                    _ProfileCard(
                      isDark: isDark,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _ProfileSectionTitle(
                            icon: Icons.storefront_rounded,
                            title: 'Business Details',
                            isDark: isDark,
                          ),
                          const SizedBox(height: 8),
                          _ProfileDetailItem(
                            icon: Icons.email_outlined,
                            label: 'Email Address',
                            value: _user!.email,
                            isDark: isDark,
                          ),
                          _ProfileDivider(isDark: isDark),
                          _ProfileDetailItem(
                            icon: Icons.phone_android_rounded,
                            label: 'Phone Number',
                            value: _user!.phone ?? 'Not provided',
                            isDark: isDark,
                          ),
                          if (_user!.location?.address != null) ...[
                            _ProfileDivider(isDark: isDark),
                            _ProfileDetailItem(
                              icon: Icons.location_on_outlined,
                              label: 'Address',
                              value: _user!.location!.address!,
                              isDark: isDark,
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (_user!.categories.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      _ProfileCard(
                        isDark: isDark,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _ProfileSectionTitle(
                              icon: Icons.handyman_rounded,
                              title: 'Services Offered',
                              isDark: isDark,
                            ),
                            const SizedBox(height: 14),
                            LayoutBuilder(
                              builder: (context, constraints) {
                                const gap = 10.0;
                                final tileWidth =
                                    (constraints.maxWidth - gap) / 2;
                                return Wrap(
                                  spacing: gap,
                                  runSpacing: gap,
                                  children: [
                                    for (final c in _user!.categories)
                                      SizedBox(
                                        width: tileWidth,
                                        child: _ServiceTile(
                                          category: c,
                                          isDark: isDark,
                                        ),
                                      ),
                                  ],
                                );
                              },
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),

                    const AppearanceSettingsCard(),
                    const SizedBox(height: 16),

                    // Legal
                    _ProfileCard(
                      isDark: isDark,
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(
                        children: [
                          _ProfileLinkRow(
                            icon: Icons.privacy_tip_outlined,
                            label: 'Privacy Policy',
                            isDark: isDark,
                            onTap: () => launchUrl(
                              Uri.parse('https://carzzi.com/privacy'),
                              mode: LaunchMode.externalApplication,
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: _ProfileDivider(isDark: isDark, gap: 0),
                          ),
                          _ProfileLinkRow(
                            icon: Icons.description_outlined,
                            label: 'Terms of Service',
                            isDark: isDark,
                            onTap: () => launchUrl(
                              Uri.parse('https://carzzi.com/terms'),
                              mode: LaunchMode.externalApplication,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    OutlinedButton.icon(
                      onPressed: () async {
                        await _authService.logout();
                        if (!context.mounted) return;
                        context.read<ThemeProvider>().markUnauthenticated();
                        Navigator.pushNamedAndRemoveUntil(
                          context,
                          '/login',
                          (route) => false,
                        );
                      },
                      icon: const Icon(
                        Icons.logout_rounded,
                        color: AppColors.error,
                      ),
                      label: const Text(
                        'Logout',
                        style: TextStyle(
                          fontSize: 15,
                          color: AppColors.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        backgroundColor: AppColors.error.withValues(
                          alpha: isDark ? 0.1 : 0.04,
                        ),
                        side: BorderSide(
                          color: AppColors.error.withValues(
                            alpha: isDark ? 0.45 : 0.3,
                          ),
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

Color _profileAccent(bool isDark) =>
    isDark ? AppColors.primaryPurple : const Color(0xFF7C3AED);

/// One offered service: icon + readable name (e.g. "battery" → Battery).
class _ServiceTile extends StatelessWidget {
  final String category;
  final bool isDark;

  const _ServiceTile({required this.category, required this.isDark});

  static IconData _iconFor(String c) {
    final k = c.toLowerCase();
    if (k.contains('batter')) return Icons.battery_charging_full_rounded;
    if (k.contains('tire') || k.contains('tyre')) {
      return Icons.tire_repair_rounded;
    }
    if (k.contains('wash')) return Icons.local_car_wash_rounded;
    if (k.contains('essential')) return Icons.shield_outlined;
    if (k.contains('insur')) return Icons.verified_user_outlined;
    if (k.contains('general') ||
        k.contains('periodic') ||
        k.contains('service')) {
      return Icons.build_rounded;
    }
    return Icons.miscellaneous_services_rounded;
  }

  static String _labelFor(String c) {
    final k = c.trim().toLowerCase();
    const names = {
      'general': 'General Service',
      'tires': 'Tyres',
      'tyres': 'Tyres',
      'battery': 'Battery',
      'carwash': 'Car Wash',
      'car wash': 'Car Wash',
    };
    if (names.containsKey(k)) return names[k]!;
    return k
        .split(RegExp(r'[\s_-]+'))
        .where((w) => w.isNotEmpty)
        .map((w) => w[0].toUpperCase() + w.substring(1))
        .join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final accent = _profileAccent(isDark);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: isDark ? 0.12 : 0.05),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withValues(alpha: 0.15)),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: accent.withValues(alpha: isDark ? 0.2 : 0.12),
            ),
            child: Icon(_iconFor(category), size: 18, color: accent),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _labelFor(category),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: isDark ? Colors.white : const Color(0xFF111827),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  final bool isDark;
  final Widget child;
  final EdgeInsetsGeometry padding;

  const _ProfileCard({
    required this.isDark,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: isDark ? AppColors.backgroundSecondary : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? AppColors.borderColor : const Color(0xFFEDE9FE),
        ),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.3)
                : _profileAccent(isDark).withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _ProfileSectionTitle extends StatelessWidget {
  final IconData icon;
  final String title;
  final bool isDark;

  const _ProfileSectionTitle({
    required this.icon,
    required this.title,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    final accent = _profileAccent(isDark);
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: accent.withValues(alpha: isDark ? 0.18 : 0.1),
          ),
          child: Icon(icon, color: accent, size: 20),
        ),
        const SizedBox(width: 12),
        Text(
          title,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: isDark ? Colors.white : const Color(0xFF111827),
          ),
        ),
      ],
    );
  }
}

class _ProfileChip extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool isDark;
  final bool filled;

  const _ProfileChip({
    required this.label,
    required this.isDark,
    this.icon,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    final accent = _profileAccent(isDark);
    final fg = filled
        ? accent
        : (isDark ? Colors.grey[300]! : const Color(0xFF4B5563));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: filled
            ? accent.withValues(alpha: isDark ? 0.18 : 0.1)
            : (isDark ? AppColors.backgroundSurface : const Color(0xFFF3F4F6)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 15, color: fg),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: fg,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileDivider extends StatelessWidget {
  final bool isDark;
  final double gap;

  const _ProfileDivider({required this.isDark, this.gap = 4});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: gap),
      child: Divider(
        height: 1,
        thickness: 1,
        color: isDark ? AppColors.borderColor : const Color(0xFFF1F1F4),
      ),
    );
  }
}

class _ProfileLinkRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isDark;
  final VoidCallback onTap;

  const _ProfileLinkRow({
    required this.icon,
    required this.label,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final muted = isDark ? Colors.grey[400]! : const Color(0xFF6B7280);
    return Material(
      type: MaterialType.transparency,
      child: ListTile(
        minTileHeight: 52,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        leading: Icon(icon, color: muted),
        title: Text(
          label,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: isDark ? Colors.white : const Color(0xFF111827),
          ),
        ),
        trailing: Icon(Icons.chevron_right_rounded, color: muted),
        onTap: onTap,
      ),
    );
  }
}

class _ProfileDetailItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool isDark;

  const _ProfileDetailItem({
    required this.icon,
    required this.label,
    required this.value,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        // Icon lines up with the label, not the middle of a long address.
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: isDark
                  ? AppColors.backgroundSurface
                  : const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: isDark ? Colors.grey[400] : const Color(0xFF4B5563),
              size: 20,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    color: isDark ? Colors.grey[400] : const Color(0xFF6B7280),
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 15,
                    height: 1.45,
                    color: isDark ? Colors.white : const Color(0xFF111827),
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
