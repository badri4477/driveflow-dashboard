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

export interface VahanFill { licensePlate?: string; make?: string; model?: string; variant?: string; fuelType?: string }

// Engine/emission words that say nothing about the trim level.
const NOISE = new Set(['BSIV', 'BSVI', 'BS4', 'BS6', 'BSIII', 'BS3', 'BHARAT', 'STAGE', 'AT', 'MT', 'AMT']);
const words = (s: string) =>
  s.toUpperCase().replace(/[()]/g, ' ').split(/[^A-Z0-9]+/).filter((w) => w.length >= 2 && !NOISE.has(w));

/** Vahan gives model + trim in one string (e.g. "I20 ASTA-CRDI BSIV"). Pick the catalog variant
 *  (brand_model, e.g. "Elite i20 2018 Asta(O)") sharing the most trim words, preferring rows with the
 *  same fuel and manufacturing year. Returns '' unless one variant clearly wins. */
export function matchVariant(vahanModel: string, model: string, rows: CatalogRow[], fuel?: string, year?: number | null): string {
  if (!vahanModel || vahanModel.includes('*') || rows.length === 0) return '';
  const modelWords = new Set(words(model));
  const trim = words(vahanModel).filter((w) => !modelWords.has(w));
  if (trim.length === 0) return '';
  const best = new Map<string, number>();
  for (const r of rows) {
    const v = (r.brand_model || '').trim();
    if (!v) continue;
    const vw = new Set(words(v));
    let score = 0;
    for (const t of trim) {
      if (vw.has(t)) score += 10;
      else if ([...vw].some((w) => w.length >= 3 && (w.startsWith(t) || t.startsWith(w)))) score += 6;
    }
    if (score === 0) continue;
    if (fuel && (r.fuel_type || '').toLowerCase() === fuel.toLowerCase()) score += 3;
    if (year) {
      const ys = v.match(/(19|20)\d{2}/g)?.map(Number) || [];
      // Catalog variants are "<generation year> [ Trim ]": a 2015 car is the 2012 generation, not 2008 or 2020.
      const gen = Math.max(-1, ...ys.filter((y) => y <= year));
      if (gen > 0) score += 2 + (gen - 1900) / 1000; // newer eligible generation wins ties
      else if (ys.length) score -= 2; // only generations newer than the car
    }
    if (!best.has(v) || score > best.get(v)!) best.set(v, score);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return '';
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return ''; // tie → let the user choose
  return ranked[0][0];
}

export function buildFill(v: VahanVehicle, catalog: CatalogRow[], fuelOptions: string[]): VahanFill {
  const brands = Array.from(new Set(catalog.map((r) => (r.brand_name || '').trim()).filter(Boolean)));
  const make = matchBrand(v.maker, brands);
  const models = make
    ? Array.from(new Set(catalog.filter((r) => r.brand_name === make).map((r) => (r.model || '').trim()).filter(Boolean)))
    : [];
  const model = make ? matchModel(v.model, models) : '';
  const fuelType = matchFuel(v.fuelType, fuelOptions);
  const variant = make && model
    ? matchVariant(v.model, model, catalog.filter((r) => r.brand_name === make && r.model === model), fuelType, v.year)
    : '';
  return {
    licensePlate: v.registrationNumber || undefined,
    make: make || undefined,
    model: model || undefined,
    variant: variant || undefined,
    fuelType,
  };
}
