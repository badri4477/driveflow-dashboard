import { lookupByRegistration, lookupByChassisEngine, VahanError, isVahanConfigured } from '../services/vahanService.js';
import { logger } from '../middleware/errorHandler.js';

const PLATE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
const CHASSIS_RE = /^[A-Z0-9]{5,25}$/;
const ENGINE_RE = /^[A-Z0-9]{4,25}$/;

// @desc    Is automatic (Vahan) lookup available?
// @route   GET /api/vehicles/vahan/status
// @access  Private
export const vahanStatus = (req, res) => res.json({ enabled: isVahanConfigured() });

// @desc    Look up vehicle details from Vahan by registration no. or chassis + engine no.
// @route   POST /api/vehicles/vahan/lookup   body: { regnNo } | { chasiNo, engNo }
// @access  Private (customer, admin, merchant, staff)
export const vahanLookup = async (req, res) => {
  const regnNo = String(req.body?.regnNo || '').replace(/[\s-]/g, '').toUpperCase();
  const chasiNo = String(req.body?.chasiNo || '').replace(/\s/g, '').toUpperCase();
  const engNo = String(req.body?.engNo || '').replace(/\s/g, '').toUpperCase();

  try {
    if (regnNo) {
      if (!PLATE_RE.test(regnNo)) return res.status(400).json({ message: 'Enter a valid registration number (e.g. MH02AB1234).' });
      return res.json(await lookupByRegistration(regnNo));
    }
    if (chasiNo || engNo) {
      if (!CHASSIS_RE.test(chasiNo)) return res.status(400).json({ message: 'Enter a valid chassis number.' });
      if (!ENGINE_RE.test(engNo)) return res.status(400).json({ message: 'Enter a valid engine number.' });
      return res.json(await lookupByChassisEngine(chasiNo, engNo));
    }
    return res.status(400).json({ message: 'Registration number, or chassis and engine number, is required.' });
  } catch (err) {
    if (err instanceof VahanError) {
      logger?.warn?.(`Vahan lookup failed [${err.code}] ${err.status}: ${err.message}`);
      // Never forward upstream 401s as our own 401 — the client would treat it as a logout.
      if (err.code === 'VAHAN_NOT_FOUND') return res.status(404).json({ found: false, code: err.code, message: err.message });
      if (err.code === 'VAHAN_RATE_LIMIT') return res.status(429).json({ found: false, code: err.code, message: 'Daily lookup limit reached. Please enter details manually.' });
      if (err.code === 'VAHAN_FORBIDDEN') return res.status(503).json({ found: false, code: err.code, message: 'Automatic lookup is not authorised from this server yet. Please enter details manually.' });
      if (err.code === 'VAHAN_NOT_CONFIGURED') return res.status(503).json({ found: false, code: err.code, message: err.message });
      return res.status(502).json({ found: false, code: err.code, message: 'Could not fetch details from Vahan right now. Please try again or enter details manually.' });
    }
    logger?.error?.('Vahan lookup unexpected error', err);
    return res.status(500).json({ found: false, message: 'Vehicle lookup failed. Please enter details manually.' });
  }
};
