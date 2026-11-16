import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, CheckCircle, Search, MapPin, Navigation } from 'lucide-react';
import { bookingService, Booking } from '@/services/bookingService';
import { useAuthStore } from '@/store/authStore';
import { socketService } from '@/services/socket';
import { isBookingAssignedToStaff } from '@/lib/staffAssignment';
import { staggerContainer, staggerItem } from '@/animations/variants';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useTracking } from '@/hooks/use-tracking';
import { getETA, ETAResponse } from '@/services/trackingService';

const ACTIVE_STATUSES = ['CREATED', 'ASSIGNED', 'ACCEPTED', 'REACHED_CUSTOMER', 'VEHICLE_PICKED', 'REACHED_MERCHANT', 'SERVICE_STARTED', 'SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'QC_PENDING', 'CAR_WASH_STARTED', 'CAR_WASH_COMPLETED', 'STAFF_REACHED_MERCHANT', 'PICKUP_BATTERY_TIRE', 'DELIVERY'];
const COMPLETED_STATUSES = ['Completed', 'COMPLETED', 'DELIVERED', 'Delivered'];

const StaffOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter') || 'all';
  const { user } = useAuthStore();
  const { location: trackingLocation, setActiveBookingId, activeBookingId } = useTracking();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(filterParam);

  useEffect(() => {
    if (filterParam) {
      setStatusFilter(filterParam);
    }
  }, [filterParam]);

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setSearchParams({ filter: value });
  };

  const [etaByBooking, setEtaByBooking] = useState<Record<string, ETAResponse>>({});
  const etaTimeoutRef = useRef<number | null>(null);

  const fetchData = async () => {
    try {
      const data = await bookingService.getMyBookings();
      setBookings(data);
      setFilteredBookings(data);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load orders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Socket Setup
    socketService.connect();
    const bookingUpdatedHandler = (updatedBooking: Booking) => {
        setBookings(prev => {
          const index = prev.findIndex(b => b._id === updatedBooking._id);
          if (index !== -1) {
            return prev.map(b => b._id === updatedBooking._id ? updatedBooking : b);
          }
          
          // Check if this new/updated booking is now assigned to the current staff
          const staffId = user?._id || (user as any)?.id;
          const isAssignedToMe = isBookingAssignedToStaff(updatedBooking, staffId);

          if (isAssignedToMe) {
            // Prepend new order if assigned to me and not already in list
            return [updatedBooking, ...prev];
          }
          return prev;
        });
    };
    socketService.on('bookingUpdated', bookingUpdatedHandler);

    return () => {
      socketService.off('bookingUpdated', bookingUpdatedHandler);
    };
  }, [user?._id]);

  // Auto-bind an active booking to enable live sharing to customers/merchants
  useEffect(() => {
    if (activeBookingId) return;
    const candidate = bookings.find(b => ACTIVE_STATUSES.includes(b.status));
    if (candidate) {
      setActiveBookingId(candidate._id);
    }
  }, [bookings, activeBookingId, setActiveBookingId]);

  useEffect(() => {
    let result = bookings;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((b) => {
        const idMatch = (b._id?.toLowerCase() || '').includes(query) || (b.orderNumber && String(b.orderNumber).toLowerCase().includes(query));
        const userName =
          typeof b.user === 'object' && b.user !== null ? (b.user.name?.toLowerCase() || '') : '';
        const userMatch = userName.includes(query);
        return idMatch || userMatch;
      });
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'today') {
        const today = new Date().toISOString().split('T')[0];
        result = result.filter(b => b.date && b.date.startsWith(today));
      } else if (statusFilter === 'active') {
        result = result.filter(b => ACTIVE_STATUSES.includes(b.status));
      } else if (statusFilter === 'completed') {
        result = result.filter(b => COMPLETED_STATUSES.includes(b.status));
      } else if (statusFilter === 'delivered') {
        result = result.filter(b => ['Delivered', 'DELIVERED'].includes(b.status));
      } else {
        result = result.filter(b => b.status === statusFilter);
      }
    }

    setFilteredBookings(result);
  }, [searchQuery, statusFilter, bookings]);

  // Compute ETA badges for visible orders using OSRM backend endpoint
  useEffect(() => {
    if (!trackingLocation) {
      setEtaByBooking({});
      return;
    }
    if (etaTimeoutRef.current) {
      window.clearTimeout(etaTimeoutRef.current);
    }
    etaTimeoutRef.current = window.setTimeout(async () => {
      const updates: Record<string, ETAResponse> = {};
      const toProcess = filteredBookings.slice(0, 12);
      for (const b of toProcess) {
        let destLat: number | undefined;
        let destLng: number | undefined;
        if (['ASSIGNED', 'ACCEPTED', 'REACHED_CUSTOMER', 'OUT_FOR_DELIVERY'].includes(b.status)) {
          destLat = b.location?.lat;
          destLng = b.location?.lng;
        } else if (b.status === 'VEHICLE_PICKED' && b.merchant?.location) {
          destLat = b.merchant.location.lat;
          destLng = b.merchant.location.lng;
        }
        if (destLat && destLng) {
          try {
            const res = await getETA(trackingLocation.lat, trackingLocation.lng, destLat, destLng);
            updates[b._id] = res;
          } catch {
            // ignore
          }
        }
      }
      setEtaByBooking(prev => ({ ...prev, ...updates }));
    }, 400);
    return () => {
      if (etaTimeoutRef.current) {
        window.clearTimeout(etaTimeoutRef.current);
        etaTimeoutRef.current = null;
      }
    };
  }, [trackingLocation, filteredBookings]);

  const handleGetDirections = (order: Booking) => {
    const destLat = order.location?.lat;
    const destLng = order.location?.lng;
    const destAddress = order.location?.address;

    if (!destLat || !destLng) {
        // If lat/lng missing but address exists, try to search address
        if (destAddress) {
            const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destAddress)}`;
            window.open(url, '_blank');
            return;
        }
        toast.error('Customer location not available');
        return;
    }

    // 1. Try to use cached location from TrackingContext (fastest)
    if (trackingLocation && trackingLocation.lat && trackingLocation.lng) {
        const url = `https://www.google.com/maps/dir/?api=1&origin=${trackingLocation.lat},${trackingLocation.lng}&destination=${destLat},${destLng}`;
        window.open(url, '_blank');
        return;
    }

    // 2. Fallback to requesting current position
    if (navigator.geolocation) {
        const loadingToast = toast.loading('Getting your location...');
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                toast.dismiss(loadingToast);
                const { latitude, longitude } = position.coords;
                const url = `https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}&destination=${destLat},${destLng}`;
                window.open(url, '_blank');
            },
            (error) => {
                toast.dismiss(loadingToast);
                console.error('Error getting location', error);
                // If we can't get current location, just open maps with destination
                // Google Maps will try to find the route from "Your Location" automatically
                const url = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
                window.open(url, '_blank');
            },
            {
                enableHighAccuracy: true,
                timeout: 5000, // 5 seconds timeout to prevent hanging
                maximumAge: 10000
            }
        );
    } else {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
        window.open(url, '_blank');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[50vh]">Loading...</div>;
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="container-mobile space-y-6 no-horizontal-scroll"
    >
      <motion.div variants={staggerItem} className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">Service Orders</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Handle your assigned bookings and status updates</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search orders... (max 30 characters)" 
              className="pl-9 w-full sm:w-[200px]"
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                if (val.length > 30) {
                  toast.error('Too long data: Please enter a maximum of 30 characters');
                  return;
                }
                const allowedRegex = /^[a-zA-Z0-9\s'-]*$/;
                if (!allowedRegex.test(val)) {
                  toast.error('Invalid data: Please enter valid characters');
                  return;
                }
                setSearchQuery(val);
              }}
              maxLength={30}
            />
          </div>
          <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="today">Today's Orders</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      <motion.div variants={staggerItem} className="space-y-4">
        {filteredBookings.length === 0 ? (
          <div className="text-center py-8 sm:py-12 bg-muted/30 rounded-2xl border border-dashed border-border">
            <Package className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base sm:text-lg font-medium">No orders found</h3>
            <p className="text-muted-foreground text-sm sm:text-base">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4">
            {filteredBookings.map((order) => (
              <motion.div 
                key={order._id} 
                variants={staggerItem} 
                className="bg-card rounded-2xl border border-border p-4 flex flex-col cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/staff/order/${order._id}`)}
              >
                <div className="flex items-start justify-between mb-3 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Order #{order.orderNumber ?? order._id.slice(-6).toUpperCase()}</p>
                    <h3 className="font-semibold line-clamp-2 text-sm sm:text-base">
                      {order.services && order.services.length > 0
                        ? (typeof order.services[0] === 'string' ? order.services[0] : order.services[0].name)
                        : 'Service'}
                      {order.services && order.services.length > 1 && ` +${order.services.length - 1} more`}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {typeof order.user === 'object' && order.user !== null ? order.user.name : 'Customer'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="px-2 sm:px-3 py-1 bg-accent/10 text-accent rounded-full text-xs font-medium whitespace-nowrap">{order.status}</span>
                    {etaByBooking[order._id] && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] bg-blue-50 text-blue-700 border border-blue-200">
                        ETA {etaByBooking[order._id].textDuration}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="space-y-2 mb-4 flex-1">
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

                {['ASSIGNED', 'ACCEPTED', 'REACHED_CUSTOMER', 'VEHICLE_PICKED'].includes(order.status) && order.location && (
                  <div className="mt-3 mb-2 p-3 bg-muted/30 rounded-lg border border-border/50">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground">Pickup Location</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{order.location.address}</p>
                      </div>
                    </div>
                  </div>
                )}

                {(['ASSIGNED', 'ACCEPTED', 'VEHICLE_PICKED'].includes(order.status)) && (
                  <div className="mt-auto pt-4 border-t border-border">
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleGetDirections(order); }}
                      className="w-full py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors">
                      <Navigation className="w-4 h-4" /> 
                      <span className="hidden sm:inline">Get Directions</span>
                      <span className="sm:hidden">Directions</span>
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default StaffOrdersPage;
