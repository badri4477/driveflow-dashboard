import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import { vehicleService, Vehicle } from '../../services/vehicleService';
import { Booking, bookingService } from '../../services/bookingService';
import { calculateHealthDisplayPercent, dailyDecayPercentFromBaseline, calculateRemainingHealthPercentLegacy } from '@/lib/vehicleHealthRemaining';

interface VehicleHealthPanelProps {
  booking: Booking;
  onUpdate: () => void;
  /** When set, called after successful "Save health" instead of onUpdate (use for refetch + tab change). */
  onHealthStatsSaved?: () => void | Promise<void>;
}

const VehicleHealthPanel: React.FC<VehicleHealthPanelProps> = ({ booking, onUpdate, onHealthStatsSaved }) => {
  const vehicle = booking.vehicle as unknown as Vehicle;
  const [loading, setLoading] = useState(false);

  // Health indicators live on the vehicle. They're shown only once health was
  // saved on THIS order (booking.healthSavedAt); a new order for the same car
  // starts empty (same rule as the mobile app).
  const buildHealth = () => {
    const fromThisOrder = !!(booking as any).healthSavedAt;
    const row = (key: 'generalService' | 'brakePads' | 'tires' | 'battery' | 'wiperBlade') => {
      const ind = (vehicle?.healthIndicators as any)?.[key];
      return fromThisOrder
        ? { value: ind?.value ?? 0, fixedKm: ind?.fixedKm ?? 0, fixedDays: ind?.fixedDays ?? 0 }
        : { value: 0, fixedKm: 0, fixedDays: 0 };
    };
    return {
      generalService: row('generalService'),
      brakePads: row('brakePads'),
      tires: row('tires'),
      battery: row('battery'),
      wiperBlade: row('wiperBlade'),
    };
  };

  const [health, setHealth] = useState(buildHealth);

  useEffect(() => {
    if (vehicle?.healthIndicators) {
      setHealth(buildHealth());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle, (booking as any).healthSavedAt]);

  const displayHealth = useMemo(() => {
    const currentKm = vehicle?.mileage || 0;
    const baselineAt = vehicle?.healthPercentBaselineAt;
    const serverPct =
      vehicle?.healthPercentDisplay != null && !Number.isNaN(Number(vehicle.healthPercentDisplay))
        ? Math.max(0, Math.min(100, Math.round(Number(vehicle.healthPercentDisplay))))
        : null;
    const baselinePct =
      serverPct != null ? serverPct : baselineAt ? dailyDecayPercentFromBaseline(baselineAt) : null;

    const row = (key: keyof typeof health) => {
      const hasInterval = health[key].fixedKm > 0 || health[key].fixedDays > 0;
      if (hasInterval) {
        return calculateRemainingHealthPercentLegacy(
          {
            ...health[key],
            lastServiceDate: vehicle?.healthIndicators?.[key]?.lastServiceDate,
            lastServiceKm: vehicle?.healthIndicators?.[key]?.lastServiceKm,
          },
          currentKm
        );
      }
      return baselinePct != null
        ? baselinePct
        : calculateHealthDisplayPercent(
            {
              ...health[key],
              lastServiceDate: vehicle?.healthIndicators?.[key]?.lastServiceDate,
              lastServiceKm: vehicle?.healthIndicators?.[key]?.lastServiceKm,
            },
            currentKm,
            baselineAt
          );
    };

    return {
      generalService: row('generalService'),
      brakePads: row('brakePads'),
      tires: row('tires'),
      battery: row('battery'),
      wiperBlade: row('wiperBlade'),
    };
  }, [health, vehicle]);

  const handleSliderChange = (key: keyof typeof health, value: number[]) => {
    setHealth(prev => ({
      ...prev,
      [key]: { ...prev[key], value: value[0] }
    }));
  };

  const handleKmChange = (key: keyof typeof health, km: string) => {
    const value = parseInt(km) || 0;
    setHealth(prev => ({
        ...prev,
        [key]: { ...prev[key], fixedKm: value }
    }));
  };

  const handleDaysChange = (key: keyof typeof health, days: string) => {
    const value = parseInt(days) || 0;
    setHealth(prev => ({
        ...prev,
        [key]: { ...prev[key], fixedDays: value }
    }));
  };

  const handleResetHealth = async () => {
    if (!vehicle?._id) {
        toast.error('Vehicle ID not found');
        return;
    }

    setLoading(true);
    try {
      await vehicleService.updateVehicleHealth(vehicle._id, { resetAll: true });
      const resetHealth = {
        generalService: { value: 0, fixedKm: 0, fixedDays: 0 },
        brakePads: { value: 0, fixedKm: 0, fixedDays: 0 },
        tires: { value: 0, fixedKm: 0, fixedDays: 0 },
        battery: { value: 0, fixedKm: 0, fixedDays: 0 },
        wiperBlade: { value: 0, fixedKm: 0, fixedDays: 0 },
      };
      setHealth(resetHealth);
      toast.success('All vehicle health indicators reset successfully');
      onUpdate();
    } catch (error) {
      toast.error('Failed to reset vehicle health');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveHealth = async () => {
    if (!vehicle?._id) {
        toast.error('Vehicle ID not found');
        return;
    }

    setLoading(true);
    try {
      await vehicleService.updateVehicleHealth(vehicle._id, health);
      // Mark health as saved on this order (keeps fields filled for it).
      await bookingService.updateBookingDetails(booking._id, { healthSaved: true } as any);
      toast.success('Vehicle health indicators updated successfully');
      if (onHealthStatsSaved) {
        await onHealthStatsSaved();
      } else {
        onUpdate();
      }
    } catch (error) {
      toast.error('Failed to update vehicle health');
    } finally {
      setLoading(false);
    }
  };

  const indicators = [
    { key: 'generalService', label: 'General Service (Oil & Filter)', icon: '🛢️' },
    { key: 'brakePads', label: 'Brake Pads', icon: '🛑' },
    { key: 'tires', label: 'Tire Condition', icon: '🛞' },
    { key: 'battery', label: 'Battery Health', icon: '🔋' },
    { key: 'wiperBlade', label: 'Wiper Blade', icon: '🧹' },
  ] as const;

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-6 shadow-sm space-y-6 min-w-0 max-w-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 min-w-0">
        <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
            <span className="break-words">Vehicle Health Indicators</span>
        </h3>
        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-blue-50 px-2 py-1 rounded-full shrink-0 self-start sm:self-auto">
            <Info className="w-3 h-3 shrink-0" />
            Merchant Update Only
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 py-2 min-w-0">
        {indicators.map((indicator) => {
            const row = health[indicator.key];
            const baselineAt = vehicle?.healthPercentBaselineAt;
            const hasInterval = row.fixedKm > 0 || row.fixedDays > 0;
            const useAutoPercent = !!baselineAt || hasInterval;
            const remaining = displayHealth[indicator.key];
            const pctClass = useAutoPercent
              ? remaining <= 20
                ? 'text-red-500'
                : remaining <= 50
                  ? 'text-orange-500'
                  : 'text-green-600'
              : remaining > 80
                ? 'text-red-500'
                : remaining > 50
                  ? 'text-orange-500'
                  : 'text-green-600';

            return (
            <div key={indicator.key} className="space-y-4 min-w-0">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 min-w-0">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className="text-xl shrink-0">{indicator.icon}</span>
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-medium text-sm break-words">{indicator.label}</span>
                            <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
                                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                                    Fixed KM
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={health[indicator.key].fixedKm || ''}
                                        onChange={(e) => handleKmChange(indicator.key, e.target.value.replace(/\D/g, ''))}
                                        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        placeholder="e.g. 10000"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                                    Fixed Days
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={health[indicator.key].fixedDays || ''}
                                        onChange={(e) => handleDaysChange(indicator.key, e.target.value.replace(/\D/g, ''))}
                                        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        placeholder="e.g. 180"
                                    />
                                </label>
                            </div>
                        </div>
                    </div>
                    <span className={`text-sm font-bold shrink-0 self-start ${pctClass}`}>
                        {remaining}%
                    </span>
                </div>
                <Slider
                    value={[useAutoPercent ? remaining : health[indicator.key].value]}
                    onValueChange={(val) => {
                      if (!useAutoPercent) handleSliderChange(indicator.key, val);
                    }}
                    max={100}
                    step={1}
                    disabled={useAutoPercent}
                    title={
                      baselineAt
                        ? 'All indicators: 100% on last health save, then −1% per calendar day'
                        : hasInterval
                          ? 'Remaining life from Fixed KM / Fixed Days vs last service date and mileage'
                          : 'Manual wear % (set Fixed KM or Fixed Days for automatic remaining life)'
                    }
                    className={useAutoPercent ? 'cursor-default opacity-95' : 'cursor-pointer'}
                />
                <p className="text-[10px] text-muted-foreground italic flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                    <span className="break-words">
                      Last updated: {vehicle?.healthIndicators?.[indicator.key as keyof typeof vehicle.healthIndicators]?.lastServiceDate ? new Date(vehicle.healthIndicators[indicator.key as keyof typeof vehicle.healthIndicators]!.lastServiceDate).toLocaleDateString() : 'Never'}
                    </span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Fixed KM: {health[indicator.key].fixedKm}</span>
                      <span>Fixed Days: {health[indicator.key].fixedDays}</span>
                    </div>
                </p>
            </div>
            );
        })}
      </div>

      <div className="pt-4 border-t flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-stretch">
        <button
            onClick={handleResetHealth}
            disabled={loading}
            className="w-full sm:flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
        >
            Reset All
        </button>
        <button
            onClick={handleSaveHealth}
            disabled={loading}
            className="w-full sm:flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
        >
            {loading ? 'Updating...' : 'Save Health Stats'}
        </button>
      </div>
    </div>
  );
};

export default VehicleHealthPanel;
