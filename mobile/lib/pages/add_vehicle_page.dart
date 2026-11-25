import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import '../../services/vehicle_service.dart';
import '../models/vehicle.dart';
import '../widgets/vahan_lookup_section.dart';

class AddVehiclePage extends StatefulWidget {
  /// When set, the page edits this vehicle (brand/model/variant/
  /// registration/fuel type) instead of adding a new one.
  final Vehicle? editingVehicle;

  const AddVehiclePage({super.key, this.editingVehicle});

  @override
  State<AddVehiclePage> createState() => _AddVehiclePageState();
}

class _AddVehiclePageState extends State<AddVehiclePage> {
  final _service = VehicleService();
  final _formKey = GlobalKey<FormState>();

  bool _isLoading = false;

  final _licensePlateController = TextEditingController();
  final _frontTyresController = TextEditingController();
  final _rearTyresController = TextEditingController();
  final _batteryDetailsController = TextEditingController();
  final _pickupDropPriceController = TextEditingController();
  final String _type = 'Car';
  String? _fuelType = 'Petrol';
  String? _year;

  static const _fuelTypeOptions = ['Petrol', 'Diesel', 'EV', 'CNG', 'Hybrid'];

  /// Catalogue rows have a year range ("2016–2020" / "2021 onwards"); true
  /// when the row covers [year], or when the year/range is unknown.
  static bool _rowCoversYear(Map<String, dynamic> r, int? year) {
    final from = int.tryParse('${r['year_from'] ?? ''}');
    if (year == null || year <= 0 || from == null || from <= 0) return true;
    final to = int.tryParse('${r['year_to'] ?? ''}');
    return year >= from && (to == null || year <= to);
  }

  int? get _selectedYear => int.tryParse(_year ?? '');

  /// Current year back to 1990, newest first — parity with web.
  static final _yearOptions = List.generate(
    DateTime.now().year - 1989,
    (i) => '${DateTime.now().year - i}',
  );

  // Brand → Model → Variant are dropdowns sourced from the Vehicle
  // Reference Data catalog (admin-managed) instead of free text, so
  // customers only ever pick models the workshop actually has priced.
  List<Map<String, dynamic>> _allReferences = [];
  bool _isLoadingReferences = false;
  String? _selectedBrand;
  String? _selectedModel;
  String? _selectedVariant;
  // Bumped after a Vahan autofill so the searchable fields rebuild with the new values.
  int _fillTick = 0;
  // 'auto' | 'manual' once picked under the registration field; details show then.
  String? _entryMode;

  bool get _isEditing => widget.editingVehicle != null;

  @override
  void initState() {
    super.initState();
    final editing = widget.editingVehicle;
    if (editing != null) {
      _licensePlateController.text = editing.licensePlate;
      _frontTyresController.text = editing.frontTyres ?? '';
      _rearTyresController.text = editing.rearTyres ?? '';
      _batteryDetailsController.text = editing.batteryDetails ?? '';
      _pickupDropPriceController.text = editing.pickupDropPrice ?? '';
      _selectedBrand = editing.make;
      _selectedModel = editing.model;
      _selectedVariant = editing.variant;
      _fuelType = _normalizeFuelType(editing.fuelType) ?? editing.fuelType;
      if (_yearOptions.contains('${editing.year}')) _year = '${editing.year}';
    }
    _loadReferenceCatalog();
  }

  @override
  void dispose() {
    _licensePlateController.dispose();
    _frontTyresController.dispose();
    _rearTyresController.dispose();
    _batteryDetailsController.dispose();
    _pickupDropPriceController.dispose();
    super.dispose();
  }

  Future<void> _loadReferenceCatalog() async {
    setState(() => _isLoadingReferences = true);
    try {
      final refs = await _service.listAllReferences();
      if (mounted) setState(() => _allReferences = refs);
    } catch (e) {
      debugPrint('Failed to load vehicle reference catalog: $e');
    } finally {
      if (mounted) setState(() => _isLoadingReferences = false);
    }
  }

  List<String> get _brandOptions {
    final set = <String>{};
    for (final r in _allReferences) {
      final b = (r['brand_name'] ?? '').toString().trim();
      if (b.isNotEmpty) set.add(b);
    }
    return set.toList()..sort();
  }

  List<String> get _modelOptions {
    if (_selectedBrand == null) return [];
    final set = <String>{};
    for (final r in _allReferences) {
      if ((r['brand_name'] ?? '').toString() == _selectedBrand) {
        final m = (r['model'] ?? '').toString().trim();
        if (m.isNotEmpty) set.add(m);
      }
    }
    return set.toList()..sort();
  }

  List<String> get _variantOptions {
    if (_selectedBrand == null || _selectedModel == null) return [];
    final rows = _allReferences
        .where(
          (r) =>
              (r['brand_name'] ?? '').toString() == _selectedBrand &&
              (r['model'] ?? '').toString() == _selectedModel,
        )
        .toList();
    // Only variants sold in the chosen year, when the catalogue has a period for it.
    final inYear = rows.where((r) => _rowCoversYear(r, _selectedYear)).toList();
    final set = <String>{};
    for (final r in (inYear.isNotEmpty ? inYear : rows)) {
      final v = (r['brand_model'] ?? '').toString().trim();
      if (v.isNotEmpty) set.add(v);
    }
    return set.toList()..sort();
  }

  /// Fuel types actually offered for the selected brand/model(/variant) in
  /// the catalog — e.g. an Elite i20 2018 Asta(O) only has Petrol/Diesel
  /// rows, so EV shouldn't be selectable for it. Falls back to the full
  /// static list until a brand/model is picked, or if no row has a
  /// recognized fuel type.
  List<String> get _fuelOptions {
    if (_selectedBrand == null || _selectedModel == null) {
      return _fuelTypeOptions;
    }
    final set = <String>{};
    for (final r in _allReferences) {
      if ((r['brand_name'] ?? '').toString() == _selectedBrand &&
          (r['model'] ?? '').toString() == _selectedModel &&
          (_selectedVariant == null ||
              (r['brand_model'] ?? '').toString() == _selectedVariant)) {
        final fuel = _normalizeFuelType((r['fuel_type'] ?? '').toString());
        if (fuel != null) set.add(fuel);
      }
    }
    if (set.isEmpty) return _fuelTypeOptions;
    return _fuelTypeOptions.where(set.contains).toList();
  }

  Map<String, dynamic>? get _matchedReference {
    if (_selectedBrand == null || _selectedModel == null) return null;
    // Prefer the chosen year's period, then the fuel already chosen (e.g.
    // Diesel from Vahan) — parity with web AddVehiclePage.
    final rows = _allReferences.where((r) {
      final matchesVariant =
          _selectedVariant == null ||
          (r['brand_model'] ?? '').toString() == _selectedVariant;
      return (r['brand_name'] ?? '').toString() == _selectedBrand &&
          (r['model'] ?? '').toString() == _selectedModel &&
          matchesVariant;
    }).toList();
    final yearRows = rows
        .where((r) => _rowCoversYear(r, _selectedYear))
        .toList();
    final pool = yearRows.isNotEmpty ? yearRows : rows;
    for (final r in pool) {
      if (_fuelType != null &&
          _normalizeFuelType(r['fuel_type']?.toString()) == _fuelType) {
        return r;
      }
    }
    return pool.isEmpty ? null : pool.first;
  }

  /// Clears _fuelType if it's no longer one of the options offered for the
  /// current brand/model/variant selection, rather than leaving a stale
  /// value (e.g. EV picked, then brand changed to one with no EV rows).
  void _resetFuelTypeIfInvalid() {
    if (_fuelType != null && !_fuelOptions.contains(_fuelType)) {
      _fuelType = null;
    }
  }

  void _onBrandChanged(String? value) {
    setState(() {
      _selectedBrand = value;
      _selectedModel = null;
      _selectedVariant = null;
      _resetFuelTypeIfInvalid();
    });
  }

  void _onModelChanged(String? value) {
    setState(() {
      _selectedModel = value;
      _selectedVariant = null;
      _resetFuelTypeIfInvalid();
    });
    _applyReferenceAutofill();
  }

  void _onVariantChanged(String? value) {
    setState(() {
      _selectedVariant = value;
      _resetFuelTypeIfInvalid();
    });
    _applyReferenceAutofill();
  }

  void _applyReferenceAutofill() {
    final ref = _matchedReference;
    if (ref == null) return;
    setState(() {
      if (ref['front_tyres'] != null) {
        _frontTyresController.text = ref['front_tyres'].toString();
      }
      if (ref['rear_tyres'] != null) {
        _rearTyresController.text = ref['rear_tyres'].toString();
      }
      if (ref['battery_details'] != null) {
        _batteryDetailsController.text = ref['battery_details'].toString();
      }
      if (ref['pickup_drop_price'] != null) {
        _pickupDropPriceController.text = ref['pickup_drop_price'].toString();
      }
      final fuel = _normalizeFuelType(ref['fuel_type']?.toString());
      if (fuel != null) {
        _fuelType = fuel;
      }
    });
  }

  String? _normalizeFuelType(String? raw) {
    final v = (raw ?? '').trim().toLowerCase();
    if (v == 'petrol') return 'Petrol';
    if (v == 'diesel') return 'Diesel';
    if (v.contains('hybrid')) return 'Hybrid';
    if (v.contains('cng')) return 'CNG';
    if (v == 'ev' || v.contains('electric')) return 'EV';
    return null;
  }

  /// Matches a free-text value (e.g. from RC lookup) against the given
  /// catalog options case-insensitively, so it can populate a dropdown
  /// without violating Flutter's "value must be one of items" requirement.
  String? _matchOption(String? raw, List<String> options) {
    final v = (raw ?? '').trim();
    if (v.isEmpty) return null;
    for (final o in options) {
      if (o.toLowerCase() == v.toLowerCase()) return o;
    }
    return null;
  }

  String _norm(String s) =>
      s.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9*]'), '');

  /// Same matching as web lib/vahanMatch.ts: maker strings like
  /// "HYUNDAI MOTOR INDIA LTD" (or masked "Hy****td") → catalog brand.
  String? _matchBrand(String maker) {
    if (maker.isEmpty) return null;
    final m = _norm(maker);
    final brands = _brandOptions;
    if (!m.contains('*')) {
      final hits =
          brands.where((b) => b.isNotEmpty && m.contains(_norm(b))).toList()
            ..sort((a, b) => b.length.compareTo(a.length));
      if (hits.isNotEmpty) return hits.first;
      final first = m.length >= 4 ? m.substring(0, 4) : m;
      for (final b in brands) {
        if (_norm(b).startsWith(first)) return b;
      }
      return null;
    }
    final prefix = m.split('*').first;
    if (prefix.length < 2) return null;
    final hits = brands.where((b) => _norm(b).startsWith(prefix)).toList();
    return hits.length == 1 ? hits.first : null;
  }

  static const _trimNoise = {
    'BSIV',
    'BSVI',
    'BS4',
    'BS6',
    'BSIII',
    'BS3',
    'BHARAT',
    'STAGE',
    'AT',
    'MT',
    'AMT',
  };
  // "HTK+" (catalogue) and "HTK PLUS" (Vahan) are the same trim — parity
  // with web vahanMatch.ts.
  List<String> _words(String s) => s
      .toUpperCase()
      .replaceAll(RegExp(r'\s*\+'), 'PLUS')
      .replaceAll(RegExp(r'\s+PLUS\b'), 'PLUS')
      .replaceAll(RegExp(r'[()]'), ' ')
      .split(RegExp(r'[^A-Z0-9]+'))
      .where((w) => w.length >= 2 && !_trimNoise.contains(w))
      .toList();

  /// Vahan "I20 ASTA-CRDI BSIV" + catalog "2012 [ Asta ]": most shared trim
  /// words, then same fuel, then newest generation year <= manufacturing
  /// year. Returns null on a tie so the user chooses.
  /// Vahan badge ("E 220 D" → E220D, "520D") → (catalogue model, variant or
  /// null when several trims share it). Null unless exactly one model fits.
  (String, String?)? _matchModelByBadge(
    String vahanModel,
    String? fuel,
    int? year,
  ) {
    if (vahanModel.isEmpty || vahanModel.contains('*')) return null;
    final brandWords = {
      ..._words(_selectedBrand ?? ''),
      'MERCEDES',
      'BENZ',
      'MOTORS',
      'INDIA',
      'LTD',
    };
    // Keep single letters: the badge is "E 220 D", not "220".
    final v = vahanModel
        .toUpperCase()
        .split(RegExp(r'[^A-Z0-9]+'))
        .where(
          (w) =>
              w.isNotEmpty &&
              !brandWords.contains(w) &&
              !_trimNoise.contains(w),
        )
        .join();
    final badge = RegExp(r'^[A-Z]{0,4}\d{2,3}[A-Z]?').firstMatch(v)?.group(0);
    if (badge == null || !RegExp(r'\d').hasMatch(badge)) return null;
    String compact(String s) =>
        s.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
    var cands = _allReferences
        .where(
          (r) =>
              (r['brand_name'] ?? '').toString() == _selectedBrand &&
              compact((r['brand_model'] ?? '').toString()).startsWith(badge),
        )
        .toList();
    if (cands.isEmpty) return null;
    final inYear = cands.where((r) => _rowCoversYear(r, year)).toList();
    if (inYear.isNotEmpty) cands = inYear;
    if (fuel != null) {
      final byFuel = cands
          .where((r) => _normalizeFuelType(r['fuel_type']?.toString()) == fuel)
          .toList();
      if (byFuel.isNotEmpty) cands = byFuel;
    }
    final models = cands
        .map((r) => (r['model'] ?? '').toString().trim())
        .where((m) => m.isNotEmpty)
        .toSet();
    if (models.length != 1) return null;
    final variants = cands
        .map((r) => (r['brand_model'] ?? '').toString().trim())
        .toSet();
    return (models.first, variants.length == 1 ? variants.first : null);
  }

  String? _matchVariant(String vahanModel, String? fuel, int? year) {
    if (vahanModel.isEmpty ||
        vahanModel.contains('*') ||
        _selectedModel == null) {
      return null;
    }
    final modelWords = _words(_selectedModel!).toSet();
    final trim = _words(
      vahanModel,
    ).where((w) => !modelWords.contains(w)).toList();
    if (trim.isEmpty) return null;
    final best = <String, double>{};
    // PDF: filter by year range first, then narrow by variant.
    final modelRows = _allReferences
        .where(
          (r) =>
              (r['brand_name'] ?? '').toString() == _selectedBrand &&
              (r['model'] ?? '').toString() == _selectedModel,
        )
        .toList();
    final inPeriod = modelRows.where((r) => _rowCoversYear(r, year)).toList();
    for (final r in (inPeriod.isNotEmpty ? inPeriod : modelRows)) {
      final v = (r['brand_model'] ?? '').toString().trim();
      if (v.isEmpty) continue;
      final vw = _words(v).toSet();
      double score = 0;
      for (final t in trim) {
        if (vw.contains(t)) {
          score += 10;
        } else if (vw.any(
          (w) => w.length >= 3 && (w.startsWith(t) || t.startsWith(w)),
        )) {
          score += 6;
        }
      }
      if (score == 0) continue;
      if (fuel != null &&
          _normalizeFuelType(r['fuel_type']?.toString()) == fuel) {
        score += 3;
      }
      final from = int.tryParse('${r['year_from'] ?? ''}');
      if (year != null && from != null && from > 0) {
        // Catalogue rows carry a year range: the manufacturing year must
        // fall inside it (PDF lookup rule) — parity with web vahanMatch.ts.
        score += _rowCoversYear(r, year) ? 4 : -4;
      } else if (year != null) {
        final ys = RegExp(
          r'(19|20)\d{2}',
        ).allMatches(v).map((m) => int.parse(m.group(0)!)).toList();
        final eligible = ys.where((y) => y <= year).toList();
        if (eligible.isNotEmpty) {
          final gen = eligible.reduce((a, b) => a > b ? a : b);
          score += 2 + (gen - 1900) / 1000;
        } else if (ys.isNotEmpty) {
          score -= 2;
        }
      }
      if (!best.containsKey(v) || score > best[v]!) best[v] = score;
    }
    if (best.isEmpty) return null;
    final ranked = best.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    if (ranked.length > 1 && ranked[0].value == ranked[1].value) return null;
    return ranked.first.key;
  }

  void _applyVahanResult(Map<String, dynamic> r) {
    final brand = _matchBrand((r['maker'] ?? '').toString());
    setState(() {
      if (brand != null) {
        _selectedBrand = brand;
        _selectedVariant = null;
        _selectedModel = null;
        final vm = (r['model'] ?? '').toString();
        if (vm.isNotEmpty && !vm.contains('*')) {
          final nvm = _norm(vm);
          // Offsets where a Vahan word starts: a model matching at a word
          // start beats one buried mid-word ("GLA-CLASS" → GLA, not A-Class).
          final starts = <int>{};
          var pos = 0;
          for (final tok in vm.toUpperCase().split(RegExp(r'[^A-Z0-9*]+'))) {
            if (tok.isEmpty) continue;
            starts.add(pos);
            pos += tok.length;
          }
          final hits =
              _modelOptions
                  .where((m) => m.isNotEmpty && nvm.contains(_norm(m)))
                  .toList()
                ..sort((a, b) {
                  final ia = nvm.indexOf(_norm(a));
                  final ib = nvm.indexOf(_norm(b));
                  final sa = starts.contains(ia) ? 1 : 0;
                  final sb = starts.contains(ib) ? 1 : 0;
                  if (sa != sb) return sb - sa;
                  if (a.length != b.length) return b.length - a.length;
                  return ia - ib;
                });
          if (hits.isNotEmpty) _selectedModel = hits.first;
        }
      }
      final fuel = _normalizeFuelType((r['fuelType'] ?? '').toString());
      if (fuel != null && _fuelOptions.contains(fuel)) _fuelType = fuel;
      if (_yearOptions.contains('${r['year']}')) _year = '${r['year']}';
      final y = r['year'];
      final year = y is int ? y : int.tryParse('$y');
      if (_selectedModel != null) {
        _selectedVariant = _matchVariant(
          (r['model'] ?? '').toString(),
          fuel,
          year,
        );
      } else if (_selectedBrand != null) {
        // Badge-style models (Mercedes "E 220 D", BMW "520D") → family via
        // the variants — parity with web vahanMatch.matchModelByBadge.
        final byBadge = _matchModelByBadge(
          (r['model'] ?? '').toString(),
          fuel,
          year,
        );
        if (byBadge != null) {
          _selectedModel = byBadge.$1;
          _selectedVariant = byBadge.$2;
        }
      }
      _resetFuelTypeIfInvalid();
      _fillTick++;
    });
    if (_selectedModel != null) _applyReferenceAutofill();
  }

  Future<void> _handleFinalSubmit() async {
    if (!_isEditing && _entryMode == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tap Search to look up the vehicle details.'),
        ),
      );
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    if (_selectedBrand == null ||
        _selectedModel == null ||
        _selectedVariant == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a brand, model and variant'),
        ),
      );
      return;
    }
    if (_year == null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Please select the year')));
      return;
    }
    if (_fuelType == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a fuel type')),
      );
      return;
    }

    setState(() => _isLoading = true);
    try {
      final editing = widget.editingVehicle;
      if (editing != null) {
        await _service.updateVehicle(
          editing.id,
          licensePlate: _licensePlateController.text.trim().toUpperCase(),
          make: _selectedBrand!,
          model: _selectedModel!,
          variant: _selectedVariant,
          year: int.tryParse(_year ?? ''),
          fuelType: _fuelType,
          frontTyres: _frontTyresController.text.trim(),
          rearTyres: _rearTyresController.text.trim(),
        );
      } else {
        await _service.addVehicle(
          licensePlate: _licensePlateController.text.trim().toUpperCase(),
          make: _selectedBrand!,
          model: _selectedModel!,
          variant: _selectedVariant,
          year: int.tryParse(_year ?? ''),
          type: _type,
          fuelType: _fuelType,
          frontTyres: _frontTyresController.text.trim(),
          rearTyres: _rearTyresController.text.trim(),
          batteryDetails: _batteryDetailsController.text.trim(),
          pickupDropPrice: _pickupDropPriceController.text.trim(),
        );
      }
      _service.clearCache();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _isEditing
                  ? 'Vehicle updated successfully!'
                  : 'Vehicle added successfully!',
            ),
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _isEditing
                  ? 'Failed to update vehicle: $e'
                  : 'Failed to add vehicle: $e',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: isDark
          ? AppColors.backgroundPrimary
          : AppColors.backgroundPrimaryLight,
      appBar: AppBar(
        centerTitle: true,
        title: Text(
          _isEditing ? 'Edit Vehicle' : 'Add Vehicle',
          style: TextStyle(
            color: isDark ? Colors.white : Colors.black,
            fontWeight: FontWeight.bold,
          ),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: _buildForm(),
      ),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _isEditing ? 'Edit Vehicle Details' : 'Confirm Vehicle Details',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 24),
          VahanLookupSection(
            plateController: _licensePlateController,
            allowLookup: !_isEditing,
            showDetails: false,
            onResult: _applyVahanResult,
            onModeChanged: (m) => setState(() => _entryMode = m),
            describeFill: (_) =>
                _selectedBrand != null && _selectedModel != null
                ? 'Brand, model and fuel filled in. Pick the variant and check the details below.'
                : _selectedBrand != null
                ? 'Brand filled in. Choose the model and variant below.'
                : 'Some details are hidden by Vahan without owner consent. Choose brand, model and variant below.',
          ),
          if (_isEditing || _entryMode != null) ...[
            const SizedBox(height: 16),
            if (_isLoadingReferences && _allReferences.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Center(
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            else ...[
              _buildAutocompleteField(
                key: ValueKey('brand-field-$_fillTick'),
                label: 'Brand',
                options: _brandOptions,
                selectedValue: _selectedBrand,
                onSelected: _onBrandChanged,
                hint: 'Type to search brand',
                required: true,
              ),
              const SizedBox(height: 16),
              _buildAutocompleteField(
                // Resetting the key when the brand changes forces the field to
                // rebuild with a fresh internal controller, clearing stale text.
                key: ValueKey('model-field-$_selectedBrand-$_fillTick'),
                label: 'Model',
                options: _modelOptions,
                selectedValue: _selectedModel,
                onSelected: _onModelChanged,
                hint: _selectedBrand == null
                    ? 'Select brand first'
                    : 'Type to search model',
                enabled: _selectedBrand != null,
                required: true,
                matchAnywhere: true,
              ),
              const SizedBox(height: 16),
              _buildAutocompleteField(
                key: ValueKey(
                  'variant-field-$_selectedBrand-$_selectedModel-$_fillTick',
                ),
                label: 'Variant/Class',
                options: _variantOptions,
                selectedValue: _selectedVariant,
                onSelected: _onVariantChanged,
                hint: _selectedModel == null
                    ? 'Select model first'
                    : 'Type to search variant',
                enabled: _selectedModel != null,
                required: true,
                matchAnywhere: true,
              ),
            ],
            const SizedBox(height: 16),
            _buildDropdownField(
              'Year',
              _year,
              _yearOptions,
              (v) {
                setState(() => _year = v);
                _applyReferenceAutofill(); // year picks the catalogue period
              },
              hint: 'Select year',
              required: true,
            ),
            const SizedBox(height: 16),
            _buildDropdownField(
              'Fuel Type',
              // Guard against a DropdownButton assertion error if _fuelType
              // was set before _fuelOptions had narrowed (e.g. while the
              // catalog is still loading, or when editing a vehicle whose
              // saved fuel type is no longer offered for its variant).
              _fuelOptions.contains(_fuelType) ? _fuelType : null,
              _fuelOptions,
              (v) => setState(() => _fuelType = v),
              hint: 'Select fuel type',
              required: true,
            ),
          ],
          // Save shows only after Search (or when editing), with the fields.
          if (_isEditing || _entryMode != null) ...[
            const SizedBox(height: 32),
            Container(
              width: double.infinity,
              height: 54,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.primaryBlue, AppColors.primaryBlueDark],
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleFinalSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  foregroundColor: AppColors.textPrimary,
                ),
                child: _isLoading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          color: AppColors.textPrimary,
                          strokeWidth: 2,
                        ),
                      )
                    : Text(
                        _isEditing ? 'Update Vehicle' : 'Save Vehicle',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
              ),
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildDropdownField(
    String label,
    String? value,
    List<String> items,
    Function(String?) onChanged, {
    String? hint,
    bool required = false,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final enabled = items.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          required ? '$label *' : label,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: isDark
                ? AppColors.backgroundSecondary
                : AppColors.backgroundSecondaryLight,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isDark
                  ? AppColors.borderColor
                  : AppColors.borderColorLight,
            ),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              isExpanded: true,
              hint: Text(
                hint ?? 'Select',
                style: TextStyle(
                  color: isDark
                      ? AppColors.textMuted
                      : AppColors.textMutedLight,
                ),
              ),
              dropdownColor: isDark
                  ? AppColors.backgroundSurface
                  : AppColors.backgroundSurfaceLight,
              style: TextStyle(
                color: isDark ? AppColors.textPrimary : Colors.black87,
              ),
              items: items
                  .map((i) => DropdownMenuItem(value: i, child: Text(i)))
                  .toList(),
              onChanged: enabled ? onChanged : null,
            ),
          ),
        ),
      ],
    );
  }

  /// Type-to-search field: filters [options] as the user types and shows a
  /// suggestion list, instead of requiring an open-then-scroll dropdown.
  /// Pass a `key` that changes whenever the field should reset (e.g. when
  /// its parent selection changes), since [Autocomplete] owns its internal
  /// controller and won't otherwise pick up an external value change.
  Widget _buildAutocompleteField({
    Key? key,
    required String label,
    required List<String> options,
    required String? selectedValue,
    required ValueChanged<String?> onSelected,
    String? hint,
    bool required = false,
    bool enabled = true,
    bool matchAnywhere = false,
  }) {
    return _SearchableDropdownField(
      key: key,
      label: label,
      options: options,
      selectedValue: selectedValue,
      onSelected: onSelected,
      hint: hint,
      required: required,
      enabled: enabled,
      matchOption: _matchOption,
      matchAnywhere: matchAnywhere,
    );
  }
}

/// A text field that shows a filterable dropdown of [options] as soon as
/// it's focused (not just once the user has typed something) — the full
/// list on focus, narrowing as they type. Built on a self-owned
/// FocusNode + OverlayEntry rather than [Autocomplete], since Autocomplete
/// only recomputes its options list on a text *change* event, so it never
/// has anything to show on the very first focus of an empty field.
class _SearchableDropdownField extends StatefulWidget {
  final String label;
  final List<String> options;
  final String? selectedValue;
  final ValueChanged<String?> onSelected;
  final String? hint;
  final bool required;
  final bool enabled;
  final String? Function(String? raw, List<String> options) matchOption;

  /// false (default, e.g. Brand): only options starting with the typed
  /// text match. true (e.g. Model/Variant): the typed text can match
  /// anywhere in the option, so "i20" finds "Elite i20" and "asta" finds
  /// every variant with "Asta" in it.
  final bool matchAnywhere;

  const _SearchableDropdownField({
    super.key,
    required this.label,
    required this.options,
    required this.selectedValue,
    required this.onSelected,
    required this.matchOption,
    this.hint,
    this.required = false,
    this.enabled = true,
    this.matchAnywhere = false,
  });

  @override
  State<_SearchableDropdownField> createState() =>
      _SearchableDropdownFieldState();
}

class _SearchableDropdownFieldState extends State<_SearchableDropdownField> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;
  final LayerLink _layerLink = LayerLink();
  final GlobalKey _fieldKey = GlobalKey();
  OverlayEntry? _overlayEntry;
  List<String> _filtered = const [];

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.selectedValue ?? '');
    _focusNode = FocusNode();
    _focusNode.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    _controller.dispose();
    _removeOverlay();
    super.dispose();
  }

  void _onFocusChange() {
    if (_focusNode.hasFocus) {
      _updateFilteredAndShow(_controller.text);
    } else {
      _removeOverlay();
    }
  }

  void _updateFilteredAndShow(String query) {
    if (!widget.enabled) return;
    final q = query.trim().toLowerCase();
    _filtered = q.isEmpty
        ? widget.options
        : widget.options
              .where(
                (o) => widget.matchAnywhere
                    ? o.toLowerCase().contains(q)
                    : o.toLowerCase().startsWith(q),
              )
              .toList();
    if (_filtered.isEmpty) {
      _removeOverlay();
      return;
    }
    if (_overlayEntry == null) {
      _overlayEntry = _buildOverlayEntry();
      Overlay.of(context).insert(_overlayEntry!);
    } else {
      _overlayEntry!.markNeedsBuild();
    }
  }

  void _removeOverlay() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  void _selectOption(String option) {
    _controller.text = option;
    _controller.selection = TextSelection.collapsed(offset: option.length);
    widget.onSelected(option);
    _removeOverlay();
    _focusNode.unfocus();
  }

  OverlayEntry _buildOverlayEntry() {
    return OverlayEntry(
      builder: (context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        final renderBox =
            _fieldKey.currentContext?.findRenderObject() as RenderBox?;
        final width = renderBox?.size.width ?? 280;
        return Positioned(
          width: width,
          child: CompositedTransformFollower(
            link: _layerLink,
            showWhenUnlinked: false,
            offset: const Offset(0, 56),
            child: Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(12),
                color: isDark
                    ? AppColors.backgroundSurface
                    : AppColors.backgroundSurfaceLight,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 280),
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    shrinkWrap: true,
                    itemCount: _filtered.length,
                    itemBuilder: (context, index) {
                      final option = _filtered[index];
                      return InkWell(
                        onTap: () => _selectOption(option),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 12,
                          ),
                          child: Text(
                            option,
                            style: TextStyle(
                              color: isDark
                                  ? AppColors.textPrimary
                                  : Colors.black87,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  void didUpdateWidget(covariant _SearchableDropdownField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.selectedValue != oldWidget.selectedValue &&
        widget.selectedValue != _controller.text) {
      _controller.text = widget.selectedValue ?? '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.required ? '${widget.label} *' : widget.label,
          style: Theme.of(
            context,
          ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        CompositedTransformTarget(
          key: _fieldKey,
          link: _layerLink,
          child: TextField(
            controller: _controller,
            focusNode: _focusNode,
            enabled: widget.enabled,
            style: TextStyle(
              color: isDark ? AppColors.textPrimary : Colors.black87,
            ),
            onChanged: (v) {
              if (v.trim().isEmpty && widget.selectedValue != null) {
                widget.onSelected(null);
              }
              // Auto-accept an exact (case-insensitive) match without
              // forcing the user to tap the suggestion.
              final match = widget.matchOption(v, widget.options);
              if (match != null && match != widget.selectedValue) {
                widget.onSelected(match);
              }
              _updateFilteredAndShow(v);
            },
            decoration: InputDecoration(
              hintText: widget.enabled
                  ? (widget.hint ?? 'Type to search')
                  : widget.hint,
              hintStyle: TextStyle(
                color: isDark ? AppColors.textMuted : AppColors.textMutedLight,
              ),
              suffixIcon: Icon(
                Icons.keyboard_arrow_down,
                color: widget.enabled
                    ? (isDark ? AppColors.textMuted : AppColors.textMutedLight)
                    : (isDark
                          ? AppColors.textMuted.withValues(alpha: 0.4)
                          : AppColors.textMutedLight.withValues(alpha: 0.4)),
              ),
              filled: true,
              fillColor: isDark
                  ? AppColors.backgroundSecondary
                  : AppColors.backgroundSecondaryLight,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: isDark
                      ? AppColors.borderColor
                      : AppColors.borderColorLight,
                ),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: isDark
                      ? AppColors.borderColor
                      : AppColors.borderColorLight,
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(
                  color: AppColors.primaryBlue,
                  width: 2,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
