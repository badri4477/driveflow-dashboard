import crypto from 'crypto';
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Refund from '../models/Refund.js';
import Booking from '../models/Booking.js';
import Coupon from '../models/Coupon.js';
import AvailableServicePincode from '../models/AvailableServicePincode.js';
import { emitBookingUpdate } from '../controllers/bookingController.js';
import { sendEmail } from '../utils/emailService.js';
import { getBookingStatusEmail } from '../utils/emailTemplates.js';
import {
  calculateOrderTotals,
  shouldApplyCheckoutGst,
} from '../utils/orderPricing.js';
import {
  extractGatewayPaidAmount,
  amountsMatch,
} from '../utils/resolvePaymentAmount.js';

const extractPincodeFromAddress = (address) => {
  const match = String(address || '').match(/(\d{6})(?!\d)/);
  if (!match) return null;
  const digits = String(match[1]).replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
};

class PaymentService {
  constructor() {
    const env = process.env.CASHFREE_ENV === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
    this.cashfree = new Cashfree(env, process.env.CASHFREE_APP_ID, process.env.CASHFREE_SECRET_KEY);
    this.maxRetryCount = Number(process.env.PAYMENT_MAX_RETRY_COUNT || 3);
  }

  /**
   * Create Cashfree order + local order/payment records
   */
  async createOrder(userId, bookingId, amount, currency = 'INR', tempBookingData = null) {
    // Validate Cashfree configuration first
    if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
      console.error('Cashfree configuration missing: CASHFREE_APP_ID or CASHFREE_SECRET_KEY');
      throw new Error('Payment gateway configuration missing. Please check environment variables.');
    }
    
    const normalizedBookingId =
      bookingId && mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null;

    let booking = null;
    if (normalizedBookingId) {
      booking = await Booking.findById(normalizedBookingId).populate('user');
      if (!booking) throw new Error('Booking not found');
      if (booking.user._id.toString() !== userId.toString()) throw new Error('Unauthorized access to booking');
      if (booking.paymentStatus === 'paid') throw new Error('Payment already completed for this booking');
    }

    const orderId = `ord_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Format phone number to 10 digits
    const formatPhone = (phone) => {
      if (!phone) return '9999999999';
      const digits = String(phone).replace(/\D/g, '');
      if (digits.length >= 10) {
        return digits.slice(-10);
      }
      return '9999999999';
    };
    
    const customerPhone = formatPhone(tempBookingData?.customerPhone);
    const customerEmail = tempBookingData?.customerEmail || 'no-reply@carzzi.local';
    
    const request = {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: currency,
      customer_details: {
        customer_id: String(userId),
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/payment/callback?order_id={order_id}`
      },
      order_expiry_time: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      order_note: normalizedBookingId ? `booking:${normalizedBookingId}` : 'temp-booking'
    };

    try {
      const cfRes = await this.cashfree.PGCreateOrder(request);
      const { payment_session_id: paymentSessionId, cf_order_id: cfOrderId, order_expiry_time: orderExpiryTime } = cfRes.data;

      const order = await Order.create({
        orderId,
        userId,
        bookingId: normalizedBookingId,
        amount,
        currency,
        paymentSessionId,
        gatewayResponse: cfRes.data,
        expiresAt: orderExpiryTime ? new Date(orderExpiryTime) : new Date(Date.now() + 20 * 60 * 1000)
      });

      const payment = await Payment.create({
        userId,
        bookingId: normalizedBookingId,
        orderId,
        cashfreeOrderId: cfOrderId,
        cfPaymentSessionId: paymentSessionId,
        amount,
        expectedAmount: amount,
        currency,
        status: 'created',
        coupon: tempBookingData?.coupon || null,
        discountAmount: tempBookingData?.discountAmount || 0,
        gatewayResponse: cfRes.data,
        metadata: {
          bookingDetails: booking
            ? { services: booking.services, vehicle: booking.vehicle, date: booking.date }
            : {},
          tempBookingData
        }
      });

      return {
        orderId,
        paymentSessionId,
        amount,
        currency,
        paymentId: payment._id,
        orderNumber: booking?.orderNumber != null ? String(booking.orderNumber) : null,
        environment: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox'
      };
    } catch (error) {
      console.error('Cashfree API Error:', error.response?.data || error.message);
      
      const err = error;
      
      // Handle specific Cashfree errors
      if (err.response?.data?.message?.includes('product is not activated')) {
        throw new Error('Payment gateway product not activated. Please check your Cashfree account setup or contact support.');
      }
      if (err.response?.data?.message?.includes('authentication')) {
        throw new Error('Invalid Cashfree credentials. Please check your CASHFREE_APP_ID and CASHFREE_SECRET_KEY.');
      }
      
      throw new Error(err.response?.data?.message || err.message || 'Failed to create payment order');
    }
  }

  /**
   * Helper to create a booking from temporary data stored during order creation
   */
  async createBookingFromTempData(tempData, userId, paymentId) {
    try {
      const bookingPincode = extractPincodeFromAddress(tempData?.location?.address);
      if (!bookingPincode) {
        throw new Error('Pickup address must contain a valid 6-digit pincode');
      }
      const availablePincodes = await AvailableServicePincode.find({}).select('pincode').lean();
      const allowedSet = new Set(availablePincodes.map((p) => p.pincode));
      if (allowedSet.size === 0) {
        throw new Error(
          'Service booking is not available. Allowed service areas have not been configured.'
        );
      }
      if (!allowedSet.has(bookingPincode)) {
        throw new Error('Service is not available for the selected pincode');
      }

      const { generateOrderNumber } = await import('../utils/orderNumber.js');
      const orderNumber = await generateOrderNumber();
      
      const subtotal = Number(tempData.subtotal ?? tempData.totalAmount) || 0;
      const discountAmount = Number(tempData.discountAmount) || 0;
      const applyTax = await shouldApplyCheckoutGst(tempData);
      const pricing = calculateOrderTotals(subtotal, discountAmount, applyTax);

      const booking = new Booking({
        user: userId,
        vehicle: tempData.vehicleId,
        services: tempData.serviceIds,
        date: tempData.date,
        orderNumber,
        notes: tempData.notes,
        location: tempData.location,
        totalAmount: pricing.subtotal,
        pickupDropPrice: tempData.pickupDropPrice || 0,
        coupon: tempData.coupon || null,
        discountAmount: pricing.discountAmount,
        gstAmount: pricing.tax,
        finalAmount: pricing.total,
        paymentStatus: 'paid',
        status: 'CREATED',
        paymentId: paymentId,
        selectedBrands: tempData.selectedBrands,
        serviceQuantities: tempData.serviceQuantities,
        quoteServices: Array.isArray(tempData.quoteServices) ? tempData.quoteServices : [],
        carWash: {
          isCarWashService: !!tempData.isCarWashService || !!tempData.isEssentialsService,
          beforeWashPhotos: [],
          afterWashPhotos: [],
        },
        batteryTire: {
          isBatteryTireService: !!tempData.isBatteryTireService
        }
      });

      // Calculate platform commission (10%) based on final amount
      const commissionRate = 0.10;
      booking.platformFee = pricing.total * commissionRate;
      booking.merchantEarnings = pricing.total - booking.platformFee;

      await booking.save();

      // Increment coupon usage if coupon was applied
      if (tempData.coupon) {
        try {
          const coupon = await Coupon.findById(tempData.coupon);
          if (coupon) {
            coupon.usageCount += 1;
            await coupon.save();
          }
        } catch (couponError) {
          console.error('Error incrementing coupon usage:', couponError);
        }
      }
      
      // Emit socket update
      const populated = await Booking.findById(booking._id)
        .populate('user', 'id name email phone')
        .populate('vehicle')
        .populate('services')
        .populate('coupon')
        .populate('merchant', 'name email phone location')
        .populate('pickupDriver', 'name email phone')
        .populate('technician', 'name email phone')
        .populate('carWash.staffAssigned', 'name email phone');
      emitBookingUpdate(populated);
      
      return populated;
    } catch (error) {
      console.error('Error creating booking from temp data:', error);
      throw error;
    }
  }

  /**
   * Handle failed payment
   */
  async verifyPayment(orderId) {
    const paymentsResponse = await this.cashfree.PGOrderFetchPayments(orderId);
    const attempts = paymentsResponse?.data || [];
    if (!attempts.length) {
      return { status: 'PENDING', attempts: [] };
    }
    const finalAttempt = [...attempts].sort((a, b) => new Date(b.payment_time || 0) - new Date(a.payment_time || 0))[0];
    return { status: finalAttempt.payment_status, attempts, finalAttempt };
  }

  /**
   * Get payment details
   */
  async processOrderStatus(orderId) {
    const payment = await Payment.findOne({ orderId });
    if (!payment) throw new Error('Payment record not found');
    const order = await Order.findOne({ orderId });
    if (!order) throw new Error('Order record not found');

    if (order.expiresAt && order.expiresAt < new Date() && ['created', 'pending'].includes(order.paymentStatus)) {
      order.paymentStatus = 'expired';
      order.orderStatus = 'EXPIRED';
      payment.status = 'expired';
      await Promise.all([order.save(), payment.save()]);
      return { payment, order, booking: null };
    }

    const verify = await this.verifyPayment(orderId);
    const status = verify.status;
    let mappedStatus = 'pending';
    if (status === 'SUCCESS') mappedStatus = 'paid';
    if (status === 'FAILED') mappedStatus = 'failed';
    if (status === 'USER_DROPPED') mappedStatus = 'user_dropped';

    const expectedAmount = payment.expectedAmount ?? payment.amount;
    const gatewayAmount = extractGatewayPaidAmount(verify.finalAttempt);

    if (mappedStatus === 'paid' && gatewayAmount != null && !amountsMatch(expectedAmount, gatewayAmount)) {
      console.error(
        `Payment amount mismatch for order ${orderId}: expected ${expectedAmount}, gateway ${gatewayAmount}`
      );
      mappedStatus = 'failed';
      payment.failureReason = `Amount mismatch: expected ${expectedAmount}, received ${gatewayAmount}`;
    }

    payment.status = mappedStatus;
    payment.gatewayResponse = { ...(payment.gatewayResponse || {}), verification: verify };
    payment.cashfreePaymentId = verify.finalAttempt?.cf_payment_id || payment.cashfreePaymentId;
    payment.paymentMethod = verify.finalAttempt?.payment_method || payment.paymentMethod;
    payment.bankReference = verify.finalAttempt?.bank_reference || payment.bankReference;
    payment.transactionId = verify.finalAttempt?.cf_payment_id || payment.transactionId;

    order.paymentStatus = mappedStatus;
    if (mappedStatus === 'paid') order.orderStatus = 'PAID';
    await Promise.all([payment.save(), order.save()]);

    let booking = null;
    if (mappedStatus === 'paid') {
      if (!payment.bookingId && payment.metadata?.tempBookingData) {
        booking = await this.createBookingFromTempData(payment.metadata.tempBookingData, payment.userId, payment.transactionId || 'cashfree');
        payment.bookingId = booking._id;
        await payment.save();
      } else if (payment.bookingId) {
        booking = await Booking.findById(payment.bookingId);
        if (booking) {
          booking.paymentStatus = 'paid';
          booking.paymentId = payment.transactionId || payment.cashfreePaymentId;
          
          // Update booking with coupon and discount info from payment
          if (payment.coupon) {
            booking.coupon = payment.coupon;
            booking.discountAmount = payment.discountAmount || 0;
            // Recalculate finalAmount if not already correct
            booking.finalAmount = Math.max(0, (booking.totalAmount || payment.amount) - (payment.discountAmount || 0));
            
            // Increment coupon usage
            try {
              const coupon = await Coupon.findById(payment.coupon);
              if (coupon) {
                coupon.usageCount += 1;
                await coupon.save();
              }
            } catch (couponError) {
              console.error('Error incrementing coupon usage for existing booking:', couponError);
            }
          }

          const commissionRate = 0.1;
          const verifiedAmount = gatewayAmount ?? expectedAmount;
          booking.platformFee = verifiedAmount * commissionRate;
          booking.merchantEarnings = verifiedAmount - booking.platformFee;
          await booking.save();
          const populated = await Booking.findById(booking._id)
            .populate('user', 'id name email phone')
            .populate('vehicle')
            .populate('services')
            .populate('merchant', 'name email phone location')
            .populate('pickupDriver', 'name email phone')
            .populate('technician', 'name email phone')
            .populate('carWash.staffAssigned', 'name email phone');
          emitBookingUpdate(populated);
        }
      }
    }

    if (mappedStatus === 'paid' && booking) {
      try {
        const emailBooking = await Booking.findById(booking._id)
          .populate('user', 'id name email phone')
          .populate('vehicle');
        if (emailBooking?.user?.email) {
          const orderRef =
            emailBooking.orderNumber || String(emailBooking._id).slice(-8).toUpperCase();
          const paidEmail = getBookingStatusEmail('PAYMENT_RECEIVED', {
            customerName: emailBooking.user.name,
            bookingId: orderRef,
            vehicleNumber: emailBooking.vehicle?.licensePlate,
            amount: gatewayAmount ?? expectedAmount,
            referenceNumber: payment.cashfreePaymentId || payment.transactionId,
          });
          void sendEmail(emailBooking.user.email, paidEmail.subject, paidEmail.text, paidEmail.html).catch(() => {});
        }
      } catch (_) {}
    }

    return { payment, order, booking };
  }

  /**
   * Get user payments
   */
  async retryPayment(orderId, userId) {
    const order = await Order.findOne({ orderId, userId });
    if (!order) throw new Error('Order not found');
    if (order.retryCount >= this.maxRetryCount) throw new Error('Retry limit exceeded');
    if (order.paymentStatus === 'paid') throw new Error('Payment already completed');
    order.retryCount += 1;
    await order.save();
    return this.createOrder(userId, order.bookingId, order.amount, order.currency, null);
  }

  /**
   * Refund payment (optional advanced feature)
   */
  async refundPayment(paymentId, amount = null, reason = '') {
    const payment = await Payment.findById(paymentId);
    if (!payment || payment.status !== 'paid') {
      throw new Error('Payment not found or not eligible for refund');
    }
    const refundAmount = Number(amount || payment.amount);
    const refundRequest = {
      refund_amount: refundAmount,
      refund_id: `rfnd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      refund_note: reason || 'Admin initiated refund'
    };
    const response = await this.cashfree.PGOrderCreateRefund(payment.orderId, refundRequest);
    const refundData = response.data;
    await Refund.create({
      refundId: refundData.refund_id || refundRequest.refund_id,
      orderId: payment.orderId,
      paymentId: payment._id,
      amount: refundAmount,
      refundStatus: (refundData.refund_status || 'PENDING').toUpperCase(),
      reason,
      gatewayResponse: refundData
    });
    payment.status = refundAmount === payment.amount ? 'refunded' : 'partial_refund';
    payment.refundAmount += refundAmount;
    await payment.save();
    await Order.findOneAndUpdate(
      { orderId: payment.orderId },
      { isRefunded: payment.status === 'refunded', refundAmount: payment.refundAmount, paymentStatus: payment.status }
    );
    return { refund: refundData, payment };
  }

  async processWebhookEvent(event) {
    const orderId = event?.data?.order?.order_id || event?.order?.order_id || event?.order_id;
    const eventId = event?.cf_payment_id || event?.data?.payment?.cf_payment_id || `${event?.type || 'event'}_${orderId || 'unknown'}`;
    if (!orderId) return { processed: false, reason: 'Missing order_id' };
    const payment = await Payment.findOne({ orderId });
    if (!payment) return { processed: false, reason: 'Payment not found' };
    payment.webhookEvents = Array.isArray(payment.webhookEvents)
      ? payment.webhookEvents
      : [];
    if (payment.webhookEvents.some((e) => e.eventId === eventId)) {
      return { processed: false, reason: 'Already processed' };
    }
    const result = await this.processOrderStatus(orderId);
    payment.webhookEvents.push({ eventId, event: event?.type || 'cf_webhook' });
    await payment.save();
    return { processed: true, payment: result.payment };
  }
}

export default new PaymentService();
