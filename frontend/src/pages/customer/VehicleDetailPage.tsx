import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import { bookingService, Booking } from '@/services/bookingService';
import { serviceService, Service } from '@/services/serviceService';
import { getVehicleReference } from '@/services/vehicleReferenceService';
import { AutocompleteField, FUEL_TYPE_OPTIONS, ReferenceRecord } from './AddVehiclePage';
import { isValidLicensePlate } from '@/lib/formValidation';
import { vehicleInfoRows } from '@/lib/vehicleInfo';
import { toast } from 'sonner';
import {
  Car,
  Calendar,
  FileText,
  ArrowLeft,
  Clock,
  Activity,
  Trash2,
  Pencil
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import VehicleHealthIndicators from '@/components/VehicleHealthIndicators';
import ServiceCategoryDialog from '@/components/ServiceCategoryDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const CustomerVehicleDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    licensePlate: '',
    make: '',
    model: '',
    variant: '',
    fuel: '',
    frontTyres: '',
    rearTyres: '',
  });

  // Brand → Model → Variant catalog, same source AddVehiclePage uses.
  const [catalog, setCatalog] = useState<ReferenceRecord[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);

  useEffect(() => {
    getVehicleReference()
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]))
      .finally(() => setIsLoadingCatalog(false));
  }, []);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((r) => {
      const b = (r.brand_name || '').trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort();
  }, [catalog]);

  const modelOptions = useMemo(() => {
    if (!editForm.make) return [];
    const set = new Set<string>();
    catalog.forEach((r) => {
      if ((r.brand_name || '') === editForm.make) {
        const m = (r.model || '').trim();
        if (m) set.add(m);
      }
    });
    return Array.from(set).sort();
  }, [catalog, editForm.make]);

  const variantOptions = useMemo(() => {
    if (!editForm.make || !editForm.model) return [];
    const set = new Set<string>();
    catalog.forEach((r) => {
      if ((r.brand_name || '') === editForm.make && (r.model || '') === editForm.model) {
        const v = (r.brand_model || '').trim();
        if (v) set.add(v);
      }
    });
    return Array.from(set).sort();
  }, [catalog, editForm.make, editForm.model]);

  // Fuel types actually offered for the selected brand/model(/variant) in
  // the catalog — same behavior as AddVehiclePage.
  const fuelOptions = useMemo(() => {
    if (!editForm.make || !editForm.model) return FUEL_TYPE_OPTIONS;
    const set = new Set<string>();
    catalog.forEach((r) => {
      if (
        (r.brand_name || '') === editForm.make &&
        (r.model || '') === editForm.model &&
        (!editForm.variant || (r.brand_model || '') === editForm.variant)
      ) {
        const f = (r.fuel_type || '').trim();
        if (FUEL_TYPE_OPTIONS.includes(f)) set.add(f);
      }
    });
    return set.size > 0 ? FUEL_TYPE_OPTIONS.filter((f) => set.has(f)) : FUEL_TYPE_OPTIONS;
  }, [catalog, editForm.make, editForm.model, editForm.variant]);

  // Auto-fill tyre sizes + fuel type once brand/model/variant resolve to a
  // specific catalog record — same behavior as AddVehiclePage.
  useEffect(() => {
    if (!editForm.make || !editForm.model) return;
    const match = catalog.find(
      (r) =>
        (r.brand_name || '') === editForm.make &&
        (r.model || '') === editForm.model &&
        (!editForm.variant || (r.brand_model || '') === editForm.variant)
    );
    if (!match) return;
    setEditForm((prev) => ({
      ...prev,
      frontTyres: (match.front_tyres as string) || prev.frontTyres,
      rearTyres: (match.rear_tyres as string) || prev.rearTyres,
      fuel: FUEL_TYPE_OPTIONS.includes((match.fuel_type as string) || '')
        ? (match.fuel_type as string)
        : prev.fuel,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, editForm.make, editForm.model, editForm.variant]);

  // If the vehicle selection narrows and the currently picked fuel type is
  // no longer offered for it, clear it rather than leave a stale value.
  useEffect(() => {
    if (editForm.fuel && !fuelOptions.includes(editForm.fuel)) {
      setEditForm((prev) => ({ ...prev, fuel: '' }));
    }
  }, [fuelOptions, editForm.fuel]);

  const openEditDialog = () => {
    if (!vehicle) return;
    setEditForm({
      licensePlate: vehicle.licensePlate || '',
      make: vehicle.make || '',
      model: vehicle.model || '',
      variant: vehicle.variant || '',
      fuel: vehicle.fuelType || '',
      frontTyres: vehicle.frontTyres || '',
      rearTyres: vehicle.rearTyres || '',
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    const plate = editForm.licensePlate.trim().toUpperCase();
    if (!isValidLicensePlate(plate)) {
      toast.error('Please enter a valid registration number (e.g. MH 02 AB 1234)');
      return;
    }
    if (!editForm.make.trim() || !editForm.model.trim() || !editForm.variant.trim()) {
      toast.error('Please select a brand, model and variant from the suggestions');
      return;
    }
    if (!editForm.fuel.trim()) {
      toast.error('Please select a fuel type');
      return;
    }
    setIsSavingEdit(true);
    try {
      await vehicleService.updateVehicle(id, {
        licensePlate: plate,
        make: editForm.make.trim(),
        model: editForm.model.trim(),
        variant: editForm.variant.trim(),
        fuelType: editForm.fuel.trim(),
        frontTyres: editForm.frontTyres,
        rearTyres: editForm.rearTyres,
      });
      toast.success('Vehicle updated successfully');
      queryClient.invalidateQueries({ queryKey: ['vehicle', id] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setEditDialogOpen(false);
    } catch (error) {
      console.error('Failed to update vehicle:', error);
      toast.error('Failed to update vehicle');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteVehicle = async () => {
    if (!id) return;
    setIsDeleting(true);
    try {
      await vehicleService.deleteVehicle(id);
      toast.success('Vehicle deleted successfully');
      // Drop (not just invalidate) the now-gone vehicle's own queries so
      // nothing refetches a resource that no longer exists — the vehicle
      // list itself still gets invalidated so it refreshes normally.
      queryClient.removeQueries({ queryKey: ['vehicle', id] });
      queryClient.removeQueries({ queryKey: ['vehicleBookings', id] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      navigate('/add-vehicle');
    } catch (error) {
      console.error('Failed to delete vehicle:', error);
      toast.error('Failed to delete vehicle');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const { data: vehicle, isLoading: vehicleLoading, error: vehicleError } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => id ? vehicleService.getVehicleById(id) : Promise.reject('No vehicle ID'),
    enabled: !!id,
    staleTime: 0, // Always refetch when cache invalidated
  });

  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ['vehicleBookings', id],
    queryFn: () => id ? bookingService.getVehicleBookings(id) : Promise.reject('No vehicle ID'),
    enabled: !!id,
    staleTime: 0, // Always refetch when cache invalidated
  });

  const isLoading = vehicleLoading || bookingsLoading;

  React.useEffect(() => {
    if (vehicleError) {
      console.error(vehicleError);
      toast.error('Failed to load vehicle details');
      navigate('/add-vehicle');
    }
  }, [vehicleError, navigate]);

  if (isLoading || !vehicle) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-muted-foreground animate-pulse">Loading vehicle details...</p>
      </div>
    );
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'On Route': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'In Service': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'Idle': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  return (
    <div className="space-y-6 py-4 sm:py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-muted rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex flex-wrap items-center gap-2 sm:gap-3">
            {vehicle.make} {vehicle.model}
            {vehicle.variant && (
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                {vehicle.variant}
              </span>
            )}
            <span className={`px-3 py-1 rounded-full text-[10px] sm:text-xs font-medium ${getStatusColor(vehicle.status)}`}>
              {vehicle.status || 'Idle'}
            </span>
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm font-mono uppercase tracking-wider">{vehicle.licensePlate}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={openEditDialog}
          className="flex items-center gap-2"
        >
          <Pencil className="w-4 h-4" />
          Edit
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteDialogOpen(true)}
          className="flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar - Vehicle Info */}
        <div className="space-y-6">
          {/* Main Info Card */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
             <div className="aspect-video bg-muted relative">
                {vehicle.image ? (
                  <img src={vehicle.image} alt="Vehicle" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary/30">
                    <Car className="w-16 h-16 text-muted-foreground/30" />
                  </div>
                )}
             </div>
             
             <div className="p-6 space-y-4">
                <dl className="grid grid-cols-2 gap-4">
                   {vehicleInfoRows(vehicle).map((r) => (
                     <div key={r.label} className="space-y-1 min-w-0">
                        <dt className="text-xs text-muted-foreground">{r.label}</dt>
                        <dd className={`font-semibold text-sm sm:text-base tabular-nums break-words ${r.expired ? 'text-destructive' : ''}`}>
                          {r.value || <span className="font-normal text-muted-foreground">Not available</span>}
                          {r.expired && <span className="ml-1 text-xs font-normal">(expired)</span>}
                        </dd>
                     </div>
                   ))}
                </dl>

                <div className="pt-4 border-t border-border space-y-3">
                   <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">VIN</span>
                      <span className="font-mono font-medium">{vehicle.vin || 'N/A'}</span>
                   </div>
                   <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Mileage</span>
                      <span className="font-medium">{vehicle.mileage ? `${vehicle.mileage} km` : 'N/A'}</span>
                   </div>
                </div>
             </div>
          </div>
          

        </div>

        {/* Main Content - Tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="history" className="w-full">
            <div className="overflow-x-auto scrollbar-hide mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
              <TabsList className="inline-flex w-full sm:w-auto justify-start border-b border-border bg-transparent p-0 h-auto rounded-none min-w-max">
                <TabsTrigger 
                  value="history"
                  className="px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary transition-all font-medium text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Service History
                  </div>
                </TabsTrigger>
                <TabsTrigger 
                  value="health"
                  className="px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary transition-all font-medium text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Vehicle Health
                  </div>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="health" className="mt-0 focus-visible:outline-none">
               <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-6">Health Status</h3>
                  <div className="flex justify-center py-4">
                     <VehicleHealthIndicators 
                        healthIndicators={vehicle.healthIndicators} 
                        mileage={vehicle.mileage}
                        healthPercentBaselineAt={vehicle.healthPercentBaselineAt}
                        healthPercentDisplay={vehicle.healthPercentDisplay}
                     />
                  </div>
               </div>
            </TabsContent>

            <TabsContent value="history" className="mt-0 focus-visible:outline-none space-y-4">
              {bookings.length === 0 ? (
                <div className="text-center py-16 bg-muted/20 rounded-2xl border border-dashed border-border">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <Calendar className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold">No service history</h3>
                  <p className="text-muted-foreground max-w-xs mx-auto">This vehicle hasn't been serviced with us yet. Book your first service today!</p>
                  <ServiceCategoryDialog
                    vehicleId={id}
                    trigger={
                      <button className="mt-6 px-6 py-2 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors">
                        Book Service
                      </button>
                    }
                  />
                </div>
              ) : (
                <div className="grid gap-4">
                   {bookings.map(booking => (
                      <div 
                        key={booking._id} 
                        className="bg-card p-5 rounded-2xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm hover:shadow-md hover:bg-muted/50 transition-all cursor-pointer"
                        onClick={() => navigate(`/track/${booking._id}`)}
                      >
                         <div className="space-y-2">
                            <div className="font-bold text-base sm:text-lg">
                               {Array.isArray(booking.services) 
                                ? (booking.services as Service[]).map(s => s.name).join(', ') 
                                : 'Service'}
                            </div>
                            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-y-2 gap-x-4">
                               <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-lg">
                                  <Calendar className="w-3.5 h-3.5" /> {new Date(booking.date).toLocaleDateString()}
                               </span>
                               <span className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-lg">
                                  <Clock className="w-3.5 h-3.5" /> {new Date(booking.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                               </span>
                            </div>
                         </div>
                         <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 border-t sm:border-t-0 pt-3 sm:pt-0">
                             <div className="text-lg font-black text-primary">
                               {booking.discountAmount ? (
                                 <span className="flex flex-col sm:items-end">
                                   <span className="text-muted-foreground line-through text-xs font-normal">₹{booking.billing?.total || booking.totalAmount}</span>
                                   <span>₹{booking.finalAmount}</span>
                                 </span>
                               ) : (
                                 `₹${booking.billing?.total || booking.finalAmount || booking.totalAmount}`
                               )}
                             </div>
                            <span className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase
                                  ${booking.status === 'DELIVERED' || booking.status === 'COMPLETED' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                    booking.status === 'CANCELLED' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'}`}
                                >
                                  {booking.status}
                                </span>
                         </div>
                      </div>
                   ))}
                </div>
              )}
            </TabsContent>

          </Tabs>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Delete Vehicle</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this vehicle? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteVehicle}
              disabled={isDeleting}
              className="rounded-xl min-w-[100px]"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Vehicle Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen} modal={false}>
        <DialogContent
          className="sm:max-w-lg rounded-2xl max-h-[90dvh] overflow-y-auto"
          onPointerDownOutside={(e) => {
            // The Brand/Model/Variant suggestion dropdowns portal to
            // document.body (so they aren't clipped by this dialog's own
            // overflow-y-auto) — Radix treats that as an "outside" click
            // and would otherwise close the whole dialog when picking a
            // suggestion.
            if ((e.target as HTMLElement)?.closest('[data-autocomplete-menu]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit Vehicle</DialogTitle>
            <DialogDescription>
              Update your vehicle's registration, brand, model and variant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="editLicensePlate">Registration Number</Label>
              <Input
                id="editLicensePlate"
                value={editForm.licensePlate}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, licensePlate: e.target.value.toUpperCase() }))
                }
                placeholder="e.g. MH 02 AB 1234"
                className="uppercase"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AutocompleteField
                label="Brand"
                value={editForm.make}
                options={brandOptions}
                required
                disabled={isLoadingCatalog}
                placeholder={isLoadingCatalog ? 'Loading brands...' : 'Type to search brand'}
                onSelect={(v) =>
                  setEditForm((prev) => ({ ...prev, make: v, model: '', variant: '' }))
                }
              />
              <AutocompleteField
                label="Model"
                value={editForm.model}
                options={modelOptions}
                required
                disabled={!editForm.make}
                placeholder={editForm.make ? 'Type to search model' : 'Select brand first'}
                onSelect={(v) => setEditForm((prev) => ({ ...prev, model: v, variant: '' }))}
                matchMode="contains"
              />
              <AutocompleteField
                label="Variant/Class"
                value={editForm.variant}
                options={variantOptions}
                required
                disabled={!editForm.model}
                placeholder={editForm.model ? 'Type to search variant' : 'Select model first'}
                onSelect={(v) => setEditForm((prev) => ({ ...prev, variant: v }))}
                matchMode="contains"
              />
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Fuel Type <span className="text-destructive">*</span>
                </label>
                <select
                  value={editForm.fuel}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, fuel: e.target.value }))}
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select fuel type</option>
                  {fuelOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={isSavingEdit}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={isSavingEdit}
              className="rounded-xl min-w-[100px]"
            >
              {isSavingEdit ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerVehicleDetailPage;
