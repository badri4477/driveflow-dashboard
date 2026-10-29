import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import SlotBlock from '../models/SlotBlock.js';
import AvailableServicePincode from '../models/AvailableServicePincode.js';
import { generateOrderNumber, formatOrderReference } from '../utils/orderNumber.js';
import { mapCategoryToCouponServiceType } from '../utils/orderPricing.js';
import User from '../models/User.js';
import { getIO, emitChatMessage } from '../socket.js';
import { emitEntitySync } from '../utils/syncService.js';
import { sendEmail } from '../utils/emailService.js';
import { getBookingStatusEmail, BOOKING_STATUS_EMAIL_KEYS } from '../utils/emailTemplates.js';
import { normalizeStatus, isValidTransition } from '../utils/statusMachine.js';
import { sendPushToUser, sendPushToRole } from '../utils/pushService.js';
import {
  sendLiveTrackingDismissPush,
  trySendLiveTrackingAssignmentSeed,
} from '../utils/liveTrackingPush.js';
import { normalizeIndianMobile, sendWhatsAppMessage, resolveAssignedWhatsAppTemplateName, resolveFeedbackWhatsAppTemplateName } from '../utils/msg91Service.js';
import crypto from 'crypto';
import Message from '../models/Message.js';
import { attachHealthPercentToBookingPayload } from '../utils/vehicleHealthDisplay.js';
import { verifyTrackingToken, createTrackingToken } from '../utils/trackingToken.js';
import { validateAssignees } from '../utils/assignmentValidation.js';
import { canAccessBooking } from '../utils/bookingAccess.js';
import { isCouponDateValid } from '../utils/validation.js';

export const toPublicTrackingDto = (booking) => {
  const bookingObj = typeof booking.toObject === 'function' ? booking.toObject({ virtuals: true }) : { ...booking };
  const phone = bookingObj.user?.phone || '';
  const maskedPhone = phone ? `******${String(phone).slice(-4)}` : undefined;
  return {
    _id: bookingObj._id,
    orderNumber: bookingObj.orderNumber,
    status: bookingObj.status,
    date: bookingObj.date,
    assignedAt: bookingObj.assignedAt,
    maskedPhone,
    services: (bookingObj.services || []).map((s) => ({
      _id: s._id,
      name: s.name,
      category: s.category,
    })),
    vehicle: bookingObj.vehicle
      ? {
          make: bookingObj.vehicle.make,
          model: bookingObj.vehicle.model,
          registrationNumber: bookingObj.vehicle.registrationNumber,
        }
      : undefined,
  };
};

const validateImageUrls = (urls) => {
  if (!urls) return;
  const urlList = Array.isArray(urls) ? urls : [urls];
  for (const url of urlList) {
    if (typeof url === 'string' && url.trim() !== '') {
      const cleanUrl = url.split('?')[0];
      if (/\.pdf$/i.test(cleanUrl)) {
        throw new Error('Only image formats (JPEG, PNG, WEBP, etc.) are allowed for vehicle and service photos.');
      }
    }
  }
};

export { createTrackingToken };

export const sanitizeBooking = (booking, currentUser) => {
  if (!booking) return booking;

  const obj = typeof booking.toObject === 'function'
    ? booking.toObject({ virtuals: true })
    : (booking.toJSON ? booking.toJSON() : { ...booking });

  if (obj.deliveryOtp) {
    let bookingUserId = null;
    if (obj.user) {
      if (typeof obj.user === 'object') {
        bookingUserId = obj.user._id?.toString() || obj.user.id?.toString() || null;
      } else {
        bookingUserId = obj.user.toString();
      }
    }

    const currentUserId = currentUser && currentUser._id ? currentUser._id.toString() : null;
    const currentUserRole = currentUser && currentUser.role ? currentUser.role.toLowerCase() : null;

    // Only allow the booking owner (customer) or an admin to see the OTP code
    if (!currentUserId || (bookingUserId !== currentUserId && currentUserRole !== 'admin')) {
      if (obj.deliveryOtp.code) {
        delete obj.deliveryOtp.code;
      }
    }
  }

  return obj;
};

const SLOT_INTERVAL_MINUTES = 30;
const SLOT_START_HOUR = 8;
const SLOT_END_HOUR = 19;
const CAR_WASH_MIN_PHOTOS = 2;
const CAR_WASH_MAX_PHOTOS = 4;
const BATTERY_AFTER_PHOTOS_REQUIRED = 4;

/** Customer mobile push when vehicle is out for delivery with PIN. */
const sendCustomerDeliveryOtpPush = async (booking, code) => {
  const userRef = booking?.user;
  const userId =
    userRef && typeof userRef === 'object' && userRef._id
      ? userRef._id
      : userRef;
  if (!userId || !code) return;

  const orderRef = formatOrderReference(booking);

  await sendPushToUser(
    userId,
    'Delivery OTP',
    `Your vehicle is on the way for booking #${orderRef}. Share delivery PIN ${code} with your delivery partner when they arrive. PIN expires in 20 minutes.`,
    {
      type: 'delivery_otp',
      status: 'OUT_FOR_DELIVERY',
      bookingId: String(booking._id),
      deliveryOtp: String(code),
    },
    'delivery_otp'
  );
};
const BLOCKING_STATUSES = {
  $nin: ['DELIVERED', 'COMPLETED', 'CANCELLED'],
};

const normalizePincode = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
};

const extractPincodeFromAddress = (address) => {
  const match = String(address || '').match(/(\d{6})(?!\d)/);
  return normalizePincode(match ? match[1] : null);
};

const getCategoryGroup = (serviceCategory) => {
  const cat = (serviceCategory || '').trim();
  if (cat === 'Car Wash' || cat === 'Wash') {
    return 'Car Wash';
  } else if (cat === 'Tyres' || cat === 'Battery' || cat === 'Tyre & Battery') {
    return 'Tyres & Battery';
  } else if (cat === 'Essentials') {
    return 'Essentials';
  } else {
    return 'General Services';
  }
};

const normalizeCategoryGroup = (category) => {
  const cat = (category || 'All').trim();
  if (cat === 'All') return 'All';
  if (cat === 'Car Wash' || cat === 'Wash') {
    return 'Car Wash';
  }
  if (cat === 'Tyres & Battery' || cat === 'Tyre & Battery' || cat === 'Tyres' || cat === 'Battery') {
    return 'Tyres & Battery';
  }
  if (cat === 'Essentials') {
    return 'Essentials';
  }
  return 'General Services';
};

/** Helper to calculate services total with vehicle-specific pricing (like car wash). */
export const calculateServicesTotal = async (serviceIds, vehicleId, selectedBrands = {}, serviceQuantities = {}) => {
  const normalizedBrands = selectedBrands || {};
  const normalizedQuantities = serviceQuantities || {};
  console.log('calculateServicesTotal inputs:', { serviceIds, vehicleId, selectedBrands: normalizedBrands, serviceQuantities: normalizedQuantities });
  try {
    const Service = (await import('../models/Service.js')).default;
    const Vehicle = (await import('../models/Vehicle.js')).default;
    const { getVehicleDataFromS3, getVehicleReferenceColumnsFromS3 } = await import('../utils/s3Storage.js');

    const services = await Service.find({ _id: { $in: serviceIds } });
    const vehicle = await Vehicle.findById(vehicleId);
    const allRefData = await getVehicleDataFromS3();
    // Admin-added brand columns keep the field name they were created with
    // even after their display label is renamed (e.g. "Yokohama Blue Earth
    // GT" -> "Yokohama [Blue Earth GT]" for clarity) — re-deriving the
    // field name from the *current* label would silently miss the price.
    // Resolve by matching the current label back to its real field name
    // first; only fall back to naive slugification for built-in brands
    // (Bridgestone, Amaron, ...) whose key has always just been the
    // lowercased, space-stripped name.
    const dynamicColumns = await getVehicleReferenceColumnsFromS3().catch(() => []);
    const resolveBrandFieldNames = (category, brand) => {
      const naiveFieldName = `${category}_price_${String(brand).toLowerCase().replace(/\s+/g, '')}`;
      const byLabel = dynamicColumns.find(
        (c) => c.category === category && String(c.label || '').trim().toLowerCase() === String(brand).trim().toLowerCase()
      );
      return [byLabel?.fieldName, naiveFieldName].filter(Boolean);
    };

    let refMatch = null;
    if (vehicle) {
      const clean = (value) =>
        String(value || '')
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
      const exactMatches = (value, search) => clean(value) === search;
      const partialMatches = (value, search) => clean(value).includes(search);

      const cleanBrand = clean(vehicle.make);
      const fullModel = clean(vehicle.model);
      const cleanModel = clean(String(vehicle.model || '').replace(/\[.*\]/g, ''));
      const cleanVariant = vehicle.variant ? clean(vehicle.variant) : '';
      const cleanFuelType = clean(vehicle.fuelType);

      const fuelTypeMatches = (item) => clean(item.fuel_type) === cleanFuelType;
      const findWithFuelTypePreference = (matchFn) => {
        if (cleanFuelType) {
          const fuelMatch = allRefData.find((item) => matchFn(item) && fuelTypeMatches(item));
          if (fuelMatch) return fuelMatch;
        }
        return allRefData.find(matchFn);
      };

      if (cleanVariant) {
        refMatch = findWithFuelTypePreference((item) =>
          exactMatches(item.brand_name, cleanBrand) &&
          (exactMatches(item.model, fullModel) || exactMatches(item.model, cleanModel)) &&
          exactMatches(item.brand_model, cleanVariant)
        );
      }

      refMatch ??= findWithFuelTypePreference((item) =>
        exactMatches(item.brand_name, cleanBrand) &&
        (exactMatches(item.model, fullModel) || exactMatches(item.model, cleanModel))
      );

      refMatch ??= findWithFuelTypePreference((item) =>
        exactMatches(item.brand_name, cleanBrand) &&
        (partialMatches(item.model, fullModel) || partialMatches(item.model, cleanModel))
      );
    }

    let total = 0;
    // Services where a brand was selected (or inferred) but the matched
    // vehicle reference row has no valid (numeric, >0) price for that
    // brand — e.g. marked "Not Available" in admin. Booking these should
    // be rejected rather than silently falling back to the generic price.
    const unavailableBrandServices = [];
    services.forEach(service => {
      const isWash = service.category === 'Car Wash' || service.category === 'Wash';
      const isBattery =
        service.category === 'Battery' ||
        service.vehiclePricingColumn === 'battery_brand' ||
        (service.name && service.name.toLowerCase().includes('battery'));
      const isTire =
        !isBattery &&
        (service.category === 'Tyres' ||
          service.category === 'Tyre & Battery' ||
          service.vehiclePricingColumn === 'tyre_brand' ||
          (service.name && service.name.toLowerCase().includes('tyre')));
      const isGeneral =
        service.category === 'Periodic' ||
        service.category === 'Services' ||
        (service.name && service.name.toLowerCase().includes('general service'));

      const qty = Number(normalizedQuantities[service._id.toString()] || normalizedQuantities[service._id] || 1);
      let servicePrice = service.price;

      // Admin-selected pricing column (set in Add/Edit Service) takes
      // priority over the name-substring heuristics below — explicit and
      // not dependent on how the service happens to be worded.
      let pricedFromColumn = false;
      // 'tyre_brand'/'battery_brand' are sentinels, not real VehicleReference
      // fields — they route into the per-brand isTire/isBattery logic below
      // instead of a direct column lookup.
      const isDirectPricingColumn =
        service.vehiclePricingColumn &&
        service.vehiclePricingColumn !== 'tyre_brand' &&
        service.vehiclePricingColumn !== 'battery_brand';
      if (isDirectPricingColumn && refMatch) {
        const columnPrice = refMatch[service.vehiclePricingColumn];
        const priceNum = Number(columnPrice);
        if (columnPrice && !isNaN(priceNum) && priceNum > 0) {
          servicePrice = priceNum;
          pricedFromColumn = true;
        }
      }

      if (pricedFromColumn) {
        // Already priced from the explicit column above — skip the
        // name-heuristic branches below.
      } else if (isGeneral && refMatch) {
        const generalPrice = Number(refMatch.general_service_price);
        if (refMatch.general_service_price && !isNaN(generalPrice) && generalPrice > 0) {
          servicePrice = generalPrice;
        }
      } else if (isWash && refMatch) {
        let washPrice = null;
        const sName = service.name.toLowerCase();

        if (sName.includes('exterior wash') && !sName.includes('interior')) {
          washPrice = refMatch.car_wash_exterior_price;
        } else if (sName.includes('interior + exterior') && !sName.includes('underbody')) {
          washPrice = refMatch.car_wash_interior_exterior_price;
        } else if (sName.includes('underbody wash') || (sName.includes('interior') && sName.includes('exterior') && sName.includes('underbody'))) {
          washPrice = refMatch.car_wash_interior_exterior_underbody_price;
        }

        // Fallback to legacy car_wash_price if specific one is not set
        if (!washPrice || washPrice === '') {
          washPrice = refMatch.car_wash_price;
        }

        const priceNum = Number(washPrice);
        if (washPrice && !isNaN(priceNum) && priceNum > 0) {
          servicePrice = priceNum;
        }
      } else if (isBattery && refMatch) {
        let selectedBrand = normalizedBrands[service._id.toString()] || normalizedBrands[service._id];
        if (!selectedBrand && service.name) {
          const nameLower = service.name.toLowerCase();
          if (nameLower.includes('amaron')) selectedBrand = 'Amaron';
          else if (nameLower.includes('exide')) selectedBrand = 'Exide';
        }
        console.log('Battery price matching:', { serviceId: service._id, name: service.name, selectedBrand, selectedBrands: normalizedBrands });
        if (selectedBrand) {
          const candidateFieldNames = resolveBrandFieldNames('battery', selectedBrand);
          let brandPrice = null;
          let priceNum = NaN;
          for (const fieldName of candidateFieldNames) {
            const candidate = refMatch[fieldName];
            const candidateNum = Number(candidate);
            if (candidate && !isNaN(candidateNum) && candidateNum > 0) {
              brandPrice = candidate;
              priceNum = candidateNum;
              break;
            }
          }
          console.log('Resolved battery brand price:', { candidateFieldNames, brandPrice, priceNum });
          if (brandPrice && !isNaN(priceNum) && priceNum > 0) {
            servicePrice = priceNum;
          } else {
            console.log('Invalid battery brand price, falling back to service.price', service.price);
            unavailableBrandServices.push({ serviceId: service._id.toString(), serviceName: service.name, brand: selectedBrand });
          }
        } else {
          console.log('No battery brand selected or matched, falling back to service.price', service.price);
        }
      } else if (isTire && refMatch) {
        const selectedBrand = normalizedBrands[service._id.toString()] || normalizedBrands[service._id];
        console.log('Tyre price matching:', { serviceId: service._id, name: service.name, selectedBrand, selectedBrands: normalizedBrands });
        if (selectedBrand) {
          const candidateFieldNames = resolveBrandFieldNames('tyre', selectedBrand);
          let brandPrice = null;
          let priceNum = NaN;
          for (const fieldName of candidateFieldNames) {
            const candidate = refMatch[fieldName];
            const candidateNum = Number(candidate);
            if (candidate && !isNaN(candidateNum) && candidateNum > 0) {
              brandPrice = candidate;
              priceNum = candidateNum;
              break;
            }
          }
          console.log('Resolved brand price:', { candidateFieldNames, brandPrice, priceNum });
          if (brandPrice && !isNaN(priceNum) && priceNum > 0) {
            servicePrice = priceNum;
          } else {
            console.log('Invalid brand price, falling back to service.price', service.price);
            unavailableBrandServices.push({ serviceId: service._id.toString(), serviceName: service.name, brand: selectedBrand });
          }
        } else {
          console.log('No brand selected, falling back to service.price', service.price);
        }
      }

      total += (servicePrice * qty);
    });

    return { total, refMatch, services, unavailableBrandServices };
  } catch (err) {
    console.error('Error in calculateServicesTotal:', err);
    // Fallback to basic calculation
    const Service = (await import('../models/Service.js')).default;
    const services = await Service.find({ _id: { $in: serviceIds } });
    const total = services.reduce((acc, s) => {
      const qty = Number(normalizedQuantities[s._id.toString()] || normalizedQuantities[s._id] || 1);
      return acc + (s.price * qty);
    }, 0);
    return { total, refMatch: null, services };
  }
};

const formatTo12HourSlot = (date) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return formatter.format(date).replace(/[\u202f\u00a0]/g, ' ');
};

const getDayBounds = (dateInput) => {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    const [y, m, d] = dateInput.split('T')[0].split('-').map(Number);
    const start = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000+05:30`);
    const end = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:59.999+05:30`);
    return { start, end };
  }

  const dObj = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(dObj.getTime())) {
    return { 
      start: new Date(1970, 0, 1), 
      end: new Date(1970, 0, 1) 
    };
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(dObj);
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  const yyyy = parts.find(p => p.type === 'year').value;

  const start = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000+05:30`);
  const end = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999+05:30`);
  return { start, end };
};
//chcbc
const getAllSlotsForDate = (dateInput) => {
  const { start } = getDayBounds(dateInput);
  const slots = [];
  const base = new Date(start.getTime() + SLOT_START_HOUR * 60 * 60 * 1000);
  const endLimit = new Date(start.getTime() + SLOT_END_HOUR * 60 * 60 * 1000);

  for (let current = new Date(base); current < endLimit; current.setTime(current.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000)) {
    slots.push(formatTo12HourSlot(new Date(current)));
  }
  return slots;
};

const getBlockedSlotsForDate = async (dateInput, category = 'All') => {
  const { start, end } = getDayBounds(dateInput);
  const normalizedCategory = normalizeCategoryGroup(category);
  
  const query = {
    date: { $gte: start, $lte: end },
    $or: [
      { category: 'All' },
      { category: normalizedCategory }
    ]
  };

  const blocks = await SlotBlock.find(query).select('slot');
  return new Set(blocks.map((b) => b.slot.trim()));
};

const isSlotAvailable = async (date, categories = ['All']) => {
  const slotStart = new Date(date);
  const slotLabel = formatTo12HourSlot(slotStart).trim();
  const categoriesToCheck = Array.isArray(categories) ? categories : [categories];
  const { start, end } = getDayBounds(date);

  // Check for admin blocks (same rules as getAvailableSlots)
  for (const category of categoriesToCheck) {
    const blockedSlots = await getBlockedSlotsForDate(start, category);
    if (blockedSlots.has(slotLabel)) {
      return false;
    }
  }
  return true;
};

export const emitBookingUpdate = (booking) => {
  try {
    const io = getIO();
    const bookingId = booking._id.toString();
    const payload = attachHealthPercentToBookingPayload(booking);
    
    // Clean payload for shared / non-owner rooms (e.g. staff/merchant/public)
    const cleanPayload = sanitizeBooking(payload, null);

    // Notify admin
    io.to('admin').emit('bookingUpdated', cleanPayload);

    // Also notify admin specifically about new bookings
    if (booking.status === 'CREATED') {
      io.to('admin').emit('bookingCreated', cleanPayload);

      // Save notification to history and send push to admins
      sendPushToRole(
        'admin',
        'New Booking Received',
        `A new booking (#${booking.orderNumber || bookingId.slice(-6).toUpperCase()}) has been created.`,
        { bookingId, type: 'order' },
        'order'
      );
    } else if (booking.status === 'CANCELLED') {
      io.to('admin').emit('bookingCancelled', cleanPayload);

      sendPushToRole(
        'admin',
        'Booking Cancelled',
        `Booking #${booking.orderNumber || bookingId.slice(-6).toUpperCase()} has been cancelled.`,
        { bookingId, type: 'order' },
        'order'
      );
    }

    // Notify specific booking room
    io.to(`booking_${bookingId}`).emit('bookingUpdated', cleanPayload);

    // Notify relevant users
    const usersToNotify = [
      booking.user?._id || booking.user,
      booking.merchant?._id || booking.merchant,
      booking.pickupDriver?._id || booking.pickupDriver,
      booking.technician?._id || booking.technician,
      booking.carWash?.staffAssigned?._id || booking.carWash?.staffAssigned,
    ].filter(id => id); // Remove null/undefined

    usersToNotify.forEach(userId => {
      const room = `user_${userId.toString()}`;
      const userPayload = sanitizeBooking(payload, { _id: userId });
      io.to(room).emit('bookingUpdated', userPayload);
      // Only emit bookingCreated for a true new booking — not on every status sync
      // (was causing duplicate "New Booking" client notifications per update).
      if (booking.status === 'CREATED') {
        io.to(room).emit('bookingCreated', userPayload);
      }
    });

    // Global Real-time Sync
    emitEntitySync('booking', booking.status === 'CREATED' ? 'created' : 'updated', cleanPayload);
  } catch (err) {
    // Error handling
  }
};

// Helper function to check if booking is for battery or tire service
const isBatteryOrTireBooking = async (booking) => {
  try {
    const Service = (await import('../models/Service.js')).default;
    const services = await Service.find({ _id: { $in: booking.services } });
    return services.some(service => 
      service.category === 'Battery' ||
      service.category === 'Tyres' ||
      service.category === 'Tyre & Battery'
    );
  } catch (error) {
    return false;
  }
};

// Helper function to check if booking is for battery service only
const isBatteryBooking = async (booking) => {
  try {
    const Service = (await import('../models/Service.js')).default;
    const services = await Service.find({ _id: { $in: booking.services } });
    return services.some(service => 
      service.category === 'Battery'
    );
  } catch (error) {
    return false;
  }
};

// Helper function to check if booking is for general service
const isGeneralServiceBooking = async (booking) => {
  try {
    const Service = (await import('../models/Service.js')).default;
    const services = await Service.find({ _id: { $in: booking.services } });
    return services.some(service => 
      service.category === 'Periodic' ||
      service.category === 'Services' ||
      service.name.toLowerCase().includes('general service')
    );
  } catch (error) {
    return false;
  }
};

// Helper function to check if booking is for Essentials service
const isEssentialsBooking = async (booking) => {
  try {
    const Service = (await import('../models/Service.js')).default;
    const services = await Service.find({ _id: { $in: booking.services } });
    return services.some(service => 
      service.category && service.category.toLowerCase().includes('essentials')
    );
  } catch (error) {
    return false;
  }
};

// Helper function to check if booking is for car wash or essentials service
const isCarWashBooking = async (booking) => {
  try {
    const Service = (await import('../models/Service.js')).default;
    const services = await Service.find({ _id: { $in: booking.services } });
    return services.some(service => 
      service.category && (
        service.category.toLowerCase().includes('car wash') ||
        service.category.toLowerCase() === 'wash' ||
        service.category.toLowerCase().includes('essentials')
      )
    );
  } catch (error) {
    return false;
  }
};


/** Greeting + automated status chat lines — run off the critical path so PUT /status returns quickly. */
const queueChatAutomationForBookingStatus = (savedBooking, canonTo) => {
  const chatEnabledStatuses = ['SERVICE_STARTED', 'CAR_WASH_STARTED', 'INSTALLATION', 'On Hold'];
  if (!chatEnabledStatuses.includes(canonTo)) {
    return Promise.resolve();
  }
  return (async () => {
    try {
      let systemUser = await User.findOne({ role: 'admin' });
      if (!systemUser) {
        systemUser = await User.findOne({ role: { $regex: /^admin$/i } });
      }

      if (!systemUser) return;

      const existingGreeting = await Message.findOne({
        bookingId: savedBooking._id,
        text: /Welcome to Carzzi Support Chat/
      });

      if (!existingGreeting) {
        const greetingText = `Hi 👋 Hope you’re doing well! 
Welcome to Carzzi Support Chat  🚗 
Through this chat, you can easily communicate with your assigned merchant regarding your requests. You will also receive updates here about the approval or rejection of parts submitted. 
If you have any questions, need assistance, or want to follow up on a request, feel free to message here anytime — we’re here to help you! 
Thank you for choosing Carzzi 🙌`;

        const greetingMessage = new Message({
          bookingId: savedBooking._id,
          sender: systemUser._id,
          text: greetingText,
          recipientRole: 'customer'
        });
        await greetingMessage.save();

        const populatedGreeting = await greetingMessage.populate('sender', '_id name role');
        emitChatMessage(savedBooking._id, populatedGreeting);
      }

      const existingStatusMessage = await Message.findOne({
        bookingId: savedBooking._id,
        text: new RegExp(`^${canonTo.replace(/_/g, ' ')}`, 'i')
      });

      if (!existingStatusMessage) {
        let statusText = '';
        if (canonTo === 'SERVICE_STARTED') statusText = "Service has started for your vehicle. Our technician is working on it.";
        else if (canonTo === 'CAR_WASH_STARTED') {
          const isEssentials = await isEssentialsBooking(savedBooking);
          statusText = isEssentials
            ? "Service has started for your vehicle. Our staff is working on it."
            : "Car wash has started for your vehicle. Our staff is working on it.";
        }
        else if (canonTo === 'INSTALLATION') statusText = "Installation has started for your vehicle.";
        else if (canonTo === 'On Hold') statusText = "Your service is currently on hold. We will update you soon.";

        if (statusText) {
          const statusMessage = new Message({
            bookingId: savedBooking._id,
            sender: systemUser._id,
            text: statusText,
            recipientRole: 'customer'
          });
          await statusMessage.save();

          const populatedStatus = await statusMessage.populate('sender', '_id name role');
          emitChatMessage(savedBooking._id, populatedStatus);
        }
      }
    } catch (msgErr) {
      console.error('Error sending automated service started message:', msgErr);
    }
  })();
};

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Private
export const createBooking = async (req, res) => {
  const { vehicleId, serviceIds, date, notes, location, selectedBrands, serviceQuantities } = req.body;

  try {
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid booking date' });
    }

    // Pickup address is now always required
    const hasAddress = location && typeof location.address === 'string' && location.address.trim().length > 0;
    if (!hasAddress) {
      return res.status(400).json({ message: 'Pickup address is required' });
    }

    const bookingPincode = extractPincodeFromAddress(location.address);
    if (!bookingPincode) {
      return res.status(400).json({ message: 'Pickup address must contain a valid 6-digit pincode' });
    }

    const availablePincodes = await AvailableServicePincode.find({}).select('pincode').lean();
    const allowedSet = new Set(availablePincodes.map((p) => p.pincode));
    if (allowedSet.size === 0) {
      return res.status(503).json({
        message:
          'Service booking is not available yet. An administrator must add at least one allowed service pincode.',
      });
    }
    if (!allowedSet.has(bookingPincode)) {
      return res.status(409).json({ message: 'Service is not available for the selected pincode' });
    }

    const Service = (await import('../models/Service.js')).default;
    const Vehicle = (await import('../models/Vehicle.js')).default;
    const { total: servicesTotal, refMatch, services, unavailableBrandServices } = await calculateServicesTotal(serviceIds, vehicleId, selectedBrands, serviceQuantities);

    if (!services || services.length === 0) {
      return res.status(400).json({ message: 'At least one valid service is required to create a booking' });
    }

    if (unavailableBrandServices && unavailableBrandServices.length > 0) {
      const { serviceName, brand } = unavailableBrandServices[0];
      return res.status(400).json({
        message: `${brand} is not available for this vehicle${serviceName ? ` (${serviceName})` : ''}. Please choose another brand.`,
      });
    }

    // Determine booking categories for slot availability check
    const bookingCategories = new Set();
    services.forEach((s) => {
      bookingCategories.add(getCategoryGroup(s.category));
    });

    const slotAvailable = await isSlotAvailable(parsedDate, Array.from(bookingCategories));
    if (!slotAvailable) {
      return res.status(409).json({ message: 'Selected slot is not available for one or more selected services' });
    }

    let totalAmount = servicesTotal;
    let pickupDropPrice = 0;

    // Check if this is a general service booking
    const isGeneralService = services.some(service => 
      service.category === 'Periodic' || 
      service.category === 'Services' || 
      (service.name && service.name.toLowerCase().includes('general service'))
    );

    // If general service, add pickup_drop_price from reference data
    if (isGeneralService) {
      try {
        if (refMatch && refMatch.pickup_drop_price) {
          const extra = Number(refMatch.pickup_drop_price);
          if (!isNaN(extra)) {
            pickupDropPrice = extra;
            totalAmount += extra;
          }
        }
      } catch (err) {
        console.error('Error adding pickup_drop_price to booking:', err);
      }
    }

    // Check if this is a service that requires payment (Car Wash, Battery/Tires, or Essentials)
    const requiresPaymentService = services.some(service => 
      service.category === 'Car Wash' || 
      service.category === 'Wash' ||
      service.category === 'Battery' ||
      service.category === 'Tyres' ||
      service.category === 'Tyre & Battery' ||
      service.category === 'Essentials'
    );

    // For services requiring payment, store booking data temporarily and require payment first
    if (requiresPaymentService) {
      // Store booking data in session/temporary storage for payment processing
      const tempBookingData = {
        user: req.user._id,
        vehicleId: vehicleId,
        serviceIds: serviceIds,
        date,
        notes,
        location,
        totalAmount,
        pickupDropPrice,
        selectedBrands,
        serviceQuantities,
        requiresPaymentService: true
      };

      // Return temporary booking data for payment processing
      res.status(201).json({
        tempBookingId: `temp_${Date.now()}_${req.user._id}`,
        ...tempBookingData,
        requiresPayment: true,
        message: 'Service booking prepared. Please complete payment to create the booking.'
      });

      return; // Exit early for payment-required services - no actual booking created yet
    }

    // Regular service booking flow (existing logic)
    const MAX_RETRIES = 5;
    let lastError = null;
    let createdBooking = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const orderNumber = await generateOrderNumber();
        
        // Check if this is a battery or tire service
        const isBatteryTireService = services.some(service => 
          service.category === 'Battery' ||
          service.category === 'Tyres' ||
          service.category === 'Tyre & Battery'
        );
        
        const booking = new Booking({
          user: req.user._id,
          vehicle: vehicleId,
          services: serviceIds,
          date,
          orderNumber,
          notes,
          location,
          totalAmount,
          pickupDropPrice,
          finalAmount: totalAmount,
          discountAmount: 0,
          coupon: null,
          selectedBrands,
          serviceQuantities,
          // Mark as battery/tire service if applicable
          ...(isBatteryTireService && {
            batteryTire: {
              isBatteryTireService: true
            }
          })
        });

        createdBooking = await booking.save();
        
        // Notify nearby drivers (staff)
        try {
          const drivers = await User.find({
            role: 'staff',
            subRole: 'Driver',
            'fcmTokens.0': { $exists: true }
          });

          for (const driver of drivers) {
            await sendPushToUser(
              driver._id,
              'New Booking Available!',
              `A new service request (#${createdBooking.orderNumber}) is waiting near you.`,
              { bookingId: createdBooking._id.toString(), type: 'order' },
              'order'
            );
          }
        } catch (err) {
          
        }

        break;
      } catch (err) {
        lastError = err;
        // Retry on duplicate orderNumber, otherwise abort
        // MongoServerError code 11000 is duplicate key
        const isDuplicate =
          err &&
          err.code === 11000 &&
          (err.keyPattern?.orderNumber || String(err.message || '').includes('orderNumber_1'));

        if (!isDuplicate) {
          throw err;
        }
      }
    }

    if (!createdBooking) {
      throw lastError || new Error('Failed to create booking with unique order number');
    }
    
    // Send confirmation email (asynchronously)
    if (req.user.email) {
      const serviceNames = services.map(s => s.name).join(', ');
      const emailTemplate = getBookingStatusEmail('BOOKING_CONFIRMED', {
        customerName: req.user.name,
        bookingId: createdBooking.orderNumber || String(createdBooking._id).slice(-8).toUpperCase(),
        service: serviceNames,
        dateTime: new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      });
      sendEmail(req.user.email, emailTemplate.subject, emailTemplate.text, emailTemplate.html).catch(() => {});
    }

    const payload = sanitizeBooking(attachHealthPercentToBookingPayload(createdBooking), req.user);
    res.status(201).json({
      ...payload,
      trackingToken: createTrackingToken(createdBooking._id),
    });

    // Send push to customer
    try {
      await sendPushToUser(
        req.user._id,
        'Booking Successful',
        `Your booking (#${createdBooking.orderNumber}) has been successfully created.`,
        { bookingId: createdBooking._id.toString(), type: 'order' },
        'order'
      );
    } catch (err) {
      
    }

    // Emit socket event for real-time updates
    try {
      // Populate for real-time consumers
      const populated = await Booking.findById(createdBooking._id)
        .populate('user', 'id name email phone')
        .populate('vehicle')
        .populate('services');
        
      emitBookingUpdate(populated || createdBooking);
    } catch (err) {
      
    }
  } catch (error) {
    
    
    if (error.name === 'ValidationError') {
       const messages = Object.values(error.errors).map(val => val.message);
       return res.status(400).json({ message: messages.join(', ') });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get available slots for a date
// @route   GET /api/bookings/available-slots?date=YYYY-MM-DD
// @access  Private
export const getAvailableSlots = async (req, res) => {
  try {
    let { date, category = 'All' } = req.query;
    category = normalizeCategoryGroup(category);
    if (!date) {
      return res.status(400).json({ message: 'date query param is required' });
    }

    const parsedDate = new Date(String(date));
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const { start, end } = getDayBounds(date);

    const bookings = await Booking.find({
      status: BLOCKING_STATUSES,
      date: { $gte: start, $lte: end },
    }).populate('services', 'category');

    const bookedSlots = new Set();
    bookings.forEach((booking) => {
      const slotTime = formatTo12HourSlot(new Date(booking.date)).trim();
      if (category === 'All') {
        bookedSlots.add(slotTime);
      } else {
        const hasCategory = booking.services.some(
          (s) => getCategoryGroup(s.category) === category
        );
        if (hasCategory) {
          bookedSlots.add(slotTime);
        }
      }
    });

    const blockedSlots = await getBlockedSlotsForDate(date, category);
    const allSlots = getAllSlotsForDate(date);
    const unavailableSlots = new Set([...blockedSlots]);
    const availableSlots = allSlots.filter((slot) => !unavailableSlots.has(slot));

    res.json({
      date: start.toISOString(),
      category,
      allSlots,
      availableSlots,
      blockedSlots: Array.from(blockedSlots),
      bookedSlots: Array.from(bookedSlots),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get slots state for admin for a date
// @route   GET /api/bookings/admin/slots?date=YYYY-MM-DD
// @access  Private/Admin
export const getAdminSlotsForDate = async (req, res) => {
  try {
    let { date, category = 'All' } = req.query;
    category = normalizeCategoryGroup(category);
    if (!date) {
      return res.status(400).json({ message: 'date query param is required' });
    }

    const parsedDate = new Date(String(date));
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const { start, end } = getDayBounds(date);

    const bookings = await Booking.find({
      status: BLOCKING_STATUSES,
      date: { $gte: start, $lte: end },
    }).populate('services', 'category');

    const slotBlocks = await SlotBlock.find({
      date: { $gte: start, $lte: end },
      $or: [
        { category: 'All' },
        { category: category }
      ]
    }).select('slot');

    const bookedSlots = new Set();
    bookings.forEach((booking) => {
      const slotTime = formatTo12HourSlot(new Date(booking.date)).trim();
      if (category === 'All') {
        bookedSlots.add(slotTime);
      } else {
        const hasCategory = booking.services.some(
          (s) => getCategoryGroup(s.category) === category
        );
        if (hasCategory) {
          bookedSlots.add(slotTime);
        }
      }
    });
    const blockedSlots = new Set(slotBlocks.map((s) => s.slot.trim()));
    const allSlots = getAllSlotsForDate(date);

    res.json({
      date: start.toISOString(),
      category,
      allSlots,
      bookedSlots: Array.from(bookedSlots),
      blockedSlots: Array.from(blockedSlots),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Replace admin-blocked slots for a date
// @route   PUT /api/bookings/admin/slots
// @access  Private/Admin
export const updateAdminSlotBlocks = async (req, res) => {
  try {
    let { date, category = 'All', blockedSlots = [] } = req.body || {};
    category = normalizeCategoryGroup(category);
    if (!date) {
      return res.status(400).json({ message: 'date is required' });
    }
    if (!Array.isArray(blockedSlots)) {
      return res.status(400).json({ message: 'blockedSlots must be an array' });
    }

    const parsedDate = new Date(String(date));
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const allSlots = getAllSlotsForDate(date);
    const invalidSlots = blockedSlots.filter((slot) => !allSlots.includes(slot));
    if (invalidSlots.length > 0) {
      return res.status(400).json({ message: `Invalid slots: ${invalidSlots.join(', ')}` });
    }

    const { start, end } = getDayBounds(date);
    await SlotBlock.deleteMany({ 
      date: { $gte: start, $lte: end },
      category: category
    });

    if (blockedSlots.length > 0) {
      await SlotBlock.insertMany(
        blockedSlots.map((slot) => ({
          date: start,
          slot,
          category,
          blockedBy: req.user._id,
        }))
      );
    }

    emitEntitySync('slotBlock', 'updated', {
      date: start.toISOString(),
      category,
      blockedSlots,
    });

    res.json({
      date: start.toISOString(),
      category,
      blockedSlots,
      message: 'Slots updated successfully',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get available service pincodes
// @route   GET /api/bookings/available-service-pincodes
// @access  Private
export const getAvailableServicePincodes = async (_req, res) => {
  try {
    const blocks = await AvailableServicePincode.find({}).select('pincode').sort({ pincode: 1 }).lean();
    res.json({
      availablePincodes: blocks.map((b) => b.pincode),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Replace available service pincodes list
// @route   PUT /api/bookings/admin/available-service-pincodes
// @access  Private/Admin
export const updateAvailableServicePincodes = async (req, res) => {
  try {
    const { availablePincodes = [] } = req.body || {};
    if (!Array.isArray(availablePincodes)) {
      return res.status(400).json({ message: 'availablePincodes must be an array' });
    }

    const normalizedPincodes = Array.from(
      new Set(availablePincodes.map((p) => normalizePincode(p)).filter(Boolean))
    );

    await AvailableServicePincode.deleteMany({});

    if (normalizedPincodes.length > 0) {
      await AvailableServicePincode.insertMany(
        normalizedPincodes.map((pincode) => ({
          pincode,
          updatedBy: req.user._id,
        }))
      );
    }

    emitEntitySync('availableServicePincode', 'updated', {
      availablePincodes: normalizedPincodes,
    });

    res.json({
      availablePincodes: normalizedPincodes,
      message: 'Available service pincodes updated successfully',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged in user bookings
// @route   GET /api/bookings/mybookings
// @access  Private
export const getMyBookings = async (req, res) => {
  try {
    let query = { user: req.user._id };

    if (req.user.role === 'staff') {
      // Staff see bookings where they are the pickup driver, technician, OR assigned to car wash
      query = { 
        $or: [
          { pickupDriver: req.user._id },
          { technician: req.user._id },
          { 'carWash.staffAssigned': req.user._id }
        ]
      };
    } else if (req.user.role === 'merchant') {
      // Merchants see bookings assigned to them, and their own personal bookings
      query = {
        $or: [
          { user: req.user._id },
          { merchant: req.user._id }
        ]
      };
    }

    const bookings = await Booking.find(query)
      .select('+deliveryOtp.code')
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone location')
      .populate('user', 'name email phone location')
      .populate('pickupDriver', 'name email phone')
      .populate('carWash.staffAssigned', 'name email phone')
      .populate('coupon')
      .populate('batteryTire.warranty.addedBy', 'name email')
      .lean();
    
    const sanitizedBookings = bookings.map((b) => sanitizeBooking(b, req.user));
    res.json(sanitizedBookings);
  } catch (error) {
    
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get bookings by user ID
// @route   GET /api/bookings/user/:userId
// @access  Private
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Check authorization: Owner, Admin, Merchant, or Staff
    const isOwner = userId === req.user._id.toString();
    const isElevated = ['admin', 'merchant', 'staff'].includes(req.user.role?.toLowerCase());
    
    if (!isOwner && !isElevated) {
      return res.status(403).json({ message: 'Not authorized to view these bookings' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    let query = { user: userId };

    if (targetUser.role === 'staff') {
      // Staff see bookings where they are the pickup driver, technician, OR assigned to car wash
      query = {
        $or: [
          { pickupDriver: userId },
          { technician: userId },
          { 'carWash.staffAssigned': userId }
        ]
      };
    } else if (targetUser.role === 'merchant') {
      // Merchants see bookings assigned to them, and their own personal bookings
      query = {
        $or: [
          { user: userId },
          { merchant: userId }
        ]
      };
    }

    const bookings = await Booking.find(query)
      .select('+deliveryOtp.code')
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('vehicle')
      .populate('services')
      .lean();
    
    const sanitizedBookings = bookings.map((b) => sanitizeBooking(b, req.user));
    res.json(sanitizedBookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get bookings by vehicle ID
// @route   GET /api/bookings/vehicle/:vehicleId
// @access  Private
export const getVehicleBookings = async (req, res) => {
  try {
    const vehicleId = req.params.vehicleId;
    
    // Check authorization: Admin, Merchant, Staff, or Vehicle Owner
    const isElevated = ['admin', 'merchant', 'staff'].includes(req.user.role?.toLowerCase());
    
    if (!isElevated) {
      // If not elevated, check if they own the vehicle. A vehicle that no
      // longer exists (e.g. just deleted) is a 404, not a 403 — conflating
      // the two made the frontend treat "vehicle was deleted" as "your
      // session is invalid" and log the user out.
      const Vehicle = (await import('../models/Vehicle.js')).default;
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      if (vehicle.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Not authorized to view bookings for this vehicle' });
      }
    }

    const bookings = await Booking.find({ vehicle: vehicleId })
      .select('+deliveryOtp.code')
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user', 'id name email')
      .populate('services')
      .lean();
    
    const sanitizedBookings = bookings.map((b) => sanitizeBooking(b, req.user));
    res.json(sanitizedBookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get bookings by merchant ID
// @route   GET /api/bookings/merchant/:merchantId
// @access  Private/Admin or Merchant
export const getMerchantBookings = async (req, res) => {
  try {
    // Check if user is authorized (admin or the merchant itself)
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.merchantId) {
      return res.status(403).json({ message: 'Not authorized to access these bookings' });
    }

    const bookings = await Booking.find({ merchant: req.params.merchantId })
      .select('+deliveryOtp.code')
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user', 'id name email')
      .populate('vehicle', 'make model licensePlate')
      .populate('services')
      .lean();
    
    const sanitizedBookings = bookings.map((b) => sanitizeBooking(b, req.user));
    res.json(sanitizedBookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all bookings
// @route   GET /api/bookings
// @access  Private/Admin
export const getAllBookings = async (req, res) => {
  try {
    let query = {};
    
    // If merchant, only show their bookings
    if (req.user.role === 'merchant') {
      query = { merchant: req.user._id };
    } else if (req.user.role === 'staff') {
      query = {
        $or: [
          { pickupDriver: req.user._id },
          { technician: req.user._id },
          { 'carWash.staffAssigned': req.user._id },
        ],
      };
    }

    const bookings = await Booking.find(query)
      .select('+deliveryOtp.code')
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone')
      .populate('pickupDriver', 'name email phone')
      .populate('technician', 'name email phone')
      .populate('carWash.staffAssigned', 'name email phone')
      .populate('batteryTire.warranty.addedBy', 'name email')
      .lean();
    
    const sanitizedBookings = bookings.map((b) => sanitizeBooking(b, req.user));
    res.json(sanitizedBookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get booking by ID
// @route   GET /api/bookings/:id
// @access  Private
export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .select('+deliveryOtp.code')
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone location')
      .populate('pickupDriver', 'name email phone')
      .populate('technician', 'name email phone')
      .populate('carWash.staffAssigned', 'name email phone')
      .populate('coupon')
      .populate('batteryTire.warranty.addedBy', 'name email');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!canAccessBooking(booking, req.user)) {
      return res.status(403).json({ message: 'Not authorized to view this booking' });
    }

    let payload = attachHealthPercentToBookingPayload(booking);
    payload = sanitizeBooking(payload, req.user);
    res.json(payload);
  } catch (error) {
    console.error('Error in getBookingById:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((val) => val.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Public booking tracking via signed token
// @route   GET /api/bookings/track/:token
// @access  Public
export const getBookingByTrackingToken = async (req, res) => {
  try {
    const verified = verifyTrackingToken(req.params.token);
    if (!verified) {
      return res.status(400).json({ message: 'Invalid or expired tracking link' });
    }

    const booking = await Booking.findById(verified.bookingId)
      .populate('vehicle')
      .populate('services', 'name category')
      .populate('user', 'phone');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    res.json(toPublicTrackingDto(booking));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update booking details (Assign staff/merchant)
// @route   PUT /api/bookings/:id/assign
// @access  Private/Admin
export const assignBooking = async (req, res) => {
  const { merchantId, driverId, technicianId, slot, carWashStaffId, assignedAt } = req.body;
  const bookingId = req.params.id;

  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Validate assignments selection
    const isCarWash = await isCarWashBooking(booking);
    if (isCarWash) {
      const hasStaff = carWashStaffId || (booking.carWash && booking.carWash.staffAssigned);
      if (!hasStaff) {
        return res.status(400).json({ message: 'Staff must be selected' });
      }
    } else {
      const hasMerchant = merchantId || booking.merchant;
      const hasStaff = driverId || technicianId || booking.pickupDriver || booking.technician;
      if (!hasMerchant || !hasStaff) {
        return res.status(400).json({ message: 'Both merchant and staff must be selected' });
      }
    }

    const assigneeErrors = await validateAssignees(booking, {
      merchantId,
      driverId,
      technicianId,
      carWashStaffId,
    });
    if (assigneeErrors.length > 0) {
      return res.status(400).json({ message: assigneeErrors.join('; ') });
    }

    const updateData = {};
    if (slot) updateData.date = slot;
    if (assignedAt) updateData.assignedAt = assignedAt;

    // Direct assignment updates
    if (merchantId) updateData.merchant = merchantId;
    if (driverId) updateData.pickupDriver = driverId;
    if (technicianId) updateData.technician = technicianId;
    
    // Handle Car Wash Staff
    if (carWashStaffId) {
      updateData['carWash.staffAssigned'] = carWashStaffId;
      // Mark as car wash service if assigning staff to it
      updateData['carWash.isCarWashService'] = true;
    }

    // Battery/Tire specific logic
    const isBatteryTire = await isBatteryOrTireBooking(booking);
    if (isBatteryTire) {
      updateData['batteryTire.isBatteryTireService'] = true;
    }

    // CRITICAL: Status transition to ASSIGNED
    // If status is CREATED and we have ANY assignment (old or new), move to ASSIGNED
    const hasAnyAssignment = !!(
      merchantId || 
      driverId || 
      technicianId || 
      carWashStaffId || 
      booking.merchant || 
      booking.pickupDriver || 
      booking.technician || 
      booking.carWash?.staffAssigned
    );

    if (booking.status === 'CREATED' && hasAnyAssignment) {
      updateData.status = 'ASSIGNED';
      
    }

    

    // Apply updates directly to database to avoid middleware/validation pitfalls of save()
    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      { $set: updateData },
      { new: true, runValidators: true }
    )
    .select('+deliveryOtp.code')
    .populate('user', 'id name email phone')
    .populate('vehicle')
    .populate('services')
    .populate('merchant', 'name email phone location')
    .populate('pickupDriver', 'name email phone')
    .populate('technician', 'name email phone')
    .populate('carWash.staffAssigned', 'name email phone')
    .populate('batteryTire.warranty.addedBy', 'name email');

    if (!updatedBooking) throw new Error('Failed to retrieve updated booking');

    // Broadcast the update via socket
    emitBookingUpdate(updatedBooking);

    // Notifications
    try {
      const orderId = updatedBooking.orderNumber || String(updatedBooking._id).slice(-6).toUpperCase();
      
      // Notify Merchant
      if (updatedBooking.merchant?._id && merchantId) {
        await sendPushToUser(
          updatedBooking.merchant._id, 
          'New Assignment', 
          `You have been assigned to booking #${orderId}`, 
          { type: 'assignment', role: 'merchant', bookingId }, 
          'order'
        );
      }

      // Notify Staff (Driver, Technician, or Car Wash Staff)
      const staffId = driverId || technicianId || carWashStaffId;
      if (staffId) {
        await sendPushToUser(
          staffId, 
          'New Assignment', 
          `You have been assigned to booking #${orderId}`, 
          { type: 'assignment', role: 'staff', bookingId }, 
          'order'
        );
      }

      // Notify Customer
      if (updatedBooking.user?._id) {
        await sendPushToUser(
          updatedBooking.user._id, 
          'Service Assigned', 
          `Your service #${orderId} has been updated.`, 
          { type: 'assignment_update', bookingId }, 
          'order'
        );
        trySendLiveTrackingAssignmentSeed(updatedBooking).catch(() => {});
        
        // Send WhatsApp message to user only when staff is assigned
        const staffAssigned = !!(driverId || technicianId || carWashStaffId);
        if (staffAssigned && updatedBooking.user?.phone) {
          try {
            // console.log('[WhatsApp] Sending assignment message to user:', updatedBooking.user.phone);
            const normalizedPhone = normalizeIndianMobile(updatedBooking.user.phone);
            // console.log('[WhatsApp] Normalized phone:', normalizedPhone);
            if (normalizedPhone) {
              const templateName = resolveAssignedWhatsAppTemplateName();
              // console.log('[WhatsApp] Using template:', templateName);
              
              // Get staff details
              let staffUser = null;
              if (driverId) {
                staffUser = await User.findById(driverId);
              } else if (technicianId) {
                staffUser = await User.findById(technicianId);
              } else if (carWashStaffId) {
                staffUser = await User.findById(carWashStaffId);
              }
              
              // Build template components
              const components = {
                body_1: {
                  type: 'text',
                  value: updatedBooking.user.name || 'User'
                },
                body_2: {
                  type: 'text',
                  value: staffUser?.name || 'Service Partner'
                },
                body_3: {
                  type: 'text',
                  value: staffUser?.phone || 'N/A'
                }
              };
              
              await sendWhatsAppMessage(normalizedPhone, templateName, components);
              // console.log('[WhatsApp] Message sent successfully!');
            }
          } catch (whatsappErr) {
            console.error('[WhatsApp] Failed to send assignment message:', whatsappErr);
          }
        }
      }
    } catch (notifyErr) {
      
    }

    res.json(sanitizeBooking(updatedBooking, req.user));
  } catch (error) {
    
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update booking status
// @route   PUT /api/bookings/:id/status
// @access  Private/Admin/Garage
export const updateBookingStatus = async (req, res) => {
  const { status } = req.body;

  try {
    const booking = await Booking.findById(req.params.id).select('+deliveryOtp.code').populate('user');

    if (booking) {
      const isOwner = booking.user && booking.user._id.toString() === req.user._id.toString();
      const isAdmin = req.user.role === 'admin';
      const isAssignedMerchant = req.user.role === 'merchant' && booking.merchant && booking.merchant.toString() === req.user._id.toString();
      const isAssignedStaff = req.user.role === 'staff' && (
        (booking.pickupDriver && booking.pickupDriver.toString() === req.user._id.toString()) ||
        (booking.technician && booking.technician.toString() === req.user._id.toString()) ||
        (booking.carWash?.staffAssigned && booking.carWash.staffAssigned.toString() === req.user._id.toString())
      );

      if (isOwner && !isAdmin && !isAssignedMerchant && !isAssignedStaff) {
        const allowedStatuses = ['DELIVERED'];
        if (!allowedStatuses.includes(status)) {
          return res.status(401).json({ message: 'Not authorized to set this status' });
        }
      } else if (!isAdmin && !isAssignedMerchant && !isAssignedStaff) {
        return res.status(401).json({ message: 'Not authorized' });
      }

      const canonFrom = booking.status;
      const canonTo = normalizeStatus(status) || status;

      if (!canonTo) {
        return res.status(400).json({ message: 'Invalid status' });
      }

      // After service is completed, merchant cannot change status
      if (req.user.role === 'merchant' && ['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(canonFrom)) {
        return res.status(401).json({ message: 'Merchant cannot change status after service completion' });
      }

      if (!isValidTransition(canonFrom, canonTo)) {
        // Allow if admin overrides, otherwise block
        if (req.user.role !== 'admin') {
          return res.status(400).json({ message: `Invalid transition from ${canonFrom} to ${canonTo}` });
        }
      }

      // Delivery OTP is for handover, not job start. Generate and notify only
      // when the vehicle is ready to go back to the customer.
      const shouldIssueDeliveryOtp =
        canonTo === 'SERVICE_COMPLETED' ||
        canonTo === 'CAR_WASH_COMPLETED' ||
        canonTo === 'OUT_FOR_DELIVERY' ||
        canonTo === 'DELIVERY';
      if (shouldIssueDeliveryOtp) {
        if (!booking.deliveryOtp || !booking.deliveryOtp.code) {
          const code = Math.floor(1000 + Math.random() * 9000).toString();
          booking.deliveryOtp = {
            code,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            attempts: 0,
            verifiedAt: null
          };

          // OTP is persisted on booking; notify out-of-band so this request is not blocked on SMTP / push latency
          if (booking.user?.email) {
            const subject = 'Delivery OTP';
            const body = `Your Delivery OTP is ${code}. Use this to confirm service completion/delivery. It expires in 24 hours.`;
            void sendEmail(booking.user.email, subject, body).catch(() => {});
          }
          void sendPushToUser(booking.user?._id, 'Delivery OTP', `Your Delivery OTP is ${code}`, { type: 'otp', bookingId: String(booking._id) }).catch(() => {});
        }
      }

      if (canonTo === 'SERVICE_COMPLETED') {
        if (req.user.role === 'staff') {
          return res.status(401).json({ message: 'Only merchant can mark service as completed' });
        }

        const isGeneralService = await isGeneralServiceBooking(booking);
        
        // Skip detailed status requirements for general service
        if (!isGeneralService) {
          if (!booking.inspection?.completedAt) {
            return res.status(400).json({ message: 'Please complete inspection before marking service as completed' });
          }
          if (!booking.qc?.completedAt) {
            return res.status(400).json({ message: 'Please complete QC before marking service as completed' });
          }
        }

        if (!booking.billing?.fileUrl) {
          return res.status(400).json({ message: 'Please upload invoice before marking service as completed' });
        }

        // Reset vehicle health indicators when general service is completed
        if (isGeneralService && booking.vehicle) {
          const Vehicle = (await import('../models/Vehicle.js')).default;
          const vehicle = await Vehicle.findById(booking.vehicle);
          if (vehicle) {
            const keys = ['generalService', 'brakePads', 'tires', 'battery', 'wiperBlade'];
            keys.forEach(key => {
              if (!vehicle.healthIndicators) {
                vehicle.healthIndicators = {};
              }
              vehicle.healthIndicators[key] = {
                value: 0,
                lastUpdated: Date.now(),
                lastServiceDate: Date.now(),
                lastServiceKm: vehicle.mileage || 0,
                fixedKm: vehicle.healthIndicators[key]?.fixedKm || 0,
                fixedDays: vehicle.healthIndicators[key]?.fixedDays || 0
              };
            });
            vehicle.healthPercentBaselineAt = new Date();
            vehicle.markModified('healthIndicators');
            vehicle.markModified('healthPercentBaselineAt');
            await vehicle.save();
            
            // Emit sync event so customer and merchant get updated data
            emitEntitySync('vehicle', 'updated', vehicle);
          }
        }
      }

      if (canonTo === 'VEHICLE_PICKED') {
        const photos = Array.isArray(booking.prePickupPhotos) ? booking.prePickupPhotos : [];
        if (photos.length < 4) {
          return res.status(400).json({ message: 'Please upload 4 vehicle photos before picking up the vehicle' });
        }
      }

      // Car wash specific photo requirements
      if (canonTo === 'CAR_WASH_STARTED') {
        const isEssentials = await isEssentialsBooking(booking);
        const beforePhotos = Array.isArray(booking.carWash?.beforeWashPhotos) ? booking.carWash.beforeWashPhotos : [];
        const requiredBeforeCount = isEssentials ? 4 : CAR_WASH_MIN_PHOTOS;
        if (beforePhotos.length < requiredBeforeCount) {
          const msg = isEssentials
            ? `Please upload at least 4 before service photos before starting service`
            : `Please upload at least ${CAR_WASH_MIN_PHOTOS} before wash photos before starting car wash`;
          return res.status(400).json({ message: msg });
        }
        
        // Set wash start time
        if (booking.carWash) {
          booking.carWash.washStartedAt = new Date();
        }
      }

      if (canonTo === 'CAR_WASH_COMPLETED') {
        const isEssentials = await isEssentialsBooking(booking);
        const afterPhotos = Array.isArray(booking.carWash?.afterWashPhotos) ? booking.carWash.afterWashPhotos : [];
        const requiredAfterCount = isEssentials ? 4 : CAR_WASH_MIN_PHOTOS;
        if (afterPhotos.length < requiredAfterCount) {
          const msg = isEssentials
            ? `Please upload at least 4 after service photos before completing service`
            : `Please upload at least ${CAR_WASH_MIN_PHOTOS} after wash photos before completing car wash`;
          return res.status(400).json({ message: msg });
        }
        
        // Set wash completion time
        if (booking.carWash) {
          booking.carWash.washCompletedAt = new Date();
        }
      }

      // Battery and Tire specific validations
      const isBatteryTireService = await isBatteryOrTireBooking(booking);
      
      if (isBatteryTireService) {
        // Check merchant assignment for battery/tire services
        if (canonTo === 'STAFF_REACHED_MERCHANT') {
          if (!booking.merchant) {
            return res.status(400).json({ message: 'Merchant must be assigned before staff can proceed to merchant location' });
          }
        }
        
        // For battery/tire services, generate OTP for delivery step
        if (canonTo === 'INSTALLATION') {
          const photos = Array.isArray(booking.prePickupPhotos) ? booking.prePickupPhotos : [];
          if (photos.length < 2) {
            return res.status(400).json({ message: 'Please upload at least 2 photos (Old Part and New Part) before starting installation' });
          }

          const code = Math.floor(1000 + Math.random() * 9000).toString();
          booking.deliveryOtp = {
            code,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            attempts: 0,
            verifiedAt: null
          };
          if (booking.user?.email) {
            await sendEmail(
            booking.user.email,
            'Delivery OTP',
            `Your Delivery OTP is ${code}. It expires in 24 hours.`
          ).catch(() => {});
        }
        await sendPushToUser(booking.user?._id, 'Delivery OTP', 'Use the OTP to confirm delivery', { type: 'otp', bookingId: String(booking._id) }).catch(() => {});
      }

        if (canonTo === 'DELIVERY') {
          const isBatteryTire = await isBatteryOrTireBooking(booking);
          if (!isBatteryTire) {
            const afterPhotos = Array.isArray(booking.serviceExecution?.afterPhotos)
              ? booking.serviceExecution.afterPhotos
              : [];
            if (afterPhotos.length < BATTERY_AFTER_PHOTOS_REQUIRED) {
              return res.status(400).json({
                message: 'Please upload complete 4 after service photos before delivery',
              });
            }
          }
        }

        if (canonTo === 'COMPLETED') {
          if (isAdmin) {
            // Admin override — bypass OTP verification, but record it was
            // an admin override (not an actual customer-entered OTP).
            if (!booking.deliveryOtp) booking.deliveryOtp = {};
            booking.deliveryOtp.verifiedAt = booking.deliveryOtp.verifiedAt || new Date();
            booking.deliveryOtp.verifiedByAdmin = true;
          } else if (!booking.deliveryOtp || !booking.deliveryOtp.verifiedAt) {
            return res.status(400).json({ message: 'OTP verification required before marking as COMPLETED' });
          }
        }
      }

      // OTP gating for delivery — notify out-of-band so staff wait time is not tied to SMTP/push latency
      if (canonTo === 'OUT_FOR_DELIVERY') {
        const code = Math.floor(100000 + Math.random() * 900000).toString().slice(0, 4);
        booking.deliveryOtp = {
          code,
          expiresAt: new Date(Date.now() + 20 * 60 * 1000),
          attempts: 0,
          verifiedAt: null
        };
        if (booking.user?.email) {
          void sendEmail(
            booking.user.email,
            'Delivery OTP',
            `Your OTP for vehicle delivery is ${code}. It expires in 20 minutes.`
          ).catch(() => {});
        }
      }

      if (canonTo === 'DELIVERED') {
        if (isAdmin) {
          // Admin override — bypass OTP verification, but record it was
          // an admin override (not an actual customer-entered OTP).
          if (!booking.deliveryOtp) booking.deliveryOtp = {};
          booking.deliveryOtp.verifiedAt = booking.deliveryOtp.verifiedAt || new Date();
          booking.deliveryOtp.verifiedByAdmin = true;
          // Admin delivering the vehicle means the final bill was settled
          // offline (cash/UPI at the counter) — mark it paid.
          if (booking.paymentStatus !== 'paid') {
            booking.paymentStatus = 'paid';
            booking.manualPayment = {
              markedBy: req.user._id,
              markedAt: new Date(),
              amount: booking.finalAmount ?? booking.totalAmount ?? 0,
            };
          }
        } else if (!booking.deliveryOtp || !booking.deliveryOtp.verifiedAt) {
          return res.status(400).json({ message: 'OTP verification required before marking as DELIVERED' });
        }
      }

      // Stock Auto Adjustment
      if (((canonTo === 'SERVICE_COMPLETED') && 
          !['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(booking.status)) ||
          (isBatteryTireService && canonTo === 'COMPLETED' && 
          !['COMPLETED'].includes(booking.status))) {
          
          const Product = (await import('../models/Product.js')).default;
          const Notification = (await import('../models/Notification.js')).default;
          
          if (Array.isArray(booking.parts)) {
            for (const part of booking.parts) {
                if (part.product) {
                    const product = await Product.findById(part.product);
                    if (product) {
                        product.quantity = Math.max(0, product.quantity - part.quantity);
                        await product.save();
                        
                        // Check for low stock
                        if (product.quantity <= product.threshold) {
                            // Trigger alert (Create a notification)
                            await Notification.create({
                                user: product.merchant,
                                title: 'Low Stock Alert',
                                message: `Product ${product.name} is running low on stock (${product.quantity} left).`,
                                type: 'system'
                            });
                        }
                    }
                }
            }
          }
      }

      // Single save: workshop timestamps + status (avoids a second PUT /details from the client)
      if (canonTo === 'SERVICE_STARTED' && !booking.serviceExecution?.jobStartTime) {
        if (!booking.serviceExecution) booking.serviceExecution = {};
        booking.serviceExecution.jobStartTime = new Date();
        booking.markModified('serviceExecution');
      }
      if (canonTo === 'SERVICE_COMPLETED' && !booking.serviceExecution?.jobEndTime) {
        if (!booking.serviceExecution) booking.serviceExecution = {};
        booking.serviceExecution.jobEndTime = new Date();
        booking.markModified('serviceExecution');
      }

      booking.status = canonTo;
      const savedBooking = await booking.save();

      setImmediate(() => {
        void queueChatAutomationForBookingStatus(savedBooking, canonTo);
      });

      // Populate fields before returning to frontend
      const updatedBooking = await Booking.findById(savedBooking._id)
        .select('+deliveryOtp.code')
        .populate('user', 'id name email phone')
        .populate('vehicle')
        .populate('services')
        .populate('merchant', 'name email phone location')
        .populate('pickupDriver', 'name email phone')
        .populate('technician', 'name email phone')
        .populate('carWash.staffAssigned', 'name email phone')
        .populate('batteryTire.warranty.addedBy', 'name email');

      // Emit socket event for real-time updates
      emitBookingUpdate(updatedBooking);

      try {
        if (
          ['REACHED_CUSTOMER', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(
            canonTo
          ) &&
          updatedBooking.user
        ) {
          const u = updatedBooking.user;
          const uid =
            typeof u === 'object' && u && u._id ? String(u._id) : String(u);
          await sendLiveTrackingDismissPush(uid, String(updatedBooking._id));
        }
      } catch (_) {}

      if (canonTo === 'CANCELLED' && booking.user) {
        try {
          const io = getIO();
          const userId = typeof booking.user === 'object' ? booking.user._id : booking.user;
          io.to(`user_${userId}`).emit('bookingCancelled', { id: updatedBooking._id, status: 'CANCELLED' });
        } catch (err) {
          
        }
      }

      // Send status update email — a branded template for the statuses
      // customers care about, falling back to a generic notice for the
      // rest (ASSIGNED, REACHED_CUSTOMER, MERCHANT_INSPECTION, etc.).
      if (updatedBooking.user && updatedBooking.user.email) {
        const orderRefForEmail =
          updatedBooking.orderNumber ||
          String(updatedBooking._id).slice(-8).toUpperCase();
        const vehicleNumberForEmail = updatedBooking.vehicle?.licensePlate;
        const serviceNamesForEmail = Array.isArray(updatedBooking.services)
          ? updatedBooking.services.map((s) => s.name).filter(Boolean).join(', ')
          : undefined;
        const vehicleLabelForEmail = updatedBooking.vehicle
          ? [updatedBooking.vehicle.make, updatedBooking.vehicle.model].filter(Boolean).join(' ')
          : undefined;

        const templateKey = BOOKING_STATUS_EMAIL_KEYS[canonTo];
        const statusEmail = templateKey
          ? getBookingStatusEmail(templateKey, {
              customerName: updatedBooking.user.name,
              bookingId: orderRefForEmail,
              service: serviceNamesForEmail,
              vehicle: vehicleLabelForEmail,
              vehicleNumber: vehicleNumberForEmail,
            })
          : null;

        if (statusEmail) {
          sendEmail(updatedBooking.user.email, statusEmail.subject, statusEmail.text, statusEmail.html).catch(() => {});
        } else {
          sendEmail(
            updatedBooking.user.email,
            'Booking Status Update - Carzzi',
            `Dear ${updatedBooking.user.name},\n\nYour booking status has been updated to: ${canonTo}.\n\nCheck your dashboard for more details.`
          ).catch(() => {});
        }
      }
      const paymentStatus = (updatedBooking.paymentStatus || '').toLowerCase();
      const isAlreadyPaid =
        paymentStatus === 'paid' || paymentStatus === 'success';

      if (
        canonTo === 'SERVICE_COMPLETED' &&
        req.user.role === 'merchant' &&
        updatedBooking.user?._id &&
        !isAlreadyPaid
      ) {
        const orderRef =
          updatedBooking.orderNumber ||
          String(updatedBooking._id).slice(-6).toUpperCase();
        const amountDue =
          updatedBooking.finalAmount ?? updatedBooking.totalAmount ?? 0;
        const amountText = Number(amountDue).toLocaleString('en-IN');
        void sendPushToUser(
          updatedBooking.user._id,
          'Service complete — payment due',
          `Your service for booking #${orderRef} is complete. Amount due: ₹${amountText}. Tap Pay to complete payment in the Carzzi app.`,
          {
            type: 'service_completed_payment_pending',
            status: 'SERVICE_COMPLETED',
            bookingId: String(updatedBooking._id),
            amountDue: String(amountDue),
          },
          'service_completed_payment_pending',
          { dataOnly: true }
        ).catch(() => {});
        if (updatedBooking.user.email) {
          const paymentPendingEmail = getBookingStatusEmail('PAYMENT_PENDING', {
            customerName: updatedBooking.user.name,
            bookingId: orderRef,
            vehicleNumber: updatedBooking.vehicle?.licensePlate,
            amount: amountDue,
          });
          void sendEmail(
            updatedBooking.user.email,
            paymentPendingEmail.subject,
            paymentPendingEmail.text,
            paymentPendingEmail.html
          ).catch(() => {});
        }
      } else if (
        canonTo === 'SERVICE_STARTED' &&
        req.user.role === 'merchant' &&
        updatedBooking.user?._id
      ) {
        const orderRef =
          updatedBooking.orderNumber ||
          String(updatedBooking._id).slice(-6).toUpperCase();
        void sendPushToUser(
          updatedBooking.user._id,
          'Service Started',
          `Your vehicle service has started for booking #${orderRef}. Our workshop team is now working on your car — track progress in the Carzzi app.`,
          {
            type: 'service_started',
            status: 'SERVICE_STARTED',
            bookingId: String(updatedBooking._id),
          },
          'service_started'
        ).catch(() => {});
      } else if (
        canonTo === 'OUT_FOR_DELIVERY' &&
        updatedBooking.user?._id
      ) {
        const deliveryPin = updatedBooking.deliveryOtp?.code || '';
        if (deliveryPin) {
          void sendCustomerDeliveryOtpPush(updatedBooking, deliveryPin).catch(
            () => {}
          );
        }
      } else if (canonTo === 'DELIVERED' && updatedBooking.user?._id) {
        const orderRef =
          updatedBooking.orderNumber ||
          String(updatedBooking._id).slice(-6).toUpperCase();
        void sendPushToUser(
          updatedBooking.user._id,
          'Feedback',
          `Your vehicle has been delivered for booking #${orderRef}. We hope everything went well — open the Carzzi app to share your feedback and rate your experience.`,
          {
            type: 'feedback',
            status: 'DELIVERED',
            bookingId: String(updatedBooking._id),
          },
          'feedback'
        ).catch(() => {});
        
        // Send WhatsApp feedback message
        if (updatedBooking.user?.phone) {
          try {
            // console.log('[WhatsApp] Sending feedback message to user:', updatedBooking.user.phone);
            const normalizedPhone = normalizeIndianMobile(updatedBooking.user.phone);
            // console.log('[WhatsApp] Normalized phone:', normalizedPhone);
            if (normalizedPhone) {
              const templateName = resolveFeedbackWhatsAppTemplateName();
              // console.log('[WhatsApp] Using template:', templateName);
              
              // Build template components
              const components = {
                body_1: {
                  type: 'text',
                  value: updatedBooking.user.name || 'User'
                },
                body_2: {
                  type: 'text',
                  value: `https://carzzi.com/track/${updatedBooking._id}`
                }
              };
              
              await sendWhatsAppMessage(normalizedPhone, templateName, components);
              // console.log('[WhatsApp] Feedback message sent successfully!');
            }
          } catch (whatsappErr) {
            console.error('[WhatsApp] Failed to send feedback message:', whatsappErr);
          }
        }
      } else {
        sendPushToUser(
          updatedBooking.user?._id,
          'Booking Update',
          `Your booking status is now: ${canonTo}`,
          { type: 'status', status: canonTo, bookingId: String(updatedBooking._id) }
        ).catch(() => {});
      }

      res.json(sanitizeBooking(updatedBooking, req.user));
    } else {
      res.status(404).json({ message: 'Booking not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Generate delivery OTP
// @route   POST /api/bookings/:id/generate-otp
// @access  Private/Staff/Admin
export const generateDeliveryOtp = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).select('+deliveryOtp.code').populate('user');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const isAdmin = req.user.role === 'admin';
    const isAssignedStaff = req.user.role === 'staff' && (
      (booking.pickupDriver && booking.pickupDriver.toString() === req.user._id.toString()) ||
      (booking.technician && booking.technician.toString() === req.user._id.toString()) ||
      (booking.carWash?.staffAssigned && booking.carWash.staffAssigned.toString() === req.user._id.toString())
    );
    if (!isAdmin && !isAssignedStaff) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Check if OTP already exists and is still valid
    const existingOtp = booking.deliveryOtp;
    const now = new Date();
    
    if (existingOtp && existingOtp.code && existingOtp.expiresAt && new Date(existingOtp.expiresAt) > now) {
      return res.json({ message: 'OTP already exists' });
    }

    // Generate new OTP only if none exists or expired
    const code = Math.floor(100000 + Math.random() * 900000).toString().slice(0, 4);
    
    booking.deliveryOtp = {
      code,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      attempts: 0,
      verifiedAt: null
    };
    await booking.save();

    if (booking.user?.email) {
      void sendEmail(
        booking.user.email,
        'Delivery OTP',
        `Your OTP for vehicle delivery is ${code}. It expires in 20 minutes.`
      ).catch(() => {});
    }
    void sendCustomerDeliveryOtpPush(booking, code).catch(() => {});

    // Emit socket update so customer sees the OTP immediately
    const populated = await Booking.findById(booking._id)
      .select('+deliveryOtp.code')
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('carWash.staffAssigned', 'name email phone');
    emitBookingUpdate(populated);
    
    res.json({ message: 'OTP generated' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const updateMessageApprovalStatus = async (req, res) => {
  const { messageId } = req.params;
  const { status } = req.body;

  try {
    const message = await Message.findById(messageId);

    if (!message || message.type !== 'approval') {
      return res.status(404).json({ message: 'Approval message not found' });
    }

    message.approval.status = status;
    await message.save();

    const populatedMessage = await message.populate('sender', '_id name role');

    emitChatMessage(message.bookingId, populatedMessage);

    res.json(populatedMessage);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Verify delivery OTP
// @route   POST /api/bookings/:id/verify-otp
// @access  Private
export const verifyDeliveryOtp = async (req, res) => {
  const { otp } = req.body;
  try {
    const booking = await Booking.findById(req.params.id).select('+deliveryOtp.code').populate('user');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (!booking.deliveryOtp || !booking.deliveryOtp.code) return res.status(400).json({ message: 'No OTP generated' });

    const now = new Date();
    if (booking.deliveryOtp.expiresAt && booking.deliveryOtp.expiresAt < now) {
      return res.status(400).json({ message: 'OTP expired' });
    }
    booking.deliveryOtp.attempts = (booking.deliveryOtp.attempts || 0) + 1;
    if (booking.deliveryOtp.attempts > 5) {
      return res.status(429).json({ message: 'Too many attempts' });
    }
    if (String(otp) !== booking.deliveryOtp.code) {
      await booking.save();
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    
    // Mark OTP as verified
    booking.deliveryOtp.verifiedAt = now;
    
    // Check if it's a battery or tire service to set the correct final status
    const isBatteryTireService = await isBatteryOrTireBooking(booking);
    
    // Update status to COMPLETED for battery/tire, otherwise DELIVERED
    const finalStatus = isBatteryTireService ? 'COMPLETED' : 'DELIVERED';
    booking.status = finalStatus;
    await booking.save();
    
    // Populate for real-time consumers
    const populated = await Booking.findById(booking._id)
      .select('+deliveryOtp.code')
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone location')
      .populate('pickupDriver', 'name email phone')
      .populate('technician', 'name email phone')
      .populate('carWash.staffAssigned', 'name email phone')
      .populate('batteryTire.warranty.addedBy', 'name email');

    // Emit socket event for real-time updates
    emitBookingUpdate(populated);
    
    // Send WhatsApp message and push notification when delivered or completed
    setImmediate(async () => {
      try {
        if ((finalStatus === 'DELIVERED' || finalStatus === 'COMPLETED') && populated.user?.phone) {
          // console.log('[WhatsApp] Sending feedback message to user (via verifyOTP):', populated.user.phone);
          const normalizedPhone = normalizeIndianMobile(populated.user.phone);
          // console.log('[WhatsApp] Normalized phone:', normalizedPhone);
          if (normalizedPhone) {
            const templateName = resolveFeedbackWhatsAppTemplateName();
            // console.log('[WhatsApp] Using template:', templateName);
            
            const components = {
              body_1: {
                type: 'text',
                value: populated.user.name || 'User'
              },
              body_2: {
                type: 'text',
                value: `https://carzzi.com/track/${populated._id}`
              }
            };
            
            await sendWhatsAppMessage(normalizedPhone, templateName, components);
            // console.log('[WhatsApp] Feedback message sent successfully!');
          }
        }
        
        if ((finalStatus === 'DELIVERED' || finalStatus === 'COMPLETED') && populated.user?._id) {
          const orderRef = populated.orderNumber || String(populated._id).slice(-6).toUpperCase();
          const message = finalStatus === 'DELIVERED'
            ? `Your vehicle has been delivered for booking #${orderRef}. We hope everything went well — open the Carzzi app to share your feedback and rate your experience.`
            : `Your service has been completed for booking #${orderRef}. We hope everything went well — open the Carzzi app to share your feedback and rate your experience.`;
          
          await sendPushToUser(
            populated.user._id,
            'Feedback',
            message,
            {
              type: 'feedback',
              status: finalStatus,
              bookingId: String(populated._id),
            },
            'feedback'
          );
        }
      } catch (err) {
        console.error('[verifyDeliveryOtp] Error sending notifications:', err);
      }
    });
    
    res.json({ message: 'OTP verified and delivery completed', booking: sanitizeBooking(populated, req.user) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// @desc    Update booking details (media, parts, notes, inspection, qc, etc.)
// @route   PUT /api/bookings/:id/details
// @access  Private/Merchant/Admin
export const updateBookingDetails = async (req, res) => {
  const { 
    media, 
    parts, 
    notes,
    prePickupPhotos,
    inspection,
    delay,
    serviceExecution,
    qc,
    billing,
    revisit,
    healthSaved
  } = req.body;

  try {
    const booking = await Booking.findById(req.params.id);

    if (booking) {
      const isAdmin = req.user.role === 'admin';
      const isAssignedMerchant = req.user.role === 'merchant' && booking.merchant && booking.merchant.toString() === req.user._id.toString();
      const isAssignedStaff = req.user.role === 'staff' && (
        (booking.pickupDriver && booking.pickupDriver.toString() === req.user._id.toString()) ||
        (booking.technician && booking.technician.toString() === req.user._id.toString()) ||
        (booking.carWash?.staffAssigned && booking.carWash.staffAssigned.toString() === req.user._id.toString())
      );

      if (!isAdmin && !isAssignedMerchant && !isAssignedStaff) {
        return res.status(401).json({ message: 'Not authorized to update this booking' });
      }

      if (media) {
        validateImageUrls(media);
        booking.media = media;
      }
      if (notes) booking.notes = notes;
      if (req.body.carWash) {
        if (!booking.carWash) booking.carWash = { isCarWashService: true };
        if (Array.isArray(req.body.carWash.beforeWashPhotos)) {
          validateImageUrls(req.body.carWash.beforeWashPhotos);
          booking.carWash.beforeWashPhotos = req.body.carWash.beforeWashPhotos;
        }
        if (Array.isArray(req.body.carWash.afterWashPhotos)) {
          validateImageUrls(req.body.carWash.afterWashPhotos);
          booking.carWash.afterWashPhotos = req.body.carWash.afterWashPhotos;
        }
        booking.markModified('carWash');
      }
      if (prePickupPhotos) {
        const isBatteryTire = await isBatteryOrTireBooking(booking);
        const maxPhotos = isBatteryTire ? 2 : 4;
        if (Array.isArray(prePickupPhotos) && prePickupPhotos.length > maxPhotos) {
          return res.status(400).json({ 
            message: isBatteryTire 
              ? `Cannot accept more than 2 photos for battery/tire services`
              : `Cannot accept more than 4 photos for general services` 
          });
        }
        validateImageUrls(prePickupPhotos);
        booking.prePickupPhotos = prePickupPhotos;
      }
      
      if (inspection) {
        if (!booking.inspection) booking.inspection = {};
        validateImageUrls(inspection.frontPhoto);
        validateImageUrls(inspection.backPhoto);
        validateImageUrls(inspection.leftPhoto);
        validateImageUrls(inspection.rightPhoto);
        if (Array.isArray(inspection.photos)) {
          validateImageUrls(inspection.photos);
        }
        if (Array.isArray(inspection.additionalParts)) {
          for (const part of inspection.additionalParts) {
            validateImageUrls(part.image);
            validateImageUrls(part.oldImage);
          }
        }
        Object.assign(booking.inspection, inspection);
        booking.markModified('inspection');
      }
      if (delay) {
        if (!booking.delay) booking.delay = {};
        Object.assign(booking.delay, delay);
        booking.markModified('delay');
      }
      if (serviceExecution) {
        if (!booking.serviceExecution) booking.serviceExecution = {};
        if (Array.isArray(serviceExecution.afterPhotos)) {
          serviceExecution.afterPhotos = serviceExecution.afterPhotos.slice(0, BATTERY_AFTER_PHOTOS_REQUIRED);
        }
        validateImageUrls(serviceExecution.beforePhotos);
        validateImageUrls(serviceExecution.duringPhotos);
        validateImageUrls(serviceExecution.afterPhotos);
        if (Array.isArray(serviceExecution.serviceParts)) {
          for (const part of serviceExecution.serviceParts) {
            validateImageUrls(part.image);
            validateImageUrls(part.oldImage);
          }
        }
        Object.assign(booking.serviceExecution, serviceExecution);
        booking.markModified('serviceExecution');
      }
      if (qc) {
        if (!booking.qc) booking.qc = {};
        Object.assign(booking.qc, qc);
        booking.markModified('qc');
      }
      if (billing) {
        if (!booking.billing) booking.billing = {};
        Object.assign(booking.billing, billing);
        
        // Recalculate total instead of trusting billing.total from client
        const { total: servicesTotal } = await calculateServicesTotal(booking.services, booking.vehicle, booking.selectedBrands, booking.serviceQuantities);
        
        const partsTotal = Number(booking.billing.partsTotal || 0);
        const labourCost = Number(booking.billing.labourCost || 0);
        const gst = Number(booking.billing.gst || 0);
        const pickupDropPrice = Number(booking.billing.pickupDropPrice || booking.pickupDropPrice || 0);
        
        const calculatedTotal = servicesTotal + partsTotal + labourCost + gst + pickupDropPrice;
        
        booking.totalAmount = calculatedTotal;
        booking.billing.total = calculatedTotal;

        // Support manual discount from billing object
        if (billing.discountAmount !== undefined) {
          booking.discountAmount = Number(billing.discountAmount);
        }

        // Recalculate coupon discount if coupon exists
        if (booking.coupon) {
          try {
            const Coupon = (await import('../models/Coupon.js')).default;
            const coupon = await Coupon.findById(booking.coupon);
            if (coupon && coupon.isActive) {
              let couponDiscount = (calculatedTotal * coupon.discountPercentage) / 100;
              if (coupon.maxDiscountAmount) {
                couponDiscount = Math.min(couponDiscount, coupon.maxDiscountAmount);
              }
              booking.discountAmount = couponDiscount;
            }
          } catch (err) {
            console.error('Error recalculating coupon discount:', err);
          }
        }

        booking.finalAmount = Math.max(0, calculatedTotal - (booking.discountAmount || 0));
        
        booking.markModified('billing');

        // If submitting a bill, also mark the service as completed
        if (booking.status === 'SERVICE_STARTED') {
          booking.status = 'SERVICE_COMPLETED';
        }
      }
      // Merchant pressed "Save Health Stats" on this order. Health values live
      // on the vehicle; this marks them as belonging to this order so a new
      // order for the same car starts with empty fields.
      if (healthSaved === true) {
        booking.healthSavedAt = new Date();
      }
      if (revisit) {
        if (!booking.revisit) booking.revisit = {};
        Object.assign(booking.revisit, revisit);
        booking.markModified('revisit');
      }
      
      if (parts) {
        booking.parts = parts;
        
        // Recalculate total amount
        const partsTotal = parts.reduce((acc, part) => acc + (part.price * part.quantity), 0);
        
        const { total: servicesTotal } = await calculateServicesTotal(booking.services, booking.vehicle, booking.selectedBrands, booking.serviceQuantities);
        
        const labourCost = Number(booking.billing?.labourCost || 0);
        const gst = Number(booking.billing?.gst || 0);
        const pickupDropPrice = Number(booking.billing?.pickupDropPrice || booking.pickupDropPrice || 0);

        const newTotal = servicesTotal + partsTotal + labourCost + gst + pickupDropPrice;
        
        booking.totalAmount = newTotal;

        // Recalculate coupon discount if coupon exists
        if (booking.coupon) {
          try {
            const Coupon = (await import('../models/Coupon.js')).default;
            const coupon = await Coupon.findById(booking.coupon);
            if (coupon && coupon.isActive) {
              let couponDiscount = (newTotal * coupon.discountPercentage) / 100;
              if (coupon.maxDiscountAmount) {
                couponDiscount = Math.min(couponDiscount, coupon.maxDiscountAmount);
              }
              booking.discountAmount = couponDiscount;
            }
          } catch (err) {
            console.error('Error recalculating coupon discount in parts update:', err);
          }
        }

        booking.finalAmount = Math.max(0, newTotal - (booking.discountAmount || 0));
        
        // Update billing partsTotal if billing exists
        if (booking.billing) {
            booking.billing.partsTotal = partsTotal;
            booking.billing.total = newTotal;
        }
      }

      const updatedBooking = await booking.save();
      
      // Populate fields before returning to frontend
      const populated = await Booking.findById(updatedBooking._id)
        .select('+deliveryOtp.code')
        .populate('user', 'id name email phone')
        .populate('vehicle')
        .populate('services')
        .populate('merchant', 'name email phone location')
        .populate('pickupDriver', 'name email phone')
        .populate('technician', 'name email phone')
        .populate('carWash.staffAssigned', 'name email phone')
        .populate('batteryTire.warranty.addedBy', 'name email');

      // Emit socket event for real-time updates
      emitBookingUpdate(populated);
      emitEntitySync('booking', 'updated', populated);

      const bookingIdStr = String(populated._id);
      // Notify customer of significant changes (e.g., billing update)
      if (billing && populated.user?._id) {
        await sendPushToUser(
          populated.user._id,
          'Bill Updated',
          `The bill for your booking #${populated.orderNumber || bookingIdStr.slice(-6).toUpperCase()} has been updated.`,
          { type: 'billing_update', bookingId: bookingIdStr }
        );
      }

      res.json(sanitizeBooking(populated, req.user));
    } else {
      res.status(404).json({ message: 'Booking not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Car wash specific endpoints
export const uploadCarWashBeforePhotos = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { photos } = req.body; // Array of photo URLs

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!booking.carWash?.isCarWashService) {
      return res.status(400).json({ message: 'This is not a car wash service' });
    }

    // Check if user is assigned staff
    if (booking.carWash.staffAssigned?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to upload photos for this booking' });
    }

    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ message: 'At least one photo is required' });
    }

    validateImageUrls(photos);

    // Ensure carWash object exists
    if (!booking.carWash) {
      booking.carWash = { isCarWashService: true };
    }

    const existing = Array.isArray(booking.carWash.beforeWashPhotos)
      ? booking.carWash.beforeWashPhotos
      : [];
    if (existing.length >= CAR_WASH_MAX_PHOTOS) {
      return res.status(400).json({ message: `Maximum ${CAR_WASH_MAX_PHOTOS} before wash photos already uploaded` });
    }

    const merged = [...existing, ...photos].slice(0, CAR_WASH_MAX_PHOTOS);
    if (merged.length > CAR_WASH_MAX_PHOTOS) {
      return res.status(400).json({ message: `Maximum ${CAR_WASH_MAX_PHOTOS} photos allowed` });
    }

    booking.carWash.beforeWashPhotos = merged;
    await booking.save();

    // Populate for real-time consumers
    const populated = await Booking.findById(booking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('carWash.staffAssigned', 'name email phone');

    emitBookingUpdate(populated);
    emitEntitySync('booking', 'updated', populated);

    res.json({ message: 'Before wash photos uploaded successfully', booking: populated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const startCarWash = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!booking.carWash?.isCarWashService) {
      return res.status(400).json({ message: 'This is not a car wash service' });
    }

    // Check if user is assigned staff
    if (booking.carWash.staffAssigned?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to start car wash for this booking' });
    }

    const beforePhotos = Array.isArray(booking.carWash.beforeWashPhotos)
      ? booking.carWash.beforeWashPhotos
      : [];
    const isEssentials = await isEssentialsBooking(booking);
    const requiredBeforeCount = isEssentials ? 4 : CAR_WASH_MIN_PHOTOS;
    if (beforePhotos.length < requiredBeforeCount) {
      return res.status(400).json({
        message: isEssentials
          ? `Please upload at least 4 before service photos before starting service`
          : `Please upload at least ${CAR_WASH_MIN_PHOTOS} before wash photos before starting car wash`,
      });
    }

    booking.status = 'CAR_WASH_STARTED';
    booking.carWash.washStartedAt = new Date();
    await booking.save();

    // Populate for real-time consumers
    const populated = await Booking.findById(booking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('carWash.staffAssigned', 'name email phone');

    emitBookingUpdate(populated);

    // Notify customer
    try {
      const isEssentials = populated.services?.some(s => s.category?.toLowerCase().includes('essentials'));
      const pushTitle = isEssentials ? 'Service Started' : 'Car Wash Started';
      const pushBody = isEssentials 
        ? `Your service (#${booking.orderNumber}) has been started.`
        : `Your car wash service (#${booking.orderNumber}) has been started.`;

      await sendPushToUser(
        booking.user,
        pushTitle,
        pushBody,
        { bookingId: booking._id.toString(), type: 'car_wash_started' },
        'order'
      );
    } catch (err) {
      
    }

    res.json({ message: isEssentials ? 'Service started successfully' : 'Car wash started successfully', booking: populated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const uploadCarWashAfterPhotos = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { photos } = req.body; // Array of photo URLs

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!booking.carWash?.isCarWashService) {
      return res.status(400).json({ message: 'This is not a car wash service' });
    }

    // Check if user is assigned staff
    if (booking.carWash.staffAssigned?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to upload photos for this booking' });
    }

    if (booking.status !== 'CAR_WASH_STARTED') {
      return res.status(400).json({ message: 'Car wash must be started before uploading after photos' });
    }

    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ message: 'At least one photo is required' });
    }

    validateImageUrls(photos);

    // Ensure carWash object exists
    if (!booking.carWash) {
      booking.carWash = { isCarWashService: true };
    }

    const existingAfter = Array.isArray(booking.carWash.afterWashPhotos)
      ? booking.carWash.afterWashPhotos
      : [];
    if (existingAfter.length >= CAR_WASH_MAX_PHOTOS) {
      return res.status(400).json({ message: `Maximum ${CAR_WASH_MAX_PHOTOS} after wash photos already uploaded` });
    }

    const mergedAfter = [...existingAfter, ...photos].slice(0, CAR_WASH_MAX_PHOTOS);
    booking.carWash.afterWashPhotos = mergedAfter;
    await booking.save();

    // Populate for real-time consumers
    const populated = await Booking.findById(booking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('carWash.staffAssigned', 'name email phone');

    emitBookingUpdate(populated);
    emitEntitySync('booking', 'updated', populated);

    res.json({ message: 'After wash photos uploaded successfully', booking: populated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const completeCarWash = async (req, res) => {
  try {
    const { bookingId } = req.params;
    

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      
      return res.status(404).json({ message: 'Booking not found' });
    }

    

    if (!booking.carWash?.isCarWashService) {
      
      return res.status(400).json({ message: 'This is not a car wash service' });
    }

    // Check if user is assigned staff
    if (booking.carWash.staffAssigned?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      
      return res.status(403).json({ message: 'Not authorized to complete car wash for this booking' });
    }

    if (booking.status !== 'CAR_WASH_STARTED') {
      
      return res.status(400).json({ message: 'Car wash must be started before completion' });
    }

    // Check if after photos are uploaded
    const afterPhotos = Array.isArray(booking.carWash?.afterWashPhotos) ? booking.carWash.afterWashPhotos : [];
    const isEssentials = await isEssentialsBooking(booking);
    const requiredAfterCount = isEssentials ? 4 : CAR_WASH_MIN_PHOTOS;
    if (afterPhotos.length < requiredAfterCount) {
      return res.status(400).json({
        message: isEssentials
          ? `Please upload at least 4 after service photos before completing service`
          : `Please upload at least ${CAR_WASH_MIN_PHOTOS} after wash photos before completing car wash`,
      });
    }

    booking.status = 'CAR_WASH_COMPLETED';
    booking.carWash.washCompletedAt = new Date();

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    booking.deliveryOtp = {
      code,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      attempts: 0,
      verifiedAt: null,
    };
    await booking.save();
    

    // Populate for real-time consumers
    const populated = await Booking.findById(booking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('carWash.staffAssigned', 'name email phone');

    

    emitBookingUpdate(populated);

    // Notify customer with OTP
    try {
      const isEssentials = populated.services?.some(s => s.category?.toLowerCase().includes('essentials'));
      const pushTitle = isEssentials ? 'Service Completed' : 'Car Wash Completed';
      const pushBody = isEssentials 
        ? `Your service (#${booking.orderNumber}) is completed! Your delivery OTP is: ${code}`
        : `Your car wash service (#${booking.orderNumber}) is completed! Your delivery OTP is: ${code}`;

      const pushResult = await sendPushToUser(
        booking.user,
        pushTitle,
        pushBody,
        { bookingId: booking._id.toString(), type: 'car_wash_completed', otp: code },
        'order'
      );
    } catch (err) {
      
    }

    res.json({
      message: isEssentials ? 'Service completed successfully' : 'Car wash completed successfully',
      booking: sanitizeBooking(populated, req.user),
    });
  } catch (error) {
    
    res.status(400).json({ message: error.message });
  }
};

export const getCarWashBookings = async (req, res) => {
  try {
    let query = { 'carWash.isCarWashService': true };

    // If staff user, show only their assigned bookings
    if (req.user.role === 'staff') {
      query['carWash.staffAssigned'] = req.user._id;
    }

    const bookings = await Booking.find(query)
      .populate('user', 'name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('carWash.staffAssigned', 'name email phone')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Merchant approval/rejection for battery/tire services
// @route   PUT /api/bookings/:id/battery-tire-approval
// @access  Private (Merchant only)
export const batteryTireApproval = async (req, res) => {
  const { status, price, image, notes } = req.body;

  try {
    const booking = await Booking.findById(req.params.id).populate('merchant');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Check if this is a battery/tire service
    if (!booking.batteryTire?.isBatteryTireService) {
      return res.status(400).json({ message: 'This is not a battery/tire service' });
    }

    // Check if user is the assigned merchant
    const isAssignedMerchant = req.user.role === 'merchant' && 
      booking.merchant && booking.merchant._id.toString() === req.user._id.toString();
    
    if (!isAssignedMerchant && req.user.role !== 'admin') {
      return res.status(401).json({ message: 'Not authorized to approve/reject this booking' });
    }

    // Validate status
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Status must be APPROVED or REJECTED' });
    }

    // Update approval status
    booking.batteryTire.merchantApproval.status = status;
    booking.batteryTire.merchantApproval.notes = notes;

    if (status === 'APPROVED') {
      if (!price || price <= 0) {
        return res.status(400).json({ message: 'Price is required for approval' });
      }
      booking.batteryTire.merchantApproval.price = price;
      booking.batteryTire.merchantApproval.image = image;
      booking.batteryTire.merchantApproval.approvedAt = new Date();
      
      // Update total amount with merchant's price
      booking.totalAmount = price;
    } else {
      booking.batteryTire.merchantApproval.rejectedAt = new Date();
    }

    const updatedBooking = await booking.save();

    // Populate for response
    const populated = await Booking.findById(updatedBooking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone location')
      .populate('pickupDriver', 'name email phone')
      .populate('batteryTire.warranty.addedBy', 'name email');

    // Emit socket event for real-time updates
    emitBookingUpdate(populated);

    // Send notifications
    try {
      const orderId = populated.orderNumber || populated._id.toString().slice(-6).toUpperCase();
      
      // Notify admin
      await sendPushToRole(
        'admin',
        `Battery/Tire Service ${status}`,
        `Merchant has ${status.toLowerCase()} battery/tire service #${orderId}${status === 'APPROVED' ? ` for ₹${price}` : ''}`,
        { type: 'battery_tire_approval', bookingId: populated._id.toString(), status },
        'order'
      );

      // Notify customer
      if (populated.user?._id) {
        const message = status === 'APPROVED' 
          ? `Your battery/tire service #${orderId} has been approved by the merchant for ₹${price}. Staff will collect the items and deliver to you.`
          : `Your battery/tire service #${orderId} has been rejected by the merchant. ${notes ? `Reason: ${notes}` : ''}`;
        
        await sendPushToUser(
          populated.user._id,
          `Service ${status}`,
          message,
          { type: 'battery_tire_approval', bookingId: populated._id.toString(), status },
          'order'
        );
      }

      // If approved, notify assigned staff
      if (status === 'APPROVED' && populated.pickupDriver?._id) {
        await sendPushToUser(
          populated.pickupDriver._id,
          'Battery/Tire Service Approved',
          `Battery/tire service #${orderId} has been approved. Please go to merchant location to collect items.`,
          { type: 'battery_tire_approved', bookingId: populated._id.toString() },
          'order'
        );
      }

    } catch (notifyErr) {
      
    }

    res.json(populated);
  } catch (error) {
    
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add warranty information for battery/tire service
// @route   PUT /api/bookings/:id/warranty
// @access  Private (Merchant only)
export const addWarranty = async (req, res) => {
  const { name, price, warrantyMonths, image } = req.body;

  try {
    const booking = await Booking.findById(req.params.id).populate('merchant');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Check if this is a battery/tire service
    if (!booking.batteryTire?.isBatteryTireService) {
      return res.status(400).json({ message: 'This is not a battery/tire service' });
    }

    // Check if user is the assigned merchant
    const isAssignedMerchant = req.user.role === 'merchant' && 
      booking.merchant && booking.merchant._id.toString() === req.user._id.toString();
    
    if (!isAssignedMerchant && req.user.role !== 'admin') {
      return res.status(401).json({ message: 'Not authorized to add warranty for this booking' });
    }

    // Validate required fields
    if (!name || !warrantyMonths) {
      return res.status(400).json({ message: 'Name and warranty months are required' });
    }

    if (warrantyMonths <= 0) {
      return res.status(400).json({ message: 'Warranty months must be positive numbers' });
    }

    if (price !== undefined && price !== null && price !== '') {
      if (parseFloat(price) <= 0) {
        return res.status(400).json({ message: 'Price must be a positive number' });
      }
    }

    // Add warranty information
    booking.batteryTire.warranty = {
      name,
      price: (price !== undefined && price !== null && price !== '') ? parseFloat(price) : undefined,
      warrantyMonths: parseInt(warrantyMonths),
      image,
      addedAt: new Date(),
      addedBy: req.user._id
    };

    const updatedBooking = await booking.save();

    // Populate for response
    const populated = await Booking.findById(updatedBooking._id)
      .populate('user', 'id name email phone')
      .populate('vehicle')
      .populate('services')
      .populate('merchant', 'name email phone location')
      .populate('pickupDriver', 'name email phone')
      .populate('batteryTire.warranty.addedBy', 'name email');

    // Emit socket event for real-time updates
    emitBookingUpdate(populated);

    // Send notifications
    try {
      const orderId = populated.orderNumber || populated._id.toString().slice(-6).toUpperCase();
      
      // Notify admin
      await sendPushToRole(
        'admin',
        'Warranty Added',
        `Warranty information added for battery/tire service #${orderId} - ${name} (${warrantyMonths} months)`,
        { type: 'warranty_added', bookingId: populated._id.toString() },
        'order'
      );

      // Notify customer
      if (populated.user?._id) {
        await sendPushToUser(
          populated.user._id,
          'Warranty Information Added',
          `Warranty details have been added to your battery/tire service #${orderId}: ${name} with ${warrantyMonths} months warranty.`,
          { type: 'warranty_added', bookingId: populated._id.toString() },
          'order'
        );
      }

    } catch (notifyErr) {
      
    }

    res.json(populated);
  } catch (error) {
    
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Apply coupon to existing booking
 * @route   POST /api/bookings/:id/apply-coupon
 * @access  Private
 */
export const applyCoupon = async (req, res) => {
  const { couponCode } = req.body;
  const bookingId = req.params.id;

  try {
    const booking = await Booking.findById(bookingId).populate('services');
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ message: 'Booking already paid' });
    }

    const Coupon = (await import('../models/Coupon.js')).default;
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });

    if (!coupon) {
      return res.status(404).json({ message: 'Invalid or inactive coupon' });
    }

    // Validate coupon
    if (!isCouponDateValid(coupon.validFrom, coupon.validUntil)) {
      return res.status(400).json({ message: 'Coupon expired' });
    }

    if (coupon.minOrderAmount && booking.totalAmount < coupon.minOrderAmount) {
      return res.status(400).json({ message: `Minimum order of ₹${coupon.minOrderAmount} required` });
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return res.status(400).json({ message: 'Coupon usage limit reached' });
    }

    // Check service applicability and calculate proportion
    const isAllApplicable = coupon.applicableServices.includes('All');
    let applicableAmount = booking.totalAmount;
    
    if (!isAllApplicable) {
      const allServices = booking.services;
      const totalBasePrice = allServices.reduce((sum, s) => sum + s.price, 0);
      
      const applicableServicesList = allServices.filter(service => {
        const mappedCat = mapCategoryToCouponServiceType(service.category);
        return coupon.applicableServices.includes(mappedCat);
      });
      
      const applicableBasePrice = applicableServicesList.reduce((sum, s) => sum + s.price, 0);
      
      if (applicableBasePrice === 0) {
        return res.status(400).json({ message: 'Coupon not applicable for these services' });
      }
      
      const prop = totalBasePrice > 0 ? (applicableBasePrice / totalBasePrice) : 0;
      applicableAmount = booking.totalAmount * prop;
    }

    // Calculate discount
    let discountAmount = (applicableAmount * coupon.discountPercentage) / 100;
    if (coupon.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
    }

    booking.coupon = coupon._id;
    booking.discountAmount = discountAmount;
    booking.finalAmount = Math.max(0, booking.totalAmount - discountAmount);

    await booking.save();
    
    // Increment usage
    coupon.usageCount += 1;
    await coupon.save();

    const populated = await Booking.findById(booking._id)
        .populate('user', 'id name email phone')
        .populate('vehicle')
        .populate('services')
        .populate('coupon');

    emitBookingUpdate(populated);

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
