import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Package, DollarSign, Users, TrendingUp, AlertTriangle, FileText, CheckCircle, Store } from 'lucide-react';
import CounterCard from '@/components/CounterCard';
import { staggerContainer, staggerItem } from '@/animations/variants';
import { bookingService, Booking } from '@/services/bookingService';
import { userService, User } from '@/services/userService';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import { serviceService, Service } from '@/services/serviceService';
import { toast } from 'sonner';
import axios from 'axios';
import { useAuthStore } from '@/store/authStore';
import { socketService } from '@/services/socket';
import GlobalSyncRefresh from '@/components/GlobalSyncRefresh';
import { Link, useNavigate } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const [stats, setStats] = useState({
    activeOrders: 0,
    completedOrders: 0,
    pendingBills: 0,
  });
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isShopOpen, setIsShopOpen] = useState(user?.isShopOpen ?? true);

  const handleShopStatusToggle = async (checked: boolean) => {
    const previousStatus = isShopOpen;
    setIsShopOpen(checked); // Optimistic update
    try {
        await userService.updateProfile({ isShopOpen: checked });
        updateUser({ isShopOpen: checked });
        toast.success(checked ? 'Shop is now Open' : 'Shop is now Closed');
    } catch (error) {
        setIsShopOpen(previousStatus); // Revert
        console.error('Failed to update shop status', error);
        toast.error('Failed to update shop status');
    }
  };

  useEffect(() => {
    if (user) {
        setIsShopOpen(user.isShopOpen ?? true);
    }
  }, [user]);

  useEffect(() => {
    fetchData();

    // Socket Setup
    socketService.connect();
    const bookingUpdatedHandler = () => {
      fetchData();
    };

    const bookingCreatedHandler = () => {
      fetchData();
    };

    socketService.on('bookingUpdated', bookingUpdatedHandler);
    socketService.on('bookingCreated', bookingCreatedHandler);

    return () => {
        socketService.off('bookingUpdated', bookingUpdatedHandler);
        socketService.off('bookingCreated', bookingCreatedHandler);
    };
  }, []);

  const fetchData = async () => {
    try {
      const bookingsData = await bookingService.getAllBookings();

      const active = bookingsData.filter((b: Booking) =>
        !['CANCELLED', 'DELIVERED', 'COMPLETED'].includes(b.status)
      ).length;
      
      const completed = bookingsData.filter((b: Booking) =>
        ['DELIVERED', 'COMPLETED'].includes(b.status)
      ).length;

      const pendingBills = bookingsData.filter((b: Booking) =>
        b.paymentStatus === 'pending' && b.status !== 'CANCELLED'
      ).length;

      setStats({
        activeOrders: active,
        completedOrders: completed,
        pendingBills,
      });

      setRecentBookings(bookingsData.slice(0, 3)); // home shows max 3 (app + web)
    } catch (error) {
      console.error('Failed to fetch dashboard data', error);
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

  return (
    <GlobalSyncRefresh
      entities={['booking', 'product', 'service', 'user', 'setting', 'approval']}
      onSync={fetchData}
    >
    {isLoading ? (
      <div className="p-8 text-center">Loading dashboard...</div>
    ) : (
    <motion.div 
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="space-y-8"
    >
      <motion.div variants={staggerItem}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-primary">
                {user?.role === 'admin' ? 'Admin Dashboard' : 'Merchant Dashboard'}
                </h1>
                <p className="text-muted-foreground mt-1">
                Overview of your workshop performance
                </p>
            </div>
            
            <div className="flex items-center space-x-3 bg-card p-3 rounded-xl border border-border shadow-sm">
                <div className={`p-2 rounded-full ${isShopOpen ? 'bg-green-100' : 'bg-gray-100'}`}>
                    <Store className={`w-5 h-5 ${isShopOpen ? 'text-green-600' : 'text-gray-500'}`} />
                </div>
                <div className="flex flex-col mr-2">
                    <Label htmlFor="shop-status" className="text-sm font-semibold cursor-pointer">
                        {isShopOpen ? 'Shop Open' : 'Shop Closed'}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                        {isShopOpen ? 'Accepting new orders' : 'Not accepting orders'}
                    </span>
                </div>
                <Switch 
                    id="shop-status" 
                    checked={isShopOpen} 
                    onCheckedChange={handleShopStatusToggle} 
                />
            </div>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={staggerItem} className="grid grid-cols-2 lg:grid-cols-3 gap-6">
        <CounterCard 
          label="Active Orders" 
          value={stats.activeOrders} 
          icon={<Package className="w-5 h-5 text-blue-600" />} 
          delay={0} 
          onClick={() => navigate('/merchant/orders?filter=active')}
        />
        <CounterCard 
          label="Completed Orders" 
          value={stats.completedOrders} 
          icon={<CheckCircle className="w-5 h-5 text-green-600" />} 
          delay={0.1} 
          onClick={() => navigate('/merchant/orders?filter=completed')}
        />
        <CounterCard 
          label="Pending Bills" 
          value={stats.pendingBills} 
          icon={<FileText className="w-5 h-5 text-orange-600" />} 
          delay={0.2} 
          onClick={() => navigate('/merchant/orders?filter=pending-bills')}
        />
      </motion.div>

      {/* Recent Orders */}
      <motion.div variants={staggerItem}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-xl">Recent Orders</h2>
          <Link to="/merchant/orders" className="text-sm text-primary hover:underline">View All</Link>
        </div>
        <div className="space-y-4">
          {recentBookings.length === 0 ? (
            <p className="text-muted-foreground">No bookings found.</p>
          ) : (
            recentBookings.map((booking) => (
              <motion.div 
                key={booking._id} 
                variants={staggerItem}
                whileHover={{ scale: 1.01, y: -2 }}
                onClick={() => navigate(`/merchant/order/${booking._id}`)}
                className="bg-card rounded-2xl border border-border p-4 flex items-center justify-between shadow-sm hover:shadow-card-hover transition-all duration-300 cursor-pointer"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">
                      {(booking.vehicle as unknown as Vehicle)?.licensePlate || 'N/A'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      booking.status === 'DELIVERED' ? 'bg-green-100 text-green-800' :
                      booking.status === 'CANCELLED' ? 'bg-red-100 text-red-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {booking.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium mt-1">
                    {Array.isArray(booking.services) 
                      ? (booking.services as unknown as Service[]).map(s => s.name).join(', ') 
                      : 'Service'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Slot: {new Date(booking.date).toLocaleDateString()}
                  </p>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
    )}
    </GlobalSyncRefresh>
  );
};

export default Dashboard;
