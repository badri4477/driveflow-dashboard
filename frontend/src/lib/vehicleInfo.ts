import type { Vehicle } from '@/services/vehicleService';

export interface VehicleInfoRow {
  label: string;
  value: string;
  /** True for a validity date that is already in the past. */
  expired?: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parses Vahan dates ("14-Mar-2026", "14/03/2026", "2026-03-14"); null if unrecognised. */
export const parseVahanDate = (s?: string): Date | null => {
  const t = (s || '').trim();
  let m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    return mi < 0 ? null : new Date(Number(m[3]), mi, Number(m[1]));
  }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
};

const isPast = (s?: string) => {
  const d = parseVahanDate(s);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
};

/**
 * The customer-facing vehicle facts shown on My Vehicles, in order.
 * Body type, colour, manufacturing month/year and the validity dates come from
 * Vahan at add time, so they're empty ('') for manually-entered vehicles.
 */
export const vehicleInfoRows = (v: Partial<Vehicle>): VehicleInfoRow[] => [
  { label: 'Registration number', value: v.licensePlate || '' },
  { label: 'Make', value: v.make || '' },
  { label: 'Model', value: v.model || '' },
  { label: 'Body type', value: v.bodyType || '' },
  { label: 'Fuel type', value: v.fuelType || '' },
  { label: 'Colour', value: v.color || '' },
  { label: 'Manufacturing month/year', value: v.manufacturingMonthYear || '' },
  { label: 'Insurance valid till', value: v.insuranceValidUpto || '', expired: isPast(v.insuranceValidUpto) },
  { label: 'Registration valid till', value: v.registrationValidUpto || '', expired: isPast(v.registrationValidUpto) },
];
