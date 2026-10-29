import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, User as UserIcon, Calendar, Wrench, Car, AlertTriangle, MapPin, Navigation, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { bookingService, Booking } from '../../services/bookingService';
import { socketService } from '@/services/socket';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import { routingService } from '@/services/routingService';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon in Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const MapController = ({ center, zoom }: { center: [number, number]; zoom: number }) => {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { animate: true, duration: 1.0 });
  }, [map, center, zoom]);
  return null;
};

import { Service } from '@/services/serviceService';
import { Vehicle } from '@/services/vehicleService';
import { User } from '@/services/userService';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ChatWidget from '@/components/ChatWidget';
import { forceHideChatUntilGeneralServiceStarted, forceHideChatWhenServiceCompleted } from '@/lib/bookingGeneralServiceChat';

// Panels
import StatusControlPanel from '../../components/merchant/StatusControlPanel';
import InspectionPanel from '../../components/merchant/InspectionPanel';
import WarrantyPanel from '../../components/merchant/WarrantyPanel';
import QCPanel from '../../components/merchant/QCPanel';
import VehicleHealthPanel from '../../components/merchant/VehicleHealthPanel';
import BillUploadPanel from '../../components/merchant/BillUploadPanel';
import MediaUploadPanel from '../../components/merchant/MediaUploadPanel';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1
  }
};

import { useTracking } from '@/hooks/use-tracking';

const OrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { setActiveBookingId } = useTracking();

  useEffect(() => {
    if (id) {
      setActiveBookingId(id);
    }
    return () => {
      setActiveBookingId(null);
    };
  }, [id, setActiveBookingId]);
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [staffLocation, setStaffLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Where the staff member is heading: the customer until the vehicle is
  // picked up, then the workshop (same rule as the staff app).
  const routeDestination = (() => {
    if (!booking) return null;
    const atWorkshop = ['VEHICLE_PICKED', 'REACHED_MERCHANT', 'VEHICLE_AT_MERCHANT', 'SERVICE_STARTED', 'SERVICE_COMPLETED'];
    const merchantLoc = (booking as any).merchant?.location;
    const customerLoc = typeof booking.location === 'object' ? booking.location : null;
    const loc = atWorkshop.includes(booking.status) && merchantLoc?.lat ? merchantLoc : customerLoc;
    return loc?.lat && loc?.lng ? { lat: Number(loc.lat), lng: Number(loc.lng) } : null;
  })();
  // Refetch only when the staff moves ~10 m+ (4 decimal places), not on
  // every GPS tick.
  const routeKey = staffLocation && routeDestination
    ? `${staffLocation.lat.toFixed(4)},${staffLocation.lng.toFixed(4)}>${routeDestination.lat},${routeDestination.lng}`
    : '';

  useEffect(() => {
    if (!routeKey || !staffLocation || !routeDestination) {
      setRouteGeometry([]);
      return;
    }
    let cancelled = false;
    routingService
      .getRoute([staffLocation.lat, staffLocation.lng], [routeDestination.lat, routeDestination.lng])
      .then((response) => {
        const geometry = response.routes?.[0]?.geometry;
        if (cancelled || !geometry || typeof geometry !== 'object') return;
        setRouteGeometry(geometry.coordinates.map((c) => [c[1], c[0]] as [number, number]));
      })
      .catch(() => {
        if (!cancelled) setRouteGeometry([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  const [isInitialTabSet, setIsInitialTabSet] = useState(false);

  const fetchBooking = useCallback(async (sourceTab?: string) => {
    if (!id) return;
    try {
      const data = await bookingService.getBookingById(id);
      


      const previousQCStatus = booking?.qc?.completedAt;
      const newQCStatus = data.qc?.completedAt;
      
      const previousStatus = booking?.status;
      const newStatus = data.status;
      
      setBooking(data);
      
      // Auto-switch to Inspection tab when status changes to SERVICE_STARTED (only for non-battery/tire services)
      if (previousStatus !== 'SERVICE_STARTED' && newStatus === 'SERVICE_STARTED' && !data.batteryTire?.isBatteryTireService) {
        setActiveTab('inspection');
      }
      // After Save Service Data — must run before the inspection→service branch: fetchBooking's closure
      // can have a stale activeTab (tab switch does not refresh the callback deps), which would otherwise
      // re-select "service" and skip this transition.
      else if (sourceTab === 'service') {
        const afterPhotoCount = data.serviceExecution?.afterPhotos?.length ?? 0;
        if (afterPhotoCount >= 4 && !data.qc?.completedAt) {
          setActiveTab('qc');
        }
      }
      // After Save health stats — same priority as service save (avoid stale activeTab branches).
      else if (sourceTab === 'health') {
        setActiveTab('billing');
      }
      // QC→Health must run before inspection→service: fetchBooking's closure can have a stale `activeTab`
      // (tab is not in useCallback deps), so after confirming QC the old branch could incorrectly force "service".
      else if (!previousQCStatus && newQCStatus && !data.batteryTire?.isBatteryTireService) {
        setActiveTab('health');
      }
      // Auto-switch to Service tab when Inspection is completed
      else if (
        data.inspection?.completedAt &&
        !data.qc?.completedAt &&
        activeTabRef.current !== 'service' &&
        activeTabRef.current !== 'qc'
      ) {
        setActiveTab('service');
      }
      
      // Set initial tab based on booking state ONLY ONCE on first load
      if (!isInitialTabSet) {
        if (data.batteryTire?.isBatteryTireService) {
          setActiveTab('overview');
        } else if (data.qc?.completedAt) {
          setActiveTab('health');
        } else if (data.inspection?.completedAt) {
          setActiveTab('service');
        } else if (data.status === 'SERVICE_STARTED') {
          setActiveTab('inspection');
        } else {
          setActiveTab('overview');
        }
        setIsInitialTabSet(true);
      }
    } catch (error) {
      toast.error('Failed to load order details');
      navigate('/merchant/orders');
    } finally {
      setLoading(false);
    }
  }, [id, navigate, booking?.qc?.completedAt, booking?.status, isInitialTabSet]);

  const handleQCUpdate = useCallback(async () => {
    await fetchBooking();
    // The fetchBooking function will handle the tab switch automatically
  }, [fetchBooking]);

  useEffect(() => {
    fetchBooking();

    // Socket Connection for Live Tracking
    if (id) {
      socketService.connect();
      socketService.joinRoom(`booking_${id}`);

      socketService.on('liveLocation', (data: { lat?: number; lng?: number; role?: string }) => {
        if (data.lat && data.lng) {
          setStaffLocation({ lat: data.lat, lng: data.lng });
        }
      });

      socketService.on('bookingUpdated', (updatedBooking: Booking) => {
        if (updatedBooking._id === id) {
          setBooking(updatedBooking);
        }
      });

      return () => {
        socketService.leaveRoom(`booking_${id}`);
        socketService.off('liveLocation');
        socketService.off('bookingUpdated');
      };
    }
  }, [id, fetchBooking]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!booking) return null;

  const isEssentials = Array.isArray(booking.services) && 
    booking.services.some(service => {
      if (typeof service !== 'object' || !service.category) return false;
      const cat = service.category.toLowerCase();
      return cat.includes('essentials');
    });

  const isCarWashService = Array.isArray(booking.services) && 
    booking.services.some(service => {
      if (typeof service !== 'object' || !service.category) return false;
      const cat = service.category.toLowerCase();
      return cat.includes('car wash') || cat.includes('wash') || cat.includes('essentials');
    });

  const hasApprovedParts = Array.isArray(booking.inspection?.additionalParts) && 
    booking.inspection.additionalParts.some(part => 
      part.approvalStatus?.toLowerCase() === 'approved' || part.approved
    );

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 space-y-6 pb-24 lg:pb-10 w-full min-w-0 max-w-full overflow-x-hidden"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/merchant/orders')}
            className="p-2 hover:bg-muted rounded-full transition-colors shrink-0"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 truncate">Order #{booking.orderNumber ?? booking._id?.slice(-6).toUpperCase()}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{new Date(booking.date).toLocaleDateString()}</span>
              <span>•</span>
              <span className="font-medium text-primary uppercase text-[10px] md:text-xs tracking-wider">{booking.status}</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Status & Workflow Control */}
      <motion.div variants={itemVariants}>
        <StatusControlPanel booking={booking} onUpdate={fetchBooking} />
      </motion.div>

      {/* Main Content Tabs */}
      <motion.div variants={itemVariants}>
        <Tabs 
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full min-w-0 max-w-full"
        >
            <TabsList className={`grid w-full min-w-0 max-w-full gap-2 h-auto p-2 bg-muted/50 border border-border rounded-2xl ${
                (isCarWashService && !hasApprovedParts) 
                ? 'grid-cols-1' 
                : (booking.batteryTire?.isBatteryTireService 
                    ? 'grid-cols-2' 
                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6')
            }`}>

                <TabsTrigger 
                    value="overview" 
                    className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm"
                >
                    Overview
                </TabsTrigger>
                {booking.batteryTire?.isBatteryTireService ? (
                    <>
                        <TabsTrigger 
                            value="warranty" 
                            className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm"
                        >
                            Warranty
                        </TabsTrigger>
                    </>
                ) : (!isCarWashService || hasApprovedParts) && (
                    <>
                        <TabsTrigger 
                            value="inspection"
                            disabled={booking.status !== 'SERVICE_STARTED'}
                            title={booking.status !== 'SERVICE_STARTED' ? "Available only when service is started" : ""}
                            className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm disabled:opacity-40"
                        >
                            Inspection
                        </TabsTrigger>
                        <TabsTrigger 
                            value="service"
                            disabled={!booking.inspection?.completedAt && !hasApprovedParts}
                            title={!booking.inspection?.completedAt && !hasApprovedParts ? "Complete Inspection first" : ""}
                            className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm disabled:opacity-40"
                        >
                            Service
                        </TabsTrigger>
                        <TabsTrigger 
                            value="qc"
                            disabled={!booking.inspection?.completedAt && !hasApprovedParts}
                            title={!booking.inspection?.completedAt && !hasApprovedParts ? "Complete Inspection first" : ""}
                            className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm disabled:opacity-40"
                        >
                            QC Check
                        </TabsTrigger>
                        <TabsTrigger 
                            value="health"
                            disabled={!booking.inspection?.completedAt && !hasApprovedParts}
                            title={!booking.inspection?.completedAt && !hasApprovedParts ? "Complete Inspection first" : ""}
                            className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm disabled:opacity-40"
                        >
                            Health
                        </TabsTrigger>
                        <TabsTrigger 
                            value="billing"
                            disabled={!booking.qc?.completedAt && !hasApprovedParts}
                            title={!booking.qc?.completedAt && !hasApprovedParts ? "Complete QC Check first" : ""}
                            className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-xl shadow-sm disabled:opacity-40"
                        >
                            Billing
                        </TabsTrigger>
                    </>
                )}
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        {/* Order Info Card */}
                        <div className="bg-card border border-border rounded-xl p-4 md:p-6 shadow-sm">
                            <h2 className="text-lg font-semibold mb-4">Order Information</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                <div className="flex items-start gap-3">
                                    <div className="p-2 bg-blue-50 rounded-lg">
                                        <Car className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Vehicle Details</p>
                                        <p className="font-medium">{(booking.vehicle as unknown as Vehicle)?.licensePlate || 'N/A'}</p>
                                        <p className="text-sm text-gray-500">{(booking.vehicle as unknown as Vehicle)?.make} {(booking.vehicle as unknown as Vehicle)?.model}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="p-2 bg-purple-50 rounded-lg">
                                        <UserIcon className="w-5 h-5 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Customer</p>
                                        <p className="font-medium">{(booking.user as unknown as User)?.name || 'Guest User'}</p>
                                        <p className="text-xs text-muted-foreground italic">Contact hidden (Privacy)</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="p-2 bg-orange-50 rounded-lg">
                                        <Wrench className="w-5 h-5 text-orange-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Service Category</p>
                                        <p className="font-medium">
                                            {Array.isArray(booking.services) 
                                                ? (booking.services as unknown as Service[]).map((s) => s.name).join(', ') 
                                                : 'General Service'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="p-2 bg-green-50 rounded-lg">
                                        <Calendar className="w-5 h-5 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Scheduled Date</p>
                                        <p className="font-medium">{new Date(booking.date).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                {booking.location && (
                                  <div className="flex items-start gap-3">
                                      <div className="p-2 bg-indigo-50 rounded-lg">
                                          <MapPin className="w-5 h-5 text-indigo-600" />
                                      </div>
                                      <div>
                                          <p className="text-sm font-medium text-muted-foreground">Pickup Location</p>
                                          {typeof booking.location === 'string' ? (
                                              <p className="font-medium text-sm">{booking.location}</p>
                                          ) : (
                                              <div>
                                                  <p className="font-medium text-sm">{booking.location.address}</p>
                                                  {booking.location.lat && booking.location.lng && (
                                                      <a 
                                                          href={`https://www.google.com/maps?q=${booking.location.lat},${booking.location.lng}`} 
                                                          target="_blank" 
                                                          rel="noreferrer"
                                                          className="text-xs text-blue-600 hover:underline"
                                                      >
                                                          View on Map
                                                      </a>
                                                  )}
                                              </div>
                                          )}
                                      </div>
                                  </div>
                                )}
                            </div>
                            
                            {booking.revisit?.isRevisit && (
                                <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                                    <div>
                                        <p className="font-semibold text-red-800">Revisit Order</p>
                                        <p className="text-sm text-red-700">This is a revisit for a previous service. Please prioritize.</p>
                                        <p className="text-xs text-red-600 mt-1">Reason: {booking.revisit.reason}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Live Tracking Map for Staff */}
                        {([
                          'ASSIGNED',
                          'ACCEPTED',
                          'REACHED_CUSTOMER',
                          'VEHICLE_PICKED',
                          'REACHED_MERCHANT',
                          'OUT_FOR_DELIVERY',
                          'STAFF_REACHED_MERCHANT',
                          'PICKUP_BATTERY_TIRE',
                          'INSTALLATION',
                          'DELIVERY'
                        ].includes(booking.status)) && (
                          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-border flex justify-between items-center">
                              <h3 className="font-semibold flex items-center gap-2">
                                <Navigation className="w-5 h-5 text-primary" />
                                Live Staff Tracking
                              </h3>
                              <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-bold uppercase animate-pulse">Live</span>
                            </div>
                            <div className="h-[300px] bg-muted relative">
                                {staffLocation ? (
                                    <MapContainer
                                        center={[staffLocation.lat, staffLocation.lng]}
                                        zoom={16}
                                        style={{ height: '100%', width: '100%' }}
                                        className="rounded-b-xl"
                                    >
                                        <MapController center={[staffLocation.lat, staffLocation.lng]} zoom={16} />
                                        <TileLayer
                                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        />
                                        <Marker position={[staffLocation.lat, staffLocation.lng]}>
                                            <Popup>
                                                <div className="text-center">
                                                    <p className="font-medium">Staff Location</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Last updated: {new Date().toLocaleTimeString()}
                                                    </p>
                                                </div>
                                            </Popup>
                                        </Marker>
                                        {routeGeometry.length > 0 && (
                                            <Polyline positions={routeGeometry} color="#2563eb" weight={4} opacity={0.85} />
                                        )}
                                        {routeDestination && (
                                            <Marker position={[routeDestination.lat, routeDestination.lng]}>
                                                <Popup>Destination</Popup>
                                            </Marker>
                                        )}
                                    </MapContainer>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <Navigation className="w-8 h-8 mb-2 opacity-50" />
                                        <p className="text-sm">Waiting for staff location...</p>
                                        <p className="text-xs mt-1">Staff will appear here when they start tracking</p>
                                    </div>
                                )}
                            </div>
                          </div>
                        )}

                        {/* Staff Pickup & Installation Photos (Visible to Merchant) */}
                        {booking.batteryTire?.isBatteryTireService && Array.isArray(booking.prePickupPhotos) && booking.prePickupPhotos.length > 0 && (
                          <div className="bg-card border border-border rounded-xl shadow-sm p-4 md:p-6 space-y-4">
                            <h3 className="font-semibold flex items-center gap-2">
                              <Camera className="w-5 h-5 text-primary" />
                              Staff Pickup & Installation Photos
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {booking.prePickupPhotos.map((url, index) => (
                                <div key={index} className="relative aspect-square rounded-xl overflow-hidden border border-border bg-muted group shadow-sm">
                                  <img 
                                    src={url} 
                                    alt={`Staff Photo ${index + 1}`} 
                                    className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                                    onClick={() => window.open(url, '_blank')}
                                  />
                                  <div className="absolute bottom-1 right-1 p-1 bg-black/50 text-white rounded text-[8px] opacity-100 transition-opacity">
                                    {index === 0 ? 'New Part' :
                                     index === 1 ? 'Old Part' :
                                     `Photo ${index + 1}`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* After Service Photos for Battery/Tire Services */}
                        {booking.batteryTire?.isBatteryTireService && (
                          <div className="bg-card border border-border rounded-xl shadow-sm p-4 md:p-6 space-y-4">
                            <MediaUploadPanel 
                              bookingId={booking._id} 
                              booking={booking} 
                              onUploadComplete={fetchBooking} 
                            />
                          </div>
                        )}


                    </div>
                </div>
            </TabsContent>



            {/* Warranty Tab - Only for battery/tire services */}
            {booking.batteryTire?.isBatteryTireService && (
                <TabsContent value="warranty" className="space-y-6 mt-8">
                    <WarrantyPanel booking={booking} onUpdate={fetchBooking} />
                </TabsContent>
            )}

            {/* Inspection Tab */}
            {!booking.batteryTire?.isBatteryTireService && (!isCarWashService || hasApprovedParts) && (
                <TabsContent value="inspection" className="mt-8">
                    <InspectionPanel booking={booking} onUpdate={fetchBooking} />
                </TabsContent>
            )}

            {/* Service Tab */}
            {!booking.batteryTire?.isBatteryTireService && (!isCarWashService || hasApprovedParts) && (
                <TabsContent value="service" className="space-y-6 mt-8">
                    <MediaUploadPanel bookingId={booking._id} booking={booking} onUploadComplete={() => fetchBooking('service')} />
                </TabsContent>
            )}

            {/* QC Tab */}
            {!booking.batteryTire?.isBatteryTireService && (!isCarWashService || hasApprovedParts) && (
                <TabsContent value="qc" className="space-y-6 mt-8">
                    <QCPanel booking={booking} onUpdate={handleQCUpdate} />
                </TabsContent>
            )}

            {/* Health Tab */}
            {!booking.batteryTire?.isBatteryTireService && (!isCarWashService || hasApprovedParts) && (
                <TabsContent value="health" className="mt-8">
                    <VehicleHealthPanel
                      booking={booking}
                      onUpdate={fetchBooking}
                      onHealthStatsSaved={() => fetchBooking('health')}
                    />
                </TabsContent>
            )}

            {/* Billing Tab */}
            {!booking.batteryTire?.isBatteryTireService && (!isCarWashService || hasApprovedParts) && (
                <TabsContent value="billing" className="mt-8">
                    <BillUploadPanel booking={booking} onUploadComplete={fetchBooking} />
                </TabsContent>
            )}
        </Tabs>
      </motion.div>
      
      {/* Floating Chat Widget */}
      <ChatWidget
        bookingId={booking._id}
        status={booking.status}
        onUpdate={fetchBooking}
        forceHidden={
          forceHideChatUntilGeneralServiceStarted(booking) || forceHideChatWhenServiceCompleted(booking)
        }
      />
    </motion.div>
  );
};

export default OrderDetail;
