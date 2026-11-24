import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api_client.dart';
import '../core/app_colors.dart';
import '../core/form_validation.dart';
import '../services/vehicle_service.dart';

/// Registration no. + Search (Vahan) — parity with web
/// `components/vehicle/VahanLookup.tsx`. Success fills the details
/// ('auto'); failure opens the manual fields ('manual').
class VahanLookupSection extends StatefulWidget {
  final TextEditingController plateController;

  /// Called with the normalised backend result after a successful lookup.
  final ValueChanged<Map<String, dynamic>> onResult;

  /// Hide the lookup entirely (e.g. when editing an existing vehicle).
  final bool allowLookup;

  /// Rendered under the result line to tell the user what got filled.
  final String Function(Map<String, dynamic> result)? describeFill;

  /// 'auto' after a successful search, 'manual' after a failed one.
  final ValueChanged<String>? onModeChanged;

  /// Show the full 19-field Vahan tile (admin). Customers see only the form fields.
  final bool showDetails;

  const VahanLookupSection({
    super.key,
    required this.plateController,
    required this.onResult,
    this.allowLookup = true,
    this.showDetails = true,
    this.describeFill,
    this.onModeChanged,
  });

  @override
  State<VahanLookupSection> createState() => _VahanLookupSectionState();
}

class _VahanLookupSectionState extends State<VahanLookupSection> {
  static final _manualSuffix = RegExp(
    r'\s*Please enter (them|details) manually\.?$',
    caseSensitive: false,
  );

  final _service = VehicleService();
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _result;

  Future<void> _search() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _error = null;
      _result = null;
    });
    final plate = widget.plateController.text.trim().toUpperCase();
    final err = FormValidation.validateLicensePlate(plate);
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await _service.vahanLookup(regnNo: plate);
      widget.onResult(res);
      widget.onModeChanged?.call('auto');
      if (mounted) setState(() => _result = res);
    } on ApiException catch (e) {
      _failed(e.message);
    } catch (_) {
      _failed('');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _failed(String message) {
    final base = message.replaceAll(_manualSuffix, '').trim();
    widget.onModeChanged?.call('manual');
    if (!mounted) return;
    setState(
      () => _error =
          '${base.isEmpty ? 'Could not fetch vehicle details.' : base} '
          'Please fill in the details below.',
    );
  }

  Widget _plateField(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Registration Number',
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        TextFormField(
          controller: widget.plateController,
          textCapitalization: TextCapitalization.characters,
          textInputAction: TextInputAction.search,
          onFieldSubmitted: widget.allowLookup && !_loading
              ? (_) => _search()
              : null,
          inputFormatters: [
            LengthLimitingTextInputFormatter(15),
            FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 ]')),
          ],
          style: TextStyle(
            color: isDark ? AppColors.textPrimary : Colors.black87,
          ),
          validator: FormValidation.validateLicensePlate,
          decoration: InputDecoration(
            hintText: 'e.g. MH12AB1234',
            hintStyle: TextStyle(
              color: isDark ? AppColors.textMuted : AppColors.textMutedLight,
            ),
            filled: true,
            fillColor: isDark
                ? AppColors.backgroundSecondary
                : AppColors.backgroundSecondaryLight,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.allowLookup) return _plateField(context);
    final theme = Theme.of(context);
    final r = _result;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _plateField(context),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton.icon(
            onPressed: _loading ? null : _search,
            icon: _loading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.search),
            label: Text(_loading ? 'Searching…' : 'Search'),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Semantics(
            liveRegion: true,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.error_outline,
                  size: 18,
                  color: theme.colorScheme.error,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (r != null) ...[
          const SizedBox(height: 12),
          Semantics(
            liveRegion: true,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: theme.dividerColor),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_circle, size: 18, color: Colors.green),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          [
                            'Found ${(r['registrationNumber'] ?? '').toString().isNotEmpty ? r['registrationNumber'] : 'vehicle'}',
                            if (r['year'] != null) '${r['year']}',
                            if ((r['fuelType'] ?? '').toString().isNotEmpty)
                              '${r['fuelType']}',
                          ].join(' · '),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (widget.describeFill != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            widget.describeFill!(r),
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
        if (widget.showDetails &&
            r != null &&
            r['details'] is List &&
            (r['details'] as List).isNotEmpty) ...[
          const SizedBox(height: 12),
          _VahanDetailsTile(
            details: (r['details'] as List).whereType<Map>().toList(),
          ),
        ],
      ],
    );
  }
}

/// The 19 Annexure-I Vahan fields, grouped, with "Not provided by Vahan" for
/// gaps — parity with web `VahanDetailsPanel.tsx` (PDF download is web-only).
class _VahanDetailsTile extends StatelessWidget {
  final List<Map> details;
  const _VahanDetailsTile({required this.details});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final provided = details.where((d) => d['provided'] != false).length;
    final rows = <Widget>[];
    String? group;
    for (final d in details) {
      final g = '${d['group'] ?? ''}';
      if (g.isNotEmpty && g != group) {
        group = g;
        rows.add(
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 4),
            child: Text(
              g.toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w700,
                letterSpacing: 0.5,
              ),
            ),
          ),
        );
      }
      final has = d['provided'] != false;
      final value = !has
          ? 'Not provided by Vahan'
          : '${d['value'] ?? ''}${d['masked'] == true ? ' (hidden by Vahan)' : ''}';
      rows.add(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: Text(
                  '${d['sno'] != null ? '${d['sno']}. ' : ''}${d['label'] ?? ''}',
                  style: theme.textTheme.bodySmall,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: Text(
                  value,
                  style: has
                      ? const TextStyle(fontWeight: FontWeight.w600)
                      : theme.textTheme.bodySmall?.copyWith(
                          fontStyle: FontStyle.italic,
                        ),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Theme(
        data: theme.copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 12),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          title: Text(
            'Full Vahan details ($provided of ${details.length} provided)',
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          ),
          children: rows,
        ),
      ),
    );
  }
}
