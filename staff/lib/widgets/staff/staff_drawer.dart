import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_colors.dart';
import '../../core/app_styles.dart';
import '../app_side_nav_logo.dart';
import 'staff_bottom_nav.dart';

class StaffSideNav extends StatelessWidget {
  final StaffBottomNavTab selectedTab;
  final ValueChanged<StaffBottomNavTab> onSelectTab;
  final VoidCallback onNotifications;
  final VoidCallback onLogout;
  final int unreadCount;

  const StaffSideNav({
    super.key,
    required this.selectedTab,
    required this.onSelectTab,
    required this.onNotifications,
    required this.onLogout,
    this.unreadCount = 0,
  });

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _selectTab(StaffBottomNavTab tab) {
    onSelectTab(tab);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      children: [
        const AppSideNavLogo(),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            children: [
              _StaffDrawerTile(
                icon: Icons.dashboard_outlined,
                label: 'Dashboard',
                active: selectedTab == StaffBottomNavTab.dashboard,
                isDark: isDark,
                onTap: () => _selectTab(StaffBottomNavTab.dashboard),
              ),
              _StaffDrawerTile(
                icon: Icons.assignment_outlined,
                label: 'Orders',
                active: selectedTab == StaffBottomNavTab.orders,
                isDark: isDark,
                onTap: () => _selectTab(StaffBottomNavTab.orders),
              ),
              _StaffDrawerTile(
                icon: Icons.notifications_outlined,
                label: 'Notifications',
                active: false,
                isDark: isDark,
                badge: unreadCount,
                onTap: onNotifications,
              ),
              _StaffDrawerTile(
                icon: Icons.person_outline,
                label: 'Profile',
                active: selectedTab == StaffBottomNavTab.profile,
                isDark: isDark,
                onTap: () => _selectTab(StaffBottomNavTab.profile),
              ),
              _StaffDrawerTile(
                icon: Icons.support_agent_outlined,
                label: 'Support',
                active: false,
                isDark: isDark,
                onTap: () => _openUrl('mailto:support@carzzi.com'),
              ),
              _StaffDrawerTile(
                icon: Icons.description_outlined,
                label: 'Terms of Service',
                active: false,
                isDark: isDark,
                onTap: () => _openUrl('https://carzzi.com/terms'),
              ),
              _StaffDrawerTile(
                icon: Icons.shield_outlined,
                label: 'Privacy Policy',
                active: false,
                isDark: isDark,
                onTap: () => _openUrl('https://carzzi.com/privacy'),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
          child: _StaffDrawerTile(
            icon: Icons.logout_rounded,
            label: 'Log out',
            active: false,
            isDark: isDark,
            onTap: onLogout,
          ),
        ),
      ],
    );
  }
}

class _StaffDrawerTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final bool isDark;
  final VoidCallback onTap;
  final int badge;

  const _StaffDrawerTile({
    required this.icon,
    required this.label,
    required this.active,
    required this.isDark,
    required this.onTap,
    this.badge = 0,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              gradient: active ? AppStyles.primaryGradient : null,
              color: active
                  ? null
                  : (isDark ? Colors.transparent : const Color(0xFFF8F8F8)),
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: AppColors.primaryBlue.withValues(alpha: 0.25),
                        blurRadius: 12,
                        offset: const Offset(0, 6),
                      ),
                    ]
                  : null,
            ),
            child: Row(
              children: [
                Icon(
                  icon,
                  size: 22,
                  color: active
                      ? AppColors.textPrimary
                      : (isDark ? AppColors.textSecondary : Colors.black54),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                      color: active
                          ? AppColors.textPrimary
                          : (isDark ? AppColors.textSecondary : Colors.black87),
                    ),
                  ),
                ),
                if (badge > 0)
                  Container(
                    constraints: const BoxConstraints(minWidth: 20),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: active ? Colors.white : const Color(0xFFEF4444),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      badge > 99 ? '99+' : '$badge',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: active ? AppColors.primaryBlue : Colors.white,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
