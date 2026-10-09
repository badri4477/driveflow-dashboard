import User from '../models/User.js';
import PendingSignup from '../models/PendingSignup.js';
import PendingLogin from '../models/PendingLogin.js';
import PendingPhoneLogin from '../models/PendingPhoneLogin.js';
import PendingPhoneSignup from '../models/PendingPhoneSignup.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendEmail } from '../utils/emailService.js';
import admin from '../config/firebase.js';
import generateToken from '../utils/generateToken.js';
import {
  clearAuthCookie,
  setAuthCookie,
} from '../utils/authCookie.js';
import {
  normalizeIndianMobile,
  sendAuthOtp as msg91SendAuthOtp,
  verifySignupOtp as msg91VerifySignupOtp,
} from '../utils/msg91Service.js';
import { isTestingEnv } from '../utils/appEnvironment.js';
import { isValidEmail, isValidPhone10 } from '../utils/validation.js';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9-]*[a-zA-Z][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;
const MAX_NAME_LENGTH = 50;
const MAX_PASSWORD_LENGTH = 15;

const isValidName = (value) => {
  const trimmed = value.trim();
  // Allow letters, spaces, apostrophes, hyphens only
  return /^[a-zA-Z][a-zA-Z\s'-]*$/.test(trimmed) && trimmed.length > 0;
};

const isNameTooLong = (value) => {
  return value.trim().length > MAX_NAME_LENGTH;
};

// Dummy QA credentials — bypasses real OTP delivery/verification so testers can log in
// with phone 1111111111 + OTP 123456 without hitting MSG91.
const DUMMY_TEST_MOBILE = '911111111111';
const DUMMY_TEST_OTP = '123456';
const DUMMY_TEST_EMAIL = 'verification@gmail.com';
/** App Store / Play Store review accounts — reviewers can't receive the
 * WhatsApp/SMS OTP, so these skip it the same way DUMMY_TEST_EMAIL does. */
const APP_REVIEW_EMAILS = new Set([
  DUMMY_TEST_EMAIL,
  'staff.review@carzzi.com',
  'merchant.review@carzzi.com',
]);

const OTP_PENDING_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 30 * 60 * 1000;
const MAX_OTP_VERIFY_ATTEMPTS = 5;
const FORGOT_PASSWORD_COOLDOWN_MS = 5 * 60 * 1000;

const isAccountLocked = (user) => user?.lockUntil && user.lockUntil > new Date();

const recordFailedLogin = async (user) => {
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
    user.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
    user.failedLoginAttempts = 0;
  }
  await user.save({ validateBeforeSave: false });
};

const clearLoginFailures = async (user) => {
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  await user.save({ validateBeforeSave: false });
};

const userAuthFields = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  subRole: user.subRole,
  phone: user.phone,
  isShopOpen: user.isShopOpen,
  location: user.location,
  addresses: user.addresses || [],
  address: user.location?.address || '',
  isOnline: user.isOnline,
});

const clientPlatform = (req) => req.headers['x-client-platform'];

const sendAuthResponse = (req, res, user, extras = {}, statusCode = 200) => {
  const token = generateToken(user._id, user.role, user.tokenVersion || 0, clientPlatform(req));
  setAuthCookie(res, token);

  const payload = {
    ...userAuthFields(user),
    token,
    ...extras,
  };

  return res.status(statusCode).json(payload);
};

const buildAuthUserPayload = (req, user, extras = {}) => ({
  ...userAuthFields(user),
  token: generateToken(user._id, user.role, user.tokenVersion || 0, clientPlatform(req)),
  ...extras,
});

const createUserFromPendingSignup = async (pending, mobile) => {
  const userExists = await User.findOne({ email: pending.email });
  if (userExists) {
    await PendingSignup.deleteOne({ mobile });
    throw new Error('User already exists');
  }

  const user = await User.create({
    name: pending.name,
    email: pending.email,
    password: pending.password,
    role: 'customer',
    phone: mobile.slice(2),
    isApproved: true,
  });

  await PendingSignup.deleteOne({ mobile });
  return user;
};

const formatChannelLabel = (channels = ['whatsapp']) => {
  if (channels.includes('whatsapp') && channels.includes('sms')) return 'WhatsApp and SMS';
  if (channels.includes('sms')) return 'SMS';
  return 'WhatsApp';
};

const resolveUserMobile = (user) => {
  const raw = user?.phone;
  if (!raw) return null;
  return normalizeIndianMobile(raw);
};

/** Step 1 — validate signup fields, store pending session (no OTP yet). */
export const prepareSignup = async (req, res) => {
  const { name, email, password, phone } = req.body;

  try {
    if (!name?.trim()) {
      return res.status(400).json({ message: 'Please enter your full name' });
    }
    if (isNameTooLong(name)) {
      return res.status(400).json({ message: 'Too long data not accept' });
    }
    if (!isValidName(name)) {
      return res.status(400).json({ message: 'Please enter a valid full name (must contain letters only with spaces, apostrophes, or hyphens)' });
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ message: 'Too long data not accept' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailValidation = isValidEmail(normalizedEmail);
    
    if (!emailValidation.valid) {
      return res.status(400).json({ message: emailValidation.error || 'Invalid email id' });
    }
    const mobile = normalizeIndianMobile(phone);

    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const phoneTaken = await User.findOne({
      $or: [{ phone }, { phone: mobile }, { phone: mobile.slice(2) }],
    });
    if (phoneTaken) {
      return res.status(400).json({ message: 'Phone number is already registered' });
    }

    const expiresAt = new Date(Date.now() + OTP_PENDING_TTL_MS);
    await PendingSignup.findOneAndUpdate(
      { mobile },
      {
        mobile,
        name: name.trim(),
        email: normalizedEmail,
        password,
        expiresAt,
        otpHash: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (isTestingEnv()) {
      const pending = await PendingSignup.findOne({ mobile });
      const user = await createUserFromPendingSignup(pending, mobile);
      return sendAuthResponse(req, res, user, {
        skipOtp: true,
        message: 'Account created (testing — OTP skipped).',
      }, 201);
    }

    res.json({
      message: 'Details verified. Continue to OTP verification.',
      mobile: `******${mobile.slice(-4)}`,
      verified: true,
    });
  } catch (error) {
    console.error('prepareSignup error:', error.message);
    res.status(500).json({ message: error.message || 'Could not verify signup details' });
  }
};

/** Step 2 — send WhatsApp OTP (template: user_authentication). */
export const sendSignupOtp = async (req, res) => {
  const { phone } = req.body;

  try {
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'Phone is required' });
    }

    const mobile = normalizeIndianMobile(phone);
    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const pending = await PendingSignup.findOne({ mobile });
    if (!pending) {
      return res.status(400).json({ message: 'Please complete signup details first' });
    }

    if (pending.expiresAt < new Date()) {
      await PendingSignup.deleteOne({ mobile });
      return res.status(400).json({ message: 'Session expired. Please start signup again.' });
    }

    if (
      pending.lastOtpSentAt &&
      Date.now() - pending.lastOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      return res.status(429).json({ message: 'Please wait before requesting another OTP.' });
    }

    const sendResult = await msg91SendAuthOtp(mobile);
    pending.otpHash = sendResult.otpHash || null;
    pending.lastOtpSentAt = new Date();
    pending.otpVerifyAttempts = 0;
    await pending.save();

    const channels = sendResult.channels || ['whatsapp'];
    res.json({
      message: isTestingEnv()
        ? 'OTP generated for testing (WhatsApp/SMS disabled). Check server logs.'
        : `OTP sent to your ${formatChannelLabel(channels)}`,
      mobile: `******${mobile.slice(-4)}`,
      channels,
    });
  } catch (error) {
    console.error('sendSignupOtp error:', error.message);
    res.status(500).json({
      message: error.message || 'Failed to send OTP. Please try again.',
    });
  }
};

export const verifySignupOtp = async (req, res) => {
  const { phone, otp } = req.body;

  try {
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'Phone is required' });
    }
    if (!isTestingEnv() && !otp) {
      return res.status(400).json({ message: 'Phone and OTP are required' });
    }

    const mobile = normalizeIndianMobile(phone);
    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const pending = await PendingSignup.findOne({ mobile });
    if (!pending) {
      return res.status(400).json({ message: 'No signup in progress. Please request a new OTP.' });
    }

    if (pending.expiresAt < new Date()) {
      await PendingSignup.deleteOne({ mobile });
      return res.status(400).json({ message: 'OTP session expired. Please request a new OTP.' });
    }

    if (!isTestingEnv()) {
      pending.otpVerifyAttempts = (pending.otpVerifyAttempts || 0) + 1;
      if (pending.otpVerifyAttempts > MAX_OTP_VERIFY_ATTEMPTS) {
        await PendingSignup.deleteOne({ mobile });
        return res.status(429).json({ message: 'Too many OTP attempts. Please start signup again.' });
      }
      await pending.save();
      await msg91VerifySignupOtp(mobile, otp, pending);
    }

    const user = await createUserFromPendingSignup(pending, mobile);

    return sendAuthResponse(req, res, user, {}, 201);
  } catch (error) {
    console.error('verifySignupOtp error:', error.message);
    const status = error.message?.includes('Invalid') || error.message?.includes('expired') ? 400 : 500;
    res.status(status).json({
      message: error.message || 'OTP verification failed',
    });
  }
};

export const registerUser = async (req, res) => {
  const { name, email, password, role, phone } = req.body;

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: 'customer',
      phone,
      isApproved: true,
    });

    if (user) {
      return sendAuthResponse(req, res, user, {}, 201);
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Public self-service application for a garage/business to become
//          a Carzzi merchant partner. Unlike registerUser (customers, always
//          auto-approved), this always lands as role 'merchant' with
//          isApproved: false — an admin must approve it (see
//          approveUser/rejectUser in userController.js, surfaced today in
//          the Admin > Merchants "Pending" tab) before the account can log
//          in. Any role/isApproved/subRole fields in the request body are
//          ignored; they're never trusted from an unauthenticated request.
// @route   POST /api/auth/merchant/apply
// @access  Public
export const applyAsMerchant = async (req, res) => {
  const { name, email, password, phone, address } = req.body;

  try {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Business/garage name is required' });
    }
    if (!isValidName(name)) {
      return res.status(400).json({ message: 'Business/garage name must be 1-50 characters, letters and spaces only' });
    }
    const emailValidation = isValidEmail(email);
    if (!emailValidation.valid) {
      return res.status(400).json({ message: emailValidation.error || 'Invalid email' });
    }
    if (!password || password.length < 6 || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be 6-${MAX_PASSWORD_LENGTH} characters` });
    }
    if (!isValidPhone10(phone)) {
      return res.status(400).json({ message: 'A valid 10-digit phone number is required' });
    }
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({ message: 'Garage address is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userExists = await User.exists({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'merchant',
      phone: phone.trim(),
      location: { address: address.trim() },
      isApproved: false,
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid application data' });
    }

    res.status(201).json({
      message:
        'Your application has been submitted. Our team will review it and you’ll be able to log in once approved.',
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0]?.message;
      return res.status(400).json({ message: firstError || 'Invalid application data' });
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * Email-first login step — lets the client decide whether to show a
 * password field (account exists) or route to signup (it doesn't),
 * without leaking anything beyond existence itself.
 */
export const checkEmailExists = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email?.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailValidation = isValidEmail(normalizedEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({ message: emailValidation.error || 'Invalid email id' });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('_id');
    res.json({ exists: !!user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** Step 1 — verify email/password, prepare OTP session (no OTP yet). */
export const prepareLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email?.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ message: 'Too long data not accept' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailValidation = isValidEmail(normalizedEmail);
    
    if (!emailValidation.valid) {
      return res.status(400).json({ message: emailValidation.error || 'Invalid email id' });
    }
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (isAccountLocked(user)) {
      return res.status(429).json({ message: 'Account temporarily locked. Please try again later.' });
    }

    const isPasswordCorrect = await user.matchPassword(password);
    if (!isPasswordCorrect) {
      await recordFailedLogin(user);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    await clearLoginFailures(user);

    if (!user.isApproved) {
      return res.status(401).json({ message: 'Account pending approval. Please wait for admin approval.' });
    }

    // Admin accounts get an extra WhatsApp/SMS OTP step on top of the
    // password, for stronger protection on the most privileged role —
    // same mechanism as the phone-only login flow below, just entered
    // via email+password first instead of phone+OTP alone.
    // Local dev only: SKIP_ADMIN_OTP=true in backend/.env bypasses this step.
    // Never honoured when NODE_ENV=production.
    const skipAdminOtp =
      process.env.SKIP_ADMIN_OTP === 'true' && process.env.NODE_ENV !== 'production';
    if (user.role === 'admin' && !skipAdminOtp) {
      const mobile = resolveUserMobile(user);
      if (!mobile) {
        return res.status(400).json({
          message: 'No WhatsApp/SMS number on this account. Contact support to add one before logging in.',
        });
      }

      const expiresAt = new Date(Date.now() + OTP_PENDING_TTL_MS);
      await PendingLogin.findOneAndUpdate(
        { email: normalizedEmail },
        { email: normalizedEmail, userId: user._id, mobile, expiresAt, otpHash: null },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.json({
        message: 'Credentials verified. Continue to OTP verification.',
        mobile: `******${mobile.slice(-4)}`,
        verified: true,
      });
    }

    // Every other role: email + password already authenticates an
    // existing account — no extra OTP step on top of it. (OTP still
    // applies to first-time signup verification and the phone-only login
    // flow, which has no password to begin with.)
    return sendAuthResponse(req, res, user, { skipOtp: true });
  } catch (error) {
    console.error('prepareLogin error:', error.message);
    res.status(500).json({ message: error.message || 'Could not verify login' });
  }
};

/** Step 2 — send login OTP via WhatsApp (user_authentication template). */
export const sendLoginOtp = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email?.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pending = await PendingLogin.findOne({ email: normalizedEmail });

    if (!pending) {
      return res.status(400).json({ message: 'Please sign in with email and password first' });
    }

    if (pending.expiresAt < new Date()) {
      await PendingLogin.deleteOne({ email: normalizedEmail });
      return res.status(400).json({ message: 'Session expired. Please sign in again.' });
    }

    if (
      pending.lastOtpSentAt &&
      Date.now() - pending.lastOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      return res.status(429).json({ message: 'Please wait before requesting another OTP.' });
    }

    const sendResult = await msg91SendAuthOtp(pending.mobile);
    pending.otpHash = sendResult.otpHash || null;
    pending.lastOtpSentAt = new Date();
    pending.otpVerifyAttempts = 0;
    await pending.save();

    const channels = sendResult.channels || ['whatsapp'];
    res.json({
      message: isTestingEnv()
        ? 'OTP generated for testing (WhatsApp/SMS disabled). Check server logs.'
        : `OTP sent to your ${formatChannelLabel(channels)}`,
      mobile: `******${pending.mobile.slice(-4)}`,
      channels,
    });
  } catch (error) {
    console.error('sendLoginOtp error:', error.message);
    res.status(500).json({ message: error.message || 'Failed to send OTP' });
  }
};

/** Step 3 — verify OTP and issue session token. */
export const verifyLoginOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email?.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }
    if (!isTestingEnv() && !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pending = await PendingLogin.findOne({ email: normalizedEmail });

    if (!pending) {
      return res.status(400).json({ message: 'Please sign in with email and password first' });
    }

    if (pending.expiresAt < new Date()) {
      await PendingLogin.deleteOne({ email: normalizedEmail });
      return res.status(400).json({ message: 'OTP session expired. Please sign in again.' });
    }

    if (!isTestingEnv()) {
      pending.otpVerifyAttempts = (pending.otpVerifyAttempts || 0) + 1;
      if (pending.otpVerifyAttempts > MAX_OTP_VERIFY_ATTEMPTS) {
        await PendingLogin.deleteOne({ email: normalizedEmail });
        return res.status(429).json({ message: 'Too many OTP attempts. Please sign in again.' });
      }
      await pending.save();
      await msg91VerifySignupOtp(pending.mobile, otp, pending);
    }

    const user = await User.findById(pending.userId);
    if (!user) {
      await PendingLogin.deleteOne({ email: normalizedEmail });
      return res.status(400).json({ message: 'User not found' });
    }

    await PendingLogin.deleteOne({ email: normalizedEmail });

    return sendAuthResponse(req, res, user);
  } catch (error) {
    console.error('verifyLoginOtp error:', error.message);
    const status = error.message?.includes('Invalid') || error.message?.includes('expired') ? 400 : 500;
    res.status(status).json({ message: error.message || 'OTP verification failed' });
  }
};

/**
 * Passwordless mobile-number login: user enters just their phone number
 * (no password) — step 1 finds the account and sends an OTP.
 */
export const sendPhoneLoginOtp = async (req, res) => {
  const { phone } = req.body;

  try {
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }

    const mobile = normalizeIndianMobile(phone);
    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const user = await User.findOne({
      $or: [{ phone }, { phone: mobile }, { phone: mobile.slice(2) }],
    });

    if (!user) {
      return res.status(404).json({ message: 'No account found with this mobile number' });
    }

    if (isAccountLocked(user)) {
      return res.status(429).json({ message: 'Account temporarily locked. Please try again later.' });
    }

    if (!user.isApproved) {
      return res.status(401).json({ message: 'Account pending approval. Please wait for admin approval.' });
    }

    const pending = await PendingPhoneLogin.findOne({ mobile });
    if (
      pending?.lastOtpSentAt &&
      Date.now() - pending.lastOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      return res.status(429).json({ message: 'Please wait before requesting another OTP.' });
    }

    const isDummyTestLogin = mobile === DUMMY_TEST_MOBILE;
    const sendResult = isDummyTestLogin
      ? { otpHash: null, channels: ['sms'] }
      : await msg91SendAuthOtp(mobile);

    await PendingPhoneLogin.findOneAndUpdate(
      { mobile },
      {
        mobile,
        userId: user._id,
        otpHash: sendResult.otpHash || null,
        expiresAt: new Date(Date.now() + OTP_PENDING_TTL_MS),
        lastOtpSentAt: new Date(),
        otpVerifyAttempts: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const channels = sendResult.channels || ['whatsapp'];
    res.json({
      message: isDummyTestLogin
        ? `Use test OTP ${DUMMY_TEST_OTP} to log in.`
        : isTestingEnv()
        ? 'OTP generated for testing (WhatsApp/SMS disabled). Check server logs.'
        : `OTP sent to your ${formatChannelLabel(channels)}`,
      mobile: `******${mobile.slice(-4)}`,
      channels,
    });
  } catch (error) {
    console.error('sendPhoneLoginOtp error:', error.message);
    res.status(500).json({ message: error.message || 'Failed to send OTP. Please try again.' });
  }
};

/** Step 2 — verify the OTP and log the user straight in. */
export const verifyPhoneLoginOtp = async (req, res) => {
  const { phone, otp } = req.body;

  try {
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }
    if (!isTestingEnv() && !otp) {
      return res.status(400).json({ message: 'Mobile number and OTP are required' });
    }

    const mobile = normalizeIndianMobile(phone);
    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const pending = await PendingPhoneLogin.findOne({ mobile });
    if (!pending) {
      return res.status(400).json({ message: 'Please request a new OTP.' });
    }

    if (pending.expiresAt < new Date()) {
      await PendingPhoneLogin.deleteOne({ mobile });
      return res.status(400).json({ message: 'OTP session expired. Please request a new OTP.' });
    }

    const isDummyTestLogin = mobile === DUMMY_TEST_MOBILE && otp === DUMMY_TEST_OTP;

    if (!isTestingEnv() && !isDummyTestLogin) {
      pending.otpVerifyAttempts = (pending.otpVerifyAttempts || 0) + 1;
      if (pending.otpVerifyAttempts > MAX_OTP_VERIFY_ATTEMPTS) {
        await PendingPhoneLogin.deleteOne({ mobile });
        return res.status(429).json({ message: 'Too many OTP attempts. Please request a new OTP.' });
      }
      await pending.save();
      await msg91VerifySignupOtp(mobile, otp, pending);
    }

    const user = await User.findById(pending.userId);
    if (!user) {
      await PendingPhoneLogin.deleteOne({ mobile });
      return res.status(400).json({ message: 'User not found' });
    }

    if (!user.isApproved) {
      await PendingPhoneLogin.deleteOne({ mobile });
      return res.status(401).json({ message: 'Account pending approval. Please wait for admin approval.' });
    }

    await clearLoginFailures(user);
    await PendingPhoneLogin.deleteOne({ mobile });

    return sendAuthResponse(req, res, user);
  } catch (error) {
    console.error('verifyPhoneLoginOtp error:', error.message);
    const status = error.message?.includes('Invalid') || error.message?.includes('expired') ? 400 : 500;
    res.status(status).json({ message: error.message || 'OTP verification failed' });
  }
};

/**
 * Phone-first signup verification — step 1: OTP-verify the mobile number
 * on its own, before name/email/password exist. Lets the client (e.g. the
 * login screen, on detecting an unregistered number) send the OTP
 * immediately and only ask for the rest of the signup details afterward,
 * with the OTP field already showing.
 */
export const sendPhoneSignupOtp = async (req, res) => {
  const { phone } = req.body;

  try {
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'Mobile number is required' });
    }

    const mobile = normalizeIndianMobile(phone);
    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }

    const phoneTaken = await User.findOne({
      $or: [{ phone }, { phone: mobile }, { phone: mobile.slice(2) }],
    });
    if (phoneTaken) {
      return res.status(400).json({ message: 'Phone number is already registered' });
    }

    const pending = await PendingPhoneSignup.findOne({ mobile });
    if (
      pending?.lastOtpSentAt &&
      Date.now() - pending.lastOtpSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      return res.status(429).json({ message: 'Please wait before requesting another OTP.' });
    }

    const isDummyTestSignup = mobile === DUMMY_TEST_MOBILE;
    const sendResult = isDummyTestSignup
      ? { otpHash: null, channels: ['sms'] }
      : await msg91SendAuthOtp(mobile);

    await PendingPhoneSignup.findOneAndUpdate(
      { mobile },
      {
        mobile,
        otpHash: sendResult.otpHash || null,
        verified: false,
        expiresAt: new Date(Date.now() + OTP_PENDING_TTL_MS),
        lastOtpSentAt: new Date(),
        otpVerifyAttempts: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const channels = sendResult.channels || ['whatsapp'];
    res.json({
      message: isDummyTestSignup
        ? `Use test OTP ${DUMMY_TEST_OTP} to continue.`
        : isTestingEnv()
        ? 'OTP generated for testing (WhatsApp/SMS disabled). Check server logs.'
        : `OTP sent to your ${formatChannelLabel(channels)}`,
      mobile: `******${mobile.slice(-4)}`,
      channels,
    });
  } catch (error) {
    console.error('sendPhoneSignupOtp error:', error.message);
    res.status(500).json({ message: error.message || 'Failed to send OTP. Please try again.' });
  }
};

/**
 * Phone-first signup — step 2: verifies the OTP and creates the account in
 * one call, using the name/email/password collected on the same screen.
 * Requires a verified (or freshly-OTP-matching) PendingPhoneSignup for the
 * phone — i.e. sendPhoneSignupOtp must have been called first.
 */
export const completeSignup = async (req, res) => {
  const { name, email, password, phone, otp } = req.body;

  try {
    if (!name?.trim()) {
      return res.status(400).json({ message: 'Please enter your full name' });
    }
    if (isNameTooLong(name)) {
      return res.status(400).json({ message: 'Too long data not accept' });
    }
    if (!isValidName(name)) {
      return res.status(400).json({ message: 'Please enter a valid full name (must contain letters only with spaces, apostrophes, or hyphens)' });
    }
    if (!password || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ message: 'Too long data not accept' });
    }

    const normalizedEmail = (email || '').toLowerCase().trim();
    const emailValidation = isValidEmail(normalizedEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({ message: emailValidation.error || 'Invalid email id' });
    }

    const mobile = normalizeIndianMobile(phone);
    if (!mobile) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number' });
    }
    if (!isTestingEnv() && !otp) {
      return res.status(400).json({ message: 'Please verify your mobile number first' });
    }

    const pending = await PendingPhoneSignup.findOne({ mobile });
    if (!pending) {
      return res.status(400).json({ message: 'Please verify your mobile number first' });
    }
    if (pending.expiresAt < new Date()) {
      await PendingPhoneSignup.deleteOne({ mobile });
      return res.status(400).json({ message: 'OTP session expired. Please verify your mobile number again.' });
    }

    const isDummyTestSignup = mobile === DUMMY_TEST_MOBILE && otp === DUMMY_TEST_OTP;

    if (!pending.verified && !isTestingEnv() && !isDummyTestSignup) {
      pending.otpVerifyAttempts = (pending.otpVerifyAttempts || 0) + 1;
      if (pending.otpVerifyAttempts > MAX_OTP_VERIFY_ATTEMPTS) {
        await PendingPhoneSignup.deleteOne({ mobile });
        return res.status(429).json({ message: 'Too many OTP attempts. Please verify your mobile number again.' });
      }
      await pending.save();
      await msg91VerifySignupOtp(mobile, otp, pending);
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const phoneTaken = await User.findOne({
      $or: [{ phone }, { phone: mobile }, { phone: mobile.slice(2) }],
    });
    if (phoneTaken) {
      await PendingPhoneSignup.deleteOne({ mobile });
      return res.status(400).json({ message: 'Phone number is already registered' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'customer',
      phone: mobile.slice(2),
      isApproved: true,
    });

    await PendingPhoneSignup.deleteOne({ mobile });

    return sendAuthResponse(req, res, user, {}, 201);
  } catch (error) {
    console.error('completeSignup error:', error.message);
    const status = error.message?.includes('Invalid') || error.message?.includes('expired') ? 400 : 500;
    res.status(status).json({ message: error.message || 'Could not create account' });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = email.toLowerCase();

  try {
    const user = await User.findOne({ email: normalizedEmail });

    if (user && (await user.matchPassword(password))) {
      if (!user.isApproved) {
        return res.status(401).json({ message: 'Account pending approval. Please wait for admin approval.' });
      }

      return sendAuthResponse(req, res, user);
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const googleLogin = async (req, res) => {
  const { idToken, signupIfMissing } = req.body;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { email, name, picture } = decodedToken;
    const normalizedEmail = email.toLowerCase();

    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      if (signupIfMissing) {
        return res.status(404).json({
          code: 'GOOGLE_ACCOUNT_NOT_FOUND',
          message: 'No account found for this Google email. Please sign up.',
          email: normalizedEmail,
          name: name || '',
          avatar: picture || '',
        });
      }

      user = await User.create({
        name,
        email: normalizedEmail,
        password: crypto.randomBytes(16).toString('hex'),
        role: 'customer',
        isApproved: true,
        avatar: picture,
      });
    }

    if (!user.isApproved) {
      return res.status(401).json({ 
        message: 'Account pending approval. Please wait for admin approval.',
        code: 'PENDING_APPROVAL' 
      });
    }

    return sendAuthResponse(req, res, user);
  } catch (error) {
    console.error('Google login verification error:', error);
    res.status(401).json({ message: 'Invalid Google token' });
  }
};

export const logoutUser = async (req, res) => {
  clearAuthCookie(res);

  // Revoke the token server-side (mobile/staff tokens don't expire on
  // their own, so this is what actually ends the session — bumping
  // tokenVersion makes every previously issued token fail the check in
  // authMiddleware.loadUserFromToken).
  if (req.user) {
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save({ validateBeforeSave: false });
  }

  res.json({ message: 'Logged out successfully' });
};

export const getSession = async (req, res) => {
  res.json(userAuthFields(req.user));
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'No account found with this email address.' });
    }

    if (
      user.passwordResetSentAt &&
      Date.now() - user.passwordResetSentAt.getTime() < FORGOT_PASSWORD_COOLDOWN_MS
    ) {
      return res.status(400).json({ message: 'Please wait before requesting another OTP.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    user.passwordResetToken = hashedOtp;
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
    user.passwordResetSentAt = new Date();
    await user.save({ validateBeforeSave: false });

    const subject = 'Password Reset OTP';
    const text = `Your password reset OTP is ${otp}. It is valid for 10 minutes. If you did not request this, you can ignore this email.`;
    const html = `<p>You requested a password reset for your Vehicle Management System account.</p><p>Your password reset OTP is: <strong>${otp}</strong></p><p>This OTP is valid for 10 minutes.</p><p>If you did not request this, you can ignore this email.</p>`;

    await sendEmail(email, subject, text, html);

    res.json({ message: 'If an account with that email exists, a reset OTP has been sent.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const resetPassword = async (req, res) => {
  const { email, otp, password } = req.body;

  try {
    if (!email || !otp || !password) {
      return res.status(400).json({ message: 'Email, OTP, and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const hashedToken = crypto.createHash('sha256').update(otp.trim()).digest('hex');

    const user = await User.findOne({
      email: normalizedEmail,
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Reset OTP is invalid or has expired.' });
    }

    if (await user.matchPassword(password)) {
      return res.status(400).json({ message: 'New password must be different from the current password.' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetSentAt = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
