import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, History } from 'lucide-react';
import { toast } from 'sonner';
import { bookingService, Booking, OverrideLines } from '@/services/bookingService';
import { getBaseServiceOverride } from '@/lib/vehicleServicePricing';

interface TotalOverrideCardProps {
  booking: Booking;
  onUpdated: (booking: Booking) => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const formatInr = (n: number) => `₹${round2(n).toLocaleString('en-IN')}`;

const LINE_FIELDS: { key: keyof OverrideLines; label: string }[] = [
  { key: 'baseService', label: 'Base Service' },
  { key: 'partsTotal', label: 'Parts Total' },
  { key: 'labourCost', label: 'Labour Cost' },
  { key: 'pickupDrop', label: 'Pickup/Drop' },
  { key: 'gst', label: 'GST' },
];

/** Bill lines currently on the booking (same fields the merchant bill uses). */
const currentLines = (b: Booking): OverrideLines => {
  const partsTotal =
    b.billing?.partsTotal != null && Number(b.billing.partsTotal) > 0
      ? Number(b.billing.partsTotal)
      : (b.parts || []).reduce((acc, p) => acc + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
  const labourCost = Number(b.billing?.labourCost) || 0;
  const gst = Number(b.billing?.gst) || 0;
  const pickupDrop = Number(b.billing?.pickupDropPrice) || Number(b.pickupDropPrice) || 0;
  const baseService =
    getBaseServiceOverride(b) ??
    Math.max(0, (Number(b.totalAmount) || 0) - partsTotal - labourCost - gst - pickupDrop);
  return { baseService, partsTotal, labourCost, pickupDrop, gst };
};

const toForm = (l: OverrideLines) =>
  Object.fromEntries(LINE_FIELDS.map(({ key }) => [key, String(round2(l[key]))])) as Record<keyof OverrideLines, string>;

/** Admin control inside Payment Info: edit each bill line of a general service order. */
const TotalOverrideCard: React.FC<TotalOverrideCardProps> = ({ booking, onUpdated }) => {
  const override = booking.totalPriceOverride;
  const isOverridden = override?.amount != null;
  const discount = Number(booking.discountAmount) || 0;
  const history = [...(override?.history || [])].reverse();

  const [form, setForm] = useState(() => toForm(currentLines(booking)));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setForm(toForm(currentLines(booking)));
    setReason('');
    setSubmitted(false);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.totalAmount, booking.finalAmount, booking.baseServiceAmountOverride, override?.amount]);

  const parsed = useMemo(() => {
    const out = {} as OverrideLines;
    LINE_FIELDS.forEach(({ key }) => { out[key] = Number(form[key]); });
    return out;
  }, [form]);
  const lineErrors = LINE_FIELDS.filter(({ key }) => {
    const v = parsed[key];
    return form[key].trim() === '' || !Number.isFinite(v) || v < 0 || v > 999999;
  }).map(({ key }) => key);
  const total = lineErrors.length ? 0 : round2(LINE_FIELDS.reduce((acc, { key }) => acc + parsed[key], 0));
  const payable = Math.max(0, round2(total - discount));
  const calculatedPayable = isOverridden
    ? Number(override?.calculatedFinal ?? booking.finalAmount) || 0
    : Number(booking.finalAmount ?? booking.totalAmount) || 0;
  const reasonError: string | null = null;
  const totalError = !lineErrors.length && payable < 1 ? 'The total must be at least ₹1.' : null;

  // Paid orders are settled: nothing to override, so hide the control.
  if (booking.paymentStatus === 'paid') return null;
  const locked = booking.status === 'CANCELLED';

  const save = async () => {
    setSubmitted(true);
    if (lineErrors.length || reasonError || totalError) return;
    setSaving(true);
    try {
      const updated = await bookingService.setTotalPriceOverride(booking._id, {
        lines: {
          baseService: round2(parsed.baseService),
          partsTotal: round2(parsed.partsTotal),
          labourCost: round2(parsed.labourCost),
          pickupDrop: round2(parsed.pickupDrop),
          gst: round2(parsed.gst),
        },
        reason: reason.trim() || undefined,
      });
      onUpdated(updated);
      toast.success('Price updated everywhere. Customer notified.');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update price');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const updated = await bookingService.setTotalPriceOverride(booking._id, {
        reset: true,
        reason: reason.trim() || undefined,
      });
      onUpdated(updated);
      toast.success('Price reset to calculated values');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to reset price');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="pt-4 mt-2 border-t border-border space-y-4" aria-labelledby="override-total-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h4 id="override-total-heading" className="text-sm font-semibold">
          {isOverridden ? 'Price set by admin' : 'Price override'}
        </h4>
        {isOverridden && (
          <span className="text-xs text-muted-foreground">
            Calculated <span className="line-through tabular-nums">{formatInr(calculatedPayable)}</span>
          </span>
        )}
      </div>
      {isOverridden && override?.reason && (
        <p className="text-xs text-muted-foreground">Reason: {override.reason}</p>
      )}

      {locked ? (
        <p className="text-xs text-muted-foreground">Locked: cancelled orders cannot be repriced.</p>
      ) : !editing ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-10 px-4 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors"
          >
            {isOverridden ? 'Edit price' : 'Override price'}
          </button>
          {isOverridden && (
            <button
              type="button"
              onClick={reset}
              disabled={saving}
              className="h-10 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {saving ? 'Resetting...' : 'Reset to calculated price'}
            </button>
          )}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-2">
            {LINE_FIELDS.map(({ key, label }) => {
              const id = `override-${key}`;
              const hasError = submitted && lineErrors.includes(key);
              return (
                <div key={key} className="flex items-center justify-between gap-3">
                  <label htmlFor={id} className="text-sm text-muted-foreground">{label}</label>
                  <div className="relative w-36">
                    <input
                      id={id}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={form[key]}
                      disabled={saving}
                      onChange={(e) => {
                        // Text field (not type=number) so the mouse wheel scrolls the page
                        // instead of changing the amount. Digits and one decimal point only.
                        const next = e.target.value;
                        if (!/^\d{0,6}(\.\d{0,2})?$/.test(next)) return;
                        setForm((f) => ({ ...f, [key]: next }));
                      }}
                      aria-invalid={hasError}
                      className="w-full h-10 px-3 border border-input rounded-md text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60 aria-[invalid=true]:border-red-500"
                    />
                  </div>
                </div>
              );
            })}
            {submitted && lineErrors.length > 0 && (
              <p className="text-xs text-red-600">Each amount must be between 0 and 999999.</p>
            )}
          </div>

          <dl className="space-y-1 text-sm border-t border-border pt-2">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="font-semibold tabular-nums">{formatInr(total)}</dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums text-green-600">−{formatInr(discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="font-medium">Customer pays</dt>
              <dd className="font-bold tabular-nums text-primary">{formatInr(payable)}</dd>
            </div>
          </dl>
          {submitted && totalError && <p className="text-xs text-red-600">{totalError}</p>}

          <div className="space-y-1">
            <label htmlFor="override-reason" className="text-sm font-medium block">Reason <span className="font-normal text-muted-foreground">(optional)</span></label>
            <textarea
              id="override-reason"
              rows={2}
              maxLength={500}
              value={reason}
              disabled={saving}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={submitted && !!reasonError}
              aria-describedby="override-reason-error"
              placeholder="e.g. Goodwill discount agreed with customer"
              className="w-full px-3 py-2 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
            />
            {submitted && reasonError && (
              <p id="override-reason-error" className="text-xs text-red-600">{reasonError}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="h-10 px-4 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(toForm(currentLines(booking)));
                setReason('');
                setSubmitted(false);
                setEditing(false);
              }}
              className="h-10 px-4 rounded-lg text-sm font-medium border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <History className="w-4 h-4 text-muted-foreground" /> History
          </h4>
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {history.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="text-xs">
                <p>
                  <span className="font-medium">
                    {entry.action === 'set' ? 'Set to' : 'Reset to'} {formatInr(Number(entry.amount))}
                  </span>
                  {entry.previousAmount != null && (
                    <span className="text-muted-foreground"> (was {formatInr(Number(entry.previousAmount))})</span>
                  )}
                </p>
                {entry.lines && (
                  <p className="text-muted-foreground">
                    {LINE_FIELDS.map(({ key, label }) => `${label} ${formatInr(Number(entry.lines?.[key]) || 0)}`).join(' · ')}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {entry.byName || 'Admin'} · {new Date(entry.at).toLocaleString('en-IN')}
                </p>
                {entry.reason && <p className="text-muted-foreground">“{entry.reason}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default TotalOverrideCard;
