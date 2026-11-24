/**
 * Vehicle catalogue + Vahan price lookup — test cases from
 * "vehicle referance data - lookup logic.pdf" against the real workbook.
 *
 * Run:  npm run test:catalog   (node --test --experimental-test-module-mocks)
 * Needs "vehicle referance data (2).xlsx" in the repo root (skips otherwise).
 * No database or S3: both are mocked, nothing touches production.
 */
import { test, describe, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(here, '../../vehicle referance data (2).xlsx');
const hasWorkbook = fs.existsSync(WORKBOOK);

// ---- mocks (must be registered before the modules under test load) --------
let catalogRows = [];
let savedFiles = {};
mock.module(new URL('../utils/s3Storage.js', import.meta.url).href, {
  namedExports: {
    getVehicleDataFromS3: async () => catalogRows,
    saveVehicleDataToS3: async (d) => { savedFiles.data = d; },
    getVehicleReferenceColumnsFromS3: async () => savedFiles.columns || [],
    saveVehicleReferenceColumnsToS3: async (c) => { savedFiles.columns = c; },
    getHiddenBuiltinColumnsFromS3: async () => [],
    saveHiddenBuiltinColumnsToS3: async (h) => { savedFiles.hidden = h; },
    getBuiltinColumnLabelsFromS3: async () => ({}),
    saveBuiltinColumnLabelsToS3: async () => {},
    getDataFromS3: async () => null,
    saveDataToS3: async (k, d) => { savedFiles[k] = d; },
  },
});

const C = await import('../utils/vehicleCatalog.js');

let records = [];
let tyreColumns = [];
before(() => {
  if (!hasWorkbook) return;
  const raw = XLSX.utils.sheet_to_json(XLSX.readFile(WORKBOOK).Sheets.in, { header: 1, defval: '' });
  ({ records, tyreColumns } = C.parseCatalogSheet(raw));
});

const q = (brand, model, variant, fuel, year) => C.findCatalogMatch(records, { brand, model, variant, fuel, year });

// ============================================================================
describe('1. Reading the workbook', { skip: !hasWorkbook && 'workbook not found' }, () => {
  test('all 3,919 vehicle rows and 38 brands load, no row errors', () => {
    assert.equal(records.length, 3919);
    assert.equal(new Set(records.map((r) => r.brand_name)).size, 38);
  });
  test('25 tyre price columns (N–AL) become tyre_price_<slug> fields', () => {
    assert.equal(tyreColumns.length, 25);
    const f = tyreColumns.map((c) => c.fieldName);
    assert.ok(f.includes('tyre_price_bridgestonesturdo'));
    assert.ok(f.includes('tyre_price_yokohamaearth1max')); // "Earth-1 Max" punctuation stripped
    assert.ok(f.includes('tyre_price_continentalultracontactuc6'));
  });
  test('every Year Range is readable', () => {
    assert.equal(records.filter((r) => r.year_from === null).length, 0);
  });
  test('fuel types normalise to Petrol / Diesel / EV / CNG / Hybrid', () => {
    const fuels = new Set(records.map((r) => r.fuel_type).filter(Boolean));
    for (const f of fuels) assert.ok(C.FUEL_TYPES.includes(f), `unexpected fuel ${f}`);
    assert.ok(fuels.has('CNG') && fuels.has('Hybrid') && fuels.has('EV'));
  });
  test('body-type typos are cleaned (Covertible, HatchBack)', () => {
    const bodies = new Set(records.map((r) => r.body_type));
    assert.ok(!bodies.has('Covertible') && !bodies.has('HatchBack'));
    assert.ok(bodies.has('Convertible') && bodies.has('Hatchback'));
  });
  test('split tyre sizes give front and rear', () => {
    const r = records.find((x) => /front:/i.test(x.tyre_size));
    assert.ok(r, 'a front/rear row exists');
    assert.equal(r.front_tyres, '135/70 R12');
    assert.equal(r.rear_tyres, '155/65 R12');
  });
});

// ============================================================================
describe('2. Parsing helpers', () => {
  test('year ranges: closed range, "onwards" is open-ended', () => {
    assert.deepEqual(C.parseYearRange('2016–2020'), { from: 2016, to: 2020 });
    assert.deepEqual(C.parseYearRange('2016-2020'), { from: 2016, to: 2020 });
    assert.deepEqual(C.parseYearRange('2021 onwards'), { from: 2021, to: null });
    assert.deepEqual(C.parseYearRange('soon'), { from: null, to: null });
  });
  test('price cells: number, Contact Carzzi, NA, PENDING, blank, ₹ with commas', () => {
    assert.deepEqual(C.priceInfo(450), { status: 'price', amount: 450 });
    assert.deepEqual(C.priceInfo('₹12,729'), { status: 'price', amount: 12729 });
    assert.equal(C.priceInfo('Contact Carzzi').status, 'quote');
    assert.equal(C.priceInfo('NA').status, 'none');
    assert.equal(C.priceInfo('PENDING').status, 'pending');
    assert.equal(C.priceInfo('').status, 'none');
    assert.equal(C.priceInfo(0).status, 'none');
    assert.equal(C.numericPrice('Contact Carzzi'), null);
  });
  test('fuel aliases', () => {
    assert.equal(C.normalizeFuel('Strong Hybrid'), 'Hybrid');
    assert.equal(C.normalizeFuel('Electric'), 'EV');
    assert.equal(C.normalizeFuel('PETROL/CNG'), 'CNG');
    assert.equal(C.normalizeFuel('diesel'), 'Diesel');
    assert.equal(C.normalizeFuel(''), '');
  });
  test('old "2014 [ Era ]" variants split into year + variant', () => {
    assert.deepEqual(C.parseLegacyVariant('2014 [ Era ]'), { year: 2014, variant: 'Era' });
    assert.deepEqual(C.parseLegacyVariant('Asta'), { year: null, variant: 'Asta' });
  });
});

// ============================================================================
describe('3. PDF sample lookups', { skip: !hasWorkbook && 'workbook not found' }, () => {
  test('Hyundai i20 Asta diesel 2015 → i20 2012–2019, ₹400 wash, 185/65 R14', () => {
    const m = q('Hyundai', 'i20', 'Asta', 'Diesel', 2015);
    assert.ok(m.confident);
    assert.equal(m.row.year_range, '2012–2019');
    assert.equal(Number(m.row.car_wash_exterior_price), 400);
    assert.equal(m.row.tyre_size, '185/65 R14');
  });
  test('Elite i20 Asta diesel 2015 → 2014–2017, 195/55 R16', () => {
    const m = q('Hyundai', 'Elite i20', 'Asta', 'Diesel', 2015);
    assert.ok(m.confident);
    assert.equal(m.row.year_range, '2014–2017');
    assert.equal(m.row.tyre_size, '195/55 R16');
  });
  test('Kia Sonet HTK+ diesel 2023 → ₹500 wash, Sturdo ₹7,749 (195/65 R15)', () => {
    const m = q('Kia', 'Sonet', 'HTK+', 'Diesel', 2023);
    assert.ok(m.confident);
    assert.equal(Number(m.row.car_wash_exterior_price), 500);
    assert.equal(m.row.tyre_size, '195/65 R15');
    assert.equal(Number(m.row.tyre_price_bridgestonesturdo), 7749);
  });
  test('Sonet trim on 215/60 R16 → Sturdo ₹9,299', () => {
    const rows = records.filter((r) => r.model === 'Sonet' && r.tyre_size === '215/60 R16' && r.year_range === '2020–2023');
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => Number(r.tyre_price_bridgestonesturdo) === 9299));
  });
  test('Toyota Innova Hycross ZX 2023 → ₹500 wash, Turanza ₹14,999, general service = quote', () => {
    const m = q('Toyota', 'Innova Hycross', 'ZX', 'Strong Hybrid', 2023);
    assert.ok(m.confident);
    assert.equal(Number(m.row.car_wash_exterior_price), 500);
    assert.equal(Number(m.row.tyre_price_bridgestoneturanza), 14999);
    assert.equal(C.numericPrice(m.row.general_service_price), null);
  });
  test('Jeep Compass Model S diesel 2022 → two rows agree on Turanza ₹15,749 (shown once)', () => {
    const m = q('Jeep', 'Compass', 'Model S', 'Diesel', 2022);
    assert.ok(m.confident);
    assert.equal(m.candidates.length, 2);
    const prices = new Set(m.candidates.map((r) => Number(r.tyre_price_bridgestoneturanza)));
    assert.deepEqual([...prices], [15749]);
  });
  test('BMW 520d Luxury Line 2019 → variant missing → NOT confident (route to Carzzi)', () => {
    const m = q('BMW', '5 Series', '520d Luxury Line', 'Diesel', 2019);
    assert.ok(m.row);
    assert.equal(m.variantMatched, false);
    assert.equal(m.confident, false);
  });
  test('Škoda Superb Style MT petrol 2017 → 2016–2020, ₹450 wash, Turanza ₹12,729, general blank', () => {
    const m = q('Skoda', 'Superb', 'Style MT', 'Petrol', 2017);
    assert.ok(m.confident);
    assert.equal(m.row.year_range, '2016–2020');
    assert.equal(Number(m.row.car_wash_exterior_price), 450);
    assert.equal(Number(m.row.tyre_price_bridgestoneturanza), 12729);
    assert.equal(C.numericPrice(m.row.general_service_price), null);
  });
});

// ============================================================================
describe('4. Year range edge cases', { skip: !hasWorkbook && 'workbook not found' }, () => {
  const superb = (y) => q('Skoda', 'Superb', '', 'Petrol', y);
  test('first year of a period is included (2016 → 2016–2020)', () => {
    assert.equal(superb(2016).row.year_range, '2016–2020');
  });
  test('last year of a period is included (2020 → 2016–2020)', () => {
    assert.equal(superb(2020).row.year_range, '2016–2020');
  });
  test('next year starts the next period (2021 → 2021 onwards)', () => {
    assert.equal(superb(2021).row.year_range, '2021 onwards');
  });
  test('"onwards" stays open (2030 → 2021 onwards)', () => {
    assert.equal(superb(2030).row.year_range, '2021 onwards');
  });
  test('year before the first period → not confident', () => {
    const m = superb(1995);
    assert.equal(m.yearMatched, false);
    assert.equal(m.confident, false);
  });
  test('unknown year → newest period is used', () => {
    assert.equal(superb(undefined).row.year_range, '2021 onwards');
  });
  test('variant not sold in that year\'s period → not confident', () => {
    const m = q('Skoda', 'Superb', 'Style MT', 'Petrol', 2030);
    assert.equal(m.confident, false);
  });
});

// ============================================================================
describe('5. Matching robustness', { skip: !hasWorkbook && 'workbook not found' }, () => {
  test('case and extra spaces do not matter', () => {
    const m = q('  KIA ', 'sonet', 'htk+', 'diesel', 2023);
    assert.ok(m.confident);
    assert.equal(m.row.model, 'Sonet');
  });
  test('old saved variant "2014 [ Era ]" still matches', () => {
    const m = q('Hyundai', 'Elite i20', '2014 [ Era ]', 'Petrol', undefined);
    assert.ok(m.confident);
    assert.equal(m.row.brand_model, 'Era');
  });
  test('fuel picks the right row (diesel vs petrol)', () => {
    const d = q('Hyundai', 'i20', 'Asta', 'Diesel', 2015);
    const p = q('Hyundai', 'i20', 'Asta', 'Petrol', 2015);
    assert.equal(d.row.fuel_type, 'Diesel');
    assert.equal(p.row.fuel_type, 'Petrol');
  });
  test('unknown brand or model → no row', () => {
    assert.equal(q('Tesla', 'Model 3', '', 'EV', 2023).row, null);
    assert.equal(q('Hyundai', 'Imaginary', '', 'Petrol', 2020).row, null);
  });
  test('missing brand/model input → no row, no crash', () => {
    assert.equal(q('', '', '', '', null).row, null);
    assert.equal(C.findCatalogMatch(null, { brand: 'Kia', model: 'Sonet' }).row, null);
  });
  test('old-format data (no year ranges) stays confident for cars with a year', () => {
    const old = [{ brand_name: 'Hyundai', model: 'Elite i20', brand_model: '2014 [ Era ]', fuel_type: 'Petrol', car_wash_exterior_price: 400 }];
    const m = C.findCatalogMatch(old, { brand: 'Hyundai', model: 'Elite i20', variant: '2014 [ Era ]', fuel: 'Petrol', year: 2015 });
    assert.ok(m.confident);
  });
});

// ============================================================================
describe('6. What the search API shows (pricedView)', () => {
  const row = { general_service_price: '', car_wash_exterior_price: 450, car_wash_interior_exterior_price: 'PENDING', tyre_price_x: 9000, battery_details: '35 Ah' };
  test('confident: numbers kept, blank/PENDING service prices read "Contact Carzzi"', () => {
    const v = C.pricedView(row, true);
    assert.equal(v.car_wash_exterior_price, 450);
    assert.equal(v.general_service_price, 'Contact Carzzi');
    assert.equal(v.car_wash_interior_exterior_price, 'Contact Carzzi');
    assert.equal(v.tyre_price_x, 9000);
    assert.equal(v.battery_details, '35 Ah');
  });
  test('not confident: every price reads "Contact Carzzi", details kept', () => {
    const v = C.pricedView(row, false);
    assert.equal(v.car_wash_exterior_price, 'Contact Carzzi');
    assert.equal(v.tyre_price_x, 'Contact Carzzi');
    assert.equal(v.battery_details, '35 Ah');
  });
});

// ============================================================================
describe('7. Booking price calculation (calculateServicesTotal)', { skip: !hasWorkbook && 'workbook not found' }, () => {
  let calculateServicesTotal;
  let Service;
  let Vehicle;
  const origFind = {};
  const svc = (id, name, category, price, extra = {}) => ({ _id: { toString: () => id }, name, category, price, ...extra });
  const SERVICES = {
    general: svc('gen', 'General Service', 'Periodic', 2999),
    ext: svc('ext', 'Exterior Wash', 'Car Wash', 299),
    full: svc('full', 'Full Wash', 'Car Wash', 699),
    tyre: svc('tyre', 'Tyre Replacement', 'Tyres', 5000),
    battery: svc('bat', 'Battery Replacement', 'Battery', 4500),
    essentials: svc('ess', 'Wiper Blade', 'Essentials', 349),
  };
  let currentVehicle = null;

  before(async () => {
    catalogRows = records;
    savedFiles.columns = tyreColumns.map(({ header, ...c }) => c);
    Service = (await import('../models/Service.js')).default;
    Vehicle = (await import('../models/Vehicle.js')).default;
    origFind.s = Service.find;
    origFind.v = Vehicle.findById;
    // Look services up by their _id (what the controller passes), not the map key.
    const byId = Object.fromEntries(Object.values(SERVICES).map((s) => [s._id.toString(), s]));
    Service.find = async (query) => query._id.$in.map((id) => byId[id]).filter(Boolean);
    Vehicle.findById = async () => currentVehicle;
    ({ calculateServicesTotal } = await import('../controllers/bookingController.js'));
  });
  after(() => {
    Service.find = origFind.s;
    Vehicle.findById = origFind.v;
  });

  const price = async (vehicle, ids, brands = {}) => {
    currentVehicle = vehicle;
    return calculateServicesTotal(ids, 'veh1', brands, {});
  };
  const sonet = { make: 'Kia', model: 'Sonet', variant: 'HTK+', fuelType: 'Diesel', year: 2023 };
  const superb = { make: 'Skoda', model: 'Superb', variant: 'Style MT', fuelType: 'Petrol', year: 2017 };
  const bmw = { make: 'BMW', model: '5 Series', variant: '520d Luxury Line', fuelType: 'Diesel', year: 2019 };
  const unknown = { make: 'Tesla', model: 'Model 3', variant: '', fuelType: 'EV', year: 2023 };

  test('exterior wash charged from the catalogue (Sonet ₹500)', async () => {
    const r = await price(sonet, ['ext']);
    assert.equal(r.total, 500);
    assert.equal(r.quoteServices.length, 0);
  });
  test('"Full Wash" uses the Full Wash column', async () => {
    const r = await price(superb, ['full']);
    const row = q('Skoda', 'Superb', 'Style MT', 'Petrol', 2017).row;
    assert.equal(r.total, Number(row.car_wash_interior_exterior_underbody_price));
  });
  test('general service with blank price → ₹0 + Carzzi quote (not the ₹2,999 default)', async () => {
    const r = await price(superb, ['gen']);
    assert.equal(r.total, 0);
    assert.deepEqual(r.quoteServices.map((x) => x.serviceId), ['gen']);
  });
  test('general service with a real price is charged', async () => {
    const row = records.find((x) => C.numericPrice(x.general_service_price) !== null);
    const v = { make: row.brand_name, model: row.model, variant: row.brand_model, fuelType: row.fuel_type, year: row.year_from };
    const r = await price(v, ['gen']);
    assert.equal(r.total, C.numericPrice(row.general_service_price));
    assert.equal(r.quoteServices.length, 0);
  });
  test('tyre with a priced brand → that price (Sonet Sturdo ₹7,749)', async () => {
    const r = await price(sonet, ['tyre'], { tyre: 'Bridgestone Sturdo' });
    assert.equal(r.total, 7749);
  });
  test('tyre brand with NA price → rejected as unavailable', async () => {
    const row = q('Kia', 'Sonet', 'HTK+', 'Diesel', 2023).row;
    const na = tyreColumns.find((c) => C.numericPrice(row[c.fieldName]) === null);
    assert.ok(na, 'Sonet has at least one NA tyre column');
    const r = await price(sonet, ['tyre'], { tyre: na.label });
    assert.equal(r.unavailableBrandServices.length, 1);
  });
  test('battery is always a Carzzi quote (₹0)', async () => {
    const r = await price(sonet, ['bat']);
    assert.equal(r.total, 0);
    assert.equal(r.quoteServices[0].reason, 'battery_quote');
  });
  test('variant not in catalogue (BMW 520d Luxury Line) → wash becomes a quote', async () => {
    const r = await price(bmw, ['ext']);
    assert.equal(r.total, 0);
    assert.equal(r.quoteServices.length, 1);
  });
  test('vehicle not in catalogue → wash quoted, reason no_catalogue_match', async () => {
    const r = await price(unknown, ['ext']);
    assert.equal(r.total, 0);
    assert.equal(r.quoteServices[0].reason, 'no_catalogue_match');
  });
  test('essentials keep their flat price', async () => {
    const r = await price(sonet, ['ess']);
    assert.equal(r.total, 349);
  });
  test('mixed booking: wash charged + battery quoted', async () => {
    const r = await price(sonet, ['ext', 'bat']);
    assert.equal(r.total, 500);
    assert.deepEqual(r.quoteServices.map((x) => x.serviceId), ['bat']);
  });
  test('pickup & drop comes from the best row even when not confident', async () => {
    const r = await price(bmw, ['gen']);
    assert.ok(Number(r.catalogRow?.pickup_drop_price) > 0);
  });
});

// ============================================================================
describe('8. Search API over HTTP', { skip: !hasWorkbook && 'workbook not found' }, () => {
  let server;
  let base;
  before(async () => {
    catalogRows = records.map((r, i) => ({ _id: String(i), ...r }));
    const express = (await import('express')).default;
    const router = (await import('../routes/vehicleReferenceRoutes.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/vehicle-reference', router);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/vehicle-reference`;
  });
  after(() => server?.close());

  const search = (params) => fetch(`${base}/search?${new URLSearchParams(params)}`);

  test('Sonet 2023 → 200, confident, real prices', async () => {
    const res = await search({ brand_name: 'Kia', model: 'Sonet', variant: 'HTK+', fuel_type: 'Diesel', year: 2023 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body._match.confident, true);
    assert.equal(Number(body.car_wash_exterior_price), 500);
    assert.equal(body.general_service_price, 'Contact Carzzi');
  });
  test('BMW 520d Luxury Line → 200 but every price "Contact Carzzi"', async () => {
    const res = await search({ brand_name: 'BMW', model: '5 Series', variant: '520d Luxury Line', fuel_type: 'Diesel', year: 2019 });
    const body = await res.json();
    assert.equal(body._match.confident, false);
    assert.equal(body.car_wash_exterior_price, 'Contact Carzzi');
    assert.equal(body.tyre_price_bridgestoneturanza, 'Contact Carzzi');
  });
  test('unknown vehicle → 404', async () => {
    const res = await search({ brand_name: 'Tesla', model: 'Model 3' });
    assert.equal(res.status, 404);
  });
  test('missing brand/model → 400', async () => {
    const res = await search({ brand_name: 'Kia' });
    assert.equal(res.status, 400);
  });
});
