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
  // Offsets in `vm` where a Vahan word starts ("GLA-CLASS" → 0, 3): a model
  // matching at a word start beats one buried mid-word (GLA over A-Class).
  const starts = new Set<number>();
  let pos = 0;
  for (const tok of vahanModel.toUpperCase().split(/[^A-Z0-9*]+/).filter(Boolean)) {
    starts.add(pos);
    pos += tok.length;
  }
  const hits = models
    .filter((m) => m && vm.includes(norm(m)))
    .map((m) => ({ m, at: vm.indexOf(norm(m)), atStart: starts.has(vm.indexOf(norm(m))) }))
    // word start first, then longest, then earliest ("GLA-CLASS" → GLA, not CLA)
    .sort((a, b) => Number(b.atStart) - Number(a.atStart) || b.m.length - a.m.length || a.at - b.at);
  return hits[0]?.m || '';
}

/** Manufacturing year inside the row's catalogue period (true when either is unknown). */
const rowCovers = (r: CatalogRow, year?: number | null) => {
  const from = Number(r.year_from);
  if (!year || !Number.isFinite(from) || from <= 0) return true;
  const to = r.year_to === null || r.year_to === undefined || r.year_to === '' ? Infinity : Number(r.year_to);
  return year >= from && year <= to;
};

const FUEL_ALIASES: Record<string, string[]> = {
  Electric: ['EV', 'Electric'],
  EV: ['EV', 'Electric'],
  Hybrid: ['Hybrid', 'Strong Hybrid'],
  CNG: ['CNG'],
};
export function matchFuel(f: string, options: string[]): string | undefined {
  if (!f) return undefined;
  const cands = FUEL_ALIASES[f] || [f];
  return options.find((o) => cands.some((c) => c.toLowerCase() === o.toLowerCase()));
}

export interface VahanFill { licensePlate?: string; make?: string; model?: string; variant?: string; fuelType?: string }

// Engine/emission words that say nothing about the trim level.
const NOISE = new Set(['BSIV', 'BSVI', 'BS4', 'BS6', 'BSIII', 'BS3', 'BHARAT', 'STAGE', 'AT', 'MT', 'AMT']);
// "HTK+" (catalogue) and "HTK PLUS" (Vahan) are the same trim — keep the
// plus as its own token so HTK+ never collapses into plain HTK (PDF rule).
const words = (s: string) =>
  s
    .toUpperCase()
    .replace(/\s*\+/g, 'PLUS')
    .replace(/\s+PLUS\b/g, 'PLUS')
    .replace(/[()]/g, ' ')
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w));

/** Vahan gives model + trim in one string (e.g. "I20 ASTA-CRDI BSIV"). Pick the catalog variant
 *  (brand_model, e.g. "Elite i20 2018 Asta(O)") sharing the most trim words, preferring rows with the
 *  same fuel and manufacturing year. Returns '' unless one variant clearly wins. */
export function matchVariant(vahanModel: string, model: string, allRows: CatalogRow[], fuel?: string, year?: number | null): string {
  if (!vahanModel || vahanModel.includes('*') || allRows.length === 0) return '';
  // PDF: filter by year range first, then narrow by variant.
  const inPeriod = allRows.filter((r) => rowCovers(r, year));
  const rows = inPeriod.length ? inPeriod : allRows;

  // Only one trim sold that year with this fuel (e.g. 2017 GLS diesel = GL 350 CDI) → it.
  const sameFuel = fuel ? rows.filter((r) => (r.fuel_type || '').toLowerCase() === fuel.toLowerCase()) : [];
  const onlyVariants = new Set(sameFuel.map((r) => (r.brand_model || '').trim()).filter(Boolean));
  if (inPeriod.length && onlyVariants.size === 1) return [...onlyVariants][0];

  const modelWords = new Set(words(model));
  const trim = words(vahanModel).filter((w) => !modelWords.has(w));
  // Every Vahan token incl. single letters ("CITY 1.5 V MT" → …, V, MT), "+" as PLUS.
  const tokens = vahanModel
    .toUpperCase()
    .replace(/\s*\+/g, ' PLUS')
    .split(/[^A-Z0-9]+/)
    .filter((t) => t && !modelWords.has(t));
  const squash = (s: string) => s.toUpperCase().replace(/\s*\+/g, 'PLUS').replace(/[^A-Z0-9]/g, '');
  // A trim that equals 1–3 consecutive Vahan words exactly ("AX7 L" = AX7+L, "V" = V).
  const exactTrim = (v: string) => {
    const target = squash(v);
    if (!target) return false;
    for (let i = 0; i < tokens.length; i++) {
      let joined = '';
      for (let j = i; j < Math.min(tokens.length, i + 3); j++) {
        joined += tokens[j];
        if (joined === target) return true;
      }
    }
    return false;
  };
  if (trim.length === 0 && tokens.length === 0) return '';
  const best = new Map<string, number>();
  for (const r of rows) {
    const v = (r.brand_model || '').trim();
    if (!v) continue;
    const vw = new Set(words(v));
    // Exact whole-trim match outranks word overlap; longer exact trims win (AX7 L over AX7).
    let score = exactTrim(v) ? 30 + squash(v).length / 10 : 0;
    for (const t of trim) {
      if (vw.has(t)) score += 10;
      else if ([...vw].some((w) => w.length >= 3 && (w.startsWith(t) || t.startsWith(w)))) score += 6;
    }
    if (score === 0) continue;
    if (fuel && (r.fuel_type || '').toLowerCase() === fuel.toLowerCase()) score += 3;
    const from = Number(r.year_from);
    if (year && Number.isFinite(from) && from > 0) {
      // Catalogue rows carry a year range ("2016–2020", "2021 onwards"): the
      // manufacturing year must fall inside it (PDF lookup rule).
      const to = r.year_to === null || r.year_to === undefined || r.year_to === '' ? Infinity : Number(r.year_to);
      score += year >= from && year <= to ? 4 : -4;
    } else if (year) {
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

/** Compact upper-case letters+digits ("E 220 d Exclusive" → "E220DEXCLUSIVE"). */
const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Luxury brands register the badge, not the family: Vahan "E 220 D" /
 * "520D" while the catalogue model is "E-Class" / "5 Series" and the badge
 * sits in the variant ("E220d Exclusive", "520d Sport Line"). Read the
 * badge (letters + 2–3 digits + one letter, e.g. E220D, GLA200D, 730L) and
 * pick the catalogue model whose variants start with it, preferring the
 * manufacturing year's period and the fuel. Returns {} unless one model wins.
 */
export function matchModelByBadge(
  vahanModel: string,
  brand: string,
  rows: CatalogRow[],
  fuel?: string,
  year?: number | null,
): { model?: string; variant?: string } {
  if (!vahanModel || vahanModel.includes('*') || rows.length === 0) return {};
  const brandWords = new Set([...words(brand), 'MERCEDES', 'BENZ', 'MOTORS', 'INDIA', 'LTD']);
  // Keep single letters here: the badge is "E 220 D", not "220".
  const v = vahanModel
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w && !brandWords.has(w) && !NOISE.has(w))
    .join('');
  const badge = v.match(/^[A-Z]{0,4}\d{2,3}[A-Z]?/)?.[0];
  if (!badge || !/\d/.test(badge)) return {};
  let cands = rows.filter((r) => compact(String(r.brand_model || '')).startsWith(badge));
  if (!cands.length) return {};
  const inYear = cands.filter((r) => rowCovers(r, year));
  if (inYear.length) cands = inYear;
  if (fuel) {
    const byFuel = cands.filter((r) => String(r.fuel_type || '').toLowerCase() === fuel.toLowerCase());
    if (byFuel.length) cands = byFuel;
  }
  const models = Array.from(new Set(cands.map((r) => String(r.model || '').trim()).filter(Boolean)));
  if (models.length !== 1) return {};
  const variants = Array.from(new Set(cands.map((r) => String(r.brand_model || '').trim())));
  // One trim with this badge → fill it; several (e.g. C220d Prime / Progressive) → let the user pick.
  return { model: models[0], variant: variants.length === 1 ? variants[0] : undefined };
}

export function buildFill(v: VahanVehicle, catalog: CatalogRow[], fuelOptions: string[]): VahanFill {
  const brands = Array.from(new Set(catalog.map((r) => (r.brand_name || '').trim()).filter(Boolean)));
  const make = matchBrand(v.maker, brands);
  const models = make
    ? Array.from(new Set(catalog.filter((r) => r.brand_name === make).map((r) => (r.model || '').trim()).filter(Boolean)))
    : [];
  let model = make ? matchModel(v.model, models) : '';
  const fuelType = matchFuel(v.fuelType, fuelOptions);
  let variant = make && model
    ? matchVariant(v.model, model, catalog.filter((r) => r.brand_name === make && r.model === model), fuelType, v.year)
    : '';
  if (make && !model) {
    // Badge-style models (Mercedes "E 220 D", BMW "520D") → family via the variants.
    const byBadge = matchModelByBadge(v.model, make, catalog.filter((r) => r.brand_name === make), fuelType, v.year);
    model = byBadge.model || '';
    variant = byBadge.variant || '';
  }
  return {
    licensePlate: v.registrationNumber || undefined,
    make: make || undefined,
    model: model || undefined,
    variant: variant || undefined,
    fuelType,
  };
}
