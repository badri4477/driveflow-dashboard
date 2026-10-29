import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User as UserIcon, Mail, Phone, MapPin, Save, Store, Crosshair, Wrench, BatteryCharging, Disc, Droplets, ShieldCheck, Settings2, Hammer } from 'lucide-react';

// Offered service → icon + readable name (same mapping as the merchant app).
const serviceIcon = (c: string) => {
  const k = c.toLowerCase();
  if (k.includes('batter')) return BatteryCharging;
  if (k.includes('tire') || k.includes('tyre')) return Disc;
  if (k.includes('wash')) return Droplets;
  if (k.includes('essential') || k.includes('insur')) return ShieldCheck;
  if (k.includes('general') || k.includes('periodic') || k.includes('service')) return Wrench;
  return Settings2;
};
const serviceLabel = (c: string) => {
  const k = c.trim().toLowerCase();
  const names: Record<string, string> = { general: 'General Service', tires: 'Tyres', tyres: 'Tyres', battery: 'Battery', carwash: 'Car Wash', 'car wash': 'Car Wash' };
  return names[k] ?? k.split(/[\s_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
};
import { useAuthStore } from '@/store/authStore';
import { userService } from '@/services/userService';
import api from '@/services/api';
import { toast } from 'sonner';
import { isValidPhone10, isValidName, isNameTooLong } from '@/lib/formValidation';

const MerchantProfilePage: React.FC = () => {
  const { user, updateUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.location?.address || '',
    lat: user?.location?.lat || '',
    lng: user?.location?.lng || '',
  });

  // Fetch latest user data on mount to ensure we have location
  useEffect(() => {
    const fetchLatestProfile = async () => {
      if (user?._id) {
        try {
          // Since we don't have a direct "get my profile" API that returns full location if missing in auth store,
          // we rely on what's in authStore or refresh it. 
          // Ideally authStore should be kept in sync. 
          // If needed we can call a profile endpoint.
        } catch (error) {
          console.error(error);
        }
      }
    };
    fetchLatestProfile();
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleGetLocation = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }

    const loadingToast = toast.loading('Detecting your location...');

    const onLocationSuccess = async (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      
      setFormData(prev => ({
        ...prev,
        lat: latitude,
        lng: longitude
      }));

      // Try to reverse geocode to get the address
      try {
        const response = await api.get('/tracking/reverse', { 
          params: { lat: latitude, lng: longitude } 
        });
        if (response.data && response.data.display_name) {
          setFormData(prev => ({
            ...prev,
            address: response.data.display_name
          }));
        }
      } catch (error) {
        console.error('Reverse geocoding failed:', error);
      }

      toast.dismiss(loadingToast);
      toast.success('Location detected!');
    };

    const requestLocation = (highAccuracy: boolean) => {
      navigator.geolocation.getCurrentPosition(
        onLocationSuccess,
        (error) => {
          if (highAccuracy && (error.code === 2 || error.code === 3)) {
            // Fallback to low accuracy if GPS is weak
            requestLocation(false);
            return;
          }
          toast.dismiss(loadingToast);
          console.error('Error getting location:', error);
          if (error.code === 3) {
            toast.error('Location request timed out. Please enter manually.');
          } else {
            toast.error('Failed to get location. Please enable location services.');
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 5000 : 10000,
          maximumAge: highAccuracy ? 30000 : 60000
        }
      );
    };

    // Fast-track: try cached location first
    navigator.geolocation.getCurrentPosition(
      onLocationSuccess,
      () => requestLocation(true),
      {
        enableHighAccuracy: false,
        timeout: 1000,
        maximumAge: 300000
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = String(formData.name || '').trim();
    const phone = String(formData.phone || '').trim();
    const address = String(formData.address || '').trim();
    const lat = formData.lat === '' ? undefined : Number(formData.lat);
    const lng = formData.lng === '' ? undefined : Number(formData.lng);

    if (!name) {
      toast.error('Shop / Owner Name is required');
      return;
    }
    if (isNameTooLong(name)) {
      toast.error('Too long data: Please enter a maximum of 20 characters');
      return;
    }
    if (!isValidName(name)) {
      toast.error('Only characters are allowed, no special characters or numbers');
      return;
    }

    if (!phone) {
      toast.error('Phone Number is required');
      return;
    }
    if (!isValidPhone10(phone)) {
      toast.error('Phone number must be exactly 10 digits with no other characters');
      return;
    }

    if (!address) {
      toast.error('Shop Address is required');
      return;
    }

    if (lat === undefined || lng === undefined) {
      toast.error('Latitude and Longitude are required');
      return;
    }
    if ((lat !== undefined && Number.isNaN(lat)) || (lng !== undefined && Number.isNaN(lng))) {
      toast.error('Latitude and longitude must be valid numbers');
      return;
    }
    if ((lat !== undefined && (lat < -90 || lat > 90)) || (lng !== undefined && (lng < -180 || lng > 180))) {
      toast.error('Latitude/longitude values are out of range');
      return;
    }

    setIsLoading(true);
    try {
      const locationData = {
        address,
        lat,
        lng
      };

      const updatedUser = await userService.updateProfile({
        name,
        email: formData.email,
        phone: phone ? phone.replace(/\D/g, '') : '',
        location: locationData
      });
      
      // Update local auth store
      updateUser(updatedUser);
      toast.success('Profile updated successfully!');
    } catch (error: any) {
      console.error('Update failed:', error);
      const msg = error.response?.data?.message || 'Failed to update profile';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
          <Store className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shop Profile</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage your shop details and location</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-1">
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center text-center"
          >
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg">
              <span className="text-3xl font-bold text-white">
                {user?.name?.charAt(0).toUpperCase() || 'S'}
              </span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{user?.name || 'Shop Name'}</h2>
            <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1 rounded-full">
              Merchant Account
            </p>
            
            <div className="w-full mt-6 space-y-3">
              <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="truncate">{user?.email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                <Phone className="w-4 h-4 text-gray-400" />
                <span>{user?.phone || 'No phone added'}</span>
              </div>
            </div>
          </motion.div>

          {user?.category && user.category.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="mt-6 bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                  <Hammer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="font-semibold text-lg text-gray-900 dark:text-white">Services Offered</h3>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {user.category.map((c: string) => {
                  const Icon = serviceIcon(c);
                  return (
                    <div
                      key={c}
                      className="flex items-center gap-2.5 p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/40"
                    >
                      <span className="w-9 h-9 shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">{serviceLabel(c)}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>

        {/* Edit Form */}
        <div className="lg:col-span-2">
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm"
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-lg text-gray-900 dark:text-white">Edit Details</h3>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Shop / Owner Name</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type="text" 
                      name="name" 
                      value={formData.name} 
                      onChange={handleChange} 
                      className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type="tel" 
                      name="phone" 
                      value={formData.phone} 
                      onChange={handleChange} 
                      className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input 
                    type="email" 
                    name="email" 
                    value={formData.email} 
                    onChange={handleChange} 
                    disabled // Email usually shouldn't be changed easily or requires verification
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-gray-500">Contact support to change email address.</p>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-700 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-indigo-500" />
                    Shop Location
                  </h4>
                  <button 
                    type="button"
                    onClick={handleGetLocation}
                    className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Crosshair className="w-3 h-3" />
                    Get Current Location
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                   <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500">Latitude</label>
                    <input 
                      type="number" 
                      name="lat" 
                      value={formData.lat} 
                      onChange={handleChange} 
                      step="any"
                      placeholder="e.g. 17.3850"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500">Longitude</label>
                    <input 
                      type="number" 
                      name="lng" 
                      value={formData.lng} 
                      onChange={handleChange} 
                      step="any"
                      placeholder="e.g. 78.4867"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Shop Address</label>
                  <textarea 
                    name="address" 
                    value={formData.address} 
                    onChange={handleChange} 
                    rows={3}
                    placeholder="Enter full shop address..."
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  * Providing accurate location helps customers find your shop and enables distance calculation for assignments.
                </p>
              </div>

              <div className="pt-4 flex justify-end">
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-sm shadow-indigo-200 dark:shadow-none transition-all flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default MerchantProfilePage;
