// Vahan (Parivahan NTR search service) client.
// Spec: API_encryption_decryption.pdf, "By Reg Num.pdf", "By Chassis and engine.pdf" (v2.1).
//  - Every body is { clientId, encData } where encData = Base64(IV(12) + Salt(16) + AES-256-GCM ciphertext+tag),
//    key = PBKDF2-HMAC-SHA256(x-api-key, salt, 65536, 32 bytes). The x-api-key never goes over the wire.
//  - JWT from /api/auth/token, valid 5 min, sent as Authorization: Bearer on search calls.
// Env: VAHAN_CLIENT_ID, VAHAN_API_KEY, optional VAHAN_BASE_URL, VAHAN_TIMEOUT_MS.
import crypto from 'crypto';
import axios from 'axios';

const IV_LEN = 12;
const SALT_LEN = 16;
const TAG_LEN = 16;
const PBKDF2_ITER = 65536;

const cfg = () => ({
  baseUrl: (process.env.VAHAN_BASE_URL || 'https://services.parivahan.gov.in/ntrsearchservice').replace(/\/+$/, ''),
  clientId: process.env.VAHAN_CLIENT_ID || '',
  apiKey: process.env.VAHAN_API_KEY || '',
  timeout: Number(process.env.VAHAN_TIMEOUT_MS) || 15000,
});

export const isVahanConfigured = () => {
  const c = cfg();
  return Boolean(c.clientId && c.apiKey);
};

export class VahanError extends Error {
  constructor(message, status = 502, code = 'VAHAN_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// PBKDF2 at 65536 iterations is ~30–60ms; run async so it doesn't block the event loop.
const deriveKey = (apiKey, salt) =>
  new Promise((resolve, reject) =>
    crypto.pbkdf2(apiKey, salt, PBKDF2_ITER, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key)))
  );

export const encrypt = async (plainText, apiKey) => {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = await deriveKey(apiKey, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
  // Java's GCM output = ciphertext || tag
  return Buffer.concat([iv, salt, ct, cipher.getAuthTag()]).toString('base64');
};

export const decrypt = async (b64, apiKey) => {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < IV_LEN + SALT_LEN + TAG_LEN) throw new VahanError('Vahan response could not be decrypted', 502);
  const iv = buf.subarray(0, IV_LEN);
  const salt = buf.subarray(IV_LEN, IV_LEN + SALT_LEN);
  const body = buf.subarray(IV_LEN + SALT_LEN);
  const ct = body.subarray(0, body.length - TAG_LEN);
  const tag = body.subarray(body.length - TAG_LEN);
  const key = await deriveKey(apiKey, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

// ---- transport ------------------------------------------------------------

const post = async (path, inner, token) => {
  const c = cfg();
  const encData = await encrypt(JSON.stringify(inner), c.apiKey);
  let res;
  try {
    res = await axios.post(
      `${c.baseUrl}${path}`,
      { clientId: c.clientId, encData },
      {
        timeout: c.timeout,
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        validateStatus: () => true,
      }
    );
  } catch (err) {
    if (err.code === 'ECONNABORTED') throw new VahanError('Vahan service timed out. Please try again or enter details manually.', 504, 'VAHAN_TIMEOUT');
    throw new VahanError('Vahan service is unreachable. Please try again or enter details manually.', 503, 'VAHAN_UNREACHABLE');
  }

  const data = res.data;
  // Live API (verified 2026-11-16) returns the token endpoint's success body in PLAIN JSON
  // ({token, tokenType, expiresInMs}) despite the PDF saying it is encrypted. Accept both.
  if (res.status < 300 && data && typeof data === 'object' && !data.encData && (data.token || data.vehicleData)) {
    return data;
  }
  // Plain (unencrypted) error: auth/envelope failures.
  if (!data || typeof data !== 'object' || !data.encData) {
    const status = Number(data?.status) || res.status || 502;
    const msg = (data && data.message) || `Vahan request failed (HTTP ${res.status})`;
    throw new VahanError(msg, status, status === 401 ? 'VAHAN_AUTH' : 'VAHAN_ERROR');
  }
  let payload;
  try {
    payload = JSON.parse(await decrypt(data.encData, c.apiKey));
  } catch (e) {
    if (e instanceof VahanError) throw e;
    throw new VahanError('Vahan response could not be decrypted', 502, 'VAHAN_DECRYPT');
  }
  // Business error inside the envelope.
  if (payload && payload.message && payload.status && payload.success !== true && !payload.token && !payload.vehicleData) {
    const status = Number(payload.status) || 502;
    throw new VahanError(payload.message, status, status === 404 ? 'VAHAN_NOT_FOUND' : status === 429 ? 'VAHAN_RATE_LIMIT' : status === 403 ? 'VAHAN_FORBIDDEN' : 'VAHAN_ERROR');
  }
  return payload;
};

// ---- token cache (single in-flight request) -------------------------------

let tokenCache = { token: null, expiresAt: 0 };
let tokenPromise = null;

const getToken = async (force = false) => {
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const c = cfg();
    const p = await post('/api/auth/token', { clientId: c.clientId });
    if (!p?.token) throw new VahanError('Vahan token generation failed', 502, 'VAHAN_AUTH');
    const ttl = Number(p.expiresInMs) || 300000;
    // refresh 30s early to avoid edge expiry mid-request
    tokenCache = { token: p.token, expiresAt: Date.now() + Math.max(ttl - 30000, 10000) };
    return p.token;
  })().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
};

const authedPost = async (path, inner) => {
  const token = await getToken();
  try {
    return await post(path, inner, token);
  } catch (e) {
    // Token rejected (expired/invalidated server-side): refresh once and retry.
    if (e instanceof VahanError && e.status === 401 && /jwt|token/i.test(e.message)) {
      tokenCache = { token: null, expiresAt: 0 };
      return post(path, inner, await getToken(true));
    }
    throw e;
  }
};

// ---- result cache (saves the daily quota on repeat lookups) ---------------

const RESULT_TTL_MS = 12 * 60 * 60 * 1000;
const RESULT_MAX = 500;
const resultCache = new Map();
const cacheGet = (k) => {
  const hit = resultCache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    resultCache.delete(k);
    return null;
  }
  return hit.value;
};
const cacheSet = (k, value) => {
  if (resultCache.size >= RESULT_MAX) resultCache.delete(resultCache.keys().next().value);
  resultCache.set(k, { value, exp: Date.now() + RESULT_TTL_MS });
};

// ---- normalisation --------------------------------------------------------

const isMasked = (v) => typeof v === 'string' && v.includes('*');
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

const FUEL_MAP = [
  [/^(PETROL|PE\*+OL|P\*+L)/i, 'Petrol'],
  [/^(DIESEL|DI\*+EL|D\*+L)/i, 'Diesel'],
  [/CNG/i, 'CNG'],
  [/(ELECTRIC|BATTERY|^EL\*+)/i, 'Electric'],
  [/LPG/i, 'LPG'],
];
const mapFuel = (raw) => {
  const r = clean(raw);
  if (!r) return '';
  if (/PETROL.*CNG|CNG.*PETROL/i.test(r)) return 'CNG';
  if (/HYBRID/i.test(r)) return 'Hybrid';
  for (const [re, val] of FUEL_MAP) if (re.test(r)) return val;
  return isMasked(r) ? '' : r;
};

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = clean(obj?.[k]);
    if (v) return v;
  }
  return '';
};

/** Only vehicle attributes leave the server — never owner name/address/financer. */
export const normalizeVehicle = (payload) => {
  const d = payload?.vehicleData || {};
  const maker = pick(d, 'rcMakerDesc', 'rcMaker', 'makerDesc');
  const model = pick(d, 'rcMakerModel', 'rcModelDesc', 'rcModel', 'makerModel');
  const fuelRaw = pick(d, 'rcFuelDesc', 'rcFuel', 'fuelDesc');
  const manu = pick(d, 'rcManuMonthYr', 'rcManufactureMonthYr');
  const yearMatch = manu.match(/(19|20)\d{2}/);
  const plate = pick(d, 'rcRegnNo') || clean(payload?.registrationNumber);
  return {
    found: true,
    registrationNumber: isMasked(plate) ? '' : plate.toUpperCase(),
    maker: maker,
    makerMasked: isMasked(maker),
    model: model,
    modelMasked: isMasked(model),
    fuelRaw,
    fuelType: mapFuel(fuelRaw),
    year: yearMatch ? Number(yearMatch[0]) : null,
    color: isMasked(pick(d, 'rcColor')) ? '' : pick(d, 'rcColor'),
    chassisNumber: isMasked(pick(d, 'rcChasiNo')) ? '' : pick(d, 'rcChasiNo'),
    engineNumber: isMasked(pick(d, 'rcEngNo')) ? '' : pick(d, 'rcEngNo'),
    bodyType: isMasked(pick(d, 'rcBodyTypeDesc')) ? '' : pick(d, 'rcBodyTypeDesc'),
    vehicleClass: isMasked(pick(d, 'rcVhClassDesc')) ? '' : pick(d, 'rcVhClassDesc'),
    seatCapacity: pick(d, 'rcSeatCap'),
    rcStatus: pick(d, 'rcStatus'),
    consentStatus: clean(payload?.consentStatus),
    details: buildDetails(d),
  };
};

// Labels for the full "vehicle details" report (web panel + PDF, mobile list), in display order.
const FIELD_LABELS = [
  ['rcRegnNo', 'Registration number'],
  ['rcStatus', 'RC status'],
  ['rcMakerDesc', 'Maker'],
  ['rcMakerModel', 'Model'],
  ['rcVhClassDesc', 'Vehicle class'],
  ['rcVchCatg', 'Vehicle category'],
  ['rcBodyTypeDesc', 'Body type'],
  ['rcFuelDesc', 'Fuel'],
  ['rcColor', 'Colour'],
  ['rcManuMonthYr', 'Manufactured (month/year)'],
  ['rcRegnDt', 'Registration date'],
  ['rcRegnUpto', 'Registration valid till'],
  ['rcFitUpto', 'Fitness valid till'],
  ['rcInsuranceUpto', 'Insurance valid till'],
  ['rcInsuranceComp', 'Insurance company'],
  ['rcPuccUpto', 'PUCC valid till'],
  ['rcTaxUpto', 'Tax valid till'],
  ['rcNormsDesc', 'Emission norms'],
  ['rcCubicCap', 'Engine capacity (cc)'],
  ['rcNoCyl', 'Cylinders'],
  ['rcSeatCap', 'Seating capacity'],
  ['rcWheelbase', 'Wheelbase (mm)'],
  ['rcGvw', 'Gross weight (kg)'],
  ['rcUnldWt', 'Unladen weight (kg)'],
  ['rcVhType', 'Vehicle type'],
  ['rcRegisteredAt', 'Registered at (RTO)'],
  ['rcOwnerCdDesc', 'Owner type'],
  ['rcOwnerSr', 'Owner serial no.'],
  ['rcChasiNo', 'Chassis number'],
  ['rcEngNo', 'Engine number'],
  ['rcBlackListStatus', 'Blacklist status'],
  ['rcNocDetails', 'NOC details'],
];
const LABEL_MAP = new Map(FIELD_LABELS);
// Personal data never leaves the server, even in the full report.
const PII_RE = /(OwnerName|FName|Father|Address|Financer|Mobile|Email|Phone|Aadhaar|Aadhar|Pan(No)?$|SaleAmt)/i;
const humanize = (k) =>
  k.replace(/^rc/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Every non-personal field Vahan returned, as [{ key, label, value, masked }] in a stable order. */
const buildDetails = (d) => {
  const keys = Object.keys(d).filter((k) => !PII_RE.test(k) && clean(d[k]));
  const order = (k) => {
    const i = FIELD_LABELS.findIndex(([key]) => key === k);
    return i === -1 ? FIELD_LABELS.length : i;
  };
  return keys
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((k) => {
      const value = clean(d[k]);
      return { key: k, label: LABEL_MAP.get(k) || humanize(k), value, masked: isMasked(value) };
    });
};

// ---- public API -----------------------------------------------------------

export const normalizePlate = (s) => clean(s).replace(/[\s-]/g, '').toUpperCase();

const ensureConfigured = () => {
  if (!isVahanConfigured()) throw new VahanError('Automatic vehicle lookup is not available right now. Please enter details manually.', 503, 'VAHAN_NOT_CONFIGURED');
};

export const lookupByRegistration = async (regnNo) => {
  ensureConfigured();
  const plate = normalizePlate(regnNo);
  const key = `r:${plate}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const payload = await authedPost('/api/getVehicleDetailsByRegnNo', { userId: cfg().clientId, regnNo: plate });
  if (process.env.VAHAN_DEBUG === 'true') console.log('[vahan] raw response for', plate, JSON.stringify(payload));
  if (!payload?.vehicleData || payload.success === false) throw new VahanError('No vehicle found for this registration number', 404, 'VAHAN_NOT_FOUND');
  const out = normalizeVehicle(payload);
  if (!out.registrationNumber) out.registrationNumber = plate;
  cacheSet(key, out);
  return out;
};

export const lookupByChassisEngine = async (chasiNo, engNo) => {
  ensureConfigured();
  const ch = clean(chasiNo).replace(/\s/g, '').toUpperCase();
  const en = clean(engNo).replace(/\s/g, '').toUpperCase();
  const key = `c:${ch}:${en}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const payload = await authedPost('/api/getVehicleDetailsByChasiNoAndEngNo', { userId: cfg().clientId, chasiNo: ch, engNo: en });
  if (!payload?.vehicleData || payload.success === false) throw new VahanError('No vehicle found for this chassis and engine number', 404, 'VAHAN_NOT_FOUND');
  const out = normalizeVehicle(payload);
  if (!out.chassisNumber) out.chassisNumber = ch;
  if (!out.engineNumber) out.engineNumber = en;
  cacheSet(key, out);
  return out;
};
