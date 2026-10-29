import mongoose from 'mongoose';
import { generateOrderNumber } from '../utils/orderNumber.js';

const bookingSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Vehicle',
      index: true,
    },
    services: [{
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Service',
    }],
    date: {
      type: Date,
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      index: true,
      enum: [
        'CREATED', 
        'ASSIGNED', 
        'REACHED_CUSTOMER',
        'VEHICLE_PICKED', 
        'REACHED_MERCHANT', 
        'SERVICE_STARTED', 
        'SERVICE_COMPLETED', 
        'OUT_FOR_DELIVERY', 
        'DELIVERED', 
        'COMPLETED',
        'CANCELLED',
        // Car wash specific statuses
        'CAR_WASH_STARTED',
        'CAR_WASH_COMPLETED',
        // Battery and Tire specific statuses
        'STAFF_REACHED_MERCHANT',
        'PICKUP_BATTERY_TIRE',
        'INSTALLATION',
        'DELIVERY'
      ],
      default: 'CREATED',
    },
    inspection: {
      photos: [String],
      frontPhoto: String,
      backPhoto: String,
      leftPhoto: String,
      rightPhoto: String,
      damageReport: String,
      additionalParts: [{
        name: String,
        price: Number,
        quantity: { type: Number, default: 1 },
        approved: { type: Boolean, default: false },
        approvalStatus: {
          type: String,
          enum: ['Pending', 'Approved', 'Rejected'],
          default: 'Pending'
        },
        rejectionReason: String,
        image: String,
        oldImage: String,
      }],
      completedAt: Date,
    },
    delay: {
      isDelayed: { type: Boolean, default: false },
      reason: { 
        type: String, 
        enum: ['Waiting for parts', 'Customer approval pending', 'Other'] 
      },
      note: String,
      startTime: Date
    },
    serviceExecution: {
      jobStartTime: Date,
      jobEndTime: Date,
      beforePhotos: [String],
      duringPhotos: [String],
      afterPhotos: [String],
      serviceParts: [{
        name: String,
        price: Number,
        quantity: { type: Number, default: 1 },
        approved: { type: Boolean, default: false },
        approvalStatus: {
          type: String,
          enum: ['Pending', 'Approved', 'Rejected'],
          default: 'Pending'
        },
        rejectionReason: String,
        image: String,
        oldImage: String, // Image from inspection (before replacement)
        addedDuringService: { type: Boolean, default: true },
        fromInspection: { type: Boolean, default: false },
        inspectionPartId: String,
      }],
    },
    qc: {
      testRide: { type: Boolean, default: false },
      safetyChecks: { type: Boolean, default: false },
      noLeaks: { type: Boolean, default: false },
      noErrorLights: { type: Boolean, default: false },
      checklist: { type: Map, of: Boolean }, // Flexible checklist
      notes: String,
      completedAt: Date,
      completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    billing: {
      invoiceNumber: String,
      invoiceDate: Date,
      fileUrl: String, // Photo/PDF
      labourCost: { type: Number, default: 0 },
      gst: { type: Number, default: 0 },
      partsTotal: { type: Number, default: 0 },
      pickupDropPrice: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    revisit: {
      isRevisit: { type: Boolean, default: false },
      originalBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
      reason: String
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    pickupDropPrice: {
      type: Number,
      default: 0
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      default: null
    },
    discountAmount: {
      type: Number,
      default: 0
    },
    /** 18% GST on discounted subtotal for customer prepaid checkout */
    gstAmount: {
      type: Number,
      default: 0
    },
    finalAmount: {
      type: Number,
      required: true
    },
    selectedBrands: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    serviceQuantities: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    media: [{
      type: String, // URLs to images/videos
    }],
    prePickupPhotos: [String],
    parts: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
      name: {
        type: String, // Allow manual entry if not linked to a product
      },
      quantity: {
        type: Number,
        default: 1,
      },
      price: {
        type: Number, // Price at the time of usage
        required: true,
      },
      image: String,
    }],
    notes: {
      type: String,
    },
    location: {
      address: { type: String },
      lat: { type: Number },
      lng: { type: Number }
    },
    merchant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    pickupDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    assignedAt: {
      type: Date,
    },
    deliveryOtp: {
      code: { type: String, select: false },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
      verifiedAt: { type: Date },
      // Set when an admin overrides OTP verification (e.g. customer can't
      // receive/enter the OTP) instead of the customer actually entering it.
      verifiedByAdmin: { type: Boolean, default: false },
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    // Set when an admin marks the booking DELIVERED and the payment is
    // recorded manually instead of through Cashfree.
    // Set when the merchant saves health stats on this order (see
    // updateBookingDetails). Health values themselves live on the vehicle.
    healthSavedAt: { type: Date },
    manualPayment: {
      markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      markedAt: { type: Date },
      amount: { type: Number },
    },
    paymentId: {
      type: String, // Cash Free Payment payment ID
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    merchantEarnings: {
      type: Number,
      default: 0,
    },
    // Car wash specific fields
    carWash: {
      isCarWashService: { type: Boolean, default: false },
      beforeWashPhotos: [String], // 4 photos before wash
      afterWashPhotos: [String],  // 4 photos after wash
      washStartedAt: Date,
      washCompletedAt: Date,
      staffAssigned: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
      },
    },
    // Battery and Tire specific fields
    batteryTire: {
      isBatteryTireService: { type: Boolean, default: false },
      merchantApproval: {
        status: {
          type: String,
          enum: ['PENDING', 'APPROVED', 'REJECTED'],
          default: 'PENDING'
        },
        price: { type: Number },
        image: { type: String },
        notes: { type: String },
        approvedAt: { type: Date },
        rejectedAt: { type: Date }
      },
      warranty: {
        name: { type: String },
        price: { type: Number },
        warrantyMonths: { type: Number },
        image: { type: String },
        addedAt: { type: Date },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      }
    },
  },
  {
    timestamps: true,
  }
);

bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ merchant: 1, createdAt: -1 });
bookingSchema.index({ pickupDriver: 1, createdAt: -1 });
bookingSchema.index({ technician: 1, createdAt: -1 });
bookingSchema.index({ vehicle: 1, createdAt: -1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ 'carWash.staffAssigned': 1, createdAt: -1 });
bookingSchema.index({ 'carWash.isCarWashService': 1, status: 1 });

bookingSchema.pre('save', async function () {
  if (!this.isNew) return;
  if (this.orderNumber != null && String(this.orderNumber).trim() !== '') return;
  this.orderNumber = await generateOrderNumber(this.createdAt || new Date());
});

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;
