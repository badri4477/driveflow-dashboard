import type { VahanVehicle } from '@/services/vehicleService';

export interface CatalogRow { brand_name?: string; model?: string; brand_model?: string; fuel_type?: string; [k: string]: unknown }

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9*]/g, '');

/** Vahan maker strings look like "HYUNDAI MOTOR INDIA LTD" or, without consent, "Hy*****td".
 *  Match against catalog brand names; masked strings are matched by visible prefix. */
export function matchBrand(maker: string, brands: string[]): string {
  if (!maker) return '';
  const m = norm(maker);
  if (!m.includes('*')) {
    // longest brand contained in the maker string wins ("MARUTI SUZUKI" over "SUZUKI")
    const hits = brands.filter((b) => b && m.includes(norm(b))).sort((a, b) => b.length - a.length);
    if (hits[0]) return hits[0];
    const first = m.slice(0, 4);
    return brands.find((b) => norm(b).startsWith(first)) || '';
  }
  const prefix = m.split('*')[0];
  if (prefix.length < 2) return '';
  const hits = brands.filter((b) => norm(b).startsWith(prefix));
  return hits.length === 1 ? hits[0] : '';
}

export function matchModel(vahanModel: string, models: string[]): string {
  if (!vahanModel || vahanModel.includes('*')) return '';
  const vm = norm(vahanModel);
  const hits = models.filter((m) => m && vm.includes(norm(m))).sort((a, b) => b.length - a.length);
  return hits[0] || '';
}

const FUEL_ALIASES: Record<string, string[]> = { Electric: ['EV', 'Electric'], EV: ['EV', 'Electric'] };
export function matchFuel(f: string, options: string[]): string | undefined {
  if (!f) return undefined;
  const cands = FUEL_ALIASES[f] || [f];
  return options.find((o) => cands.some((c) => c.toLowerCase() === o.toLowerCase()));
}

export interface VahanFill { licensePlate?: string; make?: string; model?: string; fuelType?: string }

export function buildFill(v: VahanVehicle, catalog: CatalogRow[], fuelOptions: string[]): VahanFill {
  const brands = Array.from(new Set(catalog.map((r) => (r.brand_name || '').trim()).filter(Boolean)));
  const make = matchBrand(v.maker, brands);
  const models = make
    ? Array.from(new Set(catalog.filter((r) => r.brand_name === make).map((r) => (r.model || '').trim()).filter(Boolean)))
    : [];
  const model = make ? matchModel(v.model, models) : '';
  return {
    licensePlate: v.registrationNumber || undefined,
    make: make || undefined,
    model: model || undefined,
    fuelType: matchFuel(v.fuelType, fuelOptions),
  };
}
