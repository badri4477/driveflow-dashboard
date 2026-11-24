import '../models/vehicle.dart';

/// One customer-facing vehicle fact — parity with web `lib/vehicleInfo.ts`.
class VehicleInfoRow {
  final String label;
  final String value;

  /// True for a validity date that is already in the past.
  final bool expired;

  const VehicleInfoRow(this.label, this.value, {this.expired = false});
}

const _months = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/// Parses Vahan dates ("14-Mar-2026", "14/03/2026", "2026-03-14").
DateTime? parseVahanDate(String? s) {
  final t = (s ?? '').trim();
  var m = RegExp(
    r'^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$',
  ).firstMatch(t);
  if (m != null) {
    final mi = _months.indexOf(m.group(2)!.toLowerCase());
    return mi < 0
        ? null
        : DateTime(int.parse(m.group(3)!), mi + 1, int.parse(m.group(1)!));
  }
  m = RegExp(r'^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$').firstMatch(t);
  if (m != null) {
    return DateTime(
      int.parse(m.group(3)!),
      int.parse(m.group(2)!),
      int.parse(m.group(1)!),
    );
  }
  m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(t);
  if (m != null) {
    return DateTime(
      int.parse(m.group(1)!),
      int.parse(m.group(2)!),
      int.parse(m.group(3)!),
    );
  }
  return null;
}

bool _isPast(String? s) {
  final d = parseVahanDate(s);
  if (d == null) return false;
  final now = DateTime.now();
  return d.isBefore(DateTime(now.year, now.month, now.day));
}

/// The facts shown on My Vehicles, in order. Body type, colour, manufacturing
/// month/year and validity dates come from Vahan, so they're '' for manual entries.
List<VehicleInfoRow> vehicleInfoRows(Vehicle v) => [
  VehicleInfoRow('Registration number', v.licensePlate),
  VehicleInfoRow('Make', v.make),
  VehicleInfoRow('Model', v.model),
  VehicleInfoRow('Body type', v.bodyType ?? ''),
  VehicleInfoRow('Fuel type', v.fuelType ?? ''),
  VehicleInfoRow('Colour', v.color ?? ''),
  VehicleInfoRow('Manufacturing month/year', v.manufacturingMonthYear ?? ''),
  VehicleInfoRow(
    'Insurance valid till',
    v.insuranceValidUpto ?? '',
    expired: _isPast(v.insuranceValidUpto),
  ),
  VehicleInfoRow(
    'Registration valid till',
    v.registrationValidUpto ?? '',
    expired: _isPast(v.registrationValidUpto),
  ),
];
