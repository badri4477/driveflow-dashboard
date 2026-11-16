import type { Booking } from '@/services/bookingService';

const refId = (ref: unknown): string | null => {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  const obj = ref as { _id?: unknown; id?: unknown };
  return obj._id != null ? String(obj._id) : obj.id != null ? String(obj.id) : null;
};

/** True when the booking is assigned to this staff member in any role (driver, technician, car wash). */
export const isBookingAssignedToStaff = (booking: Booking, staffId: string | null | undefined): boolean => {
  if (!staffId) return false;
  return [booking.pickupDriver, booking.technician, booking.carWash?.staffAssigned]
    .map(refId)
    .some((id) => id === String(staffId));
};
