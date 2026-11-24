/**
 * Vehicle reference catalogue ("vehicle referance data" workbook, sheet "in")
 * and the Carzzi Vahan price-lookup rules (vehicle referance data - lookup logic.pdf).
 *
 * Workbook columns: A Brand · B Model · C Variant · D Year Range · E Fuel Type ·
 * F Body Type · G Tyre Size · H Battery Details · I–K wash prices · L General
 * Service · M Pickup & Drop · N–AL "Tyre - <Brand> <Pattern>" prices (₹).
 *
 * Stored records keep the long-standing field names (brand_model = Variant,
 * car_wash_*_price, general_service_price, tyre_price_<slug>, …) so every
 * existing pricing/display path keeps working, plus the new fields
 * year_range/year_from/year_to, body_type, tyre_size.
 */

export const FUEL_TYPES = ['Petrol', 'Diesel', 'EV', 'CNG', 'Hybrid'];

/** Workbook header → record field, in workbook order (admin table follows this). */
export const CATALOG_FIELDS = [
  { header: 'Brand', field: 'brand_name' },
  { header: 'Model', field: 'model' },
  { header: 'Variant', field: 'brand_model' },
  { header: 'Year Range', field: 'year_range' },
  { header: 'Fuel Type', field: 'fuel_type' },
  { header: 'Body Type', field: 'body_type' },
  { header: 'Tyre Size', field: 'tyre_size' },
  { header: 'Battery Details', field: 'battery_details' },
  { header: 'Exterior Wash', field: 'car_wash_exterior_price' },
  { header: 'Interior + Exterior Wash', field: 'car_wash_interior_exterior_price' },
  { header: 'Full Wash', field: 'car_wash_interior_exterior_underbody_price' },
  { header: 'General Service', field: 'general_service_price' },
  { header: 'Pickup & Drop', field: 'pickup_drop_price' },
];

const TYRE_HEADER_RE = /^tyre\s*[-–:]\s*(.+)$/i;

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const norm = (v) => str(v).replace(/\s+/g, ' ').toLowerCase();
const slugAlnum = (s) => str(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Tyre - Bridgestone Sturdo" → { label: 'Bridgestone Sturdo', fieldName: 'tyre_price_bridgestonesturdo' } */
export const tyreColumnFromHeader = (header) => {
  const m = TYRE_HEADER_RE.exec(str(header));
  if (!m) return null;
  const label = m[1].replace(/\s+/g, ' ').trim();
  const key = slugAlnum(label);
  if (!key) return null;
  return { key, label, category: 'tyre', fieldName: `tyre_price_${key}` };
};

/** True when a sheet's header row is the Annexure-style catalogue (has "Year Range"). */
export const isCatalogWorkbook = (headers) =>
  headers.some((h) => norm(h) === 'year range') && headers.some((h) => norm(h) === 'variant');

export const normalizeFuel = (v) => {
  const s = norm(v);
  if (!s) return '';
  if (s.includes('hybrid')) return 'Hybrid';
  if (s.includes('cng')) return 'CNG';
  if (s === 'ev' || s.includes('electric') || s.includes('battery')) return 'EV';
  if (s.includes('diesel')) return 'Diesel';
  if (s.includes('petrol')) return 'Petrol';
  return '';
};

const BODY_FIX = {
  covertible: 'Convertible',
  convertible: 'Convertible',
  hatchback: 'Hatchback',
  'station wagon': 'Station Wagon',
  'gran coupe': 'Gran Coupe',
  suv: 'SUV',
  muv: 'MUV',
  mpv: 'MPV',
  lcv: 'LCV',
};
export const normalizeBody = (v) => {
  const s = norm(v);
  if (!s) return '';
  if (BODY_FIX[s]) return BODY_FIX[s];
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * "2016–2020" → {from:2016,to:2020}; "2021 onwards" → {from:2021,to:null}.
 * Closed range: both bounds included.
 */
export const parseYearRange = (v) => {
  const s = str(v);
  let m = s.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  m = s.match(/^(\d{4})\s*(onwards|\+|-?\s*present)?$/i);
  if (m) return { from: Number(m[1]), to: null };
  return { from: null, to: null };
};

/** "Front: 135/70 R12 / Rear: 155/65 R12" → {front, rear}; a single size fits both axles. */
export const parseTyreSize = (v) => {
  const s = str(v);
  const front = s.match(/front\s*:\s*([^/]+\/[^/]+?)(?:\s*\/\s*rear|$)/i);
  const rear = s.match(/rear\s*:\s*(.+)$/i);
  if (front || rear) {
    return { front: str(front?.[1]), rear: str(rear?.[1]) || str(front?.[1]) };
  }
  return { front: s, rear: s };
};

/**
 * Price cell meaning (PDF "When to request a price"):
 * number > 0 → 'price'; "Contact Carzzi"/other text → 'quote';
 * PENDING → 'pending'; blank / NA → 'none'.
 */
export const priceInfo = (raw) => {
  const s = str(raw);
  if (!s) return { status: 'none', amount: null };
  const n = Number(s.replace(/[₹,\s]/g, ''));
  if (Number.isFinite(n)) return n > 0 ? { status: 'price', amount: n } : { status: 'none', amount: null };
  const u = s.toUpperCase();
  if (u === 'NA' || u === 'N/A' || u === '-' || u === 'NULL') return { status: 'none', amount: null };
  if (u.includes('PENDING')) return { status: 'pending', amount: null };
  return { status: 'quote', amount: null };
};

/** Numeric price or null — anything else needs a Carzzi quote. */
export const numericPrice = (raw) => priceInfo(raw).amount;

/** Old-catalogue variants embedded the year: "2014 [ Era ]" → {year:2014, variant:'Era'}. */
export const parseLegacyVariant = (v) => {
  const m = str(v).match(/^(\d{4})\s*\[\s*(.*?)\s*\]$/);
  return m ? { year: Number(m[1]), variant: m[2] } : { year: null, variant: str(v) };
};

/** One workbook row (header→value object) → stored catalogue record. */
export const recordFromRow = (row, tyreColumns) => {
  const get = (header) => {
    const key = Object.keys(row).find((k) => norm(k) === norm(header));
    return key === undefined ? '' : row[key];
  };
  const rec = {};
  for (const { header, field } of CATALOG_FIELDS) rec[field] = get(header);
  for (const k of ['brand_name', 'model', 'brand_model', 'year_range', 'tyre_size', 'battery_details']) {
    rec[k] = str(rec[k]).replace(/\s+/g, ' ');
  }
  rec.fuel_type = normalizeFuel(rec.fuel_type);
  rec.body_type = normalizeBody(rec.body_type);
  const yr = parseYearRange(rec.year_range);
  rec.year_from = yr.from;
  rec.year_to = yr.to;
  const ts = parseTyreSize(rec.tyre_size);
  rec.front_tyres = ts.front;
  rec.rear_tyres = ts.rear;
  for (const col of tyreColumns) {
    const v = row[col.header];
    rec[col.fieldName] = v === undefined || v === null ? '' : typeof v === 'number' ? v : str(v);
  }
  for (const k of ['car_wash_exterior_price', 'car_wash_interior_exterior_price',
    'car_wash_interior_exterior_underbody_price', 'general_service_price', 'pickup_drop_price']) {
    const v = rec[k];
    rec[k] = typeof v === 'number' ? v : str(v);
  }
  return rec;
};

/**
 * Parses the whole sheet. Returns { records, tyreColumns, errors }.
 * Rows without Brand/Model/Variant are skipped (reported in errors).
 */
export const parseCatalogSheet = (rawRows) => {
  const headers = (rawRows[0] || []).map((h) => str(h));
  const tyreColumns = [];
  headers.forEach((h) => {
    const col = tyreColumnFromHeader(h);
    if (col && !tyreColumns.some((c) => c.fieldName === col.fieldName)) tyreColumns.push({ ...col, header: h });
  });
  const records = [];
  const errors = [];
  rawRows.slice(1).forEach((arr, i) => {
    if (!Array.isArray(arr) || arr.every((c) => str(c) === '')) return;
    const row = {};
    headers.forEach((h, idx) => { if (h) row[h] = arr[idx]; });
    const rec = recordFromRow(row, tyreColumns);
    if (!rec.brand_name || !rec.model || !rec.brand_model) {
      errors.push(`Row ${i + 2}: Brand, Model and Variant are required`);
      return;
    }
    if (rec.year_range && rec.year_from === null) errors.push(`Row ${i + 2}: unreadable Year Range "${rec.year_range}"`);
    records.push(rec);
  });
  return { records, tyreColumns, errors };
};

const inYear = (r, year) => {
  const from = Number(r.year_from);
  if (!Number.isFinite(from) || r.year_from === null || r.year_from === '') return false;
  const to = r.year_to === null || r.year_to === undefined || r.year_to === '' ? Infinity : Number(r.year_to);
  return year >= from && year <= to;
};

const stripBrackets = (s) => norm(String(s || '').replace(/\[[^\]]*\]/g, ''));

/**
 * PDF "Price decision": filter by brand, model, year range and fuel, then
 * narrow by variant. Returns { row, yearMatched, variantMatched, candidates }
 * (row is null when the brand/model isn't in the catalogue).
 * When the year is unknown the newest catalogue period is preferred.
 */
export const findCatalogMatch = (rows, { brand, model, variant, fuel, year } = {}) => {
  const b = norm(brand);
  const mFull = norm(model);
  const mClean = stripBrackets(model);
  if (!b || !mFull || !Array.isArray(rows)) return { row: null, yearMatched: false, variantMatched: false, candidates: [] };

  const legacy = parseLegacyVariant(variant);
  const v = norm(legacy.variant);
  let y = Number(year) || legacy.year || null;
  if (y && (y < 1950 || y > 2100)) y = null;

  const brandRows = rows.filter((r) => norm(r.brand_name) === b);
  let cands = brandRows.filter((r) => norm(r.model) === mFull || norm(r.model) === mClean || stripBrackets(r.model) === mClean);
  if (!cands.length) {
    cands = brandRows.filter((r) => {
      const rm = norm(r.model);
      return rm && (rm.includes(mClean) || mClean.includes(rm));
    });
  }
  if (!cands.length) return { row: null, yearMatched: false, variantMatched: false, candidates: [] };

  // Old-format rows (before the catalogue workbook) have no year ranges:
  // the year can't be checked, so it mustn't make the match "unsure".
  const hasRanges = cands.some((r) => r.year_from !== undefined && r.year_from !== null && r.year_from !== '');
  let yearMatched = false;
  if (y) {
    const inRange = cands.filter((r) => inYear(r, y));
    if (inRange.length) {
      cands = inRange;
      yearMatched = true;
    }
  }

  const f = normalizeFuel(fuel);
  if (f) {
    const byFuel = cands.filter((r) => normalizeFuel(r.fuel_type) === f);
    if (byFuel.length) cands = byFuel;
  }

  let variantMatched = false;
  if (v) {
    const byVariant = cands.filter((r) => norm(r.brand_model) === v || norm(parseLegacyVariant(r.brand_model).variant) === v);
    if (byVariant.length) {
      cands = byVariant;
      variantMatched = true;
    }
  }

  if (!yearMatched) {
    cands = [...cands].sort((a, z) => (Number(z.year_from) || 0) - (Number(a.year_from) || 0));
  }
  const row = cands[0] || null;
  // PDF: a variant that isn't in the catalogue, or a year outside every
  // period, "goes to Carzzi for confirmation" — prices from a near-miss row
  // must not be charged.
  const confident = !!row && (!v || variantMatched) && (!y || !hasRanges || yearMatched);
  return { row, yearMatched, variantMatched, confident, candidates: cands };
};

/** Service price fields that switch to a Carzzi quote when not numeric. */
export const SERVICE_PRICE_FIELDS = [
  'general_service_price',
  'car_wash_exterior_price',
  'car_wash_interior_exterior_price',
  'car_wash_interior_exterior_underbody_price',
  'car_wash_price',
];
export const QUOTE_TEXT = 'Contact Carzzi';

/**
 * Row as served to booking clients: any service price that isn't a number
 * (blank, NA, PENDING, text) reads "Contact Carzzi"; when the match isn't
 * confident every price (service, tyre, battery) does. Older app builds
 * then also stop showing a price Carzzi wouldn't charge.
 */
export const pricedView = (row, confident) => {
  if (!row) return row;
  const out = { ...row };
  for (const k of SERVICE_PRICE_FIELDS) {
    if (k in out && numericPrice(out[k]) === null) out[k] = QUOTE_TEXT;
  }
  if (!confident) {
    for (const k of Object.keys(out)) {
      if (SERVICE_PRICE_FIELDS.includes(k) || k.startsWith('tyre_price_') || k.startsWith('battery_price_')) {
        out[k] = QUOTE_TEXT;
      }
    }
  }
  return out;
};

/** Vehicle document → match. */
export const findCatalogMatchForVehicle = (rows, vehicle) =>
  findCatalogMatch(rows, {
    brand: vehicle?.make,
    model: vehicle?.model,
    variant: vehicle?.variant,
    fuel: vehicle?.fuelType,
    year: vehicle?.year,
  });
