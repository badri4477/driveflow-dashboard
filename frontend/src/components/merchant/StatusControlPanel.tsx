import React, { useState } from 'react';
import { Activity, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingService, Booking } from '../../services/bookingService';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { PICKUP_FLOW_ORDER, NO_PICKUP_FLOW_ORDER, STATUS_LABELS, BookingStatus, getFlowForService, getStatusLabel } from '@/lib/statusFlow';
import Timeline from '../Timeline';

interface StatusControlPanelProps {
  booking: Booking;
  onUpdate: () => void;
}



const StatusControlPanel: React.FC<StatusControlPanelProps> = ({ booking, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [serviceStartedTransition, setServiceStartedTransition] = useState(false);


  const activeStatusFlow = getFlowForService(booking.services || []);
  const currentStatusIndex = activeStatusFlow.indexOf(booking.status as BookingStatus);

  let nextStatus = '';
  if (booking.status === 'REACHED_MERCHANT') nextStatus = 'SERVICE_STARTED';
  else if (booking.status === 'SERVICE_STARTED') nextStatus = ''; // Forced via Bill Upload
  // Merchant cannot move to OUT_FOR_DELIVERY or DELIVERED anymore
  // else if (booking.status === 'SERVICE_COMPLETED') nextStatus = 'OUT_FOR_DELIVERY';
  // else if (booking.status === 'OUT_FOR_DELIVERY') nextStatus = 'DELIVERED';

  const handleStatusChange = async (status: BookingStatus | string) => {
    // Validation before completing
    if (status === 'SERVICE_COMPLETED') {
        if (!booking.inspection?.completedAt) {
            toast.error('Please complete the Inspection in the "Inspection" tab.');
            return;
        }

        if (!booking.qc?.completedAt) {
            toast.error('Please complete the QC Check in the "QC Check" tab.');
            return;
        }

        if (!booking.billing?.fileUrl) {
            toast.error('Please upload and submit the bill in the "Billing" tab before completing the service.');
            return;
        }
    }

    if (status === 'OUT_FOR_DELIVERY') {
        if (booking.paymentStatus !== 'paid') {
            toast.error('Please wait for the customer to complete the payment before moving to Out For Delivery.');
            return;
        }
    }

    if (status === 'SERVICE_STARTED') {
      setServiceStartedTransition(true);
    }
    setLoading(true);
    try {
      await bookingService.updateBookingStatus(booking._id, status);
      // jobStartTime / jobEndTime are set server-side on the same request to avoid an extra round-trip

      toast.success(`Status updated to ${status}`);
      onUpdate();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to update status');
    } finally {
      setLoading(false);
      setServiceStartedTransition(false);
    }
  };



  const nextActionLabel = getStatusLabel(nextStatus, booking.services || []);
  const isWaitingForPayment = booking.status === 'SERVICE_COMPLETED' && booking.paymentStatus !== 'paid';

  return (
    <div className="relative bg-card border border-border rounded-xl p-4 md:p-6 shadow-sm space-y-6">
      {serviceStartedTransition && (
        <div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-sm"
          role="alert"
          aria-busy="true"
          aria-live="polite"
        >
          <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden />
          <p className="text-base font-semibold text-foreground">Starting service…</p>
          <p className="text-sm text-muted-foreground">Please wait while we update this order.</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <span className="truncate">Status & Workflow</span>
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-sm font-bold md:font-medium uppercase tracking-wider ${
              booking.status === 'SERVICE_COMPLETED' || booking.status === 'DELIVERED' || booking.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
              booking.status === 'CANCELLED' ? 'bg-red-100 text-red-800' :
              'bg-blue-100 text-blue-800'
          }`}>
              {getStatusLabel(booking.status, booking.services || [])}
          </span>
          {booking.paymentStatus === 'paid' ? (
            <span className="text-[9px] md:text-[10px] text-green-600 font-bold uppercase tracking-widest">● Paid</span>
          ) : (
            <span className="text-[9px] md:text-[10px] text-amber-600 font-bold uppercase tracking-widest">○ {booking.paymentStatus}</span>
          )}
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
        <Timeline 
          steps={activeStatusFlow.map((s) => {
            const index = activeStatusFlow.indexOf(s);
            const isCompleted = index <= currentStatusIndex;
            const label =
              s === 'ACCEPTED' && booking.status === 'REACHED_CUSTOMER'
                ? 'Staff waiting at customer location'
                : (s === 'OUT_FOR_DELIVERY' && booking.status !== 'OUT_FOR_DELIVERY'
                    ? 'Waiting for staff pickup'
                    : getStatusLabel(s, booking.services || []));

            return {
              step: label,
              completed: isCompleted,
              active: booking.status === s
            };
          })} 
          vertical={false} 
          className="gap-3 sm:gap-2" 
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {nextStatus ? (
            <div className="flex-1 space-y-3">
              {isWaitingForPayment && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-xs md:text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Waiting for Customer Payment (₹{booking.totalAmount}). Cannot move to Out For Delivery.</span>
                </div>
              )}
              <button
                  onClick={() => handleStatusChange(nextStatus)}
                  disabled={loading || isWaitingForPayment}
                  className={`w-full py-2.5 px-4 rounded-lg transition-all font-bold text-sm shadow-sm active:scale-[0.98] ${
                    isWaitingForPayment 
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200' 
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
              >
                  Move to {nextActionLabel}
              </button>
            </div>
        ) : null}
        


        {booking.status === 'On Hold' && (
            <button
                onClick={() => handleStatusChange(booking.delay?.previousStatus || 'Repair In Progress')} // Fallback needed?
                disabled={loading}
                className="w-full sm:w-auto py-2.5 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all text-sm font-bold shadow-sm active:scale-[0.98]"
            >
                Resume Work
            </button>
        )}
      </div>


    </div>
  );
};

export default StatusControlPanel;
