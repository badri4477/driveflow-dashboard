import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplets, Check, Clock, X, Car, MapPin } from 'lucide-react';
import SlotPicker from '@/components/SlotPicker';
import LocationPicker, { LocationValue } from '@/components/LocationPicker';
import { staggerContainer, staggerItem, overlayVariants, modalVariants } from '@/animations/variants';
import { toast } from 'sonner';
import { serviceService, Service } from '@/services/serviceService';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import { searchVehicleReference } from '@/services/vehicleReferenceService';
import { bookingService } from '@/services/bookingService';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { formatLocalYmd, isSameLocalCalendarDay, isSlotStartInPast } from '@/lib/utils';

const extractPincodeFromAddress = (address?: string) => {
  const match = String(address || '').match(/(\d{6})(?!\d)/);
  return match ? match[1] : null;
};

const CarWashPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [services, setServices] = useState<Service[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<string[]>([]);
  const [allSlotsForDate, setAllSlotsForDate] = useState<string[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [pickupLocation, setPickupLocation] = useState<LocationValue>({ address: '' });
  const [showCustomLocation, setShowCustomLocation] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBooking, setIsBooking] = useState(false);
  const [availableServicePincodes, setAvailableServicePincodes] = useState<string[]>([]);
  const [pincodesReady, setPincodesReady] = useState(false);
  const [carWashPrices, setCarWashPrices] = useState<Record<string, number | null>>({});

  const selectedVehicleData = vehicles.find(v => v._id === selectedVehicle);

  useEffect(() => {
    const fetchRefPrice = async () => {
      if (selectedVehicleData) {
        try {
          const details = await searchVehicleReference(
            selectedVehicleData.make,
            selectedVehicleData.model,
            selectedVehicleData.variant || '',
            selectedVehicleData.fuelType,
            selectedVehicleData.year
          );
          if (details) {
            const num = (v: unknown) => {
              const n = Number(v);
              return v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
            };
            setCarWashPrices({
              exterior: num(details.car_wash_exterior_price),
              interiorExterior: num(details.car_wash_interior_exterior_price),
              underbody: num(details.car_wash_interior_exterior_underbody_price),
              legacy: num(details.car_wash_price),
            });
          } else {
            setCarWashPrices({});
          }
        } catch (error) {
          console.error('Failed to fetch car wash price from reference:', error);
          setCarWashPrices({});
        }
      } else {
        setCarWashPrices({});
      }
    };
    fetchRefPrice();
  }, [selectedVehicle, selectedVehicleData]);

  const getPackagePrice = (pkg: Service) => {
    // Admin-selected pricing column (Add/Edit Service) takes priority —
    // matches calculateServicesTotal in backend/controllers/bookingController.js,
    // and doesn't depend on the service happening to be worded a certain way.
    if (pkg.vehiclePricingColumn) {
      const columnPrice =
        pkg.vehiclePricingColumn === 'car_wash_exterior_price'
          ? carWashPrices.exterior
          : pkg.vehiclePricingColumn === 'car_wash_interior_exterior_price'
          ? carWashPrices.interiorExterior
          : pkg.vehiclePricingColumn === 'car_wash_interior_exterior_underbody_price'
          ? carWashPrices.underbody
          : null;
      if (columnPrice !== null && columnPrice > 0) {
        return columnPrice;
      }
    }

    const sName = pkg.name.toLowerCase();
    let price = null;

    if (sName.includes('exterior wash') && !sName.includes('interior')) {
      price = carWashPrices.exterior;
    } else if (sName.includes('interior + exterior') && !sName.includes('underbody')) {
      price = carWashPrices.interiorExterior;
    } else if (sName.includes('underbody wash') || (sName.includes('interior') && sName.includes('exterior') && sName.includes('underbody'))) {
      price = carWashPrices.underbody;
    }

    // Fallback to legacy price if specific one is not available
    if (price === null || price === 0) {
      price = carWashPrices.legacy;
    }

    if (price !== null && price > 0) return price;
    // A vehicle is chosen but the catalogue has no wash price for it: Carzzi
    // confirms the amount (matches calculateServicesTotal). Before a vehicle
    // is picked, show the package's standard price.
    return selectedVehicleData ? 0 : pkg.price;
  };
  const selectedLocationPincode = extractPincodeFromAddress(pickupLocation.address);
  const noServiceAreasConfigured = pincodesReady && availableServicePincodes.length === 0;
  const isSelectedLocationAllowed = Boolean(
    selectedLocationPincode &&
      (!pincodesReady ||
        (availableServicePincodes.length > 0 &&
          availableServicePincodes.includes(selectedLocationPincode)))
  );

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (user && (!user.addresses || user.addresses.length === 0)) {
      setShowCustomLocation(true);
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [servicesData, vehiclesData, blockedPincodesData] = await Promise.all([
        serviceService.getServices(undefined, 'Wash'),
        vehicleService.getVehicles(),
        bookingService.getAvailableServicePincodes(),
      ]);
      setServices(servicesData);
      setVehicles(vehiclesData);
      setAvailableServicePincodes(Array.isArray(blockedPincodesData?.availablePincodes) ? blockedPincodesData.availablePincodes : []);
      if (vehiclesData.length > 0) {
        setSelectedVehicle(vehiclesData[0]._id);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load services');
      setAvailableServicePincodes([]);
    } finally {
      setIsLoading(false);
      setPincodesReady(true);
    }
  };

  const refreshSlotsForDate = async (date: Date): Promise<string[]> => {
    try {
      const dateStr = formatLocalYmd(date);
      const data = await bookingService.getAvailableSlots(dateStr, 'Car Wash');
      const raw = Array.isArray(data?.availableSlots) ? data.availableSlots : [];
      const filtered = raw.filter(
        (slot: string) =>
          !isSameLocalCalendarDay(date) || !isSlotStartInPast(date, slot)
      );
      setAvailableSlots(filtered);
      setBookedSlots(Array.isArray(data?.bookedSlots) ? data.bookedSlots : []);
      setBlockedSlots(Array.isArray(data?.blockedSlots) ? data.blockedSlots : []);
      setAllSlotsForDate(Array.isArray(data?.allSlots) ? data.allSlots : []);
      if (selectedTime && !filtered.includes(selectedTime)) {
        setSelectedTime(null);
        toast.info('Previously selected slot is no longer available. Please select another slot.');
      }
      return filtered;
    } catch {
      setAvailableSlots([]);
      setBookedSlots([]);
      setBlockedSlots([]);
      setAllSlotsForDate([]);
      return [];
    }
  };

  useEffect(() => {
    if (selectedDate) {
      refreshSlotsForDate(selectedDate);
    } else {
      setAvailableSlots([]);
      setBookedSlots([]);
      setBlockedSlots([]);
      setAllSlotsForDate([]);
    }
  }, [selectedDate]);

  const handleBookNow = (packageId: string) => {
    if (vehicles.length === 0) {
      toast.error('Please add a vehicle to your profile first');
      return;
    }
    setSelectedPackage(packageId);
    setShowModal(true);
  };

  const handleConfirmBooking = async () => {
    if (!selectedPackage || !selectedDate || !selectedTime || !selectedVehicle) return;

    if (!pickupLocation.address.trim()) {
      toast.error('Please select a pickup location');
      return;
    }
    if (!isSelectedLocationAllowed) {
      toast.error(
        noServiceAreasConfigured
          ? 'Service not available at this area.'
          : 'Service booking is not enabled for this pincode.'
      );
      return;
    }

    setIsBooking(true);
    try {
      const [timePart, modifier] = selectedTime.split(' ');
      const parts = timePart.split(':').map(Number);
      let hours = parts[0];
      const minutes = parts[1];
      
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      
      const y = selectedDate.getFullYear();
      const m = selectedDate.getMonth() + 1;
      const d = selectedDate.getDate();
      const hh = String(hours).padStart(2, '0');
      const min = String(minutes).padStart(2, '0');
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${min}:00.000+05:30`;
      const bookingDate = new Date(dateStr);

      const bookingData = {
        vehicleId: selectedVehicle,
        serviceIds: [selectedPackage],
        date: bookingDate.toISOString(),
        location: pickupLocation,
        notes: "Booked via Car Wash Page"
      };

      const newBooking = await bookingService.createBooking(bookingData);
      
      if (newBooking && newBooking.requiresPayment) {
        const selectedPkg = services.find(s => s._id === selectedPackage);
        const tempBookingData = {
          ...bookingData,
          services: selectedPkg ? [selectedPkg] : [],
          totalAmount: newBooking.totalAmount || (selectedPkg ? getPackagePrice(selectedPkg) : 0),
          pickupDropPrice: newBooking.pickupDropPrice || 0,
          requiresPaymentService: true,
          isCarWashService: true
        };
        toast.success('Car wash service prepared! Please complete payment.');
        navigate('/payment', { 
          state: { 
            tempBookingData,
            tempBookingId: newBooking.tempBookingId 
          } 
        });
        return;
      }

      toast.success('Car wash booked successfully!');
      setShowModal(false);
      setSelectedDate(null);
      setSelectedTime(null);
      navigate('/my-bookings');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Booking failed:', error);
      toast.error(error.response?.data?.message || 'Failed to book car wash');
    } finally {
      setIsBooking(false);
    }
  };

  const selectedPackageData = services.find(p => p._id === selectedPackage);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full h-full py-4 lg:py-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="text-center sm:text-left">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Car Wash</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Choose a package and book your slot</p>
      </div>

      {services.length === 0 ? (
        <div className="text-center py-8 sm:py-12 bg-muted/30 rounded-2xl">
          <Droplets className="w-8 h-8 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-foreground">No Wash Packages Available</h3>
          <p className="text-sm text-muted-foreground">Please check back later.</p>
        </div>
      ) : (
        /* Package Cards */
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
        >
          {services.map((pkg) => (
            <motion.div
              key={pkg._id}
              variants={staggerItem}
              className="relative bg-card rounded-2xl border-2 border-border p-4 sm:p-6 transition-all hover:border-primary/50"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Droplets className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">{pkg.name}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">{pkg.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4 text-xs sm:text-sm text-muted-foreground">
                <Clock className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span>{pkg.duration}</span>
              </div>

              {pkg.features && pkg.features.length > 0 && (
                <ul className="space-y-2 mb-6">
                  {pkg.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-xs sm:text-sm">
                      <Check className="w-3 h-3 sm:w-4 sm:h-4 text-success flex-shrink-0" />
                      <span className="text-foreground line-clamp-1">{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col mb-4 mt-auto">
                {getPackagePrice(pkg) > 0 ? (
                  <span className="text-2xl sm:text-3xl font-bold text-primary tabular-nums">
                    ₹{getPackagePrice(pkg)}
                  </span>
                ) : (
                  <span className="text-base font-semibold text-muted-foreground">Price confirmed by Carzzi</span>
                )}
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => handleBookNow(pkg._id)}
                className="w-full py-3 rounded-xl font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 text-sm sm:text-base min-h-[44px]"
              >
                Book Now
              </motion.button>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Booking Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            />

            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-md bg-card rounded-t-3xl sm:rounded-2xl shadow-xl border border-border overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 flex items-center justify-between p-4 border-b border-border bg-card z-10">
                <div>
                  <h2 className="font-semibold text-base sm:text-lg truncate">Book {selectedPackageData?.name}</h2>
                  <p className="text-sm text-muted-foreground">₹{selectedPackageData?.price}</p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4 sm:space-y-6">
                {/* Vehicle Selection */}
                <div>
                  <h3 className="text-sm font-medium mb-3">Select Vehicle</h3>
                  <div className="space-y-2">
                    {vehicles.map((vehicle) => (
                      <button
                        key={vehicle._id}
                        onClick={() => setSelectedVehicle(vehicle._id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                          selectedVehicle === vehicle._id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Car className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                        </div>
                        <div className="text-left min-w-0 flex-1">
                          <p className="font-medium text-foreground text-sm truncate">
                            {vehicle.make} {vehicle.model}
                          </p>
                          <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                            <span>{vehicle.licensePlate}</span>
                            {vehicle.fuelType && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30 shrink-0">
                                {vehicle.fuelType}
                              </span>
                            )}
                          </p>
                        </div>
                        {selectedVehicle === vehicle._id && (
                          <div className="ml-auto w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <SlotPicker
                  selectedDate={selectedDate}
                  selectedTime={selectedTime}
                  onDateChange={setSelectedDate}
                  onTimeChange={setSelectedTime}
                  availableSlots={availableSlots}
                  bookedSlots={bookedSlots}
                  blockedSlots={blockedSlots}
                  allSlotsFromApi={allSlotsForDate}
                />

                {/* Pickup Location Selection */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Pickup Location</h3>
                  
                  {user?.addresses && user.addresses.length > 0 && (
                    <div className="space-y-2">
                      {user.addresses.map((addr, index) => (
                        (() => {
                          const pin = extractPincodeFromAddress(addr.address);
                          const isBlockedAddress = Boolean(
                            pincodesReady &&
                              (availableServicePincodes.length === 0 ||
                                !pin ||
                                !availableServicePincodes.includes(pin))
                          );
                          return (
                        <button
                          key={index}
                          disabled={isBlockedAddress}
                          onClick={() => {
                            if (isBlockedAddress) return;
                            setPickupLocation({ address: addr.address, lat: addr.lat, lng: addr.lng });
                            setShowCustomLocation(false);
                          }}
                          className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-colors text-left ${
                            isBlockedAddress
                              ? 'border-border opacity-60 cursor-not-allowed bg-muted/20'
                              :
                            pickupLocation.address === addr.address && !showCustomLocation
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:bg-muted/50'
                          }`}
                        >
                          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground text-sm truncate">{addr.label}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">{addr.address}</p>
                            {isBlockedAddress &&
                              (noServiceAreasConfigured ? (
                                <p className="text-[11px] font-semibold text-destructive mt-1">
                                  Service not available at this area.
                                </p>
                              ) : !pin ? (
                                <p className="text-[11px] font-semibold text-destructive mt-1">
                                  Address must include a valid 6-digit pincode
                                </p>
                              ) : (
                                <p className="text-[11px] font-semibold text-destructive mt-1">
                                  Service not enabled for this pincode
                                </p>
                              ))}
                          </div>
                        </button>
                          );
                        })()
                      ))}
                    </div>
                  )}

                  {user?.addresses && user.addresses.length > 0 && (
                    <div className="pt-2">
                      <button
                        onClick={() => {
                          setShowCustomLocation(!showCustomLocation);
                          if (!showCustomLocation) setPickupLocation({ address: '' });
                        }}
                        className="text-sm text-primary font-medium hover:underline flex items-center gap-1"
                      >
                        {showCustomLocation ? 'Cancel Custom Address' : '+ Use Custom Address'}
                      </button>
                    </div>
                  )}

                  {(showCustomLocation || !user?.addresses || user.addresses.length === 0) && (
                    <div className="mt-3">
                      <LocationPicker 
                        value={pickupLocation} 
                        onChange={setPickupLocation}
                        mapClassName="h-[180px] sm:h-[200px] w-full rounded-xl"
                      />
                    </div>
                  )}
                  {pickupLocation.address && !isSelectedLocationAllowed && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
                      <p className="text-xs font-semibold text-destructive">
                        {noServiceAreasConfigured
                          ? 'Service not available at this area.'
                          : !selectedLocationPincode
                            ? 'Add a complete address with a 6-digit pincode, or update it in your profile.'
                            : 'Service booking is not enabled for this pincode. Please choose another location.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 p-4 border-t border-border bg-card">
                <button
                  onClick={handleConfirmBooking}
                  disabled={!selectedDate || !selectedTime || !selectedVehicle || !pickupLocation.address || !isSelectedLocationAllowed || isBooking}
                  className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base min-h-[44px]"
                >
                  {isBooking ? (
                    <>
                      <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Confirm Booking'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CarWashPage;
