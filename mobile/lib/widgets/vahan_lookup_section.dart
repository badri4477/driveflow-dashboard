import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api_client.dart';
import '../core/app_colors.dart';
import '../core/form_validation.dart';
import '../services/vehicle_service.dart';

/// Registration field with optional automatic Vahan (Parivahan) lookup —
/// parity with web `components/vehicle/VahanLookup.tsx`.
/// Automatic: Vahan lookup by registration no.; Manual: fill details yourself.
class VahanLookupSection extends StatefulWidget {
  final TextEditingController plateController;

  /// Called with the normalised backend result after a successful lookup.
  final ValueChanged<Map<String, dynamic>> onResult;

  /// Hide the lookup entirely (e.g. when editing an existing vehicle).
  final bool allowLookup;

  /// Rendered under the result line to tell the user what got filled.
  final String Function(Map<String, dynamic> result)? describeFill;

  /// 'auto' or 'manual' once the user picks; parent shows the detail fields then.
  final ValueChanged<String>? onModeChanged;

  const VahanLookupSection({
    super.key,
    required this.plateController,
    required this.onResult,
    this.allowLookup = true,
    this.describeFill,
    this.onModeChanged,
  });

  @override
  State<VahanLookupSection> createState() => _VahanLookupSectionState();
}

class _VahanLookupSectionState extends State<VahanLookupSection> {
  final _service = VehicleService();

  bool? _auto; // null until the user picks Automatic or Manual
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _result;

  Future<void> _fetch() async {
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
      if (mounted) setState(() => _result = res);
    } on ApiException catch (e) {
      if (mounted) {
        setState(
          () => _error = e.message.isNotEmpty
              ? e.message
              : 'Could not fetch vehicle details. Please enter them manually.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not fetch vehicle details. Please enter them manually.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  InputDecoration _decoration(BuildContext context, String hint) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return InputDecoration(
      hintText: hint,
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
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    );
  }

  Widget _label(BuildContext context, String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: Theme.of(
        context,
      ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
    ),
  );

  Widget _field(
    BuildContext context,
    TextEditingController c,
    String hint, {
    String? Function(String?)? validator,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return TextFormField(
      controller: c,
      textCapitalization: TextCapitalization.characters,
      inputFormatters: [
        LengthLimitingTextInputFormatter(25),
        FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 ]')),
      ],
      style: TextStyle(color: isDark ? AppColors.textPrimary : Colors.black87),
      validator: validator,
      decoration: _decoration(context, hint),
    );
  }

  Widget _plateField(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _label(context, 'Registration Number'),
      _field(
        context,
        widget.plateController,
        'e.g. MH12AB1234',
        validator: FormValidation.validateLicensePlate,
      ),
    ],
  );

  void _pick(bool auto) {
    setState(() {
      _auto = auto;
      _error = null;
    });
    widget.onModeChanged?.call(auto ? 'auto' : 'manual');
    if (auto) _fetch();
  }

  Widget _modeButton(bool auto) {
    final selected = _auto == auto;
    final icon = auto ? Icons.bolt : Icons.edit_outlined;
    final label = auto ? 'Automatic (Vahan)' : 'Manual';
    final child = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (auto && _loading)
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        else
          Icon(icon, size: 18),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            auto && _loading ? 'Fetching…' : label,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
    final onPressed = _loading ? null : () => _pick(auto);
    return SizedBox(
      height: 48,
      child: selected
          ? FilledButton(onPressed: onPressed, child: child)
          : OutlinedButton(onPressed: onPressed, child: child),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.allowLookup) return _plateField(context);
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _plateField(context),
        const SizedBox(height: 16),
        Text(
          'How do you want to add vehicle details?',
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: _modeButton(true)),
            const SizedBox(width: 8),
            Expanded(child: _modeButton(false)),
          ],
        ),
        if (_auto == true) ...[
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
            Wrap(
              children: [
                TextButton(
                  onPressed: _loading ? null : _fetch,
                  child: const Text('Retry'),
                ),
                TextButton(
                  onPressed: () => _pick(false),
                  child: const Text('Enter manually'),
                ),
              ],
            ),
          ],
          if (_result != null) ...[
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
                    const Icon(
                      Icons.check_circle,
                      size: 18,
                      color: Colors.green,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            [
                              'Found ${(_result!['registrationNumber'] ?? '').toString().isNotEmpty ? _result!['registrationNumber'] : 'vehicle'}',
                              if (_result!['year'] != null)
                                '${_result!['year']}',
                              if ((_result!['fuelType'] ?? '')
                                  .toString()
                                  .isNotEmpty)
                                '${_result!['fuelType']}',
                            ].join(' · '),
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          if (widget.describeFill != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              widget.describeFill!(_result!),
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
        ],
      ],
    );
  }
}
