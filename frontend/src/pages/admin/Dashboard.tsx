import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar,
  IndianRupee,
  FileText,
  CreditCard,
  UserPlus,
  Map,
  BarChart,
  ArrowRight
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CounterCard from '@/components/CounterCard';
import { staggerContainer, staggerItem } from '@/animations/variants';
import { reportService } from '@/services/reportService';
import { bookingService, Booking } from '@/services/bookingService';
import { toast } from 'sonner';
import axios from 'axios';
import { socketService } from '@/services/socket';
import GlobalSyncRefresh from '@/components/GlobalSyncRefresh';
import AdminVahanSearch from '@/components/admin/AdminVahanSearch';

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    todaysBookings: 0,
    revenueToday: 0,
    openTickets: 0,
    pendingBills: 0,
    pendingBookings: 0,
  });
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();

    // Socket Setup
    socketService.connect();
    socketService.joinRoom('admin');

    const refreshHandler = () => fetchData();
    const newBookingHandler = (data: any) => {
      toast.success('New service booked!', {
        description: `Order #${data.orderNumber || ''} by ${data.user?.name || 'a customer'}`,
        action: {
          label: 'View',
          onClick: () => navigate(`/admin/bookings/${data._id}`)
        }
      });
      fetchData();
    };

    socketService.on('bookingUpdated', refreshHandler);
    socketService.on('bookingCreated', newBookingHandler);
    socketService.on('ticketUpdated', refreshHandler);
    socketService.on('ticketCreated', refreshHandler);

    return () => {
      socketService.leaveRoom('admin');
      socketService.off('bookingUpdated', refreshHandler);
      socketService.off('bookingCreated', newBookingHandler);
      socketService.off('ticketUpdated', refreshHandler);
      socketService.off('ticketCreated', refreshHandler);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [dashboardStats, bookings] = await Promise.all([
        reportService.getDashboardStats(),
        bookingService.getAllBookings()
      ]);

      setStats({
        todaysBookings: dashboardStats.todaysBookings || 0,
        revenueToday: dashboardStats.revenueToday || 0,
        openTickets: dashboardStats.openTickets || 0,
        pendingBills: dashboardStats.pendingBills || 0,
        pendingBookings: dashboardStats.pendingBookings || 0,
      });

      // Get latest 5 bookings
      if (Array.isArray(bookings)) {
        const sorted = [...bookings].sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setRecentBookings(sorted.slice(0, 5));
      }

    } catch (error) {
      console.error('Failed to fetch admin dashboard data', error);
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

  const quickActions = [
    {
      title: 'Pending Bills',
      description: 'Review and approve payments',
      icon: <CreditCard className="w-6 h-6" />,
      color: 'bg-sky-500',
      lightColor: 'bg-sky-50',
      textColor: 'text-sky-700',
      path: '/admin/payments?status=pending',
      count: stats.pendingBills,
    },
    {
      title: 'Pending Bookings',
      description: 'Manage active service requests',
      icon: <Calendar className="w-6 h-6" />,
      color: 'bg-orange-500',
      lightColor: 'bg-orange-50',
      textColor: 'text-orange-600',
      path: '/admin/bookings?status=active',
      count: stats.pendingBookings,
    },
    {
      title: 'Live Tracking',
      description: 'Track staff and vehicles',
      icon: <Map className="w-6 h-6" />,
      color: 'bg-cyan-500',
      lightColor: 'bg-cyan-50',
      textColor: 'text-cyan-700',
      path: '/admin/tracking',
    },
    {
      title: 'Reports',
      description: 'View detailed performance',
      icon: <BarChart className="w-6 h-6" />,
      color: 'bg-emerald-500',
      lightColor: 'bg-emerald-50',
      textColor: 'text-emerald-600',
      path: '/admin/reports',
    },
    {
      title: 'Manage Staff',
      description: 'Add or update staff members',
      icon: <UserPlus className="w-6 h-6" />,
      color: 'bg-indigo-500',
      lightColor: 'bg-indigo-50',
      textColor: 'text-indigo-600',
      path: '/admin/staff',
    },
    {
      title: 'Support Tickets',
      description: 'Answer customer queries',
      icon: <FileText className="w-6 h-6" />,
      color: 'bg-red-500',
      lightColor: 'bg-red-50',
      textColor: 'text-red-700',
      path: '/admin/support',
      count: stats.openTickets,
    },
  ];

  return (
    <GlobalSyncRefresh
      entities={['booking', 'ticket', 'user', 'payment', 'approval', 'vehicle', 'product', 'service', 'setting', 'role']}
      onSync={fetchData}
    >
      {isLoading ? (
        <div className="p-8 text-center">Loading dashboard...</div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="p-4 md:p-6 space-y-8 max-w-[1600px] mx-auto"
        >
          <motion.div variants={staggerItem} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Main Admin Dashboard</h1>
              <p className="text-muted-foreground mt-1 text-sm md:text-base">Overview of system performance and daily operations</p>
            </div>
            <div className="flex flex-col items-start md:items-end gap-3 w-full md:w-auto">
              <span className="text-xs md:text-sm text-muted-foreground bg-muted px-4 py-1.5 rounded-full border border-border shadow-sm">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
              {/* Admin-only Vahan lookup → pop-up with the 19 Annexure-I fields */}
              <AdminVahanSearch />
            </div>
          </motion.div>

          {/* KPI Cards */}
          <motion.div variants={staggerItem}>
            <h2 className="text-lg font-semibold mb-4">Key Performance Indicators</h2>
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-2 gap-4">
              <CounterCard
                label="Today's Bookings"
                value={stats.todaysBookings}
                icon={<Calendar className="w-4 h-4 text-green-600" />}
                delay={0.1}
                onClick={() => navigate('/admin/bookings?date=today')}
              />
              <CounterCard
                label="Revenue Today"
                value={`₹${Math.round(stats.revenueToday * 100) / 100}`}
                icon={<IndianRupee className="w-4 h-4 text-emerald-600" />}
                delay={0.2}
              />
            </div>
          </motion.div>

          {/* Quick Actions */}
          <motion.div variants={staggerItem}>
            <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {quickActions.map((action, index) => (
                <motion.div
                  key={action.title}
                  whileHover={{ scale: 1.05, translateY: -5 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => navigate(action.path)}
                  className="bg-card border border-border rounded-2xl p-4 cursor-pointer shadow-sm hover:shadow-md transition-all group overflow-hidden relative flex flex-col items-center text-center"
                >
                  <div className={`w-12 h-12 rounded-2xl ${action.color} text-white flex items-center justify-center mb-3 shadow-lg group-hover:rotate-6 transition-transform duration-300 relative`}>
                    {action.icon}
                    {action.count !== undefined && action.count > 0 && (
                      <span className={`absolute -top-2 -right-2 bg-white ${action.textColor || 'text-rose-600'} text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-md border border-border animate-in zoom-in duration-300`}>
                        {action.count}
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-xs sm:text-sm text-foreground">
                    {action.title}
                  </h3>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Recent Bookings Section */}
          <motion.div variants={staggerItem} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Service Bookings</h2>
              <Link to="/admin/bookings" className="text-sm text-primary hover:underline font-medium">
                View All Bookings
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {recentBookings.length === 0 ? (
                <div className="bg-card p-8 rounded-xl border border-dashed border-border text-center">
                  <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-muted-foreground">No recent bookings found.</p>
                </div>
              ) : (
                recentBookings.map((booking) => (
                  <motion.div
                    key={booking._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`${booking.status === 'CREATED'
                        ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50'
                        : 'bg-card border-border'
                      } p-4 rounded-xl border shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer`}
                    onClick={() => navigate(`/admin/bookings/${booking._id}`)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-primary/10 rounded-lg">
                        <Calendar className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <span>Order #{booking.orderNumber || 'N/A'}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${booking.status === 'CREATED' ? 'bg-red-100 text-red-700' :
                              booking.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                                'bg-green-100 text-green-700'
                            }`}>
                            {booking.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {typeof booking.user === 'object' && booking.user !== null ? booking.user.name : 'Unknown Customer'} • {new Date(booking.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="font-semibold text-primary sm:text-foreground">
                      ₹{booking.finalAmount || booking.billing?.total || (booking.totalAmount + (booking.gstAmount || 0))}
                    </div>
                    <div className="text-xs text-muted-foreground text-right">
                      {Array.isArray(booking.services) ? booking.services.length : 0} Services
                    </div>
                  </div>
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

export default AdminDashboard;
