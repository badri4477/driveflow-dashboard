import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Phone, 
  MapPin, 
  Car,
  ChevronLeft,
  CreditCard,
  Star,
  ThumbsUp,
  Navigation,
  Image as ImageIcon,
  Loader2,
  Truck,
  Wrench,
  Shield,
  Maximize2,
  Minimize2,
  Download
} from 'lucide-react';
import { bookingService, Booking } from '@/services/bookingService';
import { getMyApprovals, updateApprovalStatus, ApprovalRequest } from '@/services/approvalService';
import { reviewService } from '@/services/reviewService';
import { paymentService } from '@/services/paymentService';
import { socketService } from '@/services/socket';
import GlobalSyncRefresh from '@/components/GlobalSyncRefresh';
import Timeline from '@/components/Timeline';
import { PICKUP_FLOW_ORDER, CAR_WASH_FLOW_ORDER, NO_PICKUP_FLOW_ORDER, BATTERY_TIRE_FLOW_ORDER, STATUS_LABELS, BookingStatus, getFlowForService, getStatusLabel } from '@/lib/statusFlow';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import { AlertTriangle, Check, X, Clock } from 'lucide-react';
import ChatWidget from '@/components/ChatWidget';
import { forceHideChatUntilGeneralServiceStarted, forceHideChatWhenServiceCompleted, canCustomerSeeDeliveryOtp } from '@/lib/bookingGeneralServiceChat';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getETA, ETAResponse } from '@/services/trackingService';
import { routingService } from '@/services/routingService';
import { SmoothMarker } from '@/components/SmoothMarker';
import * as turf from '@turf/turf';
import { Vehicle } from '@/services/vehicleService';
import { searchVehicleReference } from '@/services/vehicleReferenceService';
import { sumBookingServicesSubtotal } from '@/lib/vehicleServicePricing';
import type { Service } from '@/services/serviceService';
import { cn } from '@/lib/utils';

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

const mergePhotoUrlLists = (previous: string[] = [], incoming: string[] = []): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const url of [...previous, ...incoming]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push(url);
  }
  return merged.slice(0, 4);
};

const mergeBookingCarWashPhotos = (previous: Booking | null, incoming: Booking): Booking => {
  if (previous && previous._id === incoming._id) {
    if (previous.deliveryOtp?.code && !incoming.deliveryOtp?.code) {
      incoming.deliveryOtp = {
        ...incoming.deliveryOtp,
        code: previous.deliveryOtp.code
      };
    }
  }

  if (!previous?.carWash || !incoming.carWash || previous._id !== incoming._id) {
    return incoming;
  }
  return {
    ...incoming,
    carWash: {
      ...incoming.carWash,
      beforeWashPhotos: mergePhotoUrlLists(
        previous.carWash.beforeWashPhotos,
        incoming.carWash.beforeWashPhotos,
      ),
      afterWashPhotos: mergePhotoUrlLists(
        previous.carWash.afterWashPhotos,
        incoming.carWash.afterWashPhotos,
      ),
    },
  };
};

const MapController = ({ center, destination, zoom, isMaximized }: { center: [number, number]; destination?: [number, number]; zoom: number; isMaximized: boolean }) => {
  const map = useMap();
  
  useEffect(() => {
    if (destination && destination[0] && destination[1]) {
      const bounds = L.latLngBounds([center, destination]);
      map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1.0 });
    } else {
      map.flyTo(center, zoom, { animate: true, duration: 1.0 });
    }
  }, [map, center, destination, zoom]);

  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 500);
  }, [map, isMaximized]);

  return null;
};

import { useTracking } from '@/hooks/use-tracking';

const TrackServicePage: React.FC = () => {
  const { id } = useParams();
  const { setActiveBookingId } = useTracking();
  const { user } = useAuthStore();

  /** /track uses PublicLayout (no shell padding) — always pad content; safe-area for mobile */
  const pageClass = cn(
    'mx-auto w-full min-w-0 max-w-3xl',
    'px-4 sm:px-5',
    'pt-[max(1rem,env(safe-area-inset-top,0px))] sm:pt-6',
    'pb-[max(5.5rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]',
    'space-y-4 sm:space-y-6',
  );

  useEffect(() => {
    if (id) {
      setActiveBookingId(id);
    }
    return () => {
      setActiveBookingId(null);
    };
  }, [id, setActiveBookingId]);
  const navigate = useNavigate();
  const [order, setOrder] = useState<Booking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [merchantRating, setMerchantRating] = useState(0);
  const [merchantComment, setMerchantComment] = useState('');
  const [platformRating, setPlatformRating] = useState(0);
  const [platformComment, setPlatformComment] = useState('');
  const [isRatingSubmitting, setIsRatingSubmitting] = useState(false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [isMapMaximized, setIsMapMaximized] = useState(false);
  const [vehicleRef, setVehicleRef] = useState<Record<string, unknown> | null>(null);
  // Admin-configurable per-category invoice toggle (AdminBookingsPage). Null
  // while unloaded/unavailable — callers fall back to the pre-toggle
  // defaults (general/tyre-battery blocked, everything else allowed) so
  // this never widens access ahead of a confirmed settings fetch.
  const [invoiceSettings, setInvoiceSettings] = useState<{ general: boolean; carWash: boolean; tyres: boolean; battery: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    bookingService.getInvoiceSettings()
      .then((settings) => { if (!cancelled) setInvoiceSettings(settings); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const isCarWashService = order?.carWash?.isCarWashService || false;

  const isTireService = Array.isArray(order?.services) &&
    order.services.some(service => {
      if (typeof (service as any) !== 'object' || !(service as any).category) return false;
      const cat = (service as any).category.toLowerCase();
      return cat.includes('tire') || cat.includes('tyre');
    });

  const isBatteryService = Array.isArray(order?.services) &&
    order.services.some(service => {
      if (typeof (service as any) !== 'object' || !(service as any).category) return false;
      const cat = (service as any).category.toLowerCase();
      return cat.includes('battery');
    });

  const isBatteryOrTire = isTireService || isBatteryService;

  const isEssentials = Array.isArray(order?.services) && 
    order.services.some(service => {
      if (typeof (service as any) !== 'object' || !(service as any).category) return false;
      const cat = (service as any).category.toLowerCase();
      return cat.includes('essentials');
    });

  const isGeneralService = Array.isArray(order?.services) && 
    order.services.some(service => {
      if (typeof (service as any) !== 'object') return false;
      const cat = (service as any).category;
      const name = (service as any).name?.toLowerCase() || '';
      return cat === 'Periodic' || cat === 'Services' || name.includes('general service');
    });

  // Whether a generated PDF invoice is currently offered for this booking's
  // category, per admin toggle. Defaults match the pre-toggle behavior
  // (general/tyres/battery blocked) until the setting is confirmed loaded.
  const canDownloadGeneratedInvoice = isGeneralService
    ? (invoiceSettings?.general ?? false)
    : isTireService
    ? (invoiceSettings?.tyres ?? false)
    : isBatteryService
    ? (invoiceSettings?.battery ?? false)
    : isCarWashService
    ? (invoiceSettings?.carWash ?? true)
    : true;

  const activeStatusFlow: readonly BookingStatus[] = getFlowForService(Array.isArray(order?.services) ? order.services : []);

  // Live Tracking State
  const [staffLocation, setStaffLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [eta, setEta] = useState<ETAResponse | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const etaTimer = useRef<number | null>(null);
  const nearAlertedRef = useRef<boolean>(false);
  const orderRef = useRef<Booking | null>(null);

  const loadVehicleReference = useCallback(async (vehicle: Vehicle) => {
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

  const fetchOrder = useCallback(async () => {
      if (!id) return;
      try {
          const data = await bookingService.getBookingById(id);
          setOrder(data);
          if (typeof data.vehicle === 'object' && data.vehicle !== null) {
            await loadVehicleReference(data.vehicle);
          } else {
            setVehicleRef(null);
          }
          
          // Check if feedback has already been submitted for this booking
          if (data.status === 'DELIVERED' && !hasSubmittedFeedback) {
            // First check localStorage for quick feedback state
            const localFeedbackSubmitted = localStorage.getItem(`feedback_submitted_${data._id}`) === 'true';
            
            if (localFeedbackSubmitted) {
              setHasSubmittedFeedback(true);
            } else {
              try {
                // Check if reviews already exist for this booking
                const existingReviews = await reviewService.getBookingReviews(data._id);
                const hasExistingReviews = existingReviews && existingReviews.length > 0;
                
                if (!hasExistingReviews) {
                  // Show rating modal only if no reviews exist
                  setShowRatingModal(true);
                } else {
                  // Reviews already exist, mark as submitted and store in localStorage
                  setHasSubmittedFeedback(true);
                  localStorage.setItem(`feedback_submitted_${data._id}`, 'true');
                }
              } catch (reviewError) {
                console.error("Failed to check existing reviews", reviewError);
                // If we can't check reviews, don't show the modal to avoid spam
                setHasSubmittedFeedback(true);
              }
            }
          }
          
          // Restore near-alert state from session to avoid duplicate pop on reloads
          const key = `nearAlert_${id}`;
          nearAlertedRef.current = sessionStorage.getItem(key) === '1';
      } catch (error) {
          console.error("Failed to fetch booking", error);
          toast.error("Failed to load booking details");
      } finally {
          setIsLoading(false);
      }
  }, [id, hasSubmittedFeedback, loadVehicleReference]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    fetchOrder();

    if (id) {
      socketService.connect();
      socketService.joinRoom(`booking_${id}`);

      socketService.on('liveLocation', (data: { lat?: number | string; lng?: number | string; role?: string; updatedAt?: string; timestamp?: string }) => {
        const currentOrder = orderRef.current;
        if (!currentOrder) return;
        // if (data.role && data.role !== 'staff') return;
        if (
          currentOrder.status === 'SERVICE_STARTED' ||
          currentOrder.status === 'SERVICE_COMPLETED' ||
          currentOrder.status === 'DELIVERED' ||
          currentOrder.status === 'CANCELLED'
        ) {
          return;
        }
        const latNum = typeof data.lat === 'string' ? Number(data.lat) : data.lat;
        const lngNum = typeof data.lng === 'string' ? Number(data.lng) : data.lng;
        if (typeof latNum === 'number' && isFinite(latNum) && typeof lngNum === 'number' && isFinite(lngNum)) {
          setStaffLocation({ lat: latNum, lng: lngNum });
          const ts = data.updatedAt || data.timestamp;
          if (ts) {
            const dt = new Date(ts);
            if (!Number.isNaN(dt.getTime())) setLastUpdate(dt);
          }
          if (
            !nearAlertedRef.current &&
            currentOrder.location &&
            (currentOrder.status === 'ASSIGNED' ||
              currentOrder.status === 'ACCEPTED' ||
              currentOrder.status === 'REACHED_CUSTOMER')
          ) {
            const destLat = typeof currentOrder.location === 'object' ? currentOrder.location.lat : undefined;
            const destLng = typeof currentOrder.location === 'object' ? currentOrder.location.lng : undefined;
            if (destLat && destLng) {
              const from = turf.point([lngNum, latNum]);
              const to = turf.point([destLng, destLat]);
              const d = turf.distance(from, to, { units: 'meters' });
              if (d <= 300) {
                nearAlertedRef.current = true;
                sessionStorage.setItem(`nearAlert_${id}`, '1');
                toast.success('Staff is near your location (≤300 m)');
              }
            }
          }
        }
      });

      // Server-side proximity notification
      socketService.on('nearbyStaff', (payload: { bookingId: string; distanceMeters?: number }) => {
        if (!id || String(payload?.bookingId) !== String(id)) return;
        if (!nearAlertedRef.current) {
          nearAlertedRef.current = true;
          sessionStorage.setItem(`nearAlert_${id}`, '1');
          const msg = payload?.distanceMeters
            ? `Staff is near your location (~${Math.max(1, Math.round(payload.distanceMeters))} m)`
            : 'Staff is near your location (≤300 m)';
          toast.success(msg);
        }
      });

      socketService.on('bookingUpdated', (updatedBooking: Booking) => {
        if (updatedBooking._id === id) {
          setOrder((previous) => mergeBookingCarWashPhotos(previous, updatedBooking));
          if (
            updatedBooking.status === 'SERVICE_STARTED' ||
            updatedBooking.status === 'SERVICE_COMPLETED' ||
            updatedBooking.status === 'DELIVERED' ||
            updatedBooking.status === 'COMPLETED' ||
            updatedBooking.status === 'CANCELLED'
          ) {
            setStaffLocation(null);
            setEta(null);
          }
        }
      });

      socketService.on('newApproval', (newApproval: ApprovalRequest) => {
        // Refresh approvals list when a new one arrives
        fetchPendingApprovals();
        toast.info(`New approval request: ${newApproval.type === 'PartReplacement' ? newApproval.data.name : 'Update'}`);
      });

      return () => {
        socketService.leaveRoom(`booking_${id}`);
        socketService.off('liveLocation');
        socketService.off('nearbyStaff');
        socketService.off('bookingUpdated');
        socketService.off('newApproval');
        // Don't disconnect socket fully as it might be used elsewhere, 
        // but socketService.disconnect() usually handles ref counting or single instance logic. 
        // For now, let's just leave room.
      };
    }
  }, [id, hasSubmittedFeedback]);

  const fetchPendingApprovals = useCallback(async () => {
    if (!order?._id) return;
    try {
      const approvals = await getMyApprovals(order._id);
      const filtered = approvals.filter((a) => {
        const rawRelated: unknown = a.relatedId as unknown;
        let relatedId = '';
        if (typeof rawRelated === 'string') {
          relatedId = rawRelated;
        } else if (rawRelated && typeof rawRelated === 'object') {
          const obj = rawRelated as { _id?: unknown };
          if (typeof obj._id === 'string') {
            relatedId = obj._id;
          } else if (obj._id) {
            relatedId = String(obj._id);
          } else {
            relatedId = String(rawRelated);
          }
        } else if (rawRelated != null) {
          relatedId = String(rawRelated);
        }
        return (
          relatedId === order._id &&
          a.status === 'Pending' &&
          a.type === 'PartReplacement'
        );
      });
      setPendingApprovals(filtered);
    } catch (error) {
      console.error('Failed to fetch approvals', error);
    }
  }, [order?._id]);

  useEffect(() => {
    if (!order?._id) return;
    fetchPendingApprovals();
    const interval = window.setInterval(fetchPendingApprovals, 15000);
    return () => window.clearInterval(interval);
  }, [order?._id, fetchPendingApprovals]);

  useEffect(() => {
    if (!order || !staffLocation) {
      setEta(null);
      setRouteGeometry([]);
      return;
    }
    const destLat = typeof order.location === 'object' ? order.location?.lat : undefined;
    const destLng = typeof order.location === 'object' ? order.location?.lng : undefined;
    if (!destLat || !destLng) {
      setEta(null);
      setRouteGeometry([]);
      return;
    }

    const fetchRoute = async () => {
      try {
        const start: [number, number] = [staffLocation.lat, staffLocation.lng];
        const end: [number, number] = [destLat, destLng];
        const response = await routingService.getRoute(start, end);
        if (response.routes && response.routes.length > 0) {
          const route = response.routes[0];
          const geometry = typeof route.geometry === 'object' ? route.geometry : null;
          if (geometry && geometry.coordinates) {
            const coordinates = geometry.coordinates.map((c: number[]) => [c[1], c[0]]) as [number, number][];
            setRouteGeometry(coordinates);
          }
        }
      } catch (e) {
        console.error('Failed to fetch route', e);
      }
    };

    fetchRoute();

    const showForStatuses = ['ACCEPTED', 'REACHED_CUSTOMER', 'OUT_FOR_DELIVERY'];
    if (!showForStatuses.includes(order.status)) {
      setEta(null);
      return;
    }
    if (etaTimer.current) {
      window.clearTimeout(etaTimer.current);
    }
    etaTimer.current = window.setTimeout(async () => {
      try {
        const res = await getETA(staffLocation.lat, staffLocation.lng, destLat, destLng);
        setEta(res);
      } catch (e) {
        console.error('Failed to calculate ETA', e);
      }
    }, 500);
    return () => {
      if (etaTimer.current) {
        window.clearTimeout(etaTimer.current);
        etaTimer.current = null;
      }
    };
  }, [order, staffLocation]);

  const handleApprovalAction = async (approvalId: string, status: 'Approved' | 'Rejected') => {
      let reason: string | null = null;
      if (status === 'Rejected') {
          reason = window.prompt('Please provide a reason for rejection (optional):');
          if (reason === null) return; // User cancelled
      } else {
          const confirmed = window.confirm('Are you sure you want to approve this part?');
          if (!confirmed) return;
      }

      try {
          await updateApprovalStatus(approvalId, status, reason || undefined);
          toast.success(`Request ${status.toLowerCase()} successfully`);
          fetchPendingApprovals(); // Refresh list
          
          // Refresh order details if approved as it might update the total amount
          if (status === 'Approved' && order?._id) {
              const updatedOrder = await bookingService.getBookingById(order._id);
              setOrder(updatedOrder);
          }
      } catch (error) {
          console.error(`Failed to ${status.toLowerCase()} request`, error);
          toast.error(`Failed to ${status.toLowerCase()} request`);
      }
  };

  const handleSubmitRating = async () => {
    // For car wash services, only platform rating is required
    if (isCarWashService) {
      if (platformRating === 0) {
        toast.error('Please select a rating for the platform');
        return;
      }
    } else {
      // For regular services, both merchant and platform ratings are required
      if (merchantRating === 0 || platformRating === 0) {
        toast.error('Please select ratings for both merchant and platform');
        return;
      }
    }

    setIsRatingSubmitting(true);
    try {
      const reviewPromises = [];

      // Merchant Review - only for non-car wash services
      if (!isCarWashService && order?.merchant?._id) {
        reviewPromises.push(
          reviewService.createReview({
            target: order.merchant._id,
            booking: order._id,
            rating: merchantRating,
            comment: merchantComment,
            category: 'Merchant'
          })
        );
      }

      // Platform Review (always required)
      reviewPromises.push(
        reviewService.createReview({
          booking: order?._id,
          rating: platformRating,
          comment: platformComment,
          category: 'Platform'
        })
      );

      await Promise.all(reviewPromises);
      toast.success('Thank you for your feedback!');
      setHasSubmittedFeedback(true);
      setShowRatingModal(false);
      
      // Store feedback submission in localStorage to prevent repeated requests
      if (order?._id) {
        localStorage.setItem(`feedback_submitted_${order._id}`, 'true');
      }
    } catch (error) {
      console.error('Failed to submit reviews:', error);
      toast.error('Failed to submit reviews');
    } finally {
      setIsRatingSubmitting(false);
    }
  };

  const handleCallMerchant = () => {
    if (!merchantPhone) return;
    const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent || '');
    if (isMobile) {
      window.location.href = `tel:${merchantPhone}`;
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(merchantPhone);
      toast.success('Phone number copied');
    } else {
      toast.message(merchantPhone);
    }
  };



  const handleDownloadMerchantInvoice = async () => {
    if (!order?._id) return;
    
    // If merchant has uploaded a file, prioritize that
    if (order.billing?.fileUrl) {
      window.open(order.billing.fileUrl, '_blank');
      return;
    }

    try {
      toast.info('Generating invoice...');
      const response = await bookingService.getBookingInvoice(order._id);
      
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

  const handlePayment = async () => {
    if (!order || !user) return;
    
    // Check if Cashfree is loaded
    if (!window.Cashfree) {
      toast.error('Payment gateway not loaded. Please refresh the page.');
      return;
    }
    
    setIsPaymentLoading(true);

    try {
      // Use Cashfree for payment
      const orderData = await paymentService.createOrder(order._id, order.finalAmount || order.totalAmount);
      
      const cashfree = window.Cashfree({ mode: orderData.environment });
      
      await cashfree.checkout({
        paymentSessionId: orderData.paymentSessionId,
        redirectTarget: '_modal'
      });

      // Verify payment
      const verificationData = {
        orderId: orderData.orderId,
        bookingId: order._id
      };

      await paymentService.verifyPayment(verificationData);
      
      if (isCarWashService) {
        toast.success(`Payment Successful! Your ${isEssentials ? 'service' : 'car wash'} booking is now confirmed. Admin will assign staff shortly.`);
      } else {
        toast.success('Payment Successful!');
      }
      
      const updatedOrder = await bookingService.getBookingById(order._id);
      setOrder(updatedOrder);
      
    } catch (error: any) {
      console.error("Payment Error", error);
      toast.error(error.response?.data?.message || "Failed to process payment");
    } finally {
      setIsPaymentLoading(false);
    }
  };

  if (isLoading) {
    return <div className={cn(pageClass, 'text-center text-muted-foreground')}>Loading...</div>;
  }

  if (!order) {
    return <div className={cn(pageClass, 'text-center text-muted-foreground')}>Order not found</div>;
  }

  // Construct timeline steps based on status
  const getStatusStep = (status: string) => {
    switch (status) {
      case 'CREATED':
        return 0;
      case 'ASSIGNED':
      case 'ACCEPTED':
      case 'REACHED_CUSTOMER':
        return 1;
      case 'VEHICLE_PICKED':
      case 'REACHED_MERCHANT':
      case 'CAR_WASH_STARTED':
        return 2;
      case 'SERVICE_STARTED':
        return 3;
      case 'SERVICE_COMPLETED':
      case 'CAR_WASH_COMPLETED':
      case 'OUT_FOR_DELIVERY':
        return 4;
      case 'DELIVERED':
        return 5;
      case 'COMPLETED':
        return 5;
      default:
        return 0;
    }
  };

  const currentStatusIndex = Math.max(0, activeStatusFlow.indexOf(order.status as BookingStatus));

  const timelineSteps = activeStatusFlow.map((s) => {
    const index = activeStatusFlow.indexOf(s);
    const isCompleted = index <= currentStatusIndex;
    const label =
      s === 'ACCEPTED' && order.status === 'REACHED_CUSTOMER'
        ? 'Staff waiting at your location'
        : (s === 'OUT_FOR_DELIVERY'
            ? 'Waiting for staff pickup vehicle'
            : getStatusLabel(s, Array.isArray(order?.services) ? order.services : []));

    return {
      step: label,
      completed: isCompleted,
    };
  });

  // Helper to safely access vehicle properties
  const vehicle = (typeof order.vehicle === 'object' && order.vehicle !== null) ? order.vehicle : { 
      make: 'Unknown', model: 'Vehicle', variant: '', year: 0, licensePlate: 'N/A', image: '' 
  };
  
  // Helper for merchant
  const merchantName = order.merchant?.name || 'Service Center';
  const merchantEmail = order.merchant?.email;
  const merchantPhone = order.merchant?.phone;
  const merchantLat = order.merchant?.location?.lat;
  const merchantLng = order.merchant?.location?.lng;
  const hasInspectionPhotos = Boolean(
    order.inspection &&
      (order.inspection.frontPhoto ||
        order.inspection.backPhoto ||
        order.inspection.leftPhoto ||
        order.inspection.rightPhoto)
  );
  const hasServicePhotos = !isCarWashService && Boolean(
    order.serviceExecution?.afterPhotos?.length ||
      (isBatteryOrTire && Array.isArray(order.prePickupPhotos) && order.prePickupPhotos.length > 0) ||
      order.status === 'SERVICE_COMPLETED' ||
      order.status === 'COMPLETED' ||
      order.status === 'DELIVERED'
  );
  const hasReplacedParts = Boolean(order.serviceExecution?.serviceParts?.length);

  return (
    <GlobalSyncRefresh
      entities={['booking', 'payment', 'approval', 'user']}
      onSync={fetchOrder}
    >
    <div className={pageClass}>
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        {user && (
          <Link
            to="/customer/dashboard"
            className="p-2 hover:bg-muted rounded-xl transition-colors flex-shrink-0"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">Track Service</h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            Order #{order.orderNumber ?? order._id.slice(-6).toUpperCase()}
          </p>
        </div>
      </div>

      {/* Vehicle Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-2xl border border-border p-4"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-muted overflow-hidden flex-shrink-0">
            {vehicle.image ? (
              <img src={vehicle.image} alt={vehicle.model} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Car className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm sm:text-base text-foreground line-clamp-1">
              {vehicle.make} {vehicle.model}
            </h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              {vehicle.variant && (
                <span className="text-[10px] sm:text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded leading-none">
                  {vehicle.variant}
                </span>
              )}
              <p className="text-xs sm:text-sm text-muted-foreground">{vehicle.licensePlate}</p>
            </div>
            {/* Display services as comma separated string */}
            <p className="text-xs sm:text-sm text-primary font-medium mt-1 line-clamp-2">
                {Array.isArray(order.services) 
                    ? order.services.map((s) => {
                        if (typeof s === 'string') return s;
                        const qty = order.serviceQuantities?.[s._id] || order.serviceQuantities?.[s._id.toString()];
                        const brand = order.selectedBrands?.[s._id] || order.selectedBrands?.[s._id.toString()];
                        const qtyStr = qty && Number(qty) > 1 ? ` (Qty: ${qty})` : '';
                        const brandStr = brand ? ` - ${brand}` : '';
                        return `${s.name}${brandStr}${qtyStr}`;
                      }).join(', ') 
                    : 'Service'}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Progress Timeline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-card rounded-2xl border border-border p-4 sm:p-6"
      >
        <div className="mb-3 sm:mb-4">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">Status & Workflow</h2>
        </div>
        <Timeline steps={timelineSteps} vertical={false} className="gap-3 sm:gap-2" />
      </motion.div>

      <div className="space-y-4 sm:space-y-6">
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
        ].includes(order.status)) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            layout
            className={`bg-card rounded-2xl border border-border overflow-hidden w-full transition-all duration-500 ease-in-out relative z-0 isolate ${
              isMapMaximized ? 'lg:col-span-2' : ''
            }`}
          >
            <div className="p-3 sm:p-4 border-b border-border flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-sm sm:text-base text-foreground flex items-center gap-2">
                  <Navigation className="w-4 h-4 sm:w-5 sm:h-5 text-primary flex-shrink-0" />
                  <span>Live Tracking</span>
                </h3>
                <button
                  onClick={() => setIsMapMaximized(!isMapMaximized)}
                  className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                  title={isMapMaximized ? "Minimize" : "Maximize"}
                >
                  {isMapMaximized ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                {eta && (
                  <div className="text-xs text-muted-foreground">
                    ETA: <span className="font-medium text-foreground">{eta.textDuration}</span>
                    <span className="mx-1">•</span>
                    {eta.textDistance}
                  </div>
                )}
                {staffLocation && (
                  <span className="text-xs text-green-500 font-medium animate-pulse">
                    ● Live{lastUpdate ? ` • ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(lastUpdate)}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className={`w-full relative bg-muted transition-all duration-500 ease-in-out ${
              isMapMaximized ? 'h-[500px] sm:h-[600px]' : 'h-48 sm:h-64'
            }`}>
              {staffLocation ? (
                <MapContainer
                  center={[staffLocation.lat, staffLocation.lng]}
                  zoom={16}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={false}
                >
                  <MapController 
                    center={[staffLocation.lat, staffLocation.lng]} 
                    destination={order.location && typeof order.location === 'object' && order.location.lat && order.location.lng ? [order.location.lat, order.location.lng] : undefined}
                    zoom={16} 
                    isMaximized={isMapMaximized} 
                  />
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; <a href=&quot;https://www.openstreetmap.org/copyright&quot;>OpenStreetMap</a> contributors"
                  />
                  <SmoothMarker position={[staffLocation.lat, staffLocation.lng]}>
                    <Popup>Staff is here</Popup>
                  </SmoothMarker>
                  {routeGeometry.length > 0 && (
                    <Polyline 
                      positions={routeGeometry} 
                      color="#2563eb" 
                      weight={4} 
                      opacity={0.8}
                      dashArray="10, 10"
                    />
                  )}
                  {order.location && typeof order.location === 'object' && order.location.lat && order.location.lng && (
                    <Marker position={[order.location.lat, order.location.lng]}>
                      <Popup>Destination</Popup>
                    </Marker>
                  )}
                </MapContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <MapPin className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">Waiting for live location...</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        <div className="w-full space-y-6">
          {/* Car Wash Photos Section */}
          {isCarWashService && (Boolean(order.carWash?.beforeWashPhotos?.length) || Boolean(order.carWash?.afterWashPhotos?.length)) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary" />
                {isEssentials ? 'Service Photos' : 'Car Wash Photos'}
              </h2>
              
              <div className="grid grid-cols-1 gap-6">
                {order.carWash?.beforeWashPhotos && order.carWash.beforeWashPhotos.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                      {isEssentials ? 'Before Service' : 'Before Wash'} ({order.carWash.beforeWashPhotos.length}/4)
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {order.carWash.beforeWashPhotos.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => window.open(url, '_blank')}
                          className="aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                        >
                          <img src={url} alt={`${isEssentials ? 'Before Service' : 'Before Wash'} ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {order.carWash?.afterWashPhotos && order.carWash.afterWashPhotos.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                      {isEssentials ? 'After Service' : 'After Wash'} ({order.carWash.afterWashPhotos.length}/4)
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {order.carWash.afterWashPhotos.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => window.open(url, '_blank')}
                          className="aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                        >
                          <img src={url} alt={`${isEssentials ? 'After Service' : 'After Wash'} ${i + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Inspection Photos Section */}
            {hasInspectionPhotos && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border p-6 space-y-4"
              >
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Shield className="w-5 h-5 text-primary" />
                  Vehicle Inspection
                </h2>
                <p className="text-sm text-muted-foreground">Photos of your vehicle taken by the service center before starting the service.</p>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {['front', 'back', 'left', 'right'].map((side) => {
                    const url = order.inspection?.[`${side}Photo` as keyof typeof order.inspection] as string;
                    if (!url) return null;
                    return (
                      <div key={side} className="space-y-1">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground block text-center">{side} side</span>
                        <button
                          type="button"
                          onClick={() => window.open(url, '_blank')}
                          className="aspect-square w-full rounded-xl overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                        >
                          <img src={url} alt={`${side} inspection`} className="w-full h-full object-cover" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {order.inspection?.damageReport && (
                  <div className="pt-4 border-t border-border">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Damage Report / Findings</h4>
                    <p className="text-sm italic text-muted-foreground">"{order.inspection.damageReport}"</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* Service Photos Section */}
            {hasServicePhotos ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border p-6 space-y-4"
              >
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-primary" />
                  Service Photos
                </h2>
                
                <div className="grid grid-cols-1 gap-6">
                  {/* Battery/Tire Pickup & Installation Photos */}
                  {isBatteryOrTire && Array.isArray(order.prePickupPhotos) && order.prePickupPhotos.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Pickup & Installation</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {order.prePickupPhotos.map((url, i) => (
                          <div key={i} className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => window.open(url, '_blank')}
                              className="w-full aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                            >
                              <img src={url} alt={`Step ${i + 1}`} className="w-full h-full object-cover" />
                            </button>
                            <p className="text-[10px] font-bold text-center uppercase text-muted-foreground">
                              {i === 0 ? 'New Part' : i === 1 ? 'Old Part' : `Photo ${i + 1}`}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {order.serviceExecution?.afterPhotos && order.serviceExecution.afterPhotos.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Service Completed Photos</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {order.serviceExecution.afterPhotos.map((url, i) => {
                          const sideLabels = ['Front', 'Back', 'Left', 'Right'];
                          const label = sideLabels[i] || `Photo ${i + 1}`;
                          return (
                            <div key={i} className="space-y-1">
                              <span className="text-[10px] uppercase font-bold text-muted-foreground block text-center">{label}</span>
                              <button
                                type="button"
                                onClick={() => window.open(url, '_blank')}
                                className="aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                              >
                                <img src={url} alt={`${label} service`} className="w-full h-full object-cover" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : null}
          </div>

          {hasReplacedParts && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Wrench className="w-5 h-5 text-primary" />
                Replaced Parts
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {order.serviceExecution?.serviceParts?.map((part, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{part.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty: {part.quantity} • Price: ₹{part.price}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        part.fromInspection ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {part.fromInspection ? 'From inspection' : 'New discovery'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {part.oldImage && (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => window.open(part.oldImage!, '_blank')}
                            className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                          >
                            <img src={part.oldImage} alt="Before" className="w-full h-full object-cover" />
                          </button>
                          <span className="text-xs text-muted-foreground">Before</span>
                        </div>
                      )}
                      {part.image && (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            onClick={() => window.open(part.image!, '_blank')}
                            className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted hover:opacity-90 transition-opacity"
                          >
                            <img src={part.image} alt="After" className="w-full h-full object-cover" />
                          </button>
                          <span className="text-xs text-muted-foreground">After</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Warranty Information - Only for battery/tire services */}
          {isBatteryOrTire && order.batteryTire?.warranty && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6"
            >
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Warranty Information
              </h2>
              
              <div className="flex flex-col md:flex-row gap-6">
                {order.batteryTire.warranty.image && (
                  <div className="w-full md:w-1/3 aspect-square rounded-lg overflow-hidden border border-border">
                    <img 
                      src={order.batteryTire.warranty.image} 
                      alt="Warranty Product" 
                      className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                      onClick={() => window.open(order.batteryTire.warranty.image, '_blank')}
                    />
                  </div>
                )}
                <div className="flex-1 space-y-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Product Name</p>
                    <p className="text-lg font-semibold text-foreground">{order.batteryTire.warranty.name}</p>
                  </div>
                  <div className={order.batteryTire.warranty.price !== undefined && order.batteryTire.warranty.price !== null ? "grid grid-cols-2 gap-4" : "grid grid-cols-1 gap-4"}>
                    {order.batteryTire.warranty.price !== undefined && order.batteryTire.warranty.price !== null && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">Price</p>
                        <p className="text-lg font-bold text-primary">₹{order.batteryTire.warranty.price}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Warranty Period</p>
                      <p className="text-lg font-semibold text-foreground">{order.batteryTire.warranty.warrantyMonths} months</p>
                    </div>
                  </div>
                  {order.batteryTire.warranty.addedAt && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-sm font-medium text-muted-foreground mb-1">Warranty Added On</p>
                      <p className="text-sm text-foreground">{new Date(order.batteryTire.warranty.addedAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {order.status !== 'DELIVERED' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card rounded-2xl border border-border p-4 sm:p-5"
              >
                <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Truck className="w-5 h-5 text-primary" />
                  {isCarWashService ? 'Staff Details' : 'Driver Details'}
                </h2>
                <div className="flex items-center justify-between">
                  {(() => {
                    const staff = order.carWash?.staffAssigned || order.pickupDriver || order.technician;
                    if (staff) {
                      return (
                        <>
                          <div>
                            <p className="font-medium text-foreground">
                              {staff.name}
                            </p>
                            {staff.phone && (
                              <p className="text-sm text-muted-foreground">
                                {staff.phone}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {staff.phone && (
                              <a
                                href={`tel:${staff.phone}`}
                                className="p-3 bg-muted rounded-xl hover:bg-muted/80 transition-colors"
                              >
                                <Phone className="w-5 h-5 text-foreground" />
                              </a>
                            )}
                          </div>
                        </>
                      );
                    }
                    return (
                      <p className="text-sm text-muted-foreground italic">
                        Your {isCarWashService ? 'staff' : 'driver'} details provided shortly
                      </p>
                    );
                  })()}
                </div>
              </motion.div>

              {!isCarWashService && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-card rounded-2xl border border-border p-4 sm:p-5"
                >
                  <h2 className="font-semibold text-foreground mb-3">Service Center</h2>
                  <div className="flex items-center justify-between">
                    {order.merchant ? (
                      <>
                        <div>
                          <p className="font-medium text-foreground">{merchantName}</p>
                          {merchantEmail && <p className="text-sm text-muted-foreground">{merchantEmail}</p>}
                          {merchantPhone && <p className="text-sm text-muted-foreground">{merchantPhone}</p>}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleCallMerchant}
                            className="p-3 bg-muted rounded-xl hover:bg-muted/80 transition-colors"
                          >
                            <Phone className="w-5 h-5 text-foreground" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Your authorised service center details provide shortly</p>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          <div className="">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-4 sm:p-6"
            >
              <h2 className="text-base sm:text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary shrink-0" />
                Payment Details
              </h2>
              
              <div className="space-y-3 mb-6">
                {(order.billing && (order.billing.total > 0 || order.billing.invoiceNumber || order.billing.fileUrl)) || (order.pickupDropPrice && order.pickupDropPrice > 0) ? (
                  <>
                    {(() => {
                      const serviceList = (Array.isArray(order.services)
                        ? order.services.filter((s): s is Service => typeof s === 'object' && s !== null)
                        : []) as Service[];

                      const servicesTotal =
                        serviceList.length > 0
                          ? sumBookingServicesSubtotal(serviceList, vehicleRef, order.selectedBrands, order.serviceQuantities)
                          : 0;

                      const parts = order.billing?.partsTotal || 0;
                      const labour = order.billing?.labourCost || 0;
                      const gst = order.billing?.gst || order.gstAmount || 0;
                      const pickup = order.billing?.pickupDropPrice || order.pickupDropPrice || 0;
                      const discount = order.discountAmount || 0;
                      
                      let baseAmount = servicesTotal;
                      if (baseAmount === 0) {
                        // Fallback logic
                        const rawTotal = order.totalAmount || 0;
                        baseAmount = Math.max(0, rawTotal - parts - labour - gst - pickup);
                      }

                      return (
                        <>
                          <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Base Service Amount</span>
                            <span>₹{baseAmount}</span>
                          </div>
                          {parts > 0 && (
                            <div className="flex justify-between text-sm text-muted-foreground">
                              <span>Parts Total</span>
                              <span>₹{parts}</span>
                            </div>
                          )}
                          {labour > 0 && (
                            <div className="flex justify-between text-sm text-muted-foreground">
                              <span>Labour Cost</span>
                              <span>₹{labour}</span>
                            </div>
                          )}
                          {isGeneralService && pickup > 0 && (
                            <div className="flex justify-between text-sm text-muted-foreground">
                              <span>Pickup/Drop Price</span>
                              <span>₹{pickup}</span>
                            </div>
                          )}
                          {gst > 0 && (
                            <div className="flex justify-between text-sm text-muted-foreground">
                              <span>Tax (GST 18%)</span>
                              <span>₹{gst}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-foreground text-lg pt-2 border-t border-border mt-2">
                            <span>Total Billed Amount</span>
                            <div className="text-right">
                              <span className="text-primary">₹{order.finalAmount || order.billing?.total || order.totalAmount}</span>
                              {discount > 0 && (
                                <p className="text-[10px] text-muted-foreground font-normal line-through">
                                  ₹{(order.finalAmount || order.billing?.total || order.totalAmount) + discount}
                                </p>
                              )}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    {(() => {
                      const serviceList = (Array.isArray(order.services)
                        ? order.services.filter((s): s is Service => typeof s === 'object' && s !== null)
                        : []) as Service[];
                      const subtotalFromVehicle =
                        serviceList.length > 0
                          ? sumBookingServicesSubtotal(serviceList, vehicleRef, order.selectedBrands, order.serviceQuantities)
                          : order.totalAmount;
                      return (
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>{isGeneralService ? 'Base Service Amount' : 'Subtotal'}</span>
                          <span>₹{subtotalFromVehicle}</span>
                        </div>
                      );
                    })()}
                    {(order.discountAmount ?? 0) > 0 && (
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Discount</span>
                        <span>-₹{order.discountAmount}</span>
                      </div>
                    )}
                    {(order.gstAmount ?? 0) > 0 && !isGeneralService && (
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Tax (GST 18%)</span>
                        <span>₹{order.gstAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-foreground text-lg pt-2 border-t border-border">
                      <span>Total Amount</span>
                      <span>₹{order.finalAmount || order.totalAmount}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Status</span>
                  <span className="capitalize">{order.paymentStatus}</span>
                </div>
                {order.billing?.invoiceNumber && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Invoice #</span>
                    <span>{order.billing?.invoiceNumber}</span>
                  </div>
                )}
                {isCarWashService && order.paymentStatus === 'pending' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-orange-700 font-medium">
                      ⚠️ Payment required to confirm your {isEssentials ? 'service' : 'car wash'} booking
                    </p>
                  </div>
                )}
                {isCarWashService && order.paymentStatus === 'paid' && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm text-green-700 font-medium">
                      ✓ Payment completed during booking for {isEssentials ? 'service' : 'car wash service'}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {order.billing?.fileUrl && (isCarWashService || isBatteryOrTire || order.paymentStatus === 'paid') && (
                  <div className="flex justify-end">
                    <button
                      onClick={handleDownloadMerchantInvoice}
                      className="py-3 px-5 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download Merchant Invoice
                    </button>
                  </div>
                )}

                {order.paymentStatus === 'paid' && canDownloadGeneratedInvoice && (
                  <div className="flex justify-end">
                    <button
                      onClick={handleDownloadMerchantInvoice}
                      className="py-3 px-5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download Invoice
                    </button>
                  </div>
                )}
                


                {order.paymentStatus !== 'paid' && (
                  <div className="space-y-2">
                    <button
                      className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (isGeneralService) {
                          navigate('/payment', { state: { payExistingBookingId: order._id } });
                          return;
                        }
                        void handlePayment();
                      }}
                      disabled={isPaymentLoading || (!isCarWashService && !isBatteryOrTire && !['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'].includes(order.status))}
                    >
                      {isPaymentLoading && !isGeneralService ? 'Processing...' : (isCarWashService ? `Pay Now to Confirm ${isEssentials ? 'Service' : 'Car Wash'}` : 'Pay Now')}
                    </button>
                    {!isCarWashService && !isBatteryOrTire && !['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'].includes(order.status) && (
                      <p className="text-[11px] text-center text-muted-foreground">
                        Payment will be enabled once the service is completed
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>

            {order.deliveryOtp?.code && canCustomerSeeDeliveryOtp(order) && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="bg-card rounded-2xl border border-dashed border-primary/40 p-6 text-center space-y-2 mt-4"
              >
                <p className="text-xs uppercase tracking-wide text-primary/80">Delivery OTP</p>
                <p className="text-3xl font-mono font-semibold text-primary tracking-widest">
                  {order.deliveryOtp.code}
                </p>
                <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                  {isCarWashService
                    ? 'Share this code with our staff when they complete your service handover.'
                    : 'Share this code only with our staff when they return your vehicle.'}
                </p>
              </motion.div>
            )}
          </div>

        </div>
      </div>

      

      {/* Delivery Confirmation */}
      {(order.status === 'DELIVERED' || order.status === 'COMPLETED') && !hasSubmittedFeedback && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border p-6 text-center space-y-4"
        >
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Service Completed</h2>
            <p className="text-muted-foreground">Your vehicle has been delivered. Thank you for using our service!</p>
          </div>
          <button
            onClick={() => {
              // Check if feedback has already been submitted
              const localFeedbackSubmitted = localStorage.getItem(`feedback_submitted_${order?._id}`) === 'true';
              if (localFeedbackSubmitted) {
                toast.info('You have already submitted feedback for this service. Thank you!');
              } else {
                setShowRatingModal(true);
              }
            }}
            className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Star className="w-5 h-5" />
            {isCarWashService ? 'Give Feedback for Admin' : 'Give Feedback for Merchant & Admin'}
          </button>
        </motion.div>
      )}

      {/* Merchant Info */}
      

      {/* Rating Modal */}
      <AnimatePresence>
        {showRatingModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-card w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="p-6 text-center space-y-6 max-h-[80vh] overflow-y-auto">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                  <ThumbsUp className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Rate Service</h2>
                  <p className="text-muted-foreground">Please share your experience with us.</p>
                </div>

                {/* Merchant Review - only for non-car wash services */}
                {!isCarWashService && order?.merchant && (
                  <div className="space-y-4 pt-4 border-t">
                    <h3 className="font-semibold text-primary">Service Center ({order.merchant.name})</h3>
                    <div className="flex justify-center gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setMerchantRating(star)}
                          className="focus:outline-none"
                        >
                          <Star
                            className={`w-7 h-7 transition-colors ${
                              merchantRating >= star ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={merchantComment}
                      onChange={(e) => setMerchantComment(e.target.value)}
                      placeholder="Comment for service center..."
                      rows={3}
                      className="w-full p-3 bg-muted/50 border border-border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                    />
                  </div>
                )}

                {/* Platform Review */}
                <div className="space-y-4 pt-4 border-t">
                  <h3 className="font-semibold text-primary">Platform Feedback (Admin)</h3>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setPlatformRating(star)}
                        className="focus:outline-none"
                      >
                        <Star
                          className={`w-7 h-7 transition-colors ${
                            platformRating >= star ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={platformComment}
                    onChange={(e) => setPlatformComment(e.target.value)}
                    placeholder="Comment for platform/company..."
                    rows={3}
                    className="w-full p-3 bg-muted/50 border border-border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowRatingModal(false)}
                    className="flex-1 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleSubmitRating}
                    disabled={isRatingSubmitting}
                    className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                  >
                    {isRatingSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Submit'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Widget */}
      {order?._id && (
        <ChatWidget
          bookingId={order._id}
          status={order.status}
          onUpdate={fetchOrder}
          forceHidden={
            forceHideChatUntilGeneralServiceStarted(order) || forceHideChatWhenServiceCompleted(order)
          }
        />
      )}
    </div>
    </GlobalSyncRefresh>
  );
};

export default TrackServicePage;
