import React, { useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Zap, PenLine } from 'lucide-react';
import { vahanService, VahanVehicle } from '@/services/vehicleService';
import { buildFill, CatalogRow, VahanFill } from '@/lib/vahanMatch';
import { isValidLicensePlate } from '@/lib/formValidation';

export type VehicleEntryMode = 'auto' | 'manual' | null;

interface Props {
  plate: string;
  onPlateChange: (plate: string) => void;
  catalog: CatalogRow[];
  fuelOptions: string[];
  /** Called after a successful lookup with fields matched to the catalog (only set keys should be applied). */
  onFill: (fill: VahanFill, vehicle: VahanVehicle) => void;
  /** Parent shows the brand/model/variant/fuel fields only once a mode is chosen. */
  mode: VehicleEntryMode;
  onModeChange: (mode: VehicleEntryMode) => void;
  plateError?: React.ReactNode;
  idPrefix?: string;
}

const inputCls =
  'w-full px-4 py-3 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 uppercase disabled:opacity-60';
const modeBtn = (active: boolean) =>
  `min-h-[48px] flex-1 inline-flex items-center justify-center gap-2 px-4 rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60 ${
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted'
  }`;

/** Step 1: registration number. Step 2: Automatic (Vahan lookup) or Manual.
 *  The parent renders the detail fields once a mode is picked. */
const VahanLookup: React.FC<Props> = ({ plate, onPlateChange, catalog, fuelOptions, onFill, mode, onModeChange, plateError, idPrefix = 'vahan' }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ v: VahanVehicle; fill: VahanFill } | null>(null);

  const runLookup = async () => {
    setError('');
    setResult(null);
    if (!isValidLicensePlate(plate.trim().toUpperCase())) {
      setError('Enter a valid registration number (e.g. MH 02 AB 1234) first.');
      return;
    }
    setLoading(true);
    try {
      const v = await vahanService.byRegistration(plate);
      const fill = buildFill(v, catalog, fuelOptions);
      onFill(fill, v);
      setResult({ v, fill });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not fetch vehicle details. Please enter them manually.');
    } finally {
      setLoading(false);
    }
  };

  const chooseAuto = () => {
    onModeChange('auto');
    runLookup();
  };
  const chooseManual = () => {
    onModeChange('manual');
    setError('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!loading) runLookup();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-plate`} className="block text-sm font-medium text-foreground mb-2">
          Registration number <span className="text-destructive">*</span>
        </label>
        <input
          id={`${idPrefix}-plate`}
          value={plate}
          onChange={(e) => {
            onPlateChange(e.target.value.toUpperCase());
            setResult(null);
          }}
          onKeyDown={mode === 'auto' ? onKey : undefined}
          placeholder="e.g. MH 02 AB 1234"
          autoComplete="off"
          className={inputCls}
        />
        {plateError}
      </div>

      <div>
        <p className="text-sm font-medium text-foreground mb-2">How do you want to add vehicle details?</p>
        <div className="flex flex-col sm:flex-row gap-2" role="group" aria-label="Vehicle entry method">
          <button type="button" aria-pressed={mode === 'auto'} className={modeBtn(mode === 'auto')} onClick={chooseAuto} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Zap className="w-4 h-4" aria-hidden />}
            {loading ? 'Fetching from Vahan…' : 'Automatic (Vahan)'}
          </button>
          <button type="button" aria-pressed={mode === 'manual'} className={modeBtn(mode === 'manual')} onClick={chooseManual}>
            <PenLine className="w-4 h-4" aria-hidden />
            Manual
          </button>
        </div>
      </div>

      {mode === 'auto' && (
        <div className="space-y-3">
          <div aria-live="polite">
            {error && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                <span>
                  {error}{' '}
                  <button type="button" className="underline font-medium" onClick={() => runLookup()}>Retry</button>
                  {' · '}
                  <button type="button" className="underline font-medium" onClick={chooseManual}>Enter manually</button>
                </span>
              </p>
            )}
            {result && (
              <div className="flex items-start gap-2 text-sm rounded-xl border border-border bg-muted/40 p-3">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-green-600" aria-hidden />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">
                    Found {result.v.registrationNumber || 'vehicle'}
                    {result.v.year ? ` · ${result.v.year}` : ''}
                    {result.v.fuelType ? ` · ${result.v.fuelType}` : ''}
                  </p>
                  <p className="text-muted-foreground">
                    {result.fill.make && result.fill.model
                      ? 'Brand, model and fuel filled in. Pick the variant and check the details below.'
                      : result.fill.make
                        ? 'Brand filled in. Choose the model and variant below.'
                        : 'Some details are hidden by Vahan without owner consent. Choose brand, model and variant below.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VahanLookup;
