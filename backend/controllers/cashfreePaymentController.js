import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { Cashfree } from 'cashfree-pg';
import mongoose from 'mongoose';
import paymentService from '../services/paymentService.js';
import { logAudit } from './auditController.js';
import { isValidDate } from '../utils/validation.js';
import { sanitizeBooking } from './bookingController.js';
import Booking from '../models/Booking.js';
import { resolvePaymentAmount } from '../utils/resolvePaymentAmount.js';

export const createOrder = async (req, res) => {
  try {
    const { bookingId, currency = 'INR', tempBookingData } = req.body;
    const userId = req.user._id;
    const safeBookingId = bookingId && mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null;

    const resolved = await resolvePaymentAmount({
      bookingId: safeBookingId,
      userId,
      tempBookingData: tempBookingData || null,
    });
    const orderAmount = resolved.amount;
    const serverTempData = resolved.sanitizedTempData;

    const orderData = await paymentService.createOrder(
      userId,
      safeBookingId,
      orderAmount,
      currency,
      serverTempData
    );
    await logAudit({
      user: userId,
      action: 'CREATE_CASHFREE_ORDER',
      targetModel: 'Payment',
      targetId: orderData.paymentId,
      details: {
        orderId: orderData.orderId,
        status: 'created',
        amount: orderAmount,
        bookingId: safeBookingId,
      },
      ipAddress: req.ip
    });
    res.status(201).json({ success: true, message: 'Cashfree order created successfully', data: orderData });
  } catch (error) {
    console.error('Create order error in controller:', error);
    const gatewayMessage = error.response?.data?.message || error.response?.data?.code;
    res.status(400).json({
      success: false,
      message: gatewayMessage || error.message || 'Failed to create order'
    });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const orderId = req.body.orderId || req.body.cashfree_order_id;
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'orderId is required',
      });
    }
    const result = await paymentService.processOrderStatus(orderId);
    const payment = result.payment;
    await logAudit({
      user: req.user._id,
      action: 'VERIFY_CASHFREE_PAYMENT',
      targetModel: 'Payment',
      targetId: payment?._id,
      details: {
        orderId: payment?.orderId ?? orderId,
        status: payment?.status,
        amount: payment?.amount,
        bookingId: result.booking?._id ?? payment?.bookingId ?? null,
      },
      ipAddress: req.ip
    });
    if (result && result.booking) {
      result.booking = sanitizeBooking(result.booking, req.user);
    }
    const isPaid = payment?.status === 'paid';
    res.json({
      success: isPaid,
      message: isPaid
          ? 'Payment status synced'
          : `Payment not completed (status: ${payment?.status || 'unknown'})`,
      data: {
        ...result,
        status: payment?.status || 'pending',
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Payment verification failed' });
  }
};

export const handleWebhook = async (req, res) => {
  try {
    Cashfree.PGVerifyWebhookSignature(
      req.cashfreeSignature,
      req.rawBody,
      req.cashfreeTimestamp
    );
    const result = await paymentService.processWebhookEvent(req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Cashfree webhook error:', error);
    res.status(400).json({ success: false, message: error.message || 'Webhook processing failed' });
  }
};

export const getPaymentStatus = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('bookingId').populate('userId', 'name email phone');
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to get payment status' });
  }
};

export const retryPayment = async (req, res) => {
  try {
    const data = await paymentService.retryPayment(req.body.orderId, req.user._id);
    res.json({ success: true, message: 'Retry payment session generated', data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to retry payment' });
  }
};

export const processRefund = async (req, res) => {
  try {
    const { paymentId, amount, reason } = req.body;
    const result = await paymentService.refundPayment(paymentId, amount, reason);
    res.json({ success: true, message: 'Refund initiated successfully', data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to process refund' });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const payments = await Payment.find({ userId: req.user._id }).populate('bookingId').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    const total = await Payment.countDocuments({ userId: req.user._id });
    res.json({ success: true, data: payments, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to get payment history' });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch orders' });
  }
};

// Admin payment-list row for a booking that has no matching Payment document.
const toBookingRow = (b, status) => ({
  _id: `booking_${b._id}`,
  orderId: b.orderNumber || String(b._id).slice(-8).toUpperCase(),
  amount: b.manualPayment?.amount ?? b.finalAmount ?? b.totalAmount ?? 0,
  status,
  createdAt: b.manualPayment?.markedAt || b.updatedAt,
  userId: b.user,
  user: b.user,
  bookingId: b,
  awaitingPayment: status === 'pending',
  manualPayment: status === 'paid' && !!b.manualPayment?.markedAt,
});

export const getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;

    // Validate date fields if provided
    if (startDate && !isValidDate(startDate)) {
      return res.status(400).json({ success: false, message: 'Invalid start date' });
    }
    if (endDate && !isValidDate(endDate)) {
      return res.status(400).json({ success: false, message: 'Invalid end date' });
    }
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (end < start) {
        return res.status(400).json({ success: false, message: 'End date cannot be before start date' });
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const filter = {};
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    const payments = await Payment.find(filter).populate('userId', 'name email phone').populate('bookingId').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    let total = await Payment.countDocuments(filter);

    // Bookings whose service is completed but not yet paid have no Payment
    // document until the customer starts checkout — surface them as
    // "pending" so admin sees what customers owe (page 1 only).
    let awaiting = [];
    if (Number(page) === 1 && (!status || status === 'pending')) {
      const openPaymentBookingIds = await Payment.distinct('bookingId', {
        status: { $in: ['created', 'attempted', 'pending'] },
        bookingId: { $ne: null },
      });
      const bookingFilter = {
        status: { $in: ['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'] },
        paymentStatus: { $ne: 'paid' },
        _id: { $nin: openPaymentBookingIds },
      };
      if (filter.createdAt) bookingFilter.updatedAt = filter.createdAt;

      const bookings = await Booking.find(bookingFilter)
        .populate('user', 'name email phone')
        .sort({ updatedAt: -1 })
        .limit(100);

      awaiting = bookings.map((b) => toBookingRow(b, 'pending'));
      total += awaiting.length;
    }

    // Paid bookings with no paid Payment document (admin marked DELIVERED
    // = settled offline, or the gateway record was removed) — show as paid.
    if (Number(page) === 1 && (!status || status === 'paid')) {
      const paidPaymentBookingIds = await Payment.distinct('bookingId', {
        status: 'paid',
        bookingId: { $ne: null },
      });
      const bookingFilter = {
        paymentStatus: 'paid',
        _id: { $nin: paidPaymentBookingIds },
      };
      if (filter.createdAt) bookingFilter.updatedAt = filter.createdAt;

      const bookings = await Booking.find(bookingFilter)
        .populate('user', 'name email phone')
        .sort({ updatedAt: -1 })
        .limit(100);

      const paidRows = bookings.map((b) => toBookingRow(b, 'paid'));
      awaiting = [...awaiting, ...paidRows];
      total += paidRows.length;
    }

    const stats = await Payment.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          successAmount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
          refundedAmount: { $sum: '$refundAmount' },
          count: { $sum: 1 }
        }
      }
    ]);
    res.json({ success: true, data: [...awaiting, ...payments], pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) }, stats: stats[0] || {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch payments' });
  }
};
