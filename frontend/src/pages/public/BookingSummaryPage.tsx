import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Wrench, Car, CalendarClock, MapPin, AlertCircle, ArrowRight, Loader2, Phone } from 'lucide-react';
import { bookingService, BookingSummary } from '@/services/bookingService';
import { useAuthStore } from '@/store/authStore';

const inr = (n: number) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;
const SUPPORT_PHONE = '+91 91000 06020';

const PROGRESS = [
  { label: 'Booked', statuses: ['CREATED', 'ASSIGNED', 'ACCEPTED'] },
  { label: 'Pickup', statuses: ['REACHED_CUSTOMER', 'VEHICLE_PICKED', 'REACHED_MERCHANT'] },
  { label: 'Service', statuses: ['SERVICE_STARTED', 'SERVICE_COMPLETED', 'QC_PENDING', 'CAR_WASH_STARTED', 'CAR_WASH_COMPLETED'] },
  { label: 'Delivered', statuses: ['OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'] },
];
const progressIndex = (status: string) => {
  const i = PROGRESS.findIndex((p) => p.statuses.includes(status));
  return i < 0 ? 0 : i;
};

/**
 * Public booking summary opened from the WhatsApp/SMS link sent after an admin
 * books on the customer's behalf. "Sign in to track" goes to login and returns
 * to the booking's tracking page.
 */
const BookingSummaryPage: React.FC = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user, role } = useAuthStore();
  const [data, setData] = useState<BookingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bookingService
      .getBookingSummary(token)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.response?.data?.message || 'We could not load this booking.'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const trackPath = data ? `/track/${data._id}` : '/bookings';
  const signInToTrack = () => {
    if (user && role === 'customer') {
      navigate(trackPath);
      return;
    }
    // forceLogin: show the login form even if another role (e.g. admin) is signed in on this browser.
    navigate('/login', { state: { from: { pathname: trackPath }, forceLogin: true } });
  };

  const header = (
    <header className="bg-card border-b border-border">
      <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Same logo treatment as the public navbar on white (login page). */}
        <a href="/" className="w-28 h-10 sm:w-36 sm:h-12 flex items-center" aria-label="Carzzi home">
          <img
            src="/carzzilogo.webp"
            srcSet="/carzzilogo.webp 250w, /carzzilogo-original.png 514w"
            sizes="(max-width: 639px) 112px, 144px"
            alt="Carzzi"
            width={144}
            height={48}
            className="w-full h-full object-contain object-left brightness-0"
          />
        </a>
        <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`} className="text-sm font-semibold text-primary hover:underline">
          Help
        </a>
      </div>
    </header>
  );

  if (error) {
    return (
      <div className="min-h-screen bg-muted/30">
        {header}
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" aria-hidden />
          <h1 className="text-xl font-bold mt-4">Booking link unavailable</h1>
          <p className="text-muted-foreground mt-2">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/login', { state: { from: { pathname: '/bookings' } } })}
            className="mt-6 h-12 px-6 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            Sign in to see your bookings
          </button>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-muted/30">
        {header}
        <main className="max-w-2xl mx-auto px-4 py-16 flex justify-center" aria-busy="true">
          <Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="Loading booking" />
        </main>
      </div>
    );
  }

  const when = new Date(data.date);
  const step = progressIndex(data.status);
  const cancelled = data.status === 'CANCELLED';
  const subtotal = Number(data.totalAmount) || 0;
  const servicesAmount = Math.max(0, subtotal - (Number(data.pickupDropPrice) || 0));

  return (
    <div className="min-h-screen bg-muted/30 pb-40">
      {header}
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        {/* Status */}
        <section className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${cancelled ? 'bg-destructive/10' : 'bg-green-100'}`}>
              {cancelled ? <AlertCircle className="w-6 h-6 text-destructive" /> : <Check className="w-6 h-6 text-green-700" strokeWidth={3} />}
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {cancelled ? 'This booking was cancelled' : `${data.customerName ? `${data.customerName}, your` : 'Your'} service is booked`}
              </h1>
              {data.createdByAdmin && !cancelled && <p className="text-sm text-muted-foreground">Booked for you by the Carzzi team</p>}
            </div>
          </div>

          {!cancelled && (
            <ol className="flex items-center mt-5" aria-label="Booking progress">
              {PROGRESS.map((p, i) => (
                <li key={p.label} className="flex items-center flex-1 last:flex-none" aria-current={i === step ? 'step' : undefined}>
                  <div className="flex flex-col items-center gap-1.5 w-16">
                    <span className={`w-3 h-3 rounded-full ${i <= step ? 'bg-primary ring-4 ring-primary/15' : 'bg-muted-foreground/25'}`} />
                    <span className={`text-xs ${i <= step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{p.label}</span>
                  </div>
                  {i < PROGRESS.length - 1 && <span className={`flex-1 h-0.5 mb-5 ${i < step ? 'bg-primary' : 'bg-muted-foreground/20'}`} />}
                </li>
              ))}
            </ol>
          )}

          <div className="flex justify-between mt-4 pt-4 border-t border-dashed border-border text-sm text-muted-foreground">
            <span>Order <span className="font-mono font-semibold text-foreground">#{data.orderNumber}</span></span>
            {data.createdAt && <span>{new Date(data.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>}
          </div>
        </section>

        {/* Service + price */}
        <section className="bg-card border border-border rounded-2xl p-5" aria-labelledby="svc-h">
          <h2 id="svc-h" className="text-xs font-semibold text-muted-foreground tracking-wide mb-3">SERVICE</h2>
          <ul className="space-y-3">
            {data.services.map((s) => (
              <li key={s._id} className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Wrench className="w-5 h-5 text-primary" aria-hidden />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{s.name}</span>
                  <span className="block text-sm text-muted-foreground">{s.category}</span>
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 pt-4 border-t border-border space-y-1.5 text-sm tabular-nums">
            <div className="flex justify-between"><dt className="text-muted-foreground">Services</dt><dd>{inr(servicesAmount)}</dd></div>
            {data.pickupDropPrice > 0 && (
              <div className="flex justify-between"><dt className="text-muted-foreground">Pickup &amp; drop</dt><dd>{inr(data.pickupDropPrice)}</dd></div>
            )}
            {data.discountAmount > 0 && (
              <div className="flex justify-between text-green-700"><dt>Discount</dt><dd>−{inr(data.discountAmount)}</dd></div>
            )}
            {data.gstAmount > 0 && (
              <div className="flex justify-between"><dt className="text-muted-foreground">GST (18%)</dt><dd>{inr(data.gstAmount)}</dd></div>
            )}
            <div className="flex justify-between text-base font-bold pt-1">
              <dt>{data.isGeneralService ? 'Estimated total' : 'Total'}</dt>
              <dd className="text-primary">{inr(data.finalAmount)}</dd>
            </div>
          </dl>
          {data.paymentStatus !== 'paid' && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden />
              {data.isGeneralService
                ? 'Final bill after inspection · Pay after the service'
                : 'Payment pending · Sign in to pay in the app'}
            </p>
          )}
        </section>

        {/* Vehicle, schedule and pickup in one card with matching rows */}
        <section className="bg-card border border-border rounded-2xl p-5" aria-labelledby="details-h">
          <h2 id="details-h" className="text-xs font-semibold text-muted-foreground tracking-wide mb-1">BOOKING DETAILS</h2>
          <dl className="divide-y divide-border">
            {data.vehicle && (
              <div className="flex items-start gap-3 py-4">
                <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Car className="w-5 h-5 text-primary" aria-hidden />
                </span>
                <div className="flex-1 min-w-0">
                  <dt className="text-xs text-muted-foreground">Vehicle</dt>
                  <dd>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{data.vehicle.make} {data.vehicle.model}</span>
                      {data.vehicle.licensePlate && (
                        <span className="inline-flex items-center rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-semibold tracking-wider font-mono">
                          {data.vehicle.licensePlate}
                        </span>
                      )}
                    </span>
                    {(data.vehicle.variant || data.vehicle.fuelType) && (
                      <span className="block text-sm text-muted-foreground mt-0.5">
                        {[data.vehicle.variant, data.vehicle.fuelType].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </dd>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3 py-4">
              <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarClock className="w-5 h-5 text-primary" aria-hidden />
              </span>
              <div className="flex-1 min-w-0">
                <dt className="text-xs text-muted-foreground">Schedule</dt>
                <dd className="font-semibold">
                  {when.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                  <span className="text-muted-foreground font-normal"> · </span>
                  <span className="tabular-nums">{when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase()}</span>
                </dd>
              </div>
            </div>
            {data.address && (
              <div className="flex items-start gap-3 pt-4">
                <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-primary" aria-hidden />
                </span>
                <div className="flex-1 min-w-0">
                  <dt className="text-xs text-muted-foreground">Pickup address</dt>
                  <dd className="text-sm leading-relaxed">{data.address}</dd>
                </div>
              </div>
            )}
          </dl>
        </section>

        <p className="text-center text-sm text-muted-foreground pt-2">
          Need help?{' '}
          <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`} className="font-semibold text-primary inline-flex items-center gap-1 hover:underline">
            <Phone className="w-3.5 h-3.5" aria-hidden /> {SUPPORT_PHONE}
          </a>
        </p>
      </main>

      {/* Sticky sign-in CTA */}
      <div className="fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur border-t border-border">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-5">
          <button
            type="button"
            onClick={signInToTrack}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
          >
            {user && role === 'customer' ? 'Track your service' : 'Sign in to track your service'}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
          {!(user && role === 'customer') && data.maskedPhone && (
            <p className="text-center text-xs text-muted-foreground mt-2">
              Use your mobile number <span className="font-semibold text-foreground">+91 {data.maskedPhone}</span> — we’ll send an OTP
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingSummaryPage;
