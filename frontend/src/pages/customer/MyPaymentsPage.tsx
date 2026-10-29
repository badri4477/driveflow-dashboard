import React, { useEffect, useState } from 'react';
import { bookingService, Booking } from '../../services/bookingService';
import { socketService } from '../../services/socket';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from 'lucide-react';

const FINAL_BILL_STATUSES = ['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

const MyPaymentsPage = () => {
  const [payments, setPayments] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPayments();

    socketService.connect();
    socketService.on('bookingUpdated', () => {
      fetchPayments();
    });

    return () => {
      socketService.off('bookingUpdated');
    };
  }, []);

  const fetchPayments = async () => {
    try {
      const bookings = await bookingService.getMyBookings();
      // A cancelled booking that was never actually paid shouldn't show up
      // here as "pending" — but keep it if it was paid (e.g. later
      // refunded), since that's still a real payment record.
      const paidBookings = bookings.filter(
        (b) =>
          b.paymentStatus === 'paid' ||
          (b.status !== 'CANCELLED' && (b.paymentStatus !== 'pending' || b.totalAmount > 0))
      );
      setPayments(paidBookings);
    } catch (error) {
      toast.error('Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  };

  const getVehicleLabel = (booking: Booking) =>
    typeof booking.vehicle === 'object' && booking.vehicle !== null
      ? booking.vehicle.licensePlate
      : 'Vehicle';

  const getAmount = (booking: Booking) =>
    booking.discountAmount && booking.finalAmount !== undefined && booking.finalAmount !== null
      ? booking.finalAmount
      : (booking.billing?.total || booking.finalAmount || booking.totalAmount);

  // Periodic/general services are billed after the service: inspection can
  // add parts, so the amount is only an estimate until the service completes.
  const isAwaitingFinalBill = (booking: Booking) => {
    if (booking.paymentStatus === 'paid' || booking.status === 'CANCELLED') return false;
    if ((booking as any).carWash?.isCarWashService) return false;
    const categories = (Array.isArray(booking.services) ? booking.services : [])
      .map((s: any) => (typeof s === 'object' && s?.category ? String(s.category).toLowerCase() : ''));
    if (categories.some((c) => /battery|tire|tyre|wash|essentials/.test(c))) return false;
    return !FINAL_BILL_STATUSES.includes(booking.status);
  };

  const getPaymentStatusDisplay = (booking: Booking) => {
    if (booking.status === 'CANCELLED' && booking.paymentStatus !== 'paid') {
      return { label: 'cancelled', variant: 'outline' as const };
    }
    if (isAwaitingFinalBill(booking)) {
      return { label: 'Due after service', variant: 'outline' as const };
    }
    return {
      label: booking.paymentStatus,
      variant: (booking.paymentStatus === 'paid'
        ? 'success'
        : booking.paymentStatus === 'failed'
        ? 'destructive'
        : 'outline') as any,
    };
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden py-4 lg:py-6 space-y-4 sm:space-y-6 pb-24 lg:pb-6">
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">My Payments</h1>
      
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Payment History</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {payments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground px-4">
              No payments found.
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border">
                {payments.map((booking) => (
                  <div key={booking._id} className="p-4 space-y-2 min-w-0">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">{format(new Date(booking.date), 'PPP')}</p>
                        <p className="font-mono text-sm font-semibold truncate">
                          {booking.orderNumber ?? booking._id.slice(-8).toUpperCase()}
                        </p>
                      </div>
                      <Badge
                        variant={getPaymentStatusDisplay(booking).variant}
                        className="text-xs shrink-0"
                      >
                        {getPaymentStatusDisplay(booking).label}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground break-words">
                      Service for {getVehicleLabel(booking)}
                    </p>
                    <p className="text-sm font-semibold text-primary">
                      {isAwaitingFinalBill(booking) && (
                        <span className="text-xs font-normal text-muted-foreground mr-1">Est.</span>
                      )}
                      ₹{getAmount(booking)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-sm">Date</TableHead>
                      <TableHead className="text-sm">Booking Ref</TableHead>
                      <TableHead className="text-sm">Description</TableHead>
                      <TableHead className="text-sm">Amount</TableHead>
                      <TableHead className="text-sm">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((booking) => (
                      <TableRow key={booking._id}>
                        <TableCell className="text-sm">{format(new Date(booking.date), 'PPP')}</TableCell>
                        <TableCell className="font-mono text-xs">{booking.orderNumber ?? booking._id.slice(-8).toUpperCase()}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          Service for {getVehicleLabel(booking)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {isAwaitingFinalBill(booking) && (
                            <span className="text-xs font-normal text-muted-foreground mr-1">Est.</span>
                          )}
                          ₹{getAmount(booking)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getPaymentStatusDisplay(booking).variant} className="text-xs">
                            {getPaymentStatusDisplay(booking).label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MyPaymentsPage;
