import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, UserPlus, Car, Plus, Minus, Loader2, Check, MapPin, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { bookingService, AdminCustomerResult } from '@/services/bookingService';
import { serviceService, Service } from '@/services/serviceService';
import { searchVehicleReference, getVehicleReference } from '@/services/vehicleReferenceService';
import { AutocompleteField, FUEL_TYPE_OPTIONS, ReferenceRecord } from '@/pages/customer/AddVehiclePage';
import { isValidLicensePlate } from '@/lib/formValidation';
import VahanLookup, { VehicleEntryMode } from '@/components/vehicle/VahanLookup';
import { getServiceUnitPrice, isGeneralServiceItem, VehicleReferenceRecord } from '@/lib/vehicleServicePricing';
import { formatLocalYmd, isSameLocalCalendarDay, isSlotStartInPast } from '@/lib/utils';
import SlotPicker from '@/components/SlotPicker';
import LocationPicker, { LocationValue } from '@/components/LocationPicker';

const PREPAID_CATEGORIES = ['Car Wash', 'Wash', 'Battery', 'Tyres', 'Tyre & Battery', 'Essentials'];
const GST_RATE = 0.18;
const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${round2(n).toLocaleString('en-IN')}`;

const categoryGroup = (cat: string) => {
  if (cat === 'Car Wash' || cat === 'Wash') return 'Car Wash';
  if (cat === 'Tyres' || cat === 'Battery' || cat === 'Tyre & Battery') return 'Tyres & Battery';
  if (cat === 'Essentials') return 'Essentials';
  return 'General Services';
};
const brandKind = (s: Service): 'tyre' | 'battery' | null => {
  if (s.category === 'Battery' || s.vehiclePricingColumn === 'battery_brand') return 'battery';
  if (s.category === 'Tyres' || s.category === 'Tyre & Battery' || s.vehiclePricingColumn === 'tyre_brand') return 'tyre';
  return null;
};
const brandsFromRef = (ref: VehicleReferenceRecord, kind: 'tyre' | 'battery') => {
  if (!ref) return [];
  const prefix = kind === 'tyre' ? 'tyre_price_' : 'battery_price_';
  return Object.entries(ref)
    .filter(([k, v]) => k.startsWith(prefix) && Number(v) > 0)
    .map(([k]) => k.slice(prefix.length))
    .map((b) => b.charAt(0).toUpperCase() + b.slice(1));
};
/** "10:30 AM" on a local day → ISO in IST, same as the customer booking flow. */
const slotToIso = (day: Date, slot: string) => {
  const [time, mod] = slot.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (mod === 'PM' && h < 12) h += 12;
  if (mod === 'AM' && h === 12) h = 0;
  return new Date(`${formatLocalYmd(day)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000+05:30`).toISOString();
};

const inputCls =
  'w-full h-11 px-3 border border-input rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60';
const labelCls = 'text-sm font-medium block mb-1';
const sectionCls = 'bg-card rounded-2xl border border-border p-6 space-y-4';
// Same step flow as the customer booking page, with a Customer step first.
const STEPS = ['Customer', 'Vehicle', 'Service', 'Schedule', 'Confirm'];
const STEP_ERROR_KEYS: string[][] = [
  ['customer', 'name', 'phone', 'email'],
  ['vehicle', 'licensePlate', 'make', 'model', 'variant', 'fuelType'],
  ['services'],
  ['slot', 'address'],
  [],
];

type NewCustomer = { name: string; phone: string; email: string };

/** Bookings default to the next day. */
const tomorrowYmd = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatLocalYmd(d);
};

// In-progress form is kept per browser tab so a refresh resumes where the admin left off.
const DRAFT_KEY = 'admin-create-booking-draft';
type Draft = Record<string, any>;
const loadDraft = (): Draft => {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : {};
    // A saved date in the past is dropped (slots for it are gone).
    if (d.day && d.day < formatLocalYmd(new Date())) {
      delete d.day;
      delete d.slot;
    }
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
};
type NewVehicle = { make: string; model: string; variant: string; fuelType: string; licensePlate: string; frontTyres: string; rearTyres: string };

const AdminCreateBookingPage: React.FC = () => {
  const navigate = useNavigate();
  const draft = useRef<Draft>(loadDraft()).current;

  // Customer
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminCustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState<AdminCustomerResult | null>(draft.customer ?? null);
  const [addingCustomer, setAddingCustomer] = useState<boolean>(draft.addingCustomer ?? false);
  const [newCustomer, setNewCustomer] = useState<NewCustomer>(draft.newCustomer ?? { name: '', phone: '', email: '' });

  // Vehicle
  const [vehicleId, setVehicleId] = useState<string>(draft.vehicleId ?? '');
  const [addingVehicle, setAddingVehicle] = useState<boolean>(draft.addingVehicle ?? false);
  const [newVehicle, setNewVehicle] = useState<NewVehicle>(draft.newVehicle ?? { make: '', model: '', variant: '', fuelType: '', licensePlate: '', frontTyres: '', rearTyres: '' });
  // Brand -> Model -> Variant come from Vehicle Reference Data, same as the customer Add Vehicle form.
  const [catalog, setCatalog] = useState<ReferenceRecord[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  // Automatic (Vahan) / Manual — detail fields show once picked; a restored draft with details opens in manual.
  const [entryMode, setEntryMode] = useState<VehicleEntryMode>(newVehicle.make ? 'manual' : null);
  const [vehicleRef, setVehicleRef] = useState<VehicleReferenceRecord>(null);
  const [refLoading, setRefLoading] = useState(false);

  // Services
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(draft.selected ?? []);
  const [brands, setBrands] = useState<Record<string, string>>(draft.brands ?? {});
  const [quantities, setQuantities] = useState<Record<string, number>>(draft.quantities ?? {});

  // Schedule
  const [day, setDay] = useState<string>(draft.day ?? tomorrowYmd());
  const [slotData, setSlotData] = useState<{ available: string[]; booked: string[]; blocked: string[]; all: string[] }>({
    available: [], booked: [], blocked: [], all: [],
  });
  const [slot, setSlot] = useState<string>(draft.slot ?? '');
  // Same location model as the customer flow: saved address or map pick.
  const [pickup, setPickup] = useState<LocationValue>(draft.pickup ?? { address: '' });
  const [showCustomLocation, setShowCustomLocation] = useState<boolean>(draft.showCustomLocation ?? false);
  const address = pickup.address || '';
  const [servicePincodes, setServicePincodes] = useState<string[] | null>(null);

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<number>(draft.step ?? 0);
  // Errors only show for steps the admin has tried to leave.
  const [triedSteps, setTriedSteps] = useState<number[]>([]);
  const searchSeq = useRef(0);
  const createdRef = useRef(false);

  useEffect(() => {
    if (createdRef.current) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      step, customer, addingCustomer, newCustomer, vehicleId, addingVehicle, newVehicle,
      selected, brands, quantities, day, slot, pickup, showCustomLocation,
    }));
  }, [step, customer, addingCustomer, newCustomer, vehicleId, addingVehicle, newVehicle,
    selected, brands, quantities, day, slot, pickup, showCustomLocation]);

  useEffect(() => {
    serviceService
      .getServices()
      .then((data: Service[]) => setServices(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load services'))
      .finally(() => setServicesLoading(false));
    getVehicleReference()
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]))
      .finally(() => setCatalogLoading(false));
    bookingService
      .getAvailableServicePincodes()
      .then((data) => setServicePincodes(Array.isArray(data?.availablePincodes) ? data.availablePincodes : []))
      .catch(() => setServicePincodes([]));
  }, []);

  // Debounced customer search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await bookingService.searchCustomersForBooking(q);
        if (seq === searchSeq.current) setResults(data);
      } catch {
        if (seq === searchSeq.current) toast.error('Customer search failed');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const brandOptions = useMemo(
    () => Array.from(new Set(catalog.map((r) => (r.brand_name || '').trim()).filter(Boolean))).sort(),
    [catalog]
  );
  const modelOptions = useMemo(() => {
    if (!newVehicle.make) return [];
    return Array.from(new Set(
      catalog.filter((r) => r.brand_name === newVehicle.make).map((r) => (r.model || '').trim()).filter(Boolean)
    )).sort();
  }, [catalog, newVehicle.make]);
  const variantOptions = useMemo(() => {
    if (!newVehicle.make || !newVehicle.model) return [];
    return Array.from(new Set(
      catalog.filter((r) => r.brand_name === newVehicle.make && r.model === newVehicle.model)
        .map((r) => (r.brand_model || '').trim()).filter(Boolean)
    )).sort();
  }, [catalog, newVehicle.make, newVehicle.model]);
  const fuelOptions = useMemo(() => {
    if (!newVehicle.make || !newVehicle.model) return FUEL_TYPE_OPTIONS;
    const set = new Set<string>();
    catalog.forEach((r) => {
      if (r.brand_name === newVehicle.make && r.model === newVehicle.model &&
        (!newVehicle.variant || r.brand_model === newVehicle.variant)) {
        const f = (r.fuel_type || '').trim();
        if (FUEL_TYPE_OPTIONS.includes(f)) set.add(f);
      }
    });
    return set.size > 0 ? FUEL_TYPE_OPTIONS.filter((f) => set.has(f)) : FUEL_TYPE_OPTIONS;
  }, [catalog, newVehicle.make, newVehicle.model, newVehicle.variant]);

  // Auto-fill fuel + tyre sizes once the selection resolves to a catalog record.
  useEffect(() => {
    if (!newVehicle.make || !newVehicle.model) return;
    const rows = catalog.filter((r) => r.brand_name === newVehicle.make && r.model === newVehicle.model &&
      (!newVehicle.variant || r.brand_model === newVehicle.variant));
    // Prefer the row with the fuel already chosen (e.g. Diesel from Vahan) over the first row.
    const match = rows.find((r) => newVehicle.fuelType && r.fuel_type === newVehicle.fuelType) || rows[0];
    if (!match) return;
    setNewVehicle((v) => ({
      ...v,
      frontTyres: (match.front_tyres as string) || v.frontTyres,
      rearTyres: (match.rear_tyres as string) || v.rearTyres,
      fuelType: FUEL_TYPE_OPTIONS.includes((match.fuel_type as string) || '') ? (match.fuel_type as string) : v.fuelType,
    }));
  }, [catalog, newVehicle.make, newVehicle.model, newVehicle.variant]);
  useEffect(() => {
    if (newVehicle.fuelType && !fuelOptions.includes(newVehicle.fuelType)) {
      setNewVehicle((v) => ({ ...v, fuelType: '' }));
    }
  }, [fuelOptions, newVehicle.fuelType]);

  const savedVehicle = customer?.vehicles.find((v) => v._id === vehicleId) || null;
  const vehicleInfo = addingVehicle || !customer
    ? { make: newVehicle.make, model: newVehicle.model, variant: newVehicle.variant, fuelType: newVehicle.fuelType }
    : savedVehicle;

  // Live vehicle price list lookup (same source the customer flow uses)
  useEffect(() => {
    if (!vehicleInfo?.make || !vehicleInfo?.model) {
      setVehicleRef(null);
      return;
    }
    let cancelled = false;
    setRefLoading(true);
    const t = setTimeout(async () => {
      const ref = await searchVehicleReference(vehicleInfo.make, vehicleInfo.model, vehicleInfo.variant, vehicleInfo.fuelType);
      if (!cancelled) {
        setVehicleRef(ref && typeof ref === 'object' ? (Array.isArray(ref) ? ref[0] ?? null : ref) : null);
        setRefLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vehicleInfo?.make, vehicleInfo?.model, vehicleInfo?.variant, vehicleInfo?.fuelType]);

  const selectedServices = useMemo(() => services.filter((s) => selected.includes(s._id)), [services, selected]);
  const slotCategory = useMemo(() => {
    const groups = Array.from(new Set(selectedServices.map((s) => categoryGroup(s.category))));
    return groups.length === 1 ? groups[0] : 'All';
  }, [selectedServices]);

  // Slots for the chosen day + service category (SlotPicker hides past/booked slots).
  useEffect(() => {
    if (!day) return;
    let cancelled = false;
    bookingService
      .getAvailableSlots(day, slotCategory)
      .then((data) => {
        if (cancelled) return;
        // Same as the customer flow: today's slots that already started are not offered.
        const dayDate = new Date(`${day}T00:00:00`);
        const next = {
          available: (data?.availableSlots || []).filter(
            (s: string) => !isSameLocalCalendarDay(dayDate) || !isSlotStartInPast(dayDate, s)
          ),
          booked: data?.bookedSlots || [],
          blocked: data?.blockedSlots || [],
          all: data?.allSlots || [],
        };
        setSlotData(next);
        setSlot((cur) => (next.available.includes(cur) && !next.booked.includes(cur) ? cur : ''));
      })
      .catch(() => !cancelled && setSlotData({ available: [], booked: [], blocked: [], all: [] }));
    return () => {
      cancelled = true;
    };
  }, [day, slotCategory]);

  const pinOf = (addr: string) => (addr.match(/(\d{6})(?!\d)/) || [])[1] || null;
  const pinAllowed = (addr: string) => {
    const pin = pinOf(addr);
    return !!pin && (servicePincodes === null || servicePincodes.includes(pin));
  };
  const savedAddresses = (!addingCustomer && customer?.addresses) || [];

  // Pricing preview — the server recalculates on submit.
  const lines = selectedServices.map((s) => {
    const qty = quantities[s._id] ?? 1;
    const unit = getServiceUnitPrice(s, vehicleRef, brands[s._id]);
    return { service: s, qty, unit, amount: unit * qty };
  });
  const servicesTotal = lines.reduce((acc, l) => acc + l.amount, 0);
  const hasGeneral = selectedServices.some(isGeneralServiceItem);
  const pickupDrop = hasGeneral && vehicleRef?.pickup_drop_price != null ? Number(vehicleRef.pickup_drop_price) || 0 : 0;
  const prepaid = selectedServices.some((s) => PREPAID_CATEGORIES.includes(s.category));
  const subtotal = servicesTotal + pickupDrop;
  const gst = prepaid && !hasGeneral ? round2(subtotal * GST_RATE) : 0;
  const total = round2(subtotal + gst);

  // Validation
  const errors: Record<string, string> = {};
  if (!customer && !addingCustomer) errors.customer = 'Select a customer or add a new one.';
  if (addingCustomer) {
    if (!newCustomer.name.trim()) errors.name = 'Name is required.';
    if (!/^\d{10}$/.test(newCustomer.phone)) errors.phone = 'Enter a 10-digit mobile number.';
    if (newCustomer.email && !/^\S+@\S+\.\S+$/.test(newCustomer.email)) errors.email = 'Enter a valid email.';
  }
  const needsNewVehicle = addingCustomer || addingVehicle || (customer && customer.vehicles.length === 0);
  if (needsNewVehicle) {
    if (!isValidLicensePlate(newVehicle.licensePlate.trim().toUpperCase())) {
      errors.licensePlate = 'Enter a valid registration number (e.g. MH 02 AB 1234).';
    }
    if (!entryMode && !errors.licensePlate) errors.licensePlate = 'Choose Automatic or Manual to add the vehicle details.';
    if (!newVehicle.make) errors.make = 'Select a brand from the suggestions.';
    if (!newVehicle.model) errors.model = 'Select a model from the suggestions.';
    if (!newVehicle.variant) errors.variant = 'Select a variant from the suggestions.';
    if (!newVehicle.fuelType) errors.fuelType = 'Select a fuel type.';
  } else if (customer && !vehicleId) {
    errors.vehicle = 'Select a vehicle.';
  }
  if (selected.length === 0) errors.services = 'Select at least one service.';
  selectedServices.forEach((s) => {
    if (brandKind(s) && brandsFromRef(vehicleRef, brandKind(s)!).length > 0 && !brands[s._id]) {
      errors.services = `Choose a brand for ${s.name}.`;
    }
  });
  if (!slot) errors.slot = 'Choose a time slot.';
  if (!address.trim()) errors.address = 'Select or enter the customer location.';
  else if (!pinOf(address)) errors.address = 'Address must include a 6-digit pincode.';
  else if (!pinAllowed(address)) errors.address = 'Service is not enabled for this pincode. Choose another location.';
  const show = (key: string) => {
    const tried = submitted || triedSteps.includes(STEP_ERROR_KEYS.findIndex((keys) => keys.includes(key)));
    return tried && errors[key] ? <p className="text-xs text-red-600 mt-1">{errors[key]}</p> : null;
  };
  const stepHasErrors = (i: number) => STEP_ERROR_KEYS[i].some((k) => errors[k]);
  const goNext = () => {
    if (stepHasErrors(step)) {
      setTriedSteps((t) => (t.includes(step) ? t : [...t, step]));
      toast.error('Please fix the highlighted fields');
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goBack = () => {
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pickCustomer = (c: AdminCustomerResult) => {
    setCustomer(c);
    setAddingCustomer(false);
    setResults([]);
    setQuery('');
    setVehicleId(c.vehicles[0]?._id || '');
    setAddingVehicle(c.vehicles.length === 0);
    setPickup({ address: '' });
    setShowCustomLocation(false);
  };

  const toggleService = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length) {
      const firstBad = STEP_ERROR_KEYS.findIndex((keys) => keys.some((k) => errors[k]));
      if (firstBad >= 0) setStep(firstBad);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const booking = await bookingService.adminCreateBooking({
        customer: customer && !addingCustomer
          ? { userId: customer._id }
          : { name: newCustomer.name.trim(), phone: newCustomer.phone, email: newCustomer.email.trim() || undefined },
        vehicle: needsNewVehicle
          ? {
              make: newVehicle.make.trim(),
              model: newVehicle.model.trim(),
              variant: newVehicle.variant.trim() || undefined,
              fuelType: newVehicle.fuelType || undefined,
              licensePlate: newVehicle.licensePlate.trim().toUpperCase(),
              frontTyres: newVehicle.frontTyres || undefined,
              rearTyres: newVehicle.rearTyres || undefined,
            }
          : { vehicleId },
        serviceIds: selected,
        selectedBrands: brands,
        serviceQuantities: quantities,
        date: slotToIso(new Date(`${day}T00:00:00`), slot),
        location: { address: address.trim(), lat: pickup.lat, lng: pickup.lng },
      });
      // The customer link also goes out by WhatsApp/SMS; copy it so the admin can share it directly.
      const link = booking.summaryUrl;
      let copied = false;
      if (link) {
        copied = await navigator.clipboard?.writeText(link).then(() => true, () => false) ?? false;
      }
      toast.success(`Booking #${booking.orderNumber || ''} created`, {
        description: link ? (copied ? 'Customer booking link copied to clipboard.' : link) : undefined,
        action: link ? { label: 'Open link', onClick: () => window.open(link, '_blank', 'noopener') } : undefined,
        duration: 10000,
      });
      createdRef.current = true;
      sessionStorage.removeItem(DRAFT_KEY);
      navigate(`/admin/bookings/${booking._id}`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to create booking');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/admin/bookings')}
          className="h-10 w-10 inline-flex items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Back to bookings"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">Create Booking</h1>
          <p className="text-sm text-muted-foreground">Book a service on a customer's behalf.</p>
        </div>
      </div>

      <ol className="flex items-center justify-between bg-card rounded-2xl p-3 sm:p-4 border border-border overflow-x-auto" aria-label="Booking steps">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center flex-shrink-0" aria-current={index === step ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <span
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium transition-colors ${
                  index <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {index < step ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : index + 1}
              </span>
              <span className={`text-xs mt-1 ${index <= step ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
            </div>
            {index < STEPS.length - 1 && (
              <span className={`h-0.5 w-4 sm:w-8 lg:w-16 mx-1 sm:mx-2 ${index < step ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </li>
        ))}
      </ol>

      <div className="min-h-[400px]">
          {step === 0 && (
          <section className={sectionCls} aria-labelledby="customer-heading">
            <h2 id="customer-heading" className="font-semibold">Customer</h2>
            {customer && !addingCustomer ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
                <div className="text-sm">
                  <p className="font-medium">{customer.name}</p>
                  <p className="text-muted-foreground">{[customer.phone, customer.email].filter(Boolean).join(' · ')}</p>
                </div>
                <button type="button" onClick={() => setCustomer(null)} className="h-10 px-3 rounded-lg text-sm border border-border hover:bg-muted">
                  Change
                </button>
              </div>
            ) : addingCustomer ? (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="nc-name" className={labelCls}>Name</label>
                    <input id="nc-name" className={inputCls} maxLength={50} value={newCustomer.name}
                      onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} />
                    {show('name')}
                  </div>
                  <div>
                    <label htmlFor="nc-phone" className={labelCls}>Mobile number</label>
                    <input id="nc-phone" className={inputCls} inputMode="numeric" value={newCustomer.phone}
                      onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                    {show('phone')}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="nc-email" className={labelCls}>Email <span className="font-normal text-muted-foreground">(optional)</span></label>
                    <input id="nc-email" type="email" className={inputCls} value={newCustomer.email}
                      onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))} />
                    {show('email')}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">The customer signs in later with this mobile number and an OTP.</p>
                <button type="button" onClick={() => setAddingCustomer(false)} className="h-10 px-3 rounded-lg text-sm border border-border hover:bg-muted">
                  Search existing instead
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label htmlFor="cust-search" className="sr-only">Search customers</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input id="cust-search" className={`${inputCls} pl-9`} placeholder="Search by name, phone or email"
                    value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                  {searching && <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                </div>
                {results.length > 0 && (
                  <ul className="border border-border rounded-xl divide-y divide-border max-h-64 overflow-y-auto">
                    {results.map((c) => (
                      <li key={c._id}>
                        <button type="button" onClick={() => pickCustomer(c)}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted focus-visible:outline-none focus-visible:bg-muted text-sm">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-muted-foreground"> · {c.phone || c.email}</span>
                          <span className="text-muted-foreground"> · {c.vehicles.length} vehicle{c.vehicles.length === 1 ? '' : 's'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && !searching && results.length === 0 && (
                  <p className="text-sm text-muted-foreground">No customers match “{query.trim()}”.</p>
                )}
                <button type="button" onClick={() => {
                  setAddingCustomer(true);
                  setCustomer(null);
                  const digits = query.replace(/\D/g, '');
                  setNewCustomer({ name: digits ? '' : query.trim(), phone: digits.slice(-10), email: '' });
                }}
                  className="h-10 px-3 inline-flex items-center gap-2 rounded-lg text-sm border border-border hover:bg-muted">
                  <UserPlus className="w-4 h-4" /> Add new customer
                </button>
                {show('customer')}
              </div>
            )}
          </section>
          )}

          {step === 1 && (
          <section className={sectionCls} aria-labelledby="vehicle-heading">
            <h2 id="vehicle-heading" className="font-semibold">Vehicle</h2>
            {!customer && !addingCustomer ? (
              <p className="text-sm text-muted-foreground">Select a customer first.</p>
            ) : (
              <>
                {customer && !addingCustomer && customer.vehicles.length > 0 && !addingVehicle && (
                  <div className="space-y-2">
                    {customer.vehicles.map((v) => (
                      <label key={v._id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${vehicleId === v._id ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="vehicle" checked={vehicleId === v._id} onChange={() => setVehicleId(v._id)} />
                        <Car className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">
                          <span className="font-medium">{v.make} {v.model}</span>
                          {v.variant ? ` ${v.variant}` : ''} · {v.licensePlate}
                        </span>
                      </label>
                    ))}
                    {show('vehicle')}
                  </div>
                )}
                {needsNewVehicle ? (
                  <div className="space-y-3">
                    <VahanLookup
                      mode={entryMode}
                      onModeChange={setEntryMode}
                      idPrefix="nv"
                      plate={newVehicle.licensePlate}
                      onPlateChange={(p) => setNewVehicle((v) => ({ ...v, licensePlate: p }))}
                      catalog={catalog}
                      fuelOptions={FUEL_TYPE_OPTIONS}
                      plateError={show('licensePlate')}
                      onFill={(fill) =>
                        setNewVehicle((v) => ({
                          ...v,
                          licensePlate: fill.licensePlate || v.licensePlate,
                          make: fill.make || v.make,
                          model: fill.make ? fill.model || '' : v.model,
                          variant: fill.make ? fill.variant || '' : v.variant,
                          fuelType: fill.fuelType || v.fuelType,
                        }))
                      }
                    />
                    {entryMode && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <AutocompleteField label="Brand" value={newVehicle.make} options={brandOptions} required
                          disabled={catalogLoading}
                          placeholder={catalogLoading ? 'Loading brands...' : 'Type to search brand'}
                          onSelect={(val) => setNewVehicle((v) => ({ ...v, make: val, model: '', variant: '' }))} />
                        {show('make')}
                      </div>
                      <div>
                        <AutocompleteField label="Model" value={newVehicle.model} options={modelOptions} required
                          disabled={!newVehicle.make} matchMode="contains"
                          placeholder={newVehicle.make ? 'Type to search model' : 'Select brand first'}
                          onSelect={(val) => setNewVehicle((v) => ({ ...v, model: val, variant: '' }))} />
                        {show('model')}
                      </div>
                      <div>
                        <AutocompleteField label="Variant/Class" value={newVehicle.variant} options={variantOptions} required
                          disabled={!newVehicle.model} matchMode="contains"
                          placeholder={newVehicle.model ? 'Type to search variant' : 'Select model first'}
                          onSelect={(val) => setNewVehicle((v) => ({ ...v, variant: val }))} />
                        {show('variant')}
                      </div>
                      <div>
                        <label htmlFor="nv-fuel" className="block text-sm font-medium text-foreground mb-2">
                          Fuel Type <span className="text-destructive">*</span>
                        </label>
                        <select id="nv-fuel" className={inputCls} value={newVehicle.fuelType}
                          onChange={(e) => setNewVehicle((v) => ({ ...v, fuelType: e.target.value }))}>
                          <option value="">Select fuel type</option>
                          {fuelOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        {show('fuelType')}
                      </div>
                    </div>
                    )}
                  </div>
                ) : null}
                {customer && !addingCustomer && customer.vehicles.length > 0 && (
                  <button type="button" onClick={() => setAddingVehicle((a) => !a)}
                    className="h-10 px-3 inline-flex items-center gap-2 rounded-lg text-sm border border-border hover:bg-muted">
                    {addingVehicle ? 'Use a saved vehicle' : (<><Plus className="w-4 h-4" /> Add another vehicle</>)}
                  </button>
                )}
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {refLoading
                    ? 'Loading vehicle prices…'
                    : vehicleInfo?.make && vehicleInfo?.model
                      ? vehicleRef ? 'Vehicle prices loaded from the price list.' : 'No price list entry for this vehicle — standard prices apply.'
                      : ''}
                </p>
              </>
            )}
          </section>
          )}

          {step === 2 && (
          <section className={sectionCls} aria-labelledby="services-heading">
            <h2 id="services-heading" className="font-semibold">Services</h2>
            {servicesLoading ? (
              <p className="text-sm text-muted-foreground">Loading services…</p>
            ) : services.length === 0 ? (
              <p className="text-sm text-muted-foreground">No services found.</p>
            ) : (
              <ul className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                {services.map((s) => {
                  const on = selected.includes(s._id);
                  const kind = brandKind(s);
                  const brandOptions = kind ? brandsFromRef(vehicleRef, kind) : [];
                  const qty = quantities[s._id] ?? 1;
                  return (
                    <li key={s._id} className={`rounded-xl border p-3 ${on ? 'border-primary bg-primary/5' : 'border-border'}`}>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={on} onChange={() => toggleService(s._id)} />
                        <span className="flex-1 text-sm">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-muted-foreground"> · {s.category}</span>
                        </span>
                        <span className="text-sm tabular-nums">{inr(getServiceUnitPrice(s, vehicleRef, brands[s._id]))}</span>
                      </label>
                      {on && (kind || brandOptions.length > 0) && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 pl-7">
                          {brandOptions.length > 0 && (
                            <select aria-label={`Brand for ${s.name}`} className={`${inputCls} w-44`} value={brands[s._id] || ''}
                              onChange={(e) => setBrands((b) => ({ ...b, [s._id]: e.target.value }))}>
                              <option value="">Choose brand</option>
                              {brandOptions.map((b) => <option key={b}>{b}</option>)}
                            </select>
                          )}
                          {kind === 'tyre' && (
                            <div className="inline-flex items-center gap-2" role="group" aria-label={`Quantity for ${s.name}`}>
                              <button type="button" aria-label="Decrease quantity" disabled={qty <= 1}
                                onClick={() => setQuantities((q) => ({ ...q, [s._id]: Math.max(1, qty - 1) }))}
                                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40">
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="w-6 text-center tabular-nums text-sm">{qty}</span>
                              <button type="button" aria-label="Increase quantity" disabled={qty >= 8}
                                onClick={() => setQuantities((q) => ({ ...q, [s._id]: Math.min(8, qty + 1) }))}
                                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40">
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {show('services')}
          </section>
          )}

          {step === 3 && (
          <div className="space-y-6">
            <section className="bg-card rounded-2xl border-2 border-border p-4 sm:p-6 lg:p-8 shadow-sm space-y-4" aria-labelledby="location-heading">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 id="location-heading" className="text-lg sm:text-xl font-bold flex items-center gap-2">
                  <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0" /> Customer Location
                </h2>
                {savedAddresses.length > 0 && (
                  <button type="button"
                    onClick={() => {
                      setShowCustomLocation((v) => !v);
                      setPickup({ address: '' });
                    }}
                    className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15 transition-colors">
                    {showCustomLocation ? 'Cancel Custom' : '+ Add Custom'}
                  </button>
                )}
              </div>

              {savedAddresses.length > 0 && !showCustomLocation && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-muted-foreground">Choose from saved addresses</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {savedAddresses.map((addr, i) => {
                      const blocked = !pinAllowed(addr.address);
                      const active = pickup.address === addr.address;
                      return (
                        <button key={i} type="button" disabled={blocked}
                          onClick={() => setPickup({ address: addr.address, lat: addr.lat, lng: addr.lng })}
                          className={`flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-colors ${
                            blocked ? 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
                              : active ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary/30'
                          }`}>
                          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                            <MapPin className="w-5 h-5" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block font-bold text-sm truncate">{addr.label || 'Address'}</span>
                            <span className="block text-xs text-muted-foreground line-clamp-2">{addr.address}</span>
                            {blocked && (
                              <span className="block text-xs font-semibold text-destructive mt-1">
                                {pinOf(addr.address) ? 'Service not enabled for this pincode' : 'Address must include a valid 6-digit pincode'}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(showCustomLocation || savedAddresses.length === 0) && (
                <div className="bg-muted/30 rounded-2xl border-2 border-border p-4">
                  <LocationPicker value={pickup} onChange={setPickup}
                    mapClassName="h-[300px] w-full rounded-xl mt-4 border-2 border-border" />
                </div>
              )}

              {address && (
                <div className={`flex items-start gap-3 p-4 rounded-2xl border-2 ${pinAllowed(address) ? 'bg-primary/5 border-primary/20' : 'bg-destructive/10 border-destructive/30'}`}>
                  <span className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-primary mb-1">Selected location</p>
                    <p className="text-sm font-semibold break-words">{address}</p>
                  </div>
                </div>
              )}
              {show('address')}
            </section>

            <section className="bg-card rounded-2xl border-2 border-border p-4 sm:p-6 lg:p-8 shadow-sm space-y-4" aria-labelledby="slot-heading">
              <h2 id="slot-heading" className="text-lg sm:text-xl font-bold mb-2 sm:mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0" /> Select Schedule
              </h2>
              <SlotPicker
                selectedDate={new Date(`${day}T00:00:00`)}
                selectedTime={slot || null}
                onDateChange={(d) => setDay(formatLocalYmd(d))}
                onTimeChange={setSlot}
                availableSlots={slotData.available}
                bookedSlots={slotData.booked}
                blockedSlots={slotData.blocked}
                allSlotsFromApi={slotData.all}
              />
              {show('slot')}
            </section>

          </div>
          )}

          {step === 4 && (
        <section className={sectionCls} aria-labelledby="review-heading">
          <h2 id="review-heading" className="font-semibold">Review</h2>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Customer</dt>
              <dd className="text-right">{addingCustomer ? newCustomer.name || '—' : customer?.name || '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Vehicle</dt>
              <dd className="text-right">{vehicleInfo?.make ? `${vehicleInfo.make} ${vehicleInfo.model}` : '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">When</dt>
              <dd className="text-right">{slot ? `${new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}, ${slot}` : '—'}</dd></div>
          </dl>
          <div className="border-t border-border pt-3 space-y-1 text-sm">
            {lines.length === 0 ? (
              <p className="text-muted-foreground">No services selected.</p>
            ) : (
              lines.map((l) => (
                <div key={l.service._id} className="flex justify-between gap-3">
                  <span>{l.service.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
                  <span className="tabular-nums">{inr(l.amount)}</span>
                </div>
              ))
            )}
            {pickupDrop > 0 && (
              <div className="flex justify-between"><span>Pickup & drop</span><span className="tabular-nums">{inr(pickupDrop)}</span></div>
            )}
            {gst > 0 && (
              <div className="flex justify-between"><span>GST (18%)</span><span className="tabular-nums">{inr(gst)}</span></div>
            )}
            <div className="flex justify-between font-semibold pt-2 border-t border-border">
              <span>Total</span><span className="tabular-nums text-primary">{inr(total)}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              {hasGeneral
                ? 'Estimated. The final bill is set after inspection; the customer pays after service.'
                : prepaid
                  ? 'The customer pays this in the app before the service.'
                  : ''}
            </p>
          </div>
        </section>
          )}
      </div>

      <div className="sticky bottom-0 z-20 py-3 bg-background/95 backdrop-blur-sm border-t border-border">
        <div className={`grid gap-3 ${step > 0 ? 'grid-cols-[1fr_2fr] sm:grid-cols-2' : 'grid-cols-1'}`}>
          {step > 0 && (
            <button type="button" onClick={goBack} disabled={saving}
              className="min-h-[48px] rounded-xl font-medium bg-muted hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50">
              Back
            </button>
          )}
          <button type="button" onClick={step === STEPS.length - 1 ? submit : goNext} disabled={saving}
            className="min-h-[48px] rounded-xl font-semibold text-primary-foreground bg-primary hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {step === STEPS.length - 1 ? (saving ? 'Creating…' : 'Confirm booking') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminCreateBookingPage;
