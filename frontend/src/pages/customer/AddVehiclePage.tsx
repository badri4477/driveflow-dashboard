import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronDown } from 'lucide-react';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import VehicleCard from '@/components/VehicleCard';
import VehicleDetailModal from '@/components/VehicleDetailModal';
import { staggerContainer, staggerItem } from '@/animations/variants';
import { toast } from 'sonner';
import { getVehicleReference } from '@/services/vehicleReferenceService';
import { isValidLicensePlate } from '@/lib/formValidation';
import VahanLookup, { VehicleEntryMode } from '@/components/vehicle/VahanLookup';

export interface ReferenceRecord {
  brand_name?: string;
  model?: string;
  brand_model?: string;
  fuel_type?: string;
  front_tyres?: string;
  rear_tyres?: string;
  [key: string]: unknown;
}

/** Type-to-search field: shows the full `options` list on focus, then
 * narrows it as the user types, instead of requiring an open-then-scroll
 * <select>. Only a value from `options` (or empty) is treated as "selected"
 * — typed text that doesn't match anything just doesn't fire onSelect until
 * the user picks a suggestion. */
export const AutocompleteField: React.FC<{
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** 'startsWith' (default, e.g. Brand) or 'contains' (e.g. Model/Variant —
   * lets "i20" match "Elite i20" or "asta" match any variant with "Asta"
   * anywhere in it). */
  matchMode?: 'startsWith' | 'contains';
}> = ({ label, value, options, onSelect, placeholder, required, disabled, matchMode = 'startsWith' }) => {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    // The suggestion menu is portaled to document.body (see below), so a
    // click inside it isn't inside containerRef's DOM subtree — check
    // menuRef too, or a menu-item click would look like an "outside" click
    // and close the menu before its own onClick fires.
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !(menuRef.current && menuRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Suggestions render via a portal to document.body (position: fixed),
  // rather than as a normal absolutely-positioned child — otherwise a
  // scrollable ancestor (e.g. a Dialog's overflow-y-auto content) clips
  // the dropdown instead of letting it float above everything.
  useEffect(() => {
    if (!isOpen) return;
    const updateRect = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [isOpen]);

  // Empty query shows the full list (e.g. right after focusing); once the
  // user types, narrow it down to matching options.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      matchMode === 'contains' ? o.toLowerCase().includes(q) : o.toLowerCase().startsWith(q)
    );
  }, [query, options, matchMode]);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-foreground mb-2">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            // Auto-accept an exact (case-insensitive) match without forcing
            // the user to click the suggestion.
            const exact = options.find((o) => o.toLowerCase() === e.target.value.trim().toLowerCase());
            onSelect(exact ?? '');
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={disabled ? placeholder : placeholder || 'Type to search'}
          className="w-full px-4 py-3 pr-10 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        <ChevronDown
          className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
            disabled ? 'text-muted-foreground/40' : 'text-muted-foreground'
          }`}
        />
      </div>
      {isOpen && !disabled && filtered.length > 0 && menuRect &&
        createPortal(
          <div
            ref={menuRef}
            data-autocomplete-menu
            style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: menuRect.width }}
            className="z-[100] max-h-56 overflow-y-auto bg-popover border border-border rounded-xl shadow-lg"
          >
            {filtered.map((option) => (
              <button
                type="button"
                key={option}
                onClick={() => {
                  setQuery(option);
                  onSelect(option);
                  setIsOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                {option}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

export const FUEL_TYPE_OPTIONS = ['Petrol', 'Diesel', 'EV'];

const AddVehiclePage: React.FC = () => {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleForDetail, setSelectedVehicleForDetail] = useState<Vehicle | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Brand → Model → Variant are catalog-driven (Vehicle Reference Data),
  // same source the admin manages tyre/battery pricing from.
  const [catalog, setCatalog] = useState<ReferenceRecord[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [entryMode, setEntryMode] = useState<VehicleEntryMode>(null);

  const [formData, setFormData] = useState({
    licensePlate: '',
    make: '',
    model: '',
    variant: '',
    fuel: '',
    frontTyres: '',
    rearTyres: '',
  });

  useEffect(() => {
    fetchVehicles();
    getVehicleReference()
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]))
      .finally(() => setIsLoadingCatalog(false));
  }, []);

  useEffect(() => {
    if (!isLoadingVehicles && vehicles.length === 0) {
      setShowForm(true);
    }
  }, [isLoadingVehicles, vehicles]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((r) => {
      const b = (r.brand_name || '').trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort();
  }, [catalog]);

  const modelOptions = useMemo(() => {
    if (!formData.make) return [];
    const set = new Set<string>();
    catalog.forEach((r) => {
      if ((r.brand_name || '') === formData.make) {
        const m = (r.model || '').trim();
        if (m) set.add(m);
      }
    });
    return Array.from(set).sort();
  }, [catalog, formData.make]);

  const variantOptions = useMemo(() => {
    if (!formData.make || !formData.model) return [];
    const set = new Set<string>();
    catalog.forEach((r) => {
      if ((r.brand_name || '') === formData.make && (r.model || '') === formData.model) {
        const v = (r.brand_model || '').trim();
        if (v) set.add(v);
      }
    });
    return Array.from(set).sort();
  }, [catalog, formData.make, formData.model]);

  // Fuel types actually offered for the selected brand/model(/variant) in
  // the catalog — e.g. an Elite i20 2018 Asta(O) only has Petrol/Diesel
  // rows, so EV shouldn't be selectable for it.
  const fuelOptions = useMemo(() => {
    if (!formData.make || !formData.model) return FUEL_TYPE_OPTIONS;
    const set = new Set<string>();
    catalog.forEach((r) => {
      if (
        (r.brand_name || '') === formData.make &&
        (r.model || '') === formData.model &&
        (!formData.variant || (r.brand_model || '') === formData.variant)
      ) {
        const f = (r.fuel_type || '').trim();
        if (FUEL_TYPE_OPTIONS.includes(f)) set.add(f);
      }
    });
    return set.size > 0 ? FUEL_TYPE_OPTIONS.filter((f) => set.has(f)) : FUEL_TYPE_OPTIONS;
  }, [catalog, formData.make, formData.model, formData.variant]);

  // Auto-fill tyre sizes + fuel type once brand/model (and variant, if
  // picked) resolve to a specific catalog record.
  useEffect(() => {
    if (!formData.make || !formData.model) return;
    const rows = catalog.filter(
      (r) =>
        (r.brand_name || '') === formData.make &&
        (r.model || '') === formData.model &&
        (!formData.variant || (r.brand_model || '') === formData.variant)
    );
    // Prefer the row with the fuel already chosen (e.g. Diesel from Vahan) over the first row.
    const match = rows.find((r) => formData.fuel && r.fuel_type === formData.fuel) || rows[0];
    if (!match) return;
    setFormData((prev) => ({
      ...prev,
      frontTyres: (match.front_tyres as string) || prev.frontTyres,
      rearTyres: (match.rear_tyres as string) || prev.rearTyres,
      fuel: FUEL_TYPE_OPTIONS.includes((match.fuel_type as string) || '')
        ? (match.fuel_type as string)
        : prev.fuel,
    }));
  }, [catalog, formData.make, formData.model, formData.variant]);

  // If the vehicle selection narrows and the currently picked fuel type is
  // no longer one of the options offered for it, clear it rather than
  // leave a now-invalid selection in place.
  useEffect(() => {
    if (formData.fuel && !fuelOptions.includes(formData.fuel)) {
      setFormData((prev) => ({ ...prev, fuel: '' }));
    }
  }, [fuelOptions, formData.fuel]);

  const fetchVehicles = async () => {
    try {
      setIsLoadingVehicles(true);
      const data = await vehicleService.getVehicles();
      setVehicles(data);
    } catch (error) {
      console.error('Failed to fetch vehicles:', error);
      toast.error('Failed to load your vehicles');
    } finally {
      setIsLoadingVehicles(false);
    }
  };

  const resetForm = () => {
    setFormData({ licensePlate: '', make: '', model: '', variant: '', fuel: '', frontTyres: '', rearTyres: '' });
    setEntryMode(null);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const plate = formData.licensePlate.trim().toUpperCase();
    if (!isValidLicensePlate(plate)) {
      toast.error('Please enter a valid registration number (e.g. MH 02 AB 1234)');
      return;
    }
    if (!formData.make.trim() || !formData.model.trim() || !formData.variant.trim()) {
      toast.error('Please select a brand, model and variant from the suggestions');
      return;
    }
    if (!formData.fuel.trim()) {
      toast.error('Please select a fuel type');
      return;
    }
    setIsLoading(true);

    try {
      await vehicleService.addVehicle({
        licensePlate: plate,
        make: formData.make.trim(),
        model: formData.model.trim(),
        variant: formData.variant.trim(),
        fuelType: formData.fuel.trim() || undefined,
        frontTyres: formData.frontTyres,
        rearTyres: formData.rearTyres,
      });

      toast.success('Vehicle added successfully!');
      setShowForm(false);
      resetForm();
      fetchVehicles(); // Refresh list
    } catch (error: unknown) {
      console.error('Failed to add vehicle:', error);
      const err = error as { response?: { data?: { message?: string } }; message?: string; code?: string };
      const message =
        err.response?.data?.message ||
        (err.code === 'NO_TOKEN' ? 'Please log in again to add a vehicle.' : undefined) ||
        err.message ||
        'Failed to add vehicle. Please try again.';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full h-full py-4 lg:py-6 space-y-4 sm:space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">My Vehicles</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Manage your registered vehicles</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          Add Vehicle
        </button>
      </div>

      {/* Add Vehicle Form — goes straight to manual entry, no registration lookup step */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-card rounded-2xl border border-border p-4 sm:p-6"
        >
          <h2 className="text-base sm:text-lg font-semibold mb-4 sm:mb-6">Add New Vehicle</h2>

          <form onSubmit={handleFinalSubmit} className="space-y-4">
            <VahanLookup
              mode={entryMode}
              onModeChange={setEntryMode}
              idPrefix="av"
              plate={formData.licensePlate}
              onPlateChange={(p) => setFormData((prev) => ({ ...prev, licensePlate: p }))}
              catalog={catalog}
              fuelOptions={FUEL_TYPE_OPTIONS}
              onFill={(fill) =>
                setFormData((prev) => ({
                  ...prev,
                  licensePlate: fill.licensePlate || prev.licensePlate,
                  make: fill.make || prev.make,
                  model: fill.make ? fill.model || '' : prev.model,
                  variant: fill.make ? fill.variant || '' : prev.variant,
                  fuel: fill.fuelType || prev.fuel,
                }))
              }
            />
            {entryMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AutocompleteField
                label="Brand"
                value={formData.make}
                options={brandOptions}
                required
                disabled={isLoadingCatalog}
                placeholder={isLoadingCatalog ? 'Loading brands...' : 'Type to search brand'}
                onSelect={(v) =>
                  setFormData((prev) => ({ ...prev, make: v, model: '', variant: '' }))
                }
              />
              <AutocompleteField
                label="Model"
                value={formData.model}
                options={modelOptions}
                required
                disabled={!formData.make}
                placeholder={formData.make ? 'Type to search model' : 'Select brand first'}
                onSelect={(v) => setFormData((prev) => ({ ...prev, model: v, variant: '' }))}
                matchMode="contains"
              />
              <AutocompleteField
                label="Variant/Class"
                value={formData.variant}
                options={variantOptions}
                required
                disabled={!formData.model}
                placeholder={formData.model ? 'Type to search variant' : 'Select model first'}
                onSelect={(v) => setFormData((prev) => ({ ...prev, variant: v }))}
                matchMode="contains"
              />
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Fuel Type <span className="text-destructive">*</span>
                </label>
                <select
                  name="fuel"
                  value={formData.fuel}
                  onChange={(e) => setFormData({ ...formData, fuel: e.target.value })}
                  required
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select fuel type</option>
                  {fuelOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="w-full sm:flex-1 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full sm:flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Adding...' : 'Confirm Vehicle'}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Vehicle List */}
      {isLoadingVehicles ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-[200px] bg-muted/20 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-4"
        >
          {vehicles.map((vehicle) => (
            <motion.div key={vehicle._id} variants={staggerItem} className="w-full">
              <VehicleCard
                id={vehicle._id}
                make={vehicle.make}
                model={vehicle.model}
                licensePlate={vehicle.licensePlate}
                variant={vehicle.variant}
                fuelType={vehicle.fuelType}
                image={vehicle.image}
                nextService={vehicle.nextService}
                status={vehicle.status}
                onClick={() => navigate(`/vehicles/${vehicle._id}`)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Vehicle Detail Modal */}
      <VehicleDetailModal
        vehicle={selectedVehicleForDetail}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedVehicleForDetail(null);
        }}
      />
    </div>
  );
};

export default AddVehiclePage;
