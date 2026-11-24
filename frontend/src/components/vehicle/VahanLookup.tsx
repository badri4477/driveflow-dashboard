import React, { useState } from 'react';
import { Loader2, Search, CheckCircle2, AlertCircle } from 'lucide-react';
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
}

const inputCls =
  'w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 uppercase disabled:opacity-60';

/** Registration number + Search (Vahan). Success fills the details; failure opens the manual fields. */
const VahanLookup: React.FC<Props> = ({ plate, onPlateChange, catalog, fuelOptions, onFill, mode, onModeChange, plateError, idPrefix = 'vahan' }) => {
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
        {result && mode === 'auto' && (
          <div className="flex items-start gap-2 text-sm rounded-xl border border-border bg-muted/40 p-3">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-600" aria-hidden />
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                Found {result.v.registrationNumber || 'vehicle'}
                {result.v.year ? ` · ${result.v.year}` : ''}
                {result.v.fuelType ? ` · ${result.v.fuelType}` : ''}
              </p>
              <p className="text-muted-foreground">
                {result.fill.make && result.fill.model && result.fill.variant
                  ? 'Details filled in. Please check them below.'
                  : result.fill.make && result.fill.model
                    ? 'Brand, model and fuel filled in. Pick the variant below.'
                    : result.fill.make
                      ? 'Brand filled in. Choose the model and variant below.'
                      : 'Some details are hidden by Vahan. Choose brand, model and variant below.'}
              </p>
            </div>
          </div>
        )}
        {result && mode === 'auto' && <VahanDetailsPanel vehicle={result.v} />}
      </div>
    </div>
  );
};

export default VahanLookup;
