import crypto from 'crypto';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import AvailableServicePincode from '../models/AvailableServicePincode.js';
import { calculateOrderTotals } from '../utils/orderPricing.js';
import { sendPushToUser } from '../utils/pushService.js';
import { normalizeIndianMobile, sendWhatsAppMessage, sendFlowSms } from '../utils/msg91Service.js';
import { createTrackingToken } from '../utils/trackingToken.js';
import { placeholderEmailFor } from '../utils/placeholderEmail.js';
import { emitEntitySync } from '../utils/syncService.js';
import { logAudit } from './auditController.js';
import {
  calculateServicesTotal,
  extractPincodeFromAddress,
  getCategoryGroup,
  isSlotAvailable,
  emitBookingUpdate,
  sanitizeBooking,
} from './bookingController.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits.length === 10 ? digits : null;
};

const isGeneralService = (s) =>
  s.category === 'Periodic' || s.category === 'Services' || (s.name && s.name.toLowerCase().includes('general service'));
const PREPAID_CATEGORIES = ['Car Wash', 'Wash', 'Battery', 'Tyres', 'Tyre & Battery', 'Essentials'];
const SUMMARY_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Frontend base for customer links: the admin's own site when it's an allowed
 * origin (so local testing gets localhost links), else FRONTEND_URL. */
const resolveFrontendBase = (req) => {
  const clean = (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, '');
  const origin = clean(req.get('origin'));
  const allowed = [process.env.FRONTEND_URL, ...(process.env.FRONTEND_URLS || '').split(',')].map(clean).filter(Boolean);
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) && process.env.NODE_ENV !== 'production';
  if (origin && (allowed.includes(origin) || isLocal)) return origin;
  return clean(process.env.FRONTEND_URL) || 'http://localhost:8080';
};

/** Public booking-summary link sent to the customer (signed, expires in 30 days). */
const bookingSummaryUrl = (req, bookingId) =>
  `${resolveFrontendBase(req)}/booking/${createTrackingToken(String(bookingId), SUMMARY_LINK_TTL_MS)}`;

// @desc    Search customers by name, phone or email (with their vehicles)
// @route   GET /api/bookings/admin/customers?q=
// @access  Private/Admin
export const searchCustomersForBooking = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const rx = new RegExp(escapeRegex(q), 'i');
    const phone = normalizePhone(q);
    const customers = await User.find({
      role: 'customer',
      $or: [{ name: rx }, { email: rx }, { phone: phone || rx }],
    })
      .select('name email phone addresses')
      .limit(10)
      .lean();
    const vehicles = await Vehicle.find({ user: { $in: customers.map((c) => c._id) } })
      .select('user make model variant fuelType licensePlate year')
      .lean();
    res.json(
      customers.map((c) => ({
        ...c,
        vehicles: vehicles.filter((v) => String(v.user) === String(c._id)),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Admin creates a booking for a customer (optionally new customer + vehicle)
// @route   POST /api/bookings/admin/create
// @access  Private/Admin
// Body: { customer: { userId } | { name, phone, email? },
//         vehicle: { vehicleId } | { make, model, variant?, fuelType?, licensePlate, frontTyres?, rearTyres? },
//         serviceIds, selectedBrands?, serviceQuantities?, date, location: { address, lat?, lng? },
//         notes?, merchantId? }
// Prices are always computed on the server. Anything created here is rolled
// back if a later step fails, so a failed request saves nothing.
export const adminCreateBooking = async (req, res) => {
  const { customer, vehicle, serviceIds, selectedBrands, serviceQuantities, date, location, notes, merchantId } =
    req.body || {};
  const created = { user: null, vehicle: null };

  const rollback = async () => {
    if (created.vehicle) await Vehicle.deleteOne({ _id: created.vehicle._id }).catch(() => {});
    if (created.user) await User.deleteOne({ _id: created.user._id }).catch(() => {});
  };

  try {
    // ----- Validate booking inputs before writing anything -----
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one service' });
    }
    const parsedDate = new Date(date);
    if (!date || isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Choose a valid date and time slot' });
    }
    if (parsedDate.getTime() < Date.now() - 5 * 60 * 1000) {
      return res.status(400).json({ message: 'The selected slot is in the past' });
    }
    const address = typeof location?.address === 'string' ? location.address.trim() : '';
    if (!address) return res.status(400).json({ message: 'Pickup address is required' });
    const pincode = extractPincodeFromAddress(address);
    if (!pincode) {
      return res.status(400).json({ message: 'Pickup address must contain a valid 6-digit pincode' });
    }
    const allowed = await AvailableServicePincode.find({}).select('pincode').lean();
    if (!allowed.some((p) => p.pincode === pincode)) {
      return res.status(409).json({ message: 'Service is not available for this pincode' });
    }
    if (notes && String(notes).length > 1000) {
      return res.status(400).json({ message: 'Notes must be 1000 characters or fewer' });
    }

    let merchant = null;
    if (merchantId) {
      merchant = await User.findOne({ _id: merchantId, role: 'merchant' }).select('_id name');
      if (!merchant) return res.status(400).json({ message: 'Selected merchant was not found' });
    }

    // ----- Customer -----
    let user;
    let isNewCustomer = false;
    if (customer?.userId) {
      user = await User.findOne({ _id: customer.userId, role: 'customer' });
      if (!user) return res.status(404).json({ message: 'Customer not found' });
    } else {
      const name = String(customer?.name || '').trim();
      const phone = normalizePhone(customer?.phone);
      const email = String(customer?.email || '').trim().toLowerCase();
      if (!name) return res.status(400).json({ message: 'Customer name is required' });
      if (!phone) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number' });
      const phoneTaken = await User.findOne({ $or: [{ phone }, { phone: `91${phone}` }] }).select('_id');
      if (phoneTaken) {
        return res.status(409).json({ message: 'A user with this mobile number already exists. Search and select them instead.' });
      }
      if (email && (await User.findOne({ email }).select('_id'))) {
        return res.status(409).json({ message: 'A user with this email already exists' });
      }
      // Customers sign in with mobile + OTP; the email/password only satisfy
      // the schema when the admin doesn't have an email.
      user = await User.create({
        name,
        phone,
        email: email || placeholderEmailFor(phone),
        password: crypto.randomBytes(24).toString('hex'),
        role: 'customer',
        isApproved: true,
      });
      created.user = user;
      isNewCustomer = true;
    }

    // ----- Vehicle -----
    let vehicleDoc;
    if (vehicle?.vehicleId) {
      vehicleDoc = await Vehicle.findOne({ _id: vehicle.vehicleId, user: user._id });
      if (!vehicleDoc) {
        await rollback();
        return res.status(404).json({ message: 'Vehicle not found for this customer' });
      }
    } else {
      const make = String(vehicle?.make || '').trim();
      const model = String(vehicle?.model || '').trim();
      const licensePlate = String(vehicle?.licensePlate || '').replace(/\s+/g, '').toUpperCase();
      if (!make || !model || !licensePlate) {
        await rollback();
        return res.status(400).json({ message: 'Vehicle make, model and registration number are required' });
      }
      vehicleDoc = await Vehicle.create({
        user: user._id,
        make,
        model,
        variant: vehicle?.variant ? String(vehicle.variant).trim() : undefined,
        fuelType: vehicle?.fuelType ? String(vehicle.fuelType).trim() : undefined,
        licensePlate,
        frontTyres: vehicle?.frontTyres ? String(vehicle.frontTyres).slice(0, 100) : undefined,
        rearTyres: vehicle?.rearTyres ? String(vehicle.rearTyres).slice(0, 100) : undefined,
      });
      created.vehicle = vehicleDoc;
    }

    // ----- Pricing (server-side only) -----
    const { total: servicesTotal, refMatch, services, unavailableBrandServices } = await calculateServicesTotal(
      serviceIds,
      vehicleDoc._id,
      selectedBrands || {},
      serviceQuantities || {}
    );
    if (!services || services.length === 0) {
      await rollback();
      return res.status(400).json({ message: 'Select at least one valid service' });
    }
    if (unavailableBrandServices?.length) {
      const { serviceName, brand } = unavailableBrandServices[0];
      await rollback();
      return res.status(400).json({
        message: `${brand} is not available for this vehicle${serviceName ? ` (${serviceName})` : ''}`,
      });
    }

    const categories = Array.from(new Set(services.map((s) => getCategoryGroup(s.category))));
    if (!(await isSlotAvailable(parsedDate, categories))) {
      await rollback();
      return res.status(409).json({ message: 'That slot is no longer available. Pick another time.' });
    }

    const general = services.some(isGeneralService);
    let pickupDropPrice = 0;
    if (general && refMatch?.pickup_drop_price) {
      const extra = Number(refMatch.pickup_drop_price);
      if (Number.isFinite(extra)) pickupDropPrice = extra;
    }
    const prepaid = services.some((s) => PREPAID_CATEGORIES.includes(s.category));
    // Same totals the customer checkout uses: GST only on prepaid services.
    const totals = calculateOrderTotals(servicesTotal + pickupDropPrice, 0, prepaid && !general);
    const isCarWash = services.some((s) => ['Car Wash', 'Wash', 'Essentials'].includes(s.category));
    const isBatteryTire = services.some((s) => ['Battery', 'Tyres', 'Tyre & Battery'].includes(s.category));

    // ----- Booking -----
    let booking;
    try {
      booking = await Booking.create({
        user: user._id,
        vehicle: vehicleDoc._id,
        services: services.map((s) => s._id),
        date: parsedDate,
        notes: notes ? String(notes).trim() : undefined,
        location: { address, lat: location?.lat, lng: location?.lng },
        totalAmount: totals.subtotal,
        pickupDropPrice,
        discountAmount: 0,
        gstAmount: totals.tax,
        finalAmount: totals.total,
        paymentStatus: 'pending',
        selectedBrands: selectedBrands || {},
        serviceQuantities: serviceQuantities || {},
        merchant: merchant?._id,
        createdByAdmin: true,
        createdBy: req.user._id,
        ...(isCarWash && { carWash: { isCarWashService: true, beforeWashPhotos: [], afterWashPhotos: [] } }),
        ...(isBatteryTire && { batteryTire: { isBatteryTireService: true } }),
      });
    } catch (err) {
      await rollback();
      throw err;
    }

    const populated = await Booking.findById(booking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone location');

    emitBookingUpdate(populated);
    emitEntitySync('booking', 'created', sanitizeBooking(populated, null));

    await logAudit({
      user: req.user._id,
      action: 'ADMIN_BOOKING_CREATED',
      targetModel: 'Booking',
      targetId: booking._id,
      details: {
        orderNumber: booking.orderNumber,
        customerId: user._id,
        newCustomer: isNewCustomer,
        newVehicle: !!created.vehicle,
        finalAmount: booking.finalAmount,
      },
      ipAddress: req.ip,
    });

    const summaryUrl = bookingSummaryUrl(req, booking._id);
    res.status(201).json({ ...sanitizeBooking(populated, req.user), summaryUrl });

    // ----- Notifications (after responding) -----
    setImmediate(async () => {
      const orderRef = booking.orderNumber || String(booking._id).slice(-6).toUpperCase();
      const when = parsedDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
      try {
        await sendPushToUser(
          user._id,
          'Booking Confirmed',
          `Carzzi booked ${services.map((s) => s.name).join(', ')} for you on ${when} (#${orderRef}).`,
          { bookingId: String(booking._id), type: 'order' },
          'order'
        );
        if (merchant) {
          await sendPushToUser(
            merchant._id,
            'New Order Assigned',
            `Order #${orderRef} has been assigned to you for ${when}.`,
            { bookingId: String(booking._id), type: 'order' },
            'order'
          );
        }
      } catch (err) {
        console.error('Admin booking push failed:', err.message);
      }
      try {
        const mobile = normalizeIndianMobile(user.phone);
        if (!mobile) return;
        const welcomeTemplate = process.env.MSG91_WHATSAPP_WELCOME_TEMPLATE_NAME?.trim();
        if (isNewCustomer && welcomeTemplate) {
          await sendWhatsAppMessage(mobile, welcomeTemplate, {
            body_1: { type: 'text', value: user.name || 'Customer' },
          });
        }
        const serviceNames = services.map((s) => s.name).join(', ');
        const vehicleName = `${vehicleDoc.make} ${vehicleDoc.model}`.trim();
        const amountText = `₹${Number(booking.finalAmount).toLocaleString('en-IN')}`;
        // WhatsApp template body: {{1}} name, {{2}} service, {{3}} vehicle, {{4}} date/time,
        // {{5}} order no., {{6}} estimated amount, {{7}} booking link.
        const bookingTemplate = process.env.MSG91_WHATSAPP_BOOKING_CREATED_TEMPLATE_NAME?.trim();
        if (bookingTemplate) {
          await sendWhatsAppMessage(mobile, bookingTemplate, {
            body_1: { type: 'text', value: user.name || 'Customer' },
            body_2: { type: 'text', value: serviceNames },
            body_3: { type: 'text', value: vehicleName },
            body_4: { type: 'text', value: when },
            body_5: { type: 'text', value: String(orderRef) },
            body_6: { type: 'text', value: amountText },
            body_7: { type: 'text', value: summaryUrl },
          }).catch((err) => console.error('Admin booking WhatsApp failed:', err.message));
        }
        // SMS (DLT template via MSG91 Flow): ##service## ##vehicle## ##datetime## ##order## ##link##
        const smsTemplate = process.env.MSG91_SMS_BOOKING_CREATED_TEMPLATE_ID?.trim();
        if (smsTemplate) {
          await sendFlowSms(mobile, smsTemplate, {
            service: serviceNames.slice(0, 30),
            vehicle: vehicleName.slice(0, 30),
            datetime: when,
            order: String(orderRef),
            link: summaryUrl,
          }).catch((err) => console.error('Admin booking SMS failed:', err.message));
        }
      } catch (err) {
        console.error('Admin booking messaging failed:', err.message);
      }
    });
  } catch (error) {
    await rollback();
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: Object.values(error.errors).map((e) => e.message).join(', ') });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A customer with these details already exists' });
    }
    res.status(400).json({ message: error.message });
  }
};
