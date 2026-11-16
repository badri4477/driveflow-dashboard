import api from './api';
import { Vehicle } from './vehicleService';
import { Service } from './serviceService';

export interface OverrideLines {
  baseService: number;
  partsTotal: number;
  labourCost: number;
  pickupDrop: number;
  gst: number;
}

export interface TotalPriceOverrideEntry {
  action: 'set' | 'reset';
  amount?: number;
  previousAmount?: number;
  calculatedAmount?: number;
  lines?: OverrideLines;
  reason?: string;
  byName?: string;
  at: string;
}

export interface TotalPriceOverride {
  amount: number | null;
  reason?: string;
  calculatedTotal?: number;
  calculatedFinal?: number;
  lines?: OverrideLines;
  setAt?: string;
  history?: TotalPriceOverrideEntry[];
}

export interface AdminCustomerResult {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  addresses?: { label?: string; address: string; lat?: number; lng?: number }[];
  vehicles: { _id: string; make: string; model: string; variant?: string; fuelType?: string; licensePlate: string; year?: number }[];
}

export interface AdminCreateBookingPayload {
  customer: { userId: string } | { name: string; phone: string; email?: string };
  vehicle: { vehicleId: string } | { make: string; model: string; variant?: string; fuelType?: string; licensePlate: string; frontTyres?: string; rearTyres?: string };
  serviceIds: string[];
  selectedBrands?: Record<string, string>;
  serviceQuantities?: Record<string, number>;
  date: string;
  location: { address: string; lat?: number; lng?: number };
  notes?: string;
  merchantId?: string;
}

export interface BookingSummary {
  _id: string;
  orderNumber?: string;
  status: string;
  date: string;
  createdAt?: string;
  createdByAdmin: boolean;
  customerName?: string;
  maskedPhone?: string;
  services: { _id: string; name: string; category: string }[];
  isGeneralService: boolean;
  pickupDropPrice: number;
  totalAmount: number;
  discountAmount: number;
  gstAmount: number;
  finalAmount: number;
  paymentStatus: string;
  vehicle?: { make: string; model: string; variant?: string; fuelType?: string; licensePlate?: string };
  address?: string;
}

export interface Booking {
  _id: string;
  orderNumber?: string | number;
  user: string | { _id: string; name: string; email: string; phone?: string };
  vehicle: Vehicle | string;
  services: Service[] | string[];
  date: string;
  status: 'CREATED' | 'ASSIGNED' | 'ACCEPTED' | 'REACHED_CUSTOMER' | 'VEHICLE_PICKED' | 'REACHED_MERCHANT' | 'SERVICE_STARTED' | 'SERVICE_COMPLETED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'CAR_WASH_STARTED' | 'CAR_WASH_COMPLETED' | 'STAFF_REACHED_MERCHANT' | 'PICKUP_BATTERY_TIRE' | 'INSTALLATION' | 'DELIVERY' | 'On Hold' | 'MERCHANT_INSPECTION' | 'PENDING_APPROVAL';
  totalAmount: number;
  finalAmount: number;
  gstAmount?: number;
  discountAmount?: number;
  coupon?: any;
  pickupDropPrice?: number;
  /** True when an admin booked this order on the customer's behalf. */
  createdByAdmin?: boolean;
  /** Merchant-set base service price (inspection). Overrides the catalogue price when set. */
  baseServiceAmountOverride?: number | null;
  /** Admin override of the payable total (general service). Customers only receive `amount`. */
  totalPriceOverride?: TotalPriceOverride | null;
  selectedBrands?: Record<string, string>;
  serviceQuantities?: Record<string, number>;
  notes?: string;
  location?: {
    address: string;
    lat?: number;
    lng?: number;
  };
  paymentStatus: 'pending' | 'paid' | 'failed';
  paymentId?: string;
  createdAt: string;
  prePickupPhotos?: string[];
  merchant?: { 
    _id: string; 
    name: string; 
    email: string; 
    phone?: string;
    location?: {
      lat?: number;
      lng?: number;
      address?: string;
    };
  };
  pickupDriver?: { _id: string; name: string; email: string; phone?: string };
  technician?: { _id: string; name: string; email: string; phone?: string };
  assignedAt?: string;
  media?: string[];
  parts?: {
    product?: string | { _id: string; name: string; price: number };
    name?: string;
    quantity: number;
    price: number;
  }[];
  carWash?: {
    isCarWashService: boolean;
    beforeWashPhotos: string[];
    afterWashPhotos: string[];
    washStartedAt?: string;
    washCompletedAt?: string;
    staffAssigned?: { _id: string; name: string; email: string; phone?: string };
  };
  batteryTire?: {
    isBatteryTireService: boolean;
    merchantApproval: {
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
      price?: number;
      image?: string;
      notes?: string;
      approvedAt?: string;
      rejectedAt?: string;
    };
    warranty?: {
      name: string;
      price: number;
      warrantyMonths: number;
      image?: string;
      addedAt?: string;
      addedBy?: { _id: string; name: string; email: string };
    };
  };
  inspection?: {
    photos?: string[];
    frontPhoto?: string;
    backPhoto?: string;
    leftPhoto?: string;
    rightPhoto?: string;
    damageReport?: string;
    additionalParts?: { 
      name: string; 
      price: number; 
      quantity: number; 
      approved: boolean; 
      approvalStatus?: 'Pending' | 'Approved' | 'Rejected'; 
      image?: string; 
      oldImage?: string 
    }[];
    completedAt?: string;
  };
  delay?: {
    isDelayed: boolean;
    reason: string;
    note?: string;
    startTime?: string;
    previousStatus?: string;
  };
  serviceExecution?: {
    jobStartTime?: string;
    jobEndTime?: string;
    beforePhotos?: string[];
    duringPhotos?: string[];
    afterPhotos?: string[];
    serviceParts?: { 
      name: string; 
      price: number; 
      quantity: number; 
      approved: boolean; 
      approvalStatus?: 'Pending' | 'Approved' | 'Rejected'; 
      image?: string; 
      oldImage?: string;
      addedDuringService?: boolean;
      fromInspection?: boolean;
      inspectionPartId?: string;
    }[];
  };
  qc?: {
    testRide: boolean;
    safetyChecks: boolean;
    noLeaks: boolean;
    noErrorLights: boolean;
    checklist?: Record<string, boolean>;
    notes?: string;
    completedAt?: string;
    completedBy?: string;
  };
  billing?: {
    invoiceNumber: string;
    invoiceDate: string;
    fileUrl: string;
    labourCost: number;
    gst: number;
    partsTotal: number;
    pickupDropPrice: number;
    total: number;
  };
  revisit?: {
    isRevisit: boolean;
    originalBookingId: string;
    reason: string;
  };
  deliveryOtp?: {
    code?: string;
    expiresAt?: string;
    attempts?: number;
    verifiedAt?: string | null;
  };
}

export interface BookingDetailsUpdate {
  media?: string[];
  parts?: Booking['parts'];
  notes?: Booking['notes'];
  inspection?: Booking['inspection'];
  delay?: Booking['delay'];
  serviceExecution?: Booking['serviceExecution'];
  qc?: Booking['qc'];
  billing?: Booking['billing'];
  revisit?: Booking['revisit'];
  prePickupPhotos?: Booking['prePickupPhotos'];
  carWash?: Booking['carWash'];
  /** Merchant override of the base service amount; null clears it. */
  baseServiceAmount?: number | null;
}

export interface SlotAvailabilityResponse {
  date: string;
  allSlots: string[];
  availableSlots: string[];
  blockedSlots?: string[];
  bookedSlots?: string[];
}

export const bookingService = {
  createBooking: async (data: {
    vehicleId: string;
    serviceIds: string[];
    date: string;
    notes?: string;
    selectedBrands?: Record<string, string>;
    serviceQuantities?: Record<string, number>;
    location?: {
      address: string;
      lat?: number;
      lng?: number;
    };
  }) => {
    const response = await api.post('/bookings', data);
    return response.data;
  },

  getMyBookings: async () => {
    const response = await api.get('/bookings/mybookings');
    return response.data;
  },

  getAvailableSlots: async (date: string, category: string = 'All'): Promise<SlotAvailabilityResponse> => {
    const response = await api.get('/bookings/available-slots', { params: { date, category } });
    return response.data;
  },

  /** Public: booking summary from the signed link sent to the customer. */
  getBookingSummary: async (token: string): Promise<BookingSummary> => {
    const response = await api.get(`/bookings/summary/${encodeURIComponent(token)}`);
    return response.data;
  },

  /** Admin: search customers (name/phone/email) with their saved vehicles. */
  searchCustomersForBooking: async (q: string): Promise<AdminCustomerResult[]> => {
    const response = await api.get('/bookings/admin/customers', { params: { q } });
    return response.data;
  },

  /** Admin: create a booking for a customer (new customer/vehicle created in the same request). */
  adminCreateBooking: async (data: AdminCreateBookingPayload): Promise<Booking & { summaryUrl?: string }> => {
    const response = await api.post('/bookings/admin/create', data);
    return response.data;
  },

  getAdminSlots: async (date: string, category: string = 'All'): Promise<{ date: string; category: string; allSlots: string[]; blockedSlots: string[]; bookedSlots: string[] }> => {
    const response = await api.get('/bookings/admin/slots', { params: { date, category } });
    return response.data;
  },

  updateAdminBlockedSlots: async (date: string, blockedSlots: string[], category: string = 'All') => {
    const response = await api.put('/bookings/admin/slots', { date, blockedSlots, category });
    return response.data;
  },

  getAvailableServicePincodes: async (): Promise<{ availablePincodes: string[] }> => {
    const response = await api.get('/bookings/available-service-pincodes');
    return response.data;
  },

  updateAvailableServicePincodes: async (availablePincodes: string[]) => {
    const response = await api.put('/bookings/admin/available-service-pincodes', { availablePincodes });
    return response.data;
  },

  // Admin/Garage
  getAllBookings: async () => {
    const response = await api.get('/bookings');
    return response.data;
  },

  getUserBookings: async (userId: string) => {
    const response = await api.get(`/bookings/user/${userId}`);
    return response.data;
  },

  getVehicleBookings: async (vehicleId: string) => {
    const response = await api.get(`/bookings/vehicle/${vehicleId}`);
    return response.data;
  },

  getMerchantBookings: async (merchantId: string) => {
    const response = await api.get(`/bookings/merchant/${merchantId}`);
    return response.data;
  },

  getBookingInvoice: async (id: string) => {
    const response = await api.get(`/bookings/${id}/invoice`, {
      responseType: 'blob'
    });
    return response.data;
  },

  /** Admin-configurable, per-category invoice availability (see AdminBookingsPage). */
  getInvoiceSettings: async (): Promise<{ general: boolean; carWash: boolean; tyres: boolean; battery: boolean }> => {
    const response = await api.get('/bookings/invoice-settings');
    return response.data;
  },

  getBookingById: async (id: string) => {
    const response = await api.get(`/bookings/${id}`);
    return response.data;
  },

  updateBookingStatus: async (id: string, status: string) => {
    const response = await api.put(`/bookings/${id}/status`, { status });
    return response.data;
  },

  generateDeliveryOtp: async (id: string) => {
    const response = await api.post(`/bookings/${id}/generate-otp`, {});
    return response.data;
  },

  verifyDeliveryOtp: async (id: string, otp: string) => {
    const response = await api.post(`/bookings/${id}/verify-otp`, { otp });
    return response.data;
  },

  assignBooking: async (id: string, data: { 
    merchantId?: string; 
    driverId?: string; 
    technicianId?: string; 
    slot?: string; 
    carWashStaffId?: string;
    assignedAt?: string;
  }) => {
    const response = await api.put(`/bookings/${id}/assign`, data);
    return response.data;
  },

  /** Admin: override each bill line (general service) with a reason, or reset. */
  setTotalPriceOverride: async (
    id: string,
    data: { lines: OverrideLines; reason?: string } | { reset: true; reason?: string }
  ) => {
    const response = await api.put(`/bookings/${id}/total-override`, data);
    return response.data;
  },

  updateBookingDetails: async (id: string, data: BookingDetailsUpdate) => {
    const response = await api.put(`/bookings/${id}/details`, data);
    return response.data;
  },

  // Battery/Tire specific
  batteryTireApproval: async (id: string, data: { status: 'APPROVED' | 'REJECTED'; price?: number; image?: string; notes?: string }) => {
    const response = await api.put(`/bookings/${id}/battery-tire-approval`, data);
    return response.data;
  },

  addWarranty: async (id: string, data: { name: string; price: number; warrantyMonths: number; image?: string }) => {
    const response = await api.put(`/bookings/${id}/warranty`, data);
    return response.data;
  },
};
