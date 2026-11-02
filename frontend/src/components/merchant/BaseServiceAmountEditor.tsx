import React, { useEffect, useState } from 'react';
import { IndianRupee, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { bookingService, Booking } from '../../services/bookingService';
import { getBaseServiceOverride } from '@/lib/vehicleServicePricing';

interface BaseServiceAmountEditorProps {
  booking: Booking;
  onUpdate: () => void;
}

const LOCKED_STATUSES = ['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

/** Base amount currently on the booking: override, else total minus parts/labour/GST/pickup. */
const currentBaseAmount = (b: Booking): number => {
  const override = getBaseServiceOverride(b);
  if (override !== null) return override;
  const parts =
    b.billing?.partsTotal != null
      ? Number(b.billing.partsTotal) || 0
      : (b.parts || []).reduce((acc, p) => acc + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
  const rest =
    parts +
    (Number(b.billing?.labourCost) || 0) +
    (Number(b.billing?.gst) || 0) +
    (Number(b.billing?.pickupDropPrice) || Number(b.pickupDropPrice) || 0);
  return Math.max(0, (Number(b.totalAmount) || 0) - rest);
};

const BaseServiceAmountEditor: React.FC<BaseServiceAmountEditorProps> = ({ booking, onUpdate }) => {
  const base = currentBaseAmount(booking);
  const isOverridden = getBaseServiceOverride(booking) !== null;
  const locked = booking.paymentStatus === 'paid' || LOCKED_STATUSES.includes(booking.status);

  const [value, setValue] = useState(String(base));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(currentBaseAmount(booking)));
  }, [booking.baseServiceAmountOverride, booking.totalAmount]);

  const parsed = Number(value);
  const invalid = value.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 999999;
  const dirty = !invalid && parsed !== base;

  const save = async (amount: number | null) => {
    setSaving(true);
    try {
      await bookingService.updateBookingDetails(booking._id, { baseServiceAmount: amount });
      toast.success(amount === null ? 'Base service amount reset to standard price' : 'Base service amount updated');
      onUpdate();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update base service amount');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <label htmlFor="base-service-amount" className="text-sm font-medium block">
        Base Service Amount
      </label>
      <p className="text-xs text-muted-foreground">
        Change this if the inspection shows the service costs more or less than the standard price.
        The customer's bill and payment update automatically.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative w-full sm:w-56">
          <IndianRupee className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="base-service-amount"
            type="number"
            inputMode="decimal"
            min={0}
            max={999999}
            value={value}
            disabled={locked || saving}
            onChange={(e) => {
              if (e.target.value.replace('.', '').length > 8) return;
              setValue(e.target.value);
            }}
            aria-invalid={invalid}
            className="w-full h-11 pl-9 pr-3 border border-input rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={() => save(Math.round(parsed * 100) / 100)}
          disabled={locked || saving || !dirty}
          className="h-11 px-5 rounded-lg font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Update Amount'}
        </button>
        {isOverridden && !locked && (
          <button
            type="button"
            onClick={() => save(null)}
            disabled={saving}
            className="h-11 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to standard price
          </button>
        )}
      </div>
      {invalid && <p className="text-xs text-red-600">Enter an amount between 0 and 999999.</p>}
      {locked && (
        <p className="text-xs text-muted-foreground">Locked after the service is completed or paid.</p>
      )}
      {isOverridden && !locked && (
        <p className="text-xs text-muted-foreground">Set by merchant (differs from the standard price).</p>
      )}
    </div>
  );
};

export default BaseServiceAmountEditor;
