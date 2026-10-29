import 'package:flutter/material.dart';
import '../../services/auth_service.dart';
import '../../core/app_colors.dart';
import '../app_side_nav_logo.dart';
import '../pill_bottom_bar.dart';
import '../states/status_feedback.dart';

class MerchantNavItem {
  final IconData icon;
  final String label;
  final String route;

  const MerchantNavItem({
    required this.icon,
    required this.label,
    required this.route,
  });
}

const List<MerchantNavItem> allMerchantNavItems = [
  MerchantNavItem(
    icon: Icons.home,
    label: 'Dashboard',
    route: '/merchant-dashboard',
  ),
  MerchantNavItem(
    icon: Icons.assignment_outlined,
    label: 'Orders',
    route: '/merchant-orders',
  ),
  MerchantNavItem(
    icon: Icons.message_outlined,
    label: 'Feedback',
    route: '/merchant-feedback',
  ),
  MerchantNavItem(
    icon: Icons.person_outline,
    label: 'Profile',
    route: '/merchant-profile',
  ),
];

class MerchantScaffold extends StatefulWidget {
  final Widget body;
  final String title;
  final List<Widget>? actions;
  final Widget? floatingActionButton;

  const MerchantScaffold({
    super.key,
    required this.body,
    required this.title,
    this.actions,
    this.floatingActionButton,
  });

  @override
  State<MerchantScaffold> createState() => _MerchantScaffoldState();
}

class _MerchantScaffoldState extends State<MerchantScaffold> {
  final AuthService _authService = AuthService();
  List<MerchantNavItem> _filteredItems = [];
  bool _isShopOpen = true;

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  Future<void> _loadUser() async {
    final user = await _authService.getCurrentUser();
    if (mounted) {
      setState(() {
        _filteredItems = List<MerchantNavItem>.from(allMerchantNavItems);
        _isShopOpen = user?.isShopOpen ?? true;
      });
    }
  }

  Future<void> _toggleShopStatus(bool value) async {
    final previousStatus = _isShopOpen;
    setState(() => _isShopOpen = value);
    try {
      await _authService.updateProfile({'isShopOpen': value});
      if (!mounted) return;
      StatusFeedback.auto(value ? 'Shop is now Open' : 'Shop is now Closed');
    } catch (_) {
      if (!mounted) return;
      setState(() => _isShopOpen = previousStatus);
      StatusFeedback.auto('Failed to update shop status');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    // Tabs switch with pushReplacementNamed, so each tab is the only route.
    // Back / edge-swipe: from any tab → Home; only Home closes the app.
    final isHome =
        ModalRoute.of(context)?.settings.name == '/merchant-dashboard';
    final canLeave = isHome || Navigator.of(context).canPop();

    return PopScope(
      canPop: canLeave,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        Navigator.of(context).pushReplacementNamed('/merchant-dashboard');
      },
      child: Scaffold(
        extendBody: true,
        backgroundColor: isDark
            ? AppColors.backgroundPrimary
            : const Color(0xFFF3F4F6),
        appBar: AppBar(
          elevation: 0,
          backgroundColor: isDark
              ? AppColors.backgroundPrimary
              : const Color(0xFFF3F4F6),
          foregroundColor: isDark ? Colors.white : Colors.black,
          title: Text(
            widget.title,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: isDark ? Colors.white : const Color(0xFF1E3A8A),
            ),
          ),
          actions: widget.actions,
        ),
        drawer: MerchantDrawer(
          filteredItems: _filteredItems,
          isShopOpen: _isShopOpen,
          onShopStatusChanged: _toggleShopStatus,
        ),
        body: Padding(
          padding: const EdgeInsets.only(bottom: 96),
          child: widget.body,
        ),
        bottomNavigationBar: _filteredItems.isEmpty
            ? null
            : MerchantBottomNav(filteredItems: _filteredItems),
        floatingActionButton: widget.floatingActionButton,
      ),
    );
  }
}

class MerchantDrawer extends StatelessWidget {
  final List<MerchantNavItem> filteredItems;
  final bool isShopOpen;
  final ValueChanged<bool> onShopStatusChanged;
  const MerchantDrawer({
    super.key,
    required this.filteredItems,
    required this.isShopOpen,
    required this.onShopStatusChanged,
  });

  @override
  Widget build(BuildContext context) {
    final currentRoute = ModalRoute.of(context)?.settings.name;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Drawer(
      backgroundColor: isDark ? AppColors.backgroundPrimary : Colors.white,
      child: Column(
        children: [
          const AppSideNavLogo(),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: isDark
                        ? AppColors.backgroundSecondary
                        : AppColors.primaryBlue.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isShopOpen
                          ? AppColors.success.withValues(alpha: 0.35)
                          : AppColors.warning.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.storefront_rounded,
                        size: 18,
                        color: isShopOpen
                            ? AppColors.success
                            : AppColors.warning,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Shop Status',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: isDark ? Colors.white : Colors.black87,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              isShopOpen ? 'Open' : 'Closed',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: isShopOpen
                                    ? AppColors.success
                                    : AppColors.warning,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Switch(
                        value: isShopOpen,
                        onChanged: onShopStatusChanged,
                        activeThumbColor: AppColors.success,
                        activeTrackColor: AppColors.success.withValues(
                          alpha: 0.3,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                ...filteredItems.map((item) {
                  final bool isActive = currentRoute == item.route;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: _MerchantNavTile(
                      icon: item.icon,
                      label: item.label,
                      isActive: isActive,
                      isDark: isDark,
                      onTap: () {
                        Navigator.pop(context); // Close drawer
                        if (currentRoute != item.route) {
                          Navigator.pushReplacementNamed(context, item.route);
                        }
                      },
                    ),
                  );
                }),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class MerchantBottomNav extends StatelessWidget {
  final List<MerchantNavItem> filteredItems;

  const MerchantBottomNav({super.key, required this.filteredItems});

  @override
  Widget build(BuildContext context) {
    final displayItems = [
      filteredItems.firstWhere((i) => i.label == 'Orders'),
      filteredItems.firstWhere((i) => i.label == 'Dashboard'),
      filteredItems.firstWhere((i) => i.label == 'Profile'),
    ];

    final currentRoute = ModalRoute.of(context)?.settings.name;
    var selectedIndex = displayItems.indexWhere(
      (item) => item.route == currentRoute,
    );
    if (selectedIndex < 0) selectedIndex = 1;

    return AppPillBottomBar.staffMerchant(
      selectedIndex: selectedIndex,
      onTap: (index) {
        final route = displayItems[index].route;
        if (currentRoute != route) {
          Navigator.pushReplacementNamed(context, route);
        }
      },
    );
  }
}

class _MerchantNavTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final bool isDark;
  final VoidCallback onTap;

  const _MerchantNavTile({
    required this.icon,
    required this.label,
    required this.isActive,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // Pill colour lives on the ListTile itself (tileColor + shape) over a
    // transparent Material — a coloured Container here hid the tap ripple and
    // triggered Flutter's "ink splashes may be invisible" assertion.
    return Material(
      type: MaterialType.transparency,
      child: ListTile(
        tileColor: isActive
            ? (isDark ? AppColors.primaryBlue : const Color(0xFF2563EB))
            : null,
        shape: const StadiumBorder(),
        leading: Icon(
          icon,
          color: isActive
              ? Colors.white
              : (isDark ? Colors.grey[400] : const Color(0xFF4B5563)),
        ),
        title: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            color: isActive
                ? Colors.white
                : (isDark ? Colors.grey[300] : const Color(0xFF374151)),
            fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
        visualDensity: const VisualDensity(horizontal: -1, vertical: -2),
        onTap: onTap,
      ),
    );
  }
}
