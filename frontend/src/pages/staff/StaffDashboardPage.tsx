import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Package, Clock, CheckCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { bookingService, Booking } from '@/services/bookingService';
import CounterCard from '@/components/CounterCard';
import { socketService } from '@/services/socket';
import GlobalSyncRefresh from '@/components/GlobalSyncRefresh';
import { staggerContainer, staggerItem } from '@/animations/variants';
import { toast } from 'sonner';
import axios from 'axios';
import { STATUS_LABELS, getStatusLabel } from '@/lib/statusFlow';
import { isBookingAssignedToStaff } from '@/lib/staffAssignment';

const ACTIVE_STATUSES = [
  'CREATED',
  'ASSIGNED',
  'ACCEPTED',
  'REACHED_CUSTOMER',
  'VEHICLE_PICKED',
  'REACHED_MERCHANT',
  'SERVICE_STARTED',
  'SERVICE_COMPLETED',
  'OUT_FOR_DELIVERY',
  'QC_PENDING',
  'CAR_WASH_STARTED',
  'CAR_WASH_COMPLETED',
  'STAFF_REACHED_MERCHANT',
  'PICKUP_BATTERY_TIRE',
  'DELIVERY'
];

const COMPLETED_STATUSES = [
  'Completed',
  'COMPLETED',
  'DELIVERED',
  'Delivered'
];

const StaffDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const bookingsRef = useRef<Booking[]>([]);
  bookingsRef.current = bookings;
  const [stats, setStats] = useState({
    todaysOrders: 0,
    pending: 0,
    completed: 0
  });

  useEffect(() => {
    fetchData();

    // Socket Setup
    socketService.connect();
    const bookingUpdatedHandler = (updatedBooking: Booking) => {
      const user = useAuthStore.getState().user as any;
      const staffId = user?._id || user?.id;
      // Refetch on new assignments and on updates to orders already listed.
      if (isBookingAssignedToStaff(updatedBooking, staffId) || bookingsRef.current.some(b => b._id === updatedBooking._id)) {
        fetchData();
      }
    };

    socketService.on('bookingUpdated', bookingUpdatedHandler);

    return () => {
      socketService.off('bookingUpdated', bookingUpdatedHandler);
    };
  }, []);

  const fetchData = async () => {
    try {
      const data = await bookingService.getMyBookings();
      setBookings(data);

      // Calculate stats
      const today = new Date().toISOString().split('T')[0];

      const todaysOrders = data.filter(b => b.date && b.date.startsWith(today)).length;
      const pending = data.filter(b => ACTIVE_STATUSES.includes(b.status)).length;
      const completed = data.filter(b => COMPLETED_STATUSES.includes(b.status)).length;

      setStats({
        todaysOrders,
        pending,
        completed
      });
    } catch (error) {
      console.error(error);
      // A 401 here means the session expired mid-fetch — the global axios
      // interceptor already logs the user out and redirects to /login, so
      // this toast would otherwise show up on the login page talking
      // about a dashboard the user's no longer looking at.
      if (!(axios.isAxiosError(error) && error.response?.status === 401)) {
        toast.error('Failed to load dashboard data');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const activeOrders = bookings.filter(b => ACTIVE_STATUSES.includes(b.status));

  return (
    <GlobalSyncRefresh entities={['booking', 'user', 'notification']} onSync={fetchData}>
    {isLoading ? (
      <div className="flex items-center justify-center min-h-[50vh]">Loading...</div>
    ) : (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="container-mobile space-y-6 no-horizontal-scroll"
    >
      <motion.div variants={staggerItem}>
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">Staff Dashboard</h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              Overview of your assigned jobs and live orders
            </p>
          </div>

        </div>
      </motion.div>

      <div className="space-y-6">
        <motion.div variants={staggerItem} className="space-y-6">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <CounterCard 
              label="Today's Orders" 
              value={stats.todaysOrders} 
              icon={<Package className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />} 
              delay={0} 
              onClick={() => navigate('/staff/orders?filter=today')}
            />
            <CounterCard 
              label="Pending" 
              value={stats.pending} 
              icon={<Clock className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />} 
              delay={1} 
              onClick={() => navigate('/staff/orders?filter=active')}
            />
            <CounterCard 
              label="Completed & delivered" 
              value={stats.completed} 
              icon={<CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />} 
              delay={2} 
              onClick={() => navigate('/staff/orders?filter=completed')}
            />
          </div>

          <div>
            <h2 className="font-semibold text-lg mb-4">Active Orders</h2>
            {activeOrders.length === 0 ? (
              <div className="text-center py-8 sm:py-12 bg-muted/30 rounded-2xl border border-dashed border-border">
                <Package className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-base sm:text-lg font-medium">No active orders</h3>
                <p className="text-muted-foreground text-sm sm:text-base">You don't have any active orders assigned.</p>
              </div>
            ) : (
              <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
                {activeOrders.map((order) => (
                  <motion.div key={order._id} variants={staggerItem} className="bg-card rounded-2xl border border-border p-4">
                    <Link to={`/staff/order/${order._id}`}>
                      <div className="flex items-start justify-between mb-3 gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Order #{order.orderNumber ?? order._id.slice(-6).toUpperCase()}</p>
                          <h3 className="font-semibold text-sm sm:text-base line-clamp-2">
                            {order.services && order.services.length > 0
                              ? (typeof order.services[0] === 'string' ? order.services[0] : order.services[0].name)
                              : 'Service'}
                            {order.services && order.services.length > 1 && ` +${order.services.length - 1} more`}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">
                            {typeof order.user === 'object' && order.user !== null ? order.user.name : 'Customer'}
                          </p>
                        </div>
                        <span className="px-2 sm:px-3 py-1 bg-accent/10 text-accent rounded-full text-xs font-medium whitespace-nowrap">{getStatusLabel(order.status, order.services)}</span>
                      </div>


                      
                      <div className="space-y-2 mb-4">
                        {Array.isArray(order.services) &&
                          order.services.slice(0, 2).map((service, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                              <CheckCircle className="w-4 h-4 text-muted flex-shrink-0" />
                              <span className="truncate">{typeof service === 'object' ? service.name : service}</span>
                            </div>
                          ))}
                        {Array.isArray(order.services) && order.services.length > 2 && (
                          <div className="text-xs text-muted-foreground pl-6">+{order.services.length - 2} more services</div>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
    )}
    </GlobalSyncRefresh>
  );
};

export default StaffDashboardPage;
