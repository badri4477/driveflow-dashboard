import React, { useState } from 'react';
import { Loader2, Search, AlertCircle } from 'lucide-react';
import { vahanService, VahanVehicle } from '@/services/vehicleService';
import { buildFill, CatalogRow, VahanFill } from '@/lib/vahanMatch';
import { isValidLicensePlate } from '@/lib/formValidation';
import VahanDetailsPanel from './VahanDetailsPanel';

/** 'auto' = details came from Vahan, 'manual' = lookup failed so the user fills them in. */
export type VehicleEntryMode = 'auto' | 'manual' | null;

interface Props {
  plate: string;
  onPlateChange: (plate: string) => void;
  catalog: CatalogRow[];
  fuelOptions: string[];
  /** Called after a successful lookup with fields matched to the catalog (only set keys should be applied). */
  onFill: (fill: VahanFill, vehicle: VahanVehicle) => void;
  /** Parent shows the brand/model/variant/fuel fields once mode is set. */
  mode: VehicleEntryMode;
  onModeChange: (mode: VehicleEntryMode) => void;
  plateError?: React.ReactNode;
  idPrefix?: string;
  /** Show the full 19-field Vahan panel + PDF (admin). Customers see only the form fields. */
  showDetails?: boolean;
}

const inputCls =
  'w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 uppercase disabled:opacity-60';

/** Registration number + Search (Vahan). Success fills the details; failure opens the manual fields. */
const VahanLookup: React.FC<Props> = ({ plate, onPlateChange, catalog, fuelOptions, onFill, mode, onModeChange, plateError, idPrefix = 'vahan', showDetails = true }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ v: VahanVehicle; fill: VahanFill } | null>(null);

  const search = async () => {
    setError('');
    setResult(null);
    if (!isValidLicensePlate(plate.trim().toUpperCase())) {
      setError('Enter a valid registration number (e.g. MH 02 AB 1234).');
      return;
    }
    setLoading(true);
    try {
      const v = await vahanService.byRegistration(plate);
      const fill = buildFill(v, catalog, fuelOptions);
      onFill(fill, v);
      setResult({ v, fill });
      onModeChange('auto');
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Could not fetch vehicle details.';
      setError(`${msg.replace(/\s*Please enter (them|details) manually\.?$/i, '')} Please fill in the details below.`.trim());
      onModeChange('manual');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-plate`} className="block text-sm font-medium text-foreground mb-2">
          Registration number <span className="text-destructive">*</span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id={`${idPrefix}-plate`}
            value={plate}
            onChange={(e) => {
              onPlateChange(e.target.value.toUpperCase());
              setResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!loading) search();
              }
            }}
            placeholder="e.g. MH 02 AB 1234"
            autoComplete="off"
            className={inputCls}
          />
          <button
            type="button"
            onClick={search}
            disabled={loading}
            className="min-h-[48px] inline-flex items-center justify-center gap-2 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 whitespace-nowrap"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Search className="w-4 h-4" aria-hidden />}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {plateError}
      </div>

      <div aria-live="polite">
        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}
        {showDetails && result && mode === 'auto' && <VahanDetailsPanel vehicle={result.v} />}
      </div>
    </div>
  );
};

export default VahanLookup;
