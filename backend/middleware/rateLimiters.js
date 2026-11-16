import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { getAppEnv } from '../utils/appEnvironment.js';
import { getTokenFromRequest } from '../utils/authCookie.js';

const standardHandler = (message) => ({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message },
  skip: () => getAppEnv() !== 'production',
});

export const signupPrepareLimiter = rateLimit({
  ...standardHandler('Too many signup attempts. Please try again later.'),
  max: 5,
});

export const signupOtpLimiter = rateLimit({
  ...standardHandler('Too many OTP requests. Please try again later.'),
  max: 5,
});

export const loginPrepareLimiter = rateLimit({
  ...standardHandler('Too many login attempts. Please try again later.'),
  max: 10,
});

export const loginOtpLimiter = rateLimit({
  ...standardHandler('Too many OTP requests. Please try again later.'),
  max: 10,
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password reset requests. Please try again later.' },
  skip: () => getAppEnv() !== 'production',
});

export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many submissions. Please try again later.' },
  skip: () => getAppEnv() !== 'production',
});

export const publicUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many upload requests. Please try again later.' },
  skip: () => getAppEnv() !== 'production',
});

export const captchaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 captcha generations per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many CAPTCHA requests. Please try again later.' },
  skip: () => getAppEnv() !== 'production',
});

// Best-effort identity for rate-limit bucketing: prefer the authenticated
// user (so people behind a shared/NAT'd IP don't starve each other's
// quota), falling back to IP for logged-out requests. Doesn't verify the
// token's validity beyond decoding — an expired/forged token just falls
// back to being keyed by its (still attacker-controlled but harmless-here)
// claimed id, and real auth is still enforced separately by `protect`.
const rateLimitIdentity = (req) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded?.id) return `user:${decoded.id}`;
    } catch {
      // fall through to IP
    }
  }
  return req.ip;
};

// Global safety net: every API endpoint gets its own 200-requests-per-minute
// bucket (keyed by user/IP + route), independent of every other endpoint's
// usage. Sensitive endpoints (signup, login, etc.) keep their own tighter
// limiters above, which run in addition to — not instead of — this one.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down and try again shortly.' },
  skip: () => getAppEnv() !== 'production',
  keyGenerator: (req) => `${rateLimitIdentity(req)}:${req.baseUrl}${req.path}`,
});


// Vahan lookups cost against a daily government quota — cap per user.
export const vahanLookupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?._id ? `u:${req.user._id}` : req.ip),
  message: { message: 'Too many vehicle lookups. Please wait a while or enter details manually.' },
  skip: () => getAppEnv() !== 'production',
});
