import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_colors.dart';
import '../core/app_styles.dart';

class AppPillBottomBar extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onTap;
  final _PillItem _left;
  final _PillItem _right;

  const AppPillBottomBar._({
    required this.selectedIndex,
    required this.onTap,
    required _PillItem left,
    required _PillItem right,
  }) : _left = left,
       _right = right;

  factory AppPillBottomBar.staffMerchant({
    required int selectedIndex,
    required ValueChanged<int> onTap,
  }) {
    return AppPillBottomBar._(
      selectedIndex: selectedIndex,
      onTap: onTap,
      left: const _PillItem(
        activeIcon: Icons.assignment_rounded,
        inactiveIcon: Icons.assignment_outlined,
        label: 'Orders',
      ),
      right: const _PillItem(
        activeIcon: Icons.person_rounded,
        inactiveIcon: Icons.person_outline_rounded,
        label: 'Profile',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final backgroundColor = isDark
        ? AppColors.backgroundSecondary.withValues(alpha: 0.8)
        : Colors.white.withValues(alpha: 0.8);
    final borderColor = isDark ? AppColors.borderColor : Colors.grey[200]!;
    final shadowColor = isDark
        ? Colors.black.withValues(alpha: 0.4)
        : Colors.black.withValues(alpha: 0.1);
    final inactiveColor = isDark ? AppColors.textMuted : Colors.grey.shade400;

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 12 + bottomInset),
      child: RepaintBoundary(
        child: Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            Container(
              height: 70,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(35),
                boxShadow: [
                  BoxShadow(
                    color: shadowColor,
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(35),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: backgroundColor,
                      borderRadius: BorderRadius.circular(35),
                      border: Border.all(
                        color: borderColor.withValues(alpha: 0.5),
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: _GlassNavItem(
                            activeIcon: _left.activeIcon,
                            inactiveIcon: _left.inactiveIcon,
                            label: _left.label,
                            isActive: selectedIndex == 0,
                            inactiveColor: inactiveColor,
                            onTap: () => onTap(0),
                          ),
                        ),
                        const SizedBox(width: 70),
                        Expanded(
                          child: _GlassNavItem(
                            activeIcon: _right.activeIcon,
                            inactiveIcon: _right.inactiveIcon,
                            label: _right.label,
                            isActive: selectedIndex == 2,
                            inactiveColor: inactiveColor,
                            onTap: () => onTap(2),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: -25,
              child: _CenterNavAction(
                isActive: selectedIndex == 1,
                onTap: () => onTap(1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PillItem {
  final IconData activeIcon;
  final IconData inactiveIcon;
  final String label;

  const _PillItem({
    required this.activeIcon,
    required this.inactiveIcon,
    required this.label,
  });
}

class _CenterNavAction extends StatelessWidget {
  final bool isActive;
  final VoidCallback onTap;

  const _CenterNavAction({required this.isActive, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 60,
      height: 60,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: AppStyles.primaryBlue,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          hoverColor: Colors.transparent,
          highlightColor: Colors.transparent,
          splashColor: Colors.transparent,
          focusColor: Colors.transparent,
          onTap: () {
            if (isActive) return;
            HapticFeedback.selectionClick();
            onTap();
          },
          borderRadius: BorderRadius.circular(999),
          child: const Icon(Icons.home_rounded, color: Colors.white, size: 30),
        ),
      ),
    );
  }
}

class _GlassNavItem extends StatelessWidget {
  final IconData activeIcon;
  final IconData inactiveIcon;
  final String label;
  final bool isActive;
  final Color inactiveColor;
  final VoidCallback onTap;

  const _GlassNavItem({
    required this.activeIcon,
    required this.inactiveIcon,
    required this.label,
    required this.isActive,
    required this.inactiveColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        if (isActive) return;
        HapticFeedback.selectionClick();
        onTap();
      },
      borderRadius: BorderRadius.circular(18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (isActive)
            ShaderMask(
              shaderCallback: (bounds) =>
                  AppStyles.primaryGradient.createShader(bounds),
              child: Icon(activeIcon, color: Colors.white, size: 22),
            )
          else
            Icon(inactiveIcon, color: inactiveColor, size: 20),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: isActive ? AppStyles.primaryBlue : inactiveColor,
              fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}
