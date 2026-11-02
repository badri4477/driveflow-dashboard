import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, CreditCard, Loader2, XCircle } from 'lucide-react';

import { paymentService } from '@/services/paymentService';

type PaymentStatusLocationState = {
  success?: boolean;
  title?: string;
  message?: string;
  bookingId?: string;
  retryTo?: string;
  primaryTo?: string;
};

type StatusState = {
  loading: boolean;
  success: boolean;
  title: string;
  message: string;
  bookingId?: string;
  retryTo?: string;
  primaryTo?: string;
};

const PaymentStatusPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const routeState = (location.state || {}) as PaymentStatusLocationState;

  const initialState = useMemo<StatusState>(() => {
    if (typeof routeState.success === 'boolean') {
      return {
        loading: false,
        success: routeState.success,
        title: routeState.title || (routeState.success ? 'Payment successful' : 'Payment failed'),
        message:
          routeState.message ||
          (routeState.success
            ? 'Your payment was completed successfully.'
            : 'Your payment could not be completed.'),
        bookingId: routeState.bookingId,
        retryTo: routeState.retryTo,
        primaryTo: routeState.primaryTo,
      };
    }

    return {
      loading: true,
      success: false,
      title: 'Verifying payment',
      message: 'Please wait while we confirm your payment status.',
      retryTo: '/payment',
      primaryTo: '/customer/dashboard',
    };
  }, [routeState]);

  const [status, setStatus] = useState<StatusState>(initialState);

  useEffect(() => {
    if (typeof routeState.success === 'boolean') return;

    const orderId = searchParams.get('order_id') || searchParams.get('orderId');
    if (!orderId) {
      setStatus({
        loading: false,
        success: false,
        title: 'Payment status unavailable',
        message: 'We could not find the payment reference needed to verify this transaction.',
        retryTo: '/payment',
        primaryTo: '/customer/dashboard',
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await paymentService.verifyPayment({ orderId });
        if (cancelled) return;

        const paymentStatus = result?.data?.status;
        const bookingId = result?.data?.booking?._id || result?.data?.payment?.bookingId;
        const isPaid = result?.success === true && paymentStatus === 'paid';

        setStatus({
          loading: false,
          success: isPaid,
          title: isPaid ? 'Payment successful' : 'Payment not completed',
          message: isPaid
            ? 'Your payment has been verified successfully.'
            : paymentStatus === 'user_dropped'
              ? 'The payment was cancelled before completion.'
              : paymentStatus === 'failed'
                ? 'The payment failed. Please try again.'
                : `The payment is currently ${paymentStatus || 'unavailable'}.`,
          bookingId,
          retryTo: bookingId ? `/track/${bookingId}` : '/payment',
          primaryTo: bookingId ? `/track/${bookingId}` : '/customer/dashboard',
        });
      } catch {
        if (cancelled) return;
        setStatus({
          loading: false,
          success: false,
          title: 'Payment verification failed',
          message: 'We could not confirm this payment yet. Please check again shortly.',
          retryTo: '/payment',
          primaryTo: '/customer/dashboard',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeState.success, searchParams]);

  // After a successful payment, open the booking automatically in 3 seconds.
  const autoRedirect = !status.loading && status.success && !!status.bookingId && !!status.primaryTo;
  const [secondsLeft, setSecondsLeft] = useState(3);
  useEffect(() => {
    if (!autoRedirect) return;
    setSecondsLeft(3);
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    const go = setTimeout(() => navigate(status.primaryTo!, { replace: true }), 3000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [autoRedirect, status.primaryTo, navigate]);

  const primaryLabel = status.loading
    ? 'Please wait'
    : status.success
      ? status.bookingId
        ? 'View booking'
        : 'Go to dashboard'
      : 'Go back';

  const secondaryLabel = status.loading
    ? null
    : status.success
      ? 'Dashboard'
      : 'Try payment again';

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-xl"
      >
        <div className="flex flex-col items-center text-center">
          <div
            className={`mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
              status.loading
                ? 'bg-blue-500/10 text-blue-500'
                : status.success
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-red-500/10 text-red-500'
            }`}
          >
            {status.loading ? (
              <Loader2 className="h-10 w-10 animate-spin" />
            ) : status.success ? (
              <CheckCircle2 className="h-10 w-10" />
            ) : (
              <XCircle className="h-10 w-10" />
            )}
          </div>

          <h1 className="text-2xl font-bold text-foreground">{status.title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{status.message}</p>
          {autoRedirect && (
            <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
              Opening your booking in {secondsLeft}s…
            </p>
          )}

          <div className="mt-8 flex w-full flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                if (!status.loading) navigate(status.primaryTo || '/customer/dashboard', { replace: true });
              }}
              disabled={status.loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CreditCard className="h-4 w-4" />
              {primaryLabel}
            </button>

            {secondaryLabel ? (
              <button
                type="button"
                onClick={() => {
                  if (status.success) {
                    navigate('/customer/dashboard', { replace: true });
                    return;
                  }
                  navigate(status.retryTo || '/payment');
                }}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                {secondaryLabel}
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PaymentStatusPage;
