import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { bookingService, Booking } from '@/services/bookingService';
import { userService, User } from '@/services/userService';
import { serviceService, Service } from '@/services/serviceService';
import { Vehicle } from '@/services/vehicleService';
import { socketService } from '@/services/socket';
import { toast } from 'sonner';
import { getStatusLabel } from '@/lib/statusFlow';
import { 
  ArrowLeft, 
  Calendar, 
  Car, 
  User as UserIcon, 
  MapPin, 
  Truck, 
  Wrench, 
  CreditCard,
  CheckCircle,
  XCircle,
  Clock,
  Store,
  Shield,
  Signal,
  ImageIcon,
  FileText,
  Download,
  IndianRupee,
  Camera,
  MessageCircle
} from 'lucide-react';
import * as turf from '@turf/turf';
import { searchVehicleReference } from '@/services/vehicleReferenceService';
import { sumBookingServicesSubtotal } from '@/lib/vehicleServicePricing';


const BookingDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [userBookings, setUserBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [vehicleRef, setVehicleRef] = useState<Record<string, unknown> | null>(null);

  const loadVehicleReference = React.useCallback(async (vehicle: Vehicle) => {
    if (!vehicle?.make || !vehicle?.model) {
      setVehicleRef(null);
      return;
    }
    try {
      const ref = await searchVehicleReference(
        vehicle.make,
        vehicle.model,
        vehicle.variant,
        vehicle.fuelType,
      );
      setVehicleRef(ref ?? null);
    } catch {
      setVehicleRef(null);
    }
  }, []);
  const [merchants, setMerchants] = useState<User[]>([]);
  const [drivers, setDrivers] = useState<User[]>([]);
  const [carWashStaff, setCarWashStaff] = useState<User[]>([]);
  const [selectedMerchant, setSelectedMerchant] = useState<string>('');
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [selectedCarWashStaff, setSelectedCarWashStaff] = useState<string>('');
  const [assignedAt, setAssignedAt] = useState<string>(() => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000; // in ms
    return new Date(now.getTime() - offset).toISOString().slice(0, 16);
  });
 
  // Identify service types
  const isCarWashService = React.useMemo(() => {
    const hasCarWashCategory = Array.isArray(booking?.services) && 
      (booking!.services as Service[]).some(service => {
        if (!service.category) return false;
        const cat = service.category.toLowerCase();
        return cat.includes('car wash') || cat.includes('wash') || cat.includes('essentials');
      });
    return hasCarWashCategory || booking?.carWash?.isCarWashService === true;
  }, [booking?.services, booking?.carWash?.isCarWashService]);

  const isBatteryOrTireService = React.useMemo(() => 
    Array.isArray(booking?.services) && 
    (booking!.services as Service[]).some(service => {
      if (!service.category) return false;
      const cat = service.category.toLowerCase();
      return cat.includes('battery') || cat.includes('tyre') || cat.includes('tire');
    }), [booking?.services]);

  const isEssentialsService = React.useMemo(() => {
    return Array.isArray(booking?.services) && 
      (booking!.services as Service[]).some(service => {
        const name = service.name?.toLowerCase() || '';
        const category = service.category?.toLowerCase() || '';
        return name.includes('essentials') || category.includes('essentials');
      });
  }, [booking?.services]);

  const isGeneralService = React.useMemo(() => 
    Array.isArray(booking?.services) && 
    (booking!.services as Service[]).some(service => {
      const cat = service.category;
      const name = service.name?.toLowerCase() || '';
      return cat === 'Periodic' || cat === 'Services' || name.includes('general service');
    }), [booking?.services]);

  const handleDownloadInvoice = async () => {
    if (!booking?._id) return;

    // If merchant has uploaded a file, prioritize that
    if (booking.billing?.fileUrl) {
      window.open(booking.billing.fileUrl, '_blank');
      return;
    }

    try {
      toast.info('Generating invoice...');
      const response = await bookingService.getBookingInvoice(booking._id);
      
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'carzzi_invoice.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Invoice downloaded successfully');
    } catch (error) {
      console.error('Failed to download invoice:', error);
      toast.error('Failed to download invoice. Please try again later.');
    }
  };

  // Memoized sorted lists
  const sortedMerchants = React.useMemo(() => {
    const targetLat = typeof booking?.location === 'object' ? (booking.location as any).lat : null;
    const targetLng = typeof booking?.location === 'object' ? (booking.location as any).lng : null;

    let filtered = [...merchants];

    // Identify specific categories needed for this booking
    const requiredCategories = new Set<string>();
    if (Array.isArray(booking?.services)) {
      (booking!.services as Service[]).forEach(s => {
        if (s.category === 'Battery') requiredCategories.add('battery');
        if (s.category === 'Tyres') requiredCategories.add('tires');
        if (s.category === 'Tyre & Battery') {
          requiredCategories.add('battery');
          requiredCategories.add('tires');
        }
      });
    }

    // Filter by specific category if needed
    if (requiredCategories.size > 0) {
      filtered = filtered.filter(m => 
        m.category && Array.from(requiredCategories).some(reqCat => 
          Array.isArray(m.category) 
            ? m.category.includes(reqCat as any) 
            : m.category === reqCat
        )
      );
    }

    return filtered.sort((a, b) => {
      // 1. Proximity - Prioritize nearest as requested by user
      if (targetLat && targetLng && a.location?.lat && a.location?.lng && b.location?.lat && b.location?.lng) {
        const from = turf.point([targetLng, targetLat]);
        const toA = turf.point([a.location.lng, a.location.lat]);
        const toB = turf.point([b.location.lng, b.location.lat]);
        const distA = turf.distance(from, toA);
        const distB = turf.distance(from, toB);
        if (distA !== distB) return distA - distB;
      }

      // 2. Open Shop Priority
      const aOpen = a.isShopOpen !== false;
      const bOpen = b.isShopOpen !== false;
      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;

      return 0;
    });
  }, [merchants, booking?.location, booking?.services]);

  const sortedDrivers = React.useMemo(() => {
    const targetLat = typeof booking?.location === 'object' ? booking.location.lat : null;
    const targetLng = typeof booking?.location === 'object' ? booking.location.lng : null;

    return [...drivers].sort((a, b) => {
      // 1. Online Priority
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;

      // 2. Proximity
      if (targetLat && targetLng && a.location?.lat && a.location?.lng && b.location?.lat && b.location?.lng) {
        const from = turf.point([targetLng, targetLat]);
        const toA = turf.point([a.location.lng, a.location.lat]);
        const toB = turf.point([b.location.lng, b.location.lat]);
        return turf.distance(from, toA) - turf.distance(from, toB);
      }
      return 0;
    });
  }, [drivers, booking?.location]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!id) return;
        const [bookingData, usersData] = await Promise.all([
          bookingService.getBookingById(id),
          userService.getAllUsers()
        ]);
        setBooking(bookingData);
        if (bookingData.vehicle && typeof bookingData.vehicle === 'object') {
          await loadVehicleReference(bookingData.vehicle);
        } else {
          setVehicleRef(null);
        }

        // Fetch user's other bookings
        if (bookingData.user) {
          const userId = typeof bookingData.user === 'object' ? bookingData.user._id : bookingData.user;
          const userHistory = await bookingService.getUserBookings(userId);
          setUserBookings(userHistory.filter((b: Booking) => b._id !== id));
        }
        
        // Populate lists for assignment
        setMerchants(usersData.filter((u: User) => u.role === 'merchant'));
        setDrivers(usersData.filter((u: User) => 
          u.role === 'staff' && (!u.subRole || u.subRole === 'Driver')
        ));
        setCarWashStaff(usersData.filter((u: User) => u.role === 'staff'));

        // Helper to safely get ID
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const getResourceId = (resource: any) => {
           if (!resource) return '';
           if (typeof resource === 'string') return resource;
           if (typeof resource === 'object' && resource._id) return resource._id;
           return '';
        };

        // Set initial values
        if (bookingData.merchant) setSelectedMerchant(getResourceId(bookingData.merchant));
        if (bookingData.pickupDriver) setSelectedDriver(getResourceId(bookingData.pickupDriver));
        if (bookingData.carWash?.staffAssigned) setSelectedCarWashStaff(getResourceId(bookingData.carWash.staffAssigned));
        if (bookingData.assignedAt) {
          const date = new Date(bookingData.assignedAt);
          const offset = date.getTimezoneOffset() * 60000;
          setAssignedAt(new Date(date.getTime() - offset).toISOString().slice(0, 16));
        }

      } catch (error) {
        console.error(error);
        toast.error('Failed to load booking details');
        navigate('/admin/bookings');
      } finally {
        setIsLoading(false);
      }
    };

    if (id) {
      fetchData();
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!id) return;
    
    socketService.connect();
    socketService.joinRoom('admin');

    socketService.on('bookingUpdated', (updatedBooking: Booking) => {
      if (updatedBooking._id === id) {
         setBooking(updatedBooking);
         if (updatedBooking.vehicle && typeof updatedBooking.vehicle === 'object') {
            void loadVehicleReference(updatedBooking.vehicle);
          } else {
            setVehicleRef(null);
          }
         
         // Helper to safely get ID
         const getResourceId = (resource: any) => {
           if (!resource) return '';
           if (typeof resource === 'string') return resource;
           if (typeof resource === 'object' && resource._id) return resource._id;
           return '';
         };

         // Sync local assignment states with updated booking
         if (updatedBooking.merchant) setSelectedMerchant(getResourceId(updatedBooking.merchant));
         if (updatedBooking.pickupDriver) setSelectedDriver(getResourceId(updatedBooking.pickupDriver));
         if (updatedBooking.carWash?.staffAssigned) setSelectedCarWashStaff(getResourceId(updatedBooking.carWash.staffAssigned));
         if (updatedBooking.assignedAt) {
           const date = new Date(updatedBooking.assignedAt);
           const offset = date.getTimezoneOffset() * 60000;
           setAssignedAt(new Date(date.getTime() - offset).toISOString().slice(0, 16));
         }
      }
    });

    socketService.on('liveLocation', (data: { userId: string; lat: number; lng: number; timestamp?: string; updatedAt?: string; isOnline?: boolean }) => {
      const timestamp = data.timestamp || data.updatedAt;
      
      // Update merchant locations
      setMerchants(prev => prev.map(m => {
        if (m._id === data.userId) {
          return {
            ...m,
            isOnline: data.isOnline !== undefined ? data.isOnline : true,
            location: {
              ...m.location,
              lat: data.lat,
              lng: data.lng,
              updatedAt: timestamp
            }
          };
        }
        return m;
      }));

      // Update driver locations
      setDrivers(prev => prev.map(d => {
        if (d._id === data.userId) {
          return {
            ...d,
            isOnline: data.isOnline !== undefined ? data.isOnline : true,
            location: {
              ...d.location,
              lat: data.lat,
              lng: data.lng,
              updatedAt: timestamp
            }
          };
        }
        return d;
      }));

      // Update car wash staff locations
      setCarWashStaff(prev => prev.map(s => {
        if (s._id === data.userId) {
          return {
            ...s,
            isOnline: data.isOnline !== undefined ? data.isOnline : true,
            location: {
              ...s.location,
              lat: data.lat,
              lng: data.lng,
              updatedAt: timestamp
            }
          };
        }
        return s;
      }));
    });

    socketService.on('userStatusUpdate', (data: { 
      userId: string; 
      isOnline: boolean; 
      lastSeen: string;
      location?: {
        lat: number;
        lng: number;
        address?: string;
        updatedAt?: string | Date;
      };
    }) => {
      const timestamp = data.location?.updatedAt ? String(data.location.updatedAt) : data.lastSeen;
      setMerchants(prev => prev.map(m => {
        if (m._id === data.userId) {
          const updated = { ...m, isOnline: data.isOnline, lastSeen: data.lastSeen };
          if (data.location?.lat && data.location?.lng) {
            updated.location = {
              ...m.location,
              lat: data.location.lat,
              lng: data.location.lng,
              updatedAt: timestamp
            };
          }
          return updated;
        }
        return m;
      }));
      setDrivers(prev => prev.map(d => {
        if (d._id === data.userId) {
          const updated = { ...d, isOnline: data.isOnline, lastSeen: data.lastSeen };
          if (data.location?.lat && data.location?.lng) {
            updated.location = {
              ...d.location,
              lat: data.location.lat,
              lng: data.location.lng,
              updatedAt: timestamp
            };
          }
          return updated;
        }
        return d;
      }));
      setCarWashStaff(prev => prev.map(s => {
        if (s._id === data.userId) {
          const updated = { ...s, isOnline: data.isOnline, lastSeen: data.lastSeen };
          if (data.location?.lat && data.location?.lng) {
            updated.location = {
              ...s.location,
              lat: data.location.lat,
              lng: data.location.lng,
              updatedAt: timestamp
            };
          }
          return updated;
        }
        return s;
      }));
    });

    return () => {
       socketService.leaveRoom('admin');
       socketService.off('bookingUpdated');
       socketService.off('liveLocation');
       socketService.off('userStatusUpdate');
    };
  }, [id]);

  const getStatusBadgeClass = (status: string) => {
    const styles: Record<string, string> = {
      CREATED: 'bg-red-100 text-red-800',
      ASSIGNED: 'bg-purple-100 text-purple-800',
      ACCEPTED: 'bg-indigo-100 text-indigo-800',
      REACHED_CUSTOMER: 'bg-amber-100 text-amber-800',
      VEHICLE_PICKED: 'bg-orange-100 text-orange-800',
      REACHED_MERCHANT: 'bg-cyan-100 text-cyan-800',
      SERVICE_STARTED: 'bg-yellow-100 text-yellow-800',
      SERVICE_COMPLETED: 'bg-green-100 text-green-800',
      OUT_FOR_DELIVERY: 'bg-pink-100 text-pink-800',
      DELIVERED: 'bg-emerald-100 text-emerald-800',
      COMPLETED: 'bg-emerald-100 text-emerald-800',
      CANCELLED: 'bg-red-100 text-red-800',
      CAR_WASH_STARTED: 'bg-blue-100 text-blue-800',
      CAR_WASH_COMPLETED: 'bg-green-100 text-green-800',
      STAFF_REACHED_MERCHANT: 'bg-cyan-100 text-cyan-800',
      PICKUP_BATTERY_TIRE: 'bg-orange-100 text-orange-800',
      INSTALLATION: 'bg-yellow-100 text-yellow-800',
      DELIVERY: 'bg-pink-100 text-pink-800',
      MERCHANT_INSPECTION: 'bg-indigo-100 text-indigo-800',
      PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
    };
    return styles[status] || 'bg-blue-100 text-blue-800';
  };

  const truncateOptionLabel = (label: string, max = 72) =>
    label.length > max ? `${label.slice(0, max - 1)}…` : label;

  const assignmentSelectClass =
    'w-full min-w-0 max-w-full box-border p-2 rounded-lg border border-border bg-background text-sm';

  const handleStatusUpdate = async (newStatus: string) => {
    if (!booking) return;
    try {
      await bookingService.updateBookingStatus(booking._id, newStatus);
      setBooking({ ...booking, status: newStatus as Booking['status'] });
      toast.success(`Status updated to ${getStatusLabel(newStatus, booking.services || [])}`);
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleAssignment = async () => {
    if (!booking) return;

    if (isCarWashService) {
      if (!selectedCarWashStaff) {
        toast.error('Please select staff before saving assignments.');
        return;
      }
    } else {
      if (!selectedMerchant || !selectedDriver) {
        toast.error('Both merchant and staff must be selected before saving assignments.');
        return;
      }
    }

    try {
      let assignmentData = {};

      if (isCarWashService) {
        // For car wash services, only assign car wash staff
        assignmentData = {
          carWashStaffId: selectedCarWashStaff || undefined,
          assignedAt: new Date(assignedAt).toISOString()
        };
      } else if (isBatteryOrTireService) {
        // For battery/tire services, assign both merchant and staff
        assignmentData = {
          merchantId: selectedMerchant || undefined,
          driverId: selectedDriver || undefined,
          assignedAt: new Date(assignedAt).toISOString()
        };
      } else {
        // For regular services, assign merchant and driver
        assignmentData = {
          merchantId: selectedMerchant || undefined,
          driverId: selectedDriver || undefined,
          assignedAt: new Date(assignedAt).toISOString()
        };
      }

      console.log('Sending assignment data:', assignmentData);
      
      const result = await bookingService.assignBooking(booking._id, assignmentData);
      console.log('Assignment result:', result);
      
      // Refetch to get populated data back
      const updatedBooking = await bookingService.getBookingById(booking._id);
      setBooking(updatedBooking);
      toast.success('Assignments updated successfully');
    } catch (error) {
      console.error('Assignment error:', error);
      toast.error(`Failed to update assignments: ${error.response?.data?.message || error.message}`);
    }
  };

  if (isLoading || !booking) {
    return <div className="p-8 text-center">Loading booking details...</div>;
  }

  const customer = booking.user as unknown as User;
  const vehicle = booking.vehicle as unknown as Vehicle;
  
  return (
    <div className="space-y-6 w-full min-w-0 max-w-7xl mx-auto overflow-x-hidden p-4 sm:p-6 pb-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-4 mb-6 min-w-0 max-w-full">
        <button 
          onClick={() => navigate('/admin/bookings')}
          className="p-2 hover:bg-muted rounded-full transition-colors shrink-0 -ml-2 sm:ml-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 max-w-full">
          <h1 className="text-lg sm:text-2xl font-bold break-words leading-snug">
            Booking #{booking.orderNumber ?? booking._id.slice(-6).toUpperCase()}
          </h1>
          <div className="mt-2 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className={`inline-flex max-w-full shrink-0 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getStatusBadgeClass(booking.status)}`}>
              {getStatusLabel(booking.status, booking.services || [])}
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-2">Created on {new Date(booking.createdAt).toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Customer & Vehicle */}
        <div className="space-y-6">
          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-primary" /> Customer Details
            </h3>
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Name:</span> {customer?.name}</p>
              <p><span className="text-muted-foreground">Email:</span> {customer?.email}</p>
              <p><span className="text-muted-foreground">Phone:</span> {customer?.phone || 'N/A'}</p>
              <button 
                onClick={() => navigate(`/admin/users/${customer?._id}`)}
                className="text-primary hover:underline text-xs"
              >
                View Profile
              </button>
            </div>
          </div>

          {/* Customer Booking History */}
          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Booking History
            </h3>
            {userBookings.length > 0 ? (
              <div className="space-y-3">
                {userBookings.slice(0, 5).map((prevBooking) => (
                  <div 
                    key={prevBooking._id}
                    onClick={() => navigate(`/admin/bookings/${prevBooking._id}`)}
                    className="p-3 rounded-xl border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                        #{prevBooking.orderNumber ?? prevBooking._id.slice(-6).toUpperCase()}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium text-right ${getStatusBadgeClass(prevBooking.status)}`}>
                        {getStatusLabel(prevBooking.status, prevBooking.services || [])}
                      </span>
                    </div>
                    <div className="text-xs font-medium truncate">
                      {Array.isArray(prevBooking.services) 
                        ? (prevBooking.services as Service[]).map(s => typeof s === 'object' ? s.name : 'Service').join(', ')
                        : 'Service'}
                    </div>
                    <div className="flex justify-between items-center mt-2 text-[10px] text-muted-foreground">
                      <span>{new Date(prevBooking.date).toLocaleDateString()}</span>
                      <span className="font-bold text-foreground">₹{prevBooking.totalAmount}</span>
                    </div>
                  </div>
                ))}
                {userBookings.length > 5 && (
                  <button 
                    onClick={() => navigate(`/admin/users/${customer?._id}`)}
                    className="w-full text-center text-xs text-primary hover:underline pt-1"
                  >
                    View all {userBookings.length} bookings
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic text-center py-2">No previous bookings found.</p>
            )}
          </div>

          {booking.prePickupPhotos && booking.prePickupPhotos.length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" /> Pre-Pickup Vehicle Photos
              </h3>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Captured by staff at customer location before vehicle pickup.
                </p>
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border border-border">
                  {booking.prePickupPhotos.length >= (isBatteryOrTireService ? 2 : 4) ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-green-700">{(isBatteryOrTireService ? 2 : 4)}/{(isBatteryOrTireService ? 2 : 4)} photos</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-amber-600">
                        {booking.prePickupPhotos.length}/{(isBatteryOrTireService ? 2 : 4)} photos
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {booking.prePickupPhotos.map((url, index) => (
                  <button
                    key={index}
                    type="button"
                    className="relative rounded-xl overflow-hidden border border-border bg-muted group"
                    onClick={() => window.open(url, '_blank')}
                  >
                    <img
                      src={url}
                      alt={`Pre-pickup ${index + 1}`}
                      className="w-full h-32 object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Car Wash Photos */}
          {isCarWashService && booking.carWash && (booking.carWash.beforeWashPhotos?.length > 0 || booking.carWash.afterWashPhotos?.length > 0) && (
            <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" /> {isEssentialsService ? 'Service Photos' : 'Car Wash Photos'}
              </h3>
              
              {booking.carWash.beforeWashPhotos && booking.carWash.beforeWashPhotos.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">{isEssentialsService ? 'Before Service Photos' : 'Before Wash Photos'}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {booking.carWash.beforeWashPhotos.map((url, index) => (
                      <button
                        key={index}
                        type="button"
                        className="relative rounded-xl overflow-hidden border border-border bg-muted group"
                        onClick={() => window.open(url, '_blank')}
                      >
                        <img
                          src={url}
                          alt={`Before wash ${index + 1}`}
                          className="w-full h-32 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {booking.carWash.afterWashPhotos && booking.carWash.afterWashPhotos.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">{isEssentialsService ? 'After Service Photos' : 'After Wash Photos'}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {booking.carWash.afterWashPhotos.map((url, index) => (
                      <button
                        key={index}
                        type="button"
                        className="relative rounded-xl overflow-hidden border border-border bg-muted group"
                        onClick={() => window.open(url, '_blank')}
                      >
                        <img
                          src={url}
                          alt={`After wash ${index + 1}`}
                          className="w-full h-32 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isCarWashService && !isBatteryOrTireService && (
            <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" /> Vehicle Inspection Photos
              </h3>
              {booking.inspection && (booking.inspection.frontPhoto || booking.inspection.backPhoto || booking.inspection.leftPhoto || booking.inspection.rightPhoto) ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {['front', 'back', 'left', 'right'].map((side) => {
                      const url = booking.inspection?.[`${side}Photo` as keyof typeof booking.inspection] as string;
                      if (!url) return null;
                      return (
                        <div key={side} className="space-y-1">
                          <span className="text-[10px] uppercase font-bold text-muted-foreground block text-center">{side}</span>
                          <button
                            type="button"
                            className="relative w-full rounded-xl overflow-hidden border border-border bg-muted group aspect-square"
                            onClick={() => window.open(url, '_blank')}
                          >
                            <img
                              src={url}
                              alt={`${side} inspection`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {booking.inspection.damageReport && (
                    <div className="pt-4 border-t border-border">
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Damage Report</h4>
                      <p className="text-sm italic text-muted-foreground">"{booking.inspection.damageReport}"</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic text-center py-2">
                   No inspection photos yet.
                </p>
              )}
            </div>
          )}

          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Car className="w-5 h-5 text-primary" /> Vehicle Details
            </h3>
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Vehicle:</span> {vehicle?.make} {vehicle?.model}</p>
              <p><span className="text-muted-foreground">Plate:</span> {vehicle?.licensePlate}</p>
              <p><span className="text-muted-foreground">Type:</span> {vehicle?.type}</p>
              <button 
                onClick={() => navigate(`/admin/vehicles/${vehicle?._id}`)}
                className="text-primary hover:underline text-xs"
              >
                View Vehicle
              </button>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
             <h3 className="font-semibold flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" /> Payment Info
             </h3>
             <div className="space-y-2 text-sm">
                {isGeneralService && (
                   <div className="flex justify-between">
                      <span className="text-muted-foreground">Pickup/Drop Price:</span>
                      <span className="font-bold">₹{booking.billing?.pickupDropPrice || booking.pickupDropPrice || 0}</span>
                   </div>
                )}
                
                {booking.gstAmount && booking.gstAmount > 0 && !isGeneralService ? (
                  <>
                    <div className="flex justify-between">
                       <span className="text-muted-foreground">Base Service Amount:</span>
                       <span className="font-bold">₹{booking.totalAmount}</span>
                    </div>
                    {booking.discountAmount > 0 && (
                      <div className="flex justify-between">
                         <span className="text-muted-foreground">
                            Discount{booking.coupon?.code ? ` (${booking.coupon.code})` : ''}:
                         </span>
                         <span className="font-bold text-green-600">−₹{booking.discountAmount}</span>
                      </div>
                    )}
                    {booking.discountAmount > 0 && (
                      <div className="flex justify-between">
                         <span className="text-muted-foreground">Price after Discount:</span>
                         <span className="font-bold">
                            ₹{Math.round((booking.totalAmount - booking.discountAmount) * 100) / 100}
                         </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                       <span className="text-muted-foreground">Tax (GST 18%):</span>
                       <span className="font-bold">₹{booking.gstAmount}</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2 mt-2">
                       <span className="text-muted-foreground font-semibold">Total Billed Amount:</span>
                       <span className="font-bold text-primary">
                          ₹{booking.billing?.total || booking.finalAmount || (booking.totalAmount + booking.gstAmount)}
                       </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                     <span className="text-muted-foreground">Total Amount:</span>
                     <span className="font-bold">
                        ₹{booking.billing?.total || 
                          (booking.totalAmount < (booking.pickupDropPrice || 0) 
                            ? (booking.totalAmount + (booking.pickupDropPrice || 0)) 
                            : booking.totalAmount)}
                     </span>
                  </div>
                )}

                <div className="flex justify-between">
                   <span className="text-muted-foreground">Status:</span>
                   <span className={`capitalize ${booking.paymentStatus === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>
                      {booking.paymentStatus}
                   </span>
                </div>

                {booking.paymentStatus === 'paid' && !isGeneralService && (
                  <button
                    onClick={handleDownloadInvoice}
                    className="w-full mt-2 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download Invoice
                  </button>
                )}
             </div>
          </div>

          {booking.billing && booking.billing.invoiceNumber && (
            <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> Merchant Invoice
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice #:</span>
                  <span className="font-medium">{booking.billing.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date:</span>
                  <span>{booking.billing.invoiceDate ? new Date(booking.billing.invoiceDate).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div className="pt-2 border-t border-border space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Base Service:</span>
                    <span>₹{(() => {
                        const serviceList = (Array.isArray(booking.services)
                          ? booking.services.filter((s): s is Service => typeof s === 'object' && s !== null)
                          : []) as Service[];
                        const servicesTotal = serviceList.length > 0
                          ? sumBookingServicesSubtotal(serviceList, vehicleRef, booking.selectedBrands, booking.serviceQuantities)
                          : 0;
                        return servicesTotal;
                    })()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Parts Total:</span>
                    <span>₹{booking.billing.partsTotal || 0}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Labour Cost:</span>
                    <span>₹{booking.billing.labourCost || 0}</span>
                  </div>
                  {isGeneralService && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Pickup/Drop:</span>
                      <span>₹{booking.billing.pickupDropPrice || 0}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">GST:</span>
                    <span>₹{booking.billing.gst || 0}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1">
                    <span>Total:</span>
                    <span>₹{(() => {
                        const serviceList = (Array.isArray(booking.services)
                          ? booking.services.filter((s): s is Service => typeof s === 'object' && s !== null)
                          : []) as Service[];
                        const servicesTotal = serviceList.length > 0
                          ? sumBookingServicesSubtotal(serviceList, vehicleRef, booking.selectedBrands, booking.serviceQuantities)
                          : 0;
                        const parts = booking.billing.partsTotal || 0;
                        const labour = booking.billing.labourCost || 0;
                        const gst = booking.billing.gst || 0;
                        const pickup = booking.billing.pickupDropPrice || 0;
                        
                        if (servicesTotal > 0) {
                          return servicesTotal + parts + labour + gst + pickup;
                        }
                        return booking.billing.total || 0;
                    })()}</span>
                  </div>
                </div>
                {booking.billing.fileUrl && (
                  <button
                    onClick={() => window.open(booking.billing!.fileUrl, '_blank')}
                    className="w-full mt-2 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-semibold hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    View Uploaded Bill
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Center/Right Column - Booking Details & Actions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Warranty Information (Battery/Tire Service) */}
          {isBatteryOrTireService && booking.batteryTire?.warranty && (
            <div className="bg-card rounded-2xl border-2 border-green-100 p-6 space-y-4 shadow-sm">
              <h3 className="font-bold text-xl flex items-center gap-2 text-green-700">
                <Shield className="w-6 h-6" />
                Warranty Information
              </h3>
              
              <div className="flex flex-col md:flex-row gap-8">
                {booking.batteryTire.warranty.image && (
                  <div className="w-full md:w-64 aspect-square rounded-2xl overflow-hidden border-2 border-border bg-muted group relative shadow-md">
                    <img 
                      src={booking.batteryTire.warranty.image} 
                      alt="Warranty Product" 
                      className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                      onClick={() => window.open(booking.batteryTire!.warranty!.image, '_blank')}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-white" />
                    </div>
                  </div>
                )}
                
                <div className="flex-1 space-y-6">
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Product Name</p>
                    <p className="text-2xl font-black text-green-700">{booking.batteryTire.warranty.name}</p>
                  </div>
                  
                  <div className={booking.batteryTire.warranty.price !== undefined && booking.batteryTire.warranty.price !== null ? "grid grid-cols-2 gap-6" : "grid grid-cols-1 gap-6"}>
                    {booking.batteryTire.warranty.price !== undefined && booking.batteryTire.warranty.price !== null && (
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Price</p>
                        <span className="text-2xl font-black text-primary flex items-center gap-1">
                          <IndianRupee className="w-6 h-6" />
                          {booking.batteryTire.warranty.price}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Warranty Period</p>
                      <span className="text-2xl font-black text-green-700">
                        {booking.batteryTire.warranty.warrantyMonths} months
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2">
                    {booking.batteryTire.warranty.addedAt && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Added: {new Date(booking.batteryTire.warranty.addedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {booking.batteryTire.warranty.addedBy && (
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>By: {booking.batteryTire.warranty.addedBy.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Service Details */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="font-semibold text-lg mb-4">Service Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs text-muted-foreground uppercase font-medium">Services Requested</label>
                <div className="mt-2 space-y-1">
                  {Array.isArray(booking.services) && (booking.services as Service[]).map((s, i) => {
                    const qty = booking.serviceQuantities?.[s._id] || booking.serviceQuantities?.[s._id.toString()];
                    const brand = booking.selectedBrands?.[s._id] || booking.selectedBrands?.[s._id.toString()];
                    const qtyStr = qty && Number(qty) > 1 ? ` (Qty: ${qty})` : '';
                    const brandStr = brand ? ` - ${brand}` : '';
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Wrench className="w-4 h-4 text-muted-foreground" />
                        <span>{s.name}{brandStr}{qtyStr}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                   <label className="text-xs text-muted-foreground uppercase font-medium">Scheduled Date</label>
                   <div className="flex items-center gap-2 mt-1">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span>{new Date(booking.date).toLocaleDateString()}</span>
                   </div>
                </div>
                {booking.location && (
                  <div>
                     <label className="text-xs text-muted-foreground uppercase font-medium">Pickup Location</label>
                     <div className="mt-1">
                        {typeof booking.location === 'string' ? (
                           <span className="text-sm">{booking.location}</span>
                        ) : (
                           <div>
                              <p className="text-sm">{booking.location.address}</p>
                              {booking.location.lat && booking.location.lng && (
                                 <a 
                                    href={`https://www.google.com/maps?q=${booking.location.lat},${booking.location.lng}`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1"
                                 >
                                    <MapPin className="w-3 h-3" /> View on Map
                                 </a>
                              )}
                           </div>
                        )}
                     </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Additional Parts - Inspection */}
          {!isCarWashService && !isBatteryOrTireService && Array.isArray(booking.inspection?.additionalParts) && booking.inspection.additionalParts.filter(
            (p) => (p.approvalStatus?.toLowerCase() || (p.approved ? 'approved' : 'pending')) !== 'rejected'
          ).length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-primary" />
                Additional Parts (Found During Inspection)
              </h3>
              <div className="space-y-4">
                {booking.inspection.additionalParts
                  .filter((part) => {
                    const status = part.approvalStatus?.toLowerCase() || (part.approved ? 'approved' : 'pending');
                    return status !== 'rejected';
                  })
                  .map((part, index) => {
                  const status = part.approvalStatus?.toLowerCase() || (part.approved ? 'approved' : 'pending');
                  const total = (part.price || 0) * (part.quantity || 1);
                  return (
                    <div
                      key={index}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-border rounded-xl p-4 bg-muted/40"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-sm">{part.name}</p>
                          <p className="text-sm font-semibold">
                            ₹{part.price} × {part.quantity} = ₹{total}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-3">
                          <span>Qty: {part.quantity}</span>
                          <span>Price: ₹{part.price}</span>
                          <span className="text-blue-600 font-medium">Found during inspection</span>
                          <span className="inline-flex items-center gap-1">
                            {status === 'approved' && <CheckCircle className="w-3 h-3 text-green-500" />}
                            {status === 'rejected' && <XCircle className="w-3 h-3 text-red-500" />}
                            {status === 'pending' && <Clock className="w-3 h-3 text-amber-500" />}
                            <span className="capitalize">{status}</span>
                          </span>
                        </div>
                      </div>
                        <div className="w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                          {(part.image || part.oldImage) ? (
                            <img 
                              src={part.image || part.oldImage} 
                              alt="Part" 
                              className="w-full h-full object-cover cursor-pointer" 
                              onClick={() => window.open(part.image || part.oldImage, '_blank')}
                            />
                          ) : (
                            <span>No image</span>
                          )}
                        </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Additional Parts - Service */}
          {!isCarWashService && !isBatteryOrTireService && Array.isArray(booking.serviceExecution?.serviceParts) && booking.serviceExecution.serviceParts.length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-orange-600" />
                Service Parts (Replaced/Added During Service)
              </h3>
              <div className="space-y-4">
                {booking.serviceExecution.serviceParts.map((part, index) => {
                  const status = part.approvalStatus?.toLowerCase() || 'pending';
                  const total = (part.price || 0) * (part.quantity || 1);
                  return (
                    <div
                      key={index}
                      className={`flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-border rounded-xl p-4 ${
                        part.fromInspection ? 'bg-green-50/40' : 'bg-orange-50/40'
                      }`}
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-sm">{part.name}</p>
                          <p className="text-sm font-semibold">
                            ₹{part.price} × {part.quantity} = ₹{total}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-3">
                          <span>Qty: {part.quantity}</span>
                          <span>Price: ₹{part.price}</span>
                          <span className={`font-medium ${part.fromInspection ? 'text-green-600' : 'text-orange-600'}`}>
                            {part.fromInspection ? 'From approved inspection' : 'New discovery during service'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            {status === 'approved' && <CheckCircle className="w-3 h-3 text-green-500" />}
                            {status === 'rejected' && <XCircle className="w-3 h-3 text-red-500" />}
                            {status === 'pending' && <Clock className="w-3 h-3 text-amber-500" />}
                            <span className="capitalize">{status}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {part.oldImage && (
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted">
                              <img 
                                src={part.oldImage} 
                                alt="Before" 
                                className="w-full h-full object-cover cursor-pointer" 
                                onClick={() => window.open(part.oldImage, '_blank')}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">Before</span>
                          </div>
                        )}
                        {part.image && (
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted">
                              <img 
                                src={part.image} 
                                alt="After" 
                                className="w-full h-full object-cover cursor-pointer" 
                                onClick={() => window.open(part.image, '_blank')}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">After</span>
                          </div>
                        )}
                        {!part.oldImage && !part.image && (
                          <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Service Media Section */}
          {!isCarWashService && !isBatteryOrTireService && (
            booking.serviceExecution?.afterPhotos?.length || 
            booking.serviceExecution?.serviceParts?.length || 
            booking.status === 'SERVICE_COMPLETED' || 
            booking.status === 'COMPLETED' || 
            booking.status === 'DELIVERED'
          ) ? (
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                Service Photos
              </h3>
              
              <div className="grid grid-cols-1 gap-6">
                {booking.serviceExecution?.afterPhotos && booking.serviceExecution.afterPhotos.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">Service Completed Photos</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {booking.serviceExecution.afterPhotos.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => window.open(url, '_blank')}
                          className="aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                        >
                          <img src={url} alt={`After Service ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Assignment Panel */}
          <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 min-w-0 max-w-full overflow-hidden">
             <div className="flex flex-col gap-4 mb-6 min-w-0">
                <h3 className="font-semibold text-base sm:text-lg flex items-center gap-2 min-w-0">
                   <Shield className="w-5 h-5 text-primary shrink-0" />
                   <span className="break-words">Assignments & Operations</span>
                </h3>
                <div className="flex items-stretch sm:items-center gap-3 w-full sm:w-auto">
                   <button 
                     onClick={handleAssignment}
                     className="w-full sm:w-auto px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
                   >
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      Save Assignments
                   </button>
                </div>
             </div>
             
             {isCarWashService ? (
               // Car wash service assignment - only show staff selection
               <div className="space-y-4 min-w-0">
                 <div className="space-y-2 min-w-0">
                   <label className="text-sm font-medium flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-muted-foreground shrink-0" /> Staff
                   </label>
                   <select 
                      className={assignmentSelectClass}
                      value={selectedCarWashStaff}
                      onChange={(e) => setSelectedCarWashStaff(e.target.value)}
                   >
                      <option value="">{isEssentialsService ? 'Select Staff...' : 'Select Car Wash Staff...'}</option>
                      {carWashStaff.map(s => {
                         let label = s.name;
                         if (s.isOnline) label += " 🟢 (Online)";
                         if (s.subRole) label += ` (${s.subRole})`;
                         
                         const sLat = s.location?.lat;
                         const sLng = s.location?.lng;
                         const bLat = typeof booking.location === 'object' ? (booking.location as any).lat : null;
                         const bLng = typeof booking.location === 'object' ? (booking.location as any).lng : null;

                         if (bLat && bLng && sLat && sLng && sLat !== 0 && sLng !== 0) {
                            try {
                               const from = turf.point([bLng, bLat]);
                               const to = turf.point([sLng, sLat]);
                               const dist = turf.distance(from, to);
                               if (dist < 1) {
                                  const meters = Math.round(dist * 1000);
                                  label += ` - ${meters} m`;
                               } else {
                                  label += ` - ${dist.toFixed(1)} km`;
                               }
                            } catch (e) { /* ignore */ }
                         } else if (s.isOnline) {
                            label += " - Location unknown";
                         }
                         return <option key={s._id} value={s._id}>{truncateOptionLabel(label)}</option>;
                      })}
                   </select>
                 </div>
                 {booking.carWash?.staffAssigned && (
                   <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                     <p className="text-sm text-green-800">
                       <strong>Assigned Staff:</strong> {typeof booking.carWash.staffAssigned === 'object' && booking.carWash.staffAssigned !== null ? booking.carWash.staffAssigned.name : 'Staff'}
                     </p>
                   </div>
                 )}
               </div>
             ) : isBatteryOrTireService ? (
               // Battery/Tire service assignment - show both merchant and staff selection
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                 <div className="space-y-2 min-w-0">
                   <label className="text-sm font-medium flex items-center gap-2">
                      <Store className="w-4 h-4 text-muted-foreground shrink-0" /> Merchant/Workshop
                   </label>
                   <select 
                      className={assignmentSelectClass}
                      value={selectedMerchant}
                      onChange={(e) => setSelectedMerchant(e.target.value)}
                   >
                      <option value="">Select Merchant...</option>
                      {sortedMerchants.map(m => {
                         let label = m.name;
                         // Add Open/Closed status
                         if (m.isShopOpen === false) label += " (Closed 🔴)";
                         else label += " (Open 🟢)";

                         // Add Distance
                         const mLat = m.location?.lat;
                         const mLng = m.location?.lng;
                         const bLat = typeof booking.location === 'object' ? (booking.location as any).lat : null;
                         const bLng = typeof booking.location === 'object' ? (booking.location as any).lng : null;

                         if (bLat && bLng && mLat && mLng && mLat !== 0 && mLng !== 0) {
                            try {
                               const from = turf.point([bLng, bLat]);
                               const to = turf.point([mLng, mLat]);
                               const dist = turf.distance(from, to);
                               if (dist < 1) {
                                  const meters = Math.round(dist * 1000);
                                  label += ` - ${meters} m`;
                               } else {
                                  label += ` - ${dist.toFixed(1)} km`;
                               }
                            } catch (e) { /* ignore */ }
                         }
                         return <option key={m._id} value={m._id}>{truncateOptionLabel(label)}</option>;
                      })}
                   </select>
                 </div>

                 <div className="space-y-2 min-w-0">
                   <label className="text-sm font-medium flex items-center gap-2">
                      <Truck className="w-4 h-4 text-muted-foreground shrink-0" /> Battery/Tire Service Staff
                   </label>
                   <select 
                      className={assignmentSelectClass}
                      value={selectedDriver}
                      onChange={(e) => setSelectedDriver(e.target.value)}
                   >
                      <option value="">Select Service Staff...</option>
                      {sortedDrivers.map(d => {
                         let label = d.name;
                         if (d.isOnline) label += " 🟢 (Online)";
                         if (d.subRole) label += ` (${d.subRole})`;
                         
                         const dLat = d.location?.lat;
                         const dLng = d.location?.lng;
                         const bLat = typeof booking.location === 'object' ? (booking.location as any).lat : null;
                         const bLng = typeof booking.location === 'object' ? (booking.location as any).lng : null;

                         if (bLat && bLng && dLat && dLng && dLat !== 0 && dLng !== 0) {
                            try {
                               const from = turf.point([bLng, bLat]);
                               const to = turf.point([dLng, dLat]);
                               const dist = turf.distance(from, to);
                               if (dist < 1) {
                                  const meters = Math.round(dist * 1000);
                                  label += ` - ${meters} m`;
                               } else {
                                  label += ` - ${dist.toFixed(1)} km`;
                               }
                            } catch (e) { /* ignore */ }
                         } else if (d.isOnline) {
                            label += " - Location unknown";
                         }
                         return <option key={d._id} value={d._id}>{truncateOptionLabel(label)}</option>;
                      })}
                   </select>
                 </div>

                 {/* Show current assignments */}
                 {(booking.merchant || booking.pickupDriver) && (
                   <div className="md:col-span-2 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                     <div className="space-y-1 text-sm text-green-800">
                       {booking.merchant && (
                         <p><strong>Assigned Merchant:</strong> {typeof booking.merchant === 'object' && booking.merchant !== null ? booking.merchant.name : 'Merchant'}</p>
                       )}
                       {booking.pickupDriver && (
                         <p><strong>Assigned Staff:</strong> {typeof booking.pickupDriver === 'object' && booking.pickupDriver !== null ? booking.pickupDriver.name : 'Staff'}</p>
                       )}
                     </div>
                   </div>
                 )}
               </div>
             ) : (
               // Regular service assignment - show merchant and driver
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                  <div className="space-y-2 min-w-0">
                     <label className="text-sm font-medium flex items-center gap-2">
                        <Store className="w-4 h-4 text-muted-foreground shrink-0" /> Merchant/Workshop
                     </label>
                     <select 
                        className={assignmentSelectClass}
                        value={selectedMerchant}
                        onChange={(e) => setSelectedMerchant(e.target.value)}
                     >
                        <option value="">Select Merchant...</option>
                        {sortedMerchants.map(m => {
                           let label = m.name;
                           // Add Open/Closed status
                           if (m.isShopOpen === false) label += " (Closed 🔴)";
                           else label += " (Open 🟢)";

                           // Add Distance
                           if (booking?.location && typeof booking.location === 'object' && booking.location.lat && m.location?.lat) {
                              try {
                                 const from = turf.point([booking.location.lng!, booking.location.lat]);
                                 const to = turf.point([m.location.lng!, m.location.lat]);
                                 const distance = turf.distance(from, to);
                                 if (distance < 1) {
                                    const meters = Math.round(distance * 1000);
                                    label += ` - ${meters} m`;
                                 } else {
                                    label += ` - ${distance.toFixed(1)} km`;
                                 }
                              } catch (e) {
                                 // ignore error
                              }
                           }
                           return <option key={m._id} value={m._id}>{truncateOptionLabel(label)}</option>
                        })}
                     </select>
                  </div>

                  <div className="space-y-2 min-w-0">
                    <label className="text-sm font-medium flex items-center gap-2">
                       <Truck className="w-4 h-4 text-muted-foreground shrink-0" /> Pickup Driver
                    </label>
                    <select 
                       className={assignmentSelectClass}
                       value={selectedDriver}
                       onChange={(e) => setSelectedDriver(e.target.value)}
                    >
                       <option value="">Select Driver...</option>
                       {sortedDrivers.map(d => {
                         let label = d.name;
                         if (d.isOnline) label += " 🟢 (Online)";
                         if (booking?.location && typeof booking.location === 'object' && booking.location.lat && d.location?.lat) {
                            try {
                               const from = turf.point([booking.location.lng!, booking.location.lat!]);
                               const to = turf.point([d.location.lng!, d.location.lat!]);
                               const dist = turf.distance(from, to);
                               if (dist < 1) {
                                  const meters = Math.round(dist * 1000);
                                  label += ` - ${meters} m`;
                               } else {
                                  label += ` - ${dist.toFixed(1)} km`;
                               }
                            } catch (e) { /* ignore */ }
                         }
                         return <option key={d._id} value={d._id}>{truncateOptionLabel(label)}</option>;
                       })}
                    </select>
                  </div>
               </div>
             )}
          </div>

          {/* Status Workflow */}
          <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 min-w-0 max-w-full overflow-hidden">
             <h3 className="font-semibold text-base sm:text-lg mb-4">Workflow Actions</h3>
            <div className="flex flex-wrap gap-2 min-w-0">
               {(isCarWashService ? (
                 // Car wash specific workflow
                 [
                    { label: 'Created', value: 'CREATED' },
                    { label: 'Assigned', value: 'ASSIGNED' },
                    { label: 'Reached Customer', value: 'REACHED_CUSTOMER' },
                    { label: getStatusLabel('CAR_WASH_STARTED', booking.services || []), value: 'CAR_WASH_STARTED' },
                    { label: getStatusLabel('CAR_WASH_COMPLETED', booking.services || []), value: 'CAR_WASH_COMPLETED' },
                    { label: 'Delivered', value: 'DELIVERED' },
                    { label: 'Cancelled', value: 'CANCELLED' }
                 ]
               ) : isBatteryOrTireService ? (
                 // Battery/Tire specific workflow
                 [
                    { label: 'Created', value: 'CREATED' },
                    { label: 'Assigned', value: 'ASSIGNED' },
                    { label: 'Staff Reached Merchant', value: 'STAFF_REACHED_MERCHANT' },
                    { label: 'Pickup Battery/Tire', value: 'PICKUP_BATTERY_TIRE' },
                    { label: 'Reached Customer', value: 'REACHED_CUSTOMER' },
                    { label: 'Installation', value: 'INSTALLATION' },
                    { label: 'Delivery', value: 'DELIVERY' },
                    { label: 'Completed', value: 'COMPLETED' },
                    { label: 'Cancelled', value: 'CANCELLED' }
                 ]
               ) : (
                 // Regular service workflow
                 [
                    { label: 'Created', value: 'CREATED' },
                    { label: 'Assigned', value: 'ASSIGNED' },
                    { label: 'Vehicle Picked', value: 'VEHICLE_PICKED' },
                    { label: 'Reached Merchant', value: 'REACHED_MERCHANT' },
                    { label: 'Service Started', value: 'SERVICE_STARTED' },
                    { label: 'Service Completed', value: 'SERVICE_COMPLETED' },
                    { label: 'Out For Delivery', value: 'OUT_FOR_DELIVERY' },
                    { label: 'Delivered', value: 'DELIVERED' },
                    { label: 'Cancelled', value: 'CANCELLED' }
                 ]
               )).map((s) => (
                  <button
                    key={s.value}
                    onClick={() => handleStatusUpdate(s.value)}
                    disabled={booking.status === s.value}
                    className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shrink-0
                      ${booking.status === s.value 
                        ? 'bg-primary text-primary-foreground shadow-md' 
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
                  >
                    {s.label}
                  </button>
               ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default BookingDetailPage;
