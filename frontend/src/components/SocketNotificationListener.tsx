import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socketService } from '@/services/socket';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store/appStore';

import { updateApprovalStatus } from '@/services/approvalService';
import { dispatchGlobalSync, normalizeGlobalSyncPayload } from '@/lib/globalSync';

/** Prevent duplicate booking toasts within a short window (server + client echo). */
const recentBookingUpdateToasts = new Map<string, number>();
const BOOKING_TOAST_DEDUPE_MS = 4000;

const shouldShowBookingUpdateToast = (bookingId: string, status: string) => {
  const key = `${bookingId}:${status || 'updated'}`;
  const now = Date.now();
  const last = recentBookingUpdateToasts.get(key);
  if (last && now - last < BOOKING_TOAST_DEDUPE_MS) return false;
  recentBookingUpdateToasts.set(key, now);
  return true;
};

const SocketNotificationListener = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, role: userRole, updateUser } = useAuthStore();
  const { addNotification } = useAppStore();
  const lastPaymentStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!user) {
      socketService.disconnect();
      return;
    }

    // Connect to socket if not connected
    socketService.connect();

    socketService.on('connect', () => {
      if (userRole) {
        socketService.joinRoom(userRole.toLowerCase());
      }
      socketService.joinRoom(`user_${user._id}`);
    });

    // Also join immediately if already connected to avoid duplicate join messages
    // but the 'connect' listener above handles the re-connection logic
    const isConnected = socketService.isConnected();
    if (isConnected) {
      if (userRole) {
        socketService.joinRoom(userRole.toLowerCase());
      }
      socketService.joinRoom(`user_${user._id}`);
    }

    const handleNotification = (data: any) => {
      if (!data) return;
      // Add to local store
      addNotification({
        title: data.title || 'New Notification',
        message: data.body || data.message || '',
        type: data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : data.type === 'warning' ? 'warning' : 'info',
      });

      // Show toast if it's not a booking/order update (bookingUpdated handles those)
      const isBookingRelated =
        data.type === 'order' ||
        data.type === 'booking' ||
        (typeof data.title === 'string' && data.title.toLowerCase().includes('booking'));
      if (!isBookingRelated) {
        toast.info(data.title || 'New Notification', {
          description: data.body || data.message || '',
        });
      }
      
      // Refresh notifications query if any
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    const handleBookingUpdate = (data: any) => {
      if (!data || !data._id) return;

      const bookingId = String(data._id);
      const currentPaymentStatus = data.paymentStatus;
      
      // Get previous payment status from ref or query cache
      let prevPaymentStatus = lastPaymentStatuses.current[bookingId];
      if (prevPaymentStatus === undefined) {
        const cachedBooking: any = queryClient.getQueryData(['booking', data._id]);
        prevPaymentStatus = cachedBooking?.paymentStatus;
        
        if (prevPaymentStatus === undefined) {
          const cachedBookings: any = queryClient.getQueryData(['bookings']);
          if (Array.isArray(cachedBookings)) {
            const found = cachedBookings.find((b: any) => b._id === data._id);
            if (found) {
              prevPaymentStatus = found.paymentStatus;
            }
          }
        }
      }
      
      // Update stored payment status
      lastPaymentStatuses.current[bookingId] = currentPaymentStatus;

      // Check if this is a general service booking
      const isGeneralService = 
        !data.batteryTire?.isBatteryTireService &&
        !data.carWash?.isCarWashService &&
        Array.isArray(data.services) &&
        data.services.some((s: any) => {
          if (!s || typeof s !== 'object') return false;
          const cat = String(s.category || '');
          const name = String(s.name || '').toLowerCase();
          return cat === 'Periodic' || cat === 'Services' || name.includes('general service');
        });

      // Redirect staff to order details page once payment is completed for a General Service
      if (
        userRole === 'staff' &&
        isGeneralService &&
        currentPaymentStatus === 'paid' &&
        prevPaymentStatus !== 'paid' &&
        data.status === 'SERVICE_COMPLETED'
      ) {
        const targetPath = `/staff/order/${data._id}`;
        if (window.location.pathname !== targetPath) {
          navigate(targetPath);
        }
      }

      // Refresh relevant queries
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['booking', data._id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      // Show notification (dedupe rapid repeats for the same booking + status)
      const orderNum = data.orderNumber || data._id.toString().slice(-6).toUpperCase();
      const status = (data.status || 'updated').replace(/_/g, ' ');

      // CREATED isn't a status change — bookingCreated / the booking flow
      // already confirm it, so this would just be a duplicate toast.
      if (String(data.status || '').toUpperCase() === 'CREATED') {
        return;
      }

      if (!shouldShowBookingUpdateToast(String(data._id), String(data.status || ''))) {
        return;
      }
      
      toast.info(`Booking Updated`, {
        description: `Booking #${orderNum} status is now ${status}`,
        action: {
          label: 'View',
          onClick: () => {
            // Depending on role, redirect to appropriate page
            if (userRole === 'admin') {
              navigate(`/admin/bookings/${data._id}`);
            } else if (userRole === 'merchant') {
              navigate(`/merchant/orders/${data._id}`);
            } else if (userRole === 'customer') {
              navigate(`/track/${data._id}`);
            } else if (userRole === 'staff') {
              navigate(`/staff/order/${data._id}`);
            }
          },
        },
      });
    };

    const handleBookingCreated = (data: any) => {
      if (!data || !data._id) return;
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      // The customer just made this booking and the booking flow shows its
      // own confirmation; this toast is for admin/merchant/staff.
      if (userRole === 'customer') return;

      const orderNum = data.orderNumber || data._id.toString().slice(-6).toUpperCase();
      toast.success(`New Booking`, {
        description: `New booking #${orderNum} has been created!`,
        action: {
          label: 'View',
          onClick: () => {
            if (userRole === 'admin') {
              navigate(`/admin/bookings/${data._id}`);
            } else if (userRole === 'merchant') {
              navigate(`/merchant/orders/${data._id}`);
            } else if (userRole === 'customer') {
              navigate(`/track/${data._id}`);
            } else if (userRole === 'staff') {
              navigate(`/staff/order/${data._id}`);
            }
          },
        },
      });
    };

    const handleBookingCancelled = (data: any) => {
      if (!data || !data._id) return;
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      
      const orderNum = data.orderNumber || data._id.toString().slice(-6).toUpperCase();
      toast.error(`Booking Cancelled`, {
        description: `Booking #${orderNum} has been cancelled.`,
        action: {
          label: 'View',
          onClick: () => {
            if (userRole === 'admin') {
              navigate(`/admin/bookings/${data._id}`);
            } else if (userRole === 'merchant') {
              navigate(`/merchant/orders/${data._id}`);
            } else if (userRole === 'customer') {
              navigate(`/track/${data._id}`);
            } else if (userRole === 'staff') {
              navigate(`/staff/order/${data._id}`);
            }
          },
        },
      });
    };

    const handleRoleUpdated = (data: any) => {
      if (data && data.role) {
        updateUser({ role: data.role, subRole: data.subRole, status: data.status });
        toast.success(`Role Updated`, {
          description: `Your account role has been updated to ${data.role}.`,
        });
        
        // Optionally redirect based on the new role
        if (data.role === 'merchant') {
          navigate('/merchant/dashboard');
        } else if (data.role === 'staff') {
          navigate('/staff/dashboard');
        } else if (data.role === 'customer') {
          navigate('/customer/dashboard');
        }
      }
    };

    const handleNewApproval = (data: any) => {
      if (!data || !data.relatedId) return;
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['booking', data.relatedId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      
      const approvalId = data._id;
      const title = data.type === 'PartReplacement' 
        ? 'New Part Approval' 
        : data.type === 'ExtraCost'
          ? 'Extra Cost Approval'
          : 'New Approval Request';
      
      const message = data.type === 'PartReplacement'
        ? `A new part replacement (${data.data?.name}) requires your approval.`
        : data.type === 'ExtraCost'
          ? `An extra cost of ₹${data.data?.amount} requires your approval.`
          : 'A new request requires your approval.';

      if (userRole === 'customer') {
        toast(title, {
          id: `approval_${approvalId}`, // dedupe repeat deliveries
          description: message,
          duration: 10000, // Show longer
          action: {
            label: 'Approve',
            onClick: async () => {
              try {
                await updateApprovalStatus(approvalId, 'Approved');
                toast.success('Request approved successfully');
                queryClient.invalidateQueries({ queryKey: ['booking', data.relatedId] });
              } catch (err) {
                toast.error('Failed to approve request');
              }
            }
          },
          cancel: {
            label: 'Reject',
            onClick: async () => {
              try {
                await updateApprovalStatus(approvalId, 'Rejected');
                toast.success('Request rejected successfully');
                queryClient.invalidateQueries({ queryKey: ['booking', data.relatedId] });
              } catch (err) {
                toast.error('Failed to reject request');
              }
            }
          }
        });
      } else {
        toast.info(title, {
          id: `approval_${approvalId}`,
          description: message,
          action: {
            label: 'View',
            onClick: () => {
              if (userRole === 'admin') {
                navigate(`/admin/approvals`);
              }
            },
          },
        });
      }
    };

    const handleUserUpdated = (data: any) => {
      if (!data || !data.userId) return;
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      
      // If the current user was updated, we might want to refresh their local profile too
      if (user?._id === data.userId) {
        queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
    };

    const handleVehicleCreated = (data: any) => {
      if (!data) return;
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['tracking'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      
      if (userRole === 'admin') {
        toast.info('New Vehicle Added', {
          description: `Vehicle ${data.licensePlate || ''} has been registered.`
        });
      }
    };

    const handleVehicleDeleted = (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['tracking'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const handleLiveLocation = (data: any) => {
      if (!data) return;
      // For real-time map updates, we update the tracking query cache directly
      // but only if we are an admin or merchant who might be watching the map
      if (userRole === 'admin' || userRole === 'merchant') {
        queryClient.setQueryData(['tracking'], (prev: any) => {
          if (!prev) return prev;
          
          const timestamp = data.timestamp || data.updatedAt;

          // Logic similar to AdminTrackingPage but simplified for global sync
          const newStaff = (prev.staff || []).map((s: any) => {
            if (s._id === data.userId) {
              return { 
                ...s, 
                isOnline: data.isOnline !== undefined ? data.isOnline : true,
                location: { ...s.location, lat: data.lat, lng: data.lng, updatedAt: timestamp } 
              };
            }
            return s;
          });

          const newVehicles = (prev.vehicles || []).map((v: any) => {
            if (v._id === data.vehicleId || (v.user?._id === data.userId)) {
              return { 
                ...v, 
                location: { ...v.location, lat: data.lat, lng: data.lng, updatedAt: timestamp } 
              };
            }
            return v;
          });

          return { ...prev, staff: newStaff, vehicles: newVehicles, timestamp: new Date().toISOString() };
        });
      }
    };

    const handleGlobalSync = (data: any) => {
      if (!data) return;
      const entityRaw = (data as any).entity;
      const actionRaw = (data as any).action;
      const entityData = (data as any).data;
      const entity = typeof entityRaw === 'string' ? entityRaw.toLowerCase() : '';
      const action = typeof actionRaw === 'string' ? actionRaw.toLowerCase() : '';

      if (!entity || !action) return;

      // Map entities to query keys
      const entityQueryMap: Record<string, string[]> = {
        booking: ['bookings', 'booking', 'dashboard'],
        ticket: ['tickets', 'ticket', 'dashboard'],
        vehicle: ['vehicles', 'vehicle', 'tracking', 'dashboard'],
        user: ['users', 'user', 'dashboard', 'profile', 'merchants', 'staff'],
        approval: ['approvals', 'dashboard'],
        payment: ['payments', 'dashboard'],
        product: ['products', 'dashboard', 'stock'],
        service: ['services', 'dashboard'],
        setting: ['settings', 'public-settings', 'dashboard'],
        role: ['roles', 'dashboard'],
        hero: ['hero', 'dashboard'],
        notification: ['notifications', 'dashboard'],
        coupon: ['coupons', 'dashboard'],
        review: ['reviews', 'dashboard'],
        slotblock: ['slot-blocks', 'dashboard'],
        availableservicepincode: ['service-pincodes', 'dashboard'],
        blog: ['blogs', 'dashboard'],
        blogcategory: ['blog-categories', 'dashboard'],
        career: ['careers', 'dashboard'],
        careerapplication: ['career-applications', 'dashboard'],
      };

      const keysToInvalidate = entityQueryMap[entity] || ['dashboard'];
      
      keysToInvalidate.forEach(key => {
        queryClient.invalidateQueries({ queryKey: [key] });
      });

      // Special handling for specific entities with IDs
      if (entity === 'vehicle' && entityData?._id) {
        // Invalidate specific vehicle query
        queryClient.invalidateQueries({ queryKey: ['vehicle', entityData._id] });
        // Invalidate vehicle bookings
        queryClient.invalidateQueries({ queryKey: ['vehicleBookings', entityData._id] });
      }

      if (entity === 'booking' && entityData?._id) {
        queryClient.invalidateQueries({ queryKey: ['booking', entityData._id] });
      }

      // Special handling for some actions
      if (action === 'deleted_all' && entity === 'notification') {
        queryClient.setQueryData(['notifications'], []);
      }

      dispatchGlobalSync({ entity, action, data: entityData, timestamp: (data as { timestamp?: string }).timestamp });
    };

    const handleTypedSyncEvent = (event: string, raw: unknown) => {
      if (event === 'global:sync') {
        handleGlobalSync(raw);
        return;
      }
      if (!event.startsWith('sync:')) return;
      const entity = event.slice('sync:'.length);
      const payload = normalizeGlobalSyncPayload(
        raw && typeof raw === 'object'
          ? { ...(raw as object), entity: (raw as { entity?: string }).entity ?? entity }
          : { entity, action: 'updated', data: raw }
      );
      if (payload) {
        handleGlobalSync({ entity: payload.entity, action: payload.action, data: payload.data, timestamp: payload.timestamp });
      }
    };

    const handleVehicleSync = (data: any) => {
      if (!data || !data.data) return;
      
      const vehicleId = data.data._id;
      if (vehicleId) {
        queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
        queryClient.invalidateQueries({ queryKey: ['vehicleBookings', vehicleId] });
      }
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    socketService.onGlobal('notification', handleNotification);
    socketService.onGlobal('bookingUpdated', handleBookingUpdate);
    socketService.onGlobal('bookingCreated', handleBookingCreated);
    socketService.onGlobal('bookingCancelled', handleBookingCancelled);
    socketService.onGlobal('user_role_updated', handleRoleUpdated);
    socketService.onGlobal('newApproval', handleNewApproval);
    socketService.onGlobal('userUpdated', handleUserUpdated);
    socketService.onGlobal('vehicleCreated', handleVehicleCreated);
    socketService.onGlobal('vehicleDeleted', handleVehicleDeleted);
    socketService.onGlobal('liveLocation', handleLiveLocation);
    socketService.onGlobal('global:sync', handleGlobalSync);
    socketService.onGlobal('sync:vehicle', handleVehicleSync);
    socketService.onAny(handleTypedSyncEvent);

    return () => {
      socketService.off('connect');
      socketService.offGlobal('notification', handleNotification);
      socketService.offGlobal('bookingUpdated', handleBookingUpdate);
      socketService.offGlobal('bookingCreated', handleBookingCreated);
      socketService.offGlobal('bookingCancelled', handleBookingCancelled);
      socketService.offGlobal('user_role_updated', handleRoleUpdated);
      socketService.offGlobal('newApproval', handleNewApproval);
      socketService.offGlobal('userUpdated', handleUserUpdated);
      socketService.offGlobal('vehicleCreated', handleVehicleCreated);
      socketService.offGlobal('vehicleDeleted', handleVehicleDeleted);
      socketService.offGlobal('liveLocation', handleLiveLocation);
      socketService.offGlobal('global:sync', handleGlobalSync);
      socketService.offGlobal('sync:vehicle', handleVehicleSync);
      socketService.offAny(handleTypedSyncEvent);
      socketService.disconnect();
    };
  }, [queryClient, user, userRole, navigate, addNotification, updateUser]);

  return null; // This component doesn't render anything
};

export default SocketNotificationListener;
