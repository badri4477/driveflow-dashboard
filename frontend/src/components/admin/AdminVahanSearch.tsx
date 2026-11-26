import React, { useState } from 'react';
import { Loader2, Search, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { vahanService, VahanVehicle } from '@/services/vehicleService';
import { isValidLicensePlate } from '@/lib/formValidation';
import { useAuthStore } from '@/store/authStore';
import VahanDetailsPanel from '@/components/vehicle/VahanDetailsPanel';

/**
 * Admin-only quick Vahan lookup: registration number → pop-up with the 19
 * Annexure-I fields (and PDF download). Uses the same backend lookup as Add
 * Vehicle, so only the whitelisted server can reach Vahan.
 */
const AdminVahanSearch: React.FC = () => {
  const role = useAuthStore((s) => s.user?.role);
  const [plate, setPlate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VahanVehicle | null>(null);

  if (String(role || '').toLowerCase() !== 'admin') return null;

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const p = plate.replace(/[\s-]/g, '').toUpperCase();
    setError('');
    if (!isValidLicensePlate(p)) {
      setError('Enter a valid registration number (e.g. MH02AB1234).');
      return;
    }
    setLoading(true);
    try {
      setResult(await vahanService.byRegistration(p));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError((msg || 'Could not fetch details from Vahan.').replace(/\s*Please enter (them|details) manually\.?$/i, ''));
    } finally {
      setLoading(false);
    }
  };

  const v = result;
  const title = v ? [v.makerMasked ? '' : v.maker, v.modelMasked ? '' : v.model].filter(Boolean).join(' ') : '';

  return (
    <>
      <form onSubmit={search} className="w-full md:w-[22rem]" role="search" aria-label="Vahan vehicle lookup">
        <label htmlFor="admin-vahan-plate" className="sr-only">Vehicle registration number</label>
        <div className="flex gap-2">
          <input
            id="admin-vahan-plate"
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="Registration no. e.g. TS08EN4488"
            autoComplete="off"
            maxLength={15}
            className="min-w-0 flex-1 h-11 px-4 bg-card border border-border rounded-xl text-sm uppercase placeholder:normal-case text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-11 inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Search className="w-4 h-4" aria-hidden />}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div aria-live="polite">
          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}
        </div>
      </form>

      <Dialog open={!!v} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          {v && (
            <>
              <DialogHeader>
                <DialogTitle className="tabular-nums">{v.registrationNumber || plate}</DialogTitle>
                <DialogDescription>
                  {[title || 'Vehicle details hidden by Vahan', v.year, v.fuelType].filter(Boolean).join(' · ')}
                </DialogDescription>
              </DialogHeader>
              <VahanDetailsPanel vehicle={v} defaultOpen />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminVahanSearch;
