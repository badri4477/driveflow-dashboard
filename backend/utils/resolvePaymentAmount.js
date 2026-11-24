import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import Coupon from '../models/Coupon.js';
import { calculateServicesTotal } from '../controllers/bookingController.js';
import { isCouponDateValid } from './validation.js';
import {
  calculateOrderTotals,
  shouldApplyCheckoutGst,
  mapCategoryToCouponServiceType,
} from './orderPricing.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function computeCouponDiscount(couponRef, totalAmount, services) {
  if (!couponRef) return { discountAmount: 0, couponId: null };

  const coupon =
    typeof couponRef === 'object' && couponRef._id && typeof couponRef.code === 'string'
      ? couponRef
      : await Coupon.findById(couponRef);

  if (!coupon || !coupon.isActive) {
    throw new Error('Invalid or inactive coupon');
  }

  if (!isCouponDateValid(coupon.validFrom, coupon.validUntil)) {
    throw new Error('Coupon expired');
  }

  if (coupon.minOrderAmount && totalAmount < coupon.minOrderAmount) {
    throw new Error(`Minimum order of ₹${coupon.minOrderAmount} required`);
  }

  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
    throw new Error('Coupon usage limit reached');
  }

  const isAllApplicable = coupon.applicableServices.includes('All');
  let applicableAmount = totalAmount;

  if (!isAllApplicable && Array.isArray(services) && services.length > 0) {
    const totalBasePrice = services.reduce((sum, s) => sum + (s.price || 0), 0);
    const applicableServicesList = services.filter((service) => {
      const mappedCat = mapCategoryToCouponServiceType(service.category);
      return coupon.applicableServices.includes(mappedCat);
    });
    const applicableBasePrice = applicableServicesList.reduce((sum, s) => sum + (s.price || 0), 0);

    if (applicableBasePrice === 0) {
      throw new Error('Coupon not applicable for these services');
    }

    const prop = totalBasePrice > 0 ? applicableBasePrice / totalBasePrice : 0;
    applicableAmount = totalAmount * prop;
  }

  let discountAmount = (applicableAmount * coupon.discountPercentage) / 100;
  if (coupon.maxDiscountAmount) {
    discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
  }

  return { discountAmount: round2(discountAmount), couponId: coupon._id };
}

/**
 * Resolve the authoritative payment amount on the server.
 * Never trust client-supplied amount, subtotal, or finalAmount.
 */
export async function resolvePaymentAmount({ bookingId, userId, tempBookingData }) {
  const normalizedBookingId =
    bookingId && mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null;

  if (normalizedBookingId) {
    const booking = await Booking.findById(normalizedBookingId).populate('services');
    if (!booking) throw new Error('Booking not found');
    if (booking.user.toString() !== userId.toString()) {
      throw new Error('Unauthorized access to booking');
    }
    if (booking.paymentStatus === 'paid') {
      throw new Error('Payment already completed for this booking');
    }

    // Apply or remove coupon if present in tempBookingData
    if (tempBookingData && 'coupon' in tempBookingData) {
      const couponRef = tempBookingData.coupon;
      if (couponRef) {
        const { discountAmount, couponId } = await computeCouponDiscount(
          couponRef,
          booking.totalAmount,
          booking.services
        );
        booking.coupon = couponId;
        booking.discountAmount = discountAmount;
        booking.finalAmount = Math.max(0, booking.totalAmount - discountAmount);
      } else {
        booking.coupon = null;
        booking.discountAmount = 0;
        booking.finalAmount = booking.totalAmount;
      }
      await booking.save();
    }

    const amount = round2(
      booking.finalAmount ??
        Math.max(0, (booking.totalAmount || 0) - (booking.discountAmount || 0))
    );

    if (!amount || amount < 1) {
      throw new Error('Invalid booking amount');
    }

    return { amount, booking, pricing: null, sanitizedTempData: null };
  }

  if (!tempBookingData || typeof tempBookingData !== 'object') {
    throw new Error('Either bookingId or tempBookingData is required');
  }

  const vehicleId = tempBookingData.vehicleId;
  const serviceIds = tempBookingData.serviceIds || tempBookingData.services?.map((s) => s._id || s) || [];

  if (!vehicleId || !serviceIds.length) {
    throw new Error('Invalid temp booking data: vehicle and services are required');
  }

  const { total: servicesTotal, catalogRow, services, quoteServices = [] } = await calculateServicesTotal(
    serviceIds,
    vehicleId,
    tempBookingData.selectedBrands || {},
    tempBookingData.serviceQuantities || {}
  );

  let totalAmount = servicesTotal;
  let pickupDropPrice = 0;

  const isGeneralService = services.some(
    (service) =>
      service.category === 'Periodic' ||
      service.category === 'Services' ||
      (service.name && service.name.toLowerCase().includes('general service'))
  );

  if (isGeneralService && catalogRow?.pickup_drop_price) {
    const extra = Number(catalogRow.pickup_drop_price);
    if (!isNaN(extra)) {
      pickupDropPrice = extra;
      totalAmount += extra;
    }
  }

  const couponRef = tempBookingData.coupon || null;
  const { discountAmount, couponId } = await computeCouponDiscount(couponRef, totalAmount, services);

  const pricingInput = {
    ...tempBookingData,
    serviceIds,
    services,
    totalAmount,
    pickupDropPrice,
    discountAmount,
    coupon: couponId,
  };

  const applyTax = await shouldApplyCheckoutGst(pricingInput);
  const pricing = calculateOrderTotals(totalAmount, discountAmount, applyTax);

  if (!pricing.total || pricing.total < 1) {
    throw new Error('Invalid order amount');
  }

  const sanitizedTempData = {
    vehicleId,
    serviceIds,
    date: tempBookingData.date,
    notes: tempBookingData.notes,
    location: tempBookingData.location,
    subtotal: pricing.subtotal,
    totalAmount: pricing.subtotal,
    pickupDropPrice,
    discountAmount: pricing.discountAmount,
    gstAmount: pricing.tax,
    finalAmount: pricing.total,
    coupon: couponId,
    selectedBrands: tempBookingData.selectedBrands || {},
    serviceQuantities: tempBookingData.serviceQuantities || {},
    quoteServices: quoteServices.map((q) => ({ service: q.serviceId, name: q.serviceName, reason: q.reason })),
    requiresPaymentService: true,
    isCarWashService: services.some(
      (s) => s.category === 'Car Wash' || s.category === 'Wash'
    ),
    isBatteryTireService: services.some(
      (s) =>
        s.category === 'Battery' ||
        s.category === 'Tyres' ||
        s.category === 'Tyre & Battery'
    ),
    isEssentialsService: services.some((s) => s.category === 'Essentials'),
    customerPhone: tempBookingData.customerPhone,
    customerEmail: tempBookingData.customerEmail,
  };

  return {
    amount: pricing.total,
    booking: null,
    pricing,
    sanitizedTempData,
  };
}

export function extractGatewayPaidAmount(finalAttempt) {
  if (!finalAttempt) return null;
  const raw =
    finalAttempt.order_amount ??
    finalAttempt.payment_amount ??
    finalAttempt.orderAmount ??
    finalAttempt.paymentAmount;
  const value = Number(raw);
  return Number.isFinite(value) ? round2(value) : null;
}

export function amountsMatch(expected, actual, tolerance = 0.01) {
  if (expected == null || actual == null) return false;
  return Math.abs(Number(expected) - Number(actual)) <= tolerance;
}
