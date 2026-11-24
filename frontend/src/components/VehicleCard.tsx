import React from 'react';
import { motion } from 'framer-motion';
import { Car, MoreVertical, ChevronRight, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cardHover } from '@/animations/variants';
import type { VehicleInfoRow } from '@/lib/vehicleInfo';

interface VehicleCardProps {
  id: string;
  make: string;
  model: string;
  licensePlate: string;
  variant?: string;
  fuelType?: string;
  image?: string;
  nextService?: string;
  status?: string;
  onClick?: () => void;
  onDelete?: () => void;
  className?: string;
  compact?: boolean;
  /** Extra facts (e.g. from Vahan) listed under the plate; empty values are skipped. */
  info?: VehicleInfoRow[];
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  make,
  model,
  licensePlate,
  variant,
  fuelType,
  image,
  nextService,
  status = 'Idle',
  onClick,
  onDelete,
  className,
  compact = false,
  info,
}) => {
  const infoRows = (info || []).filter((r) => r.value);
  if (compact) {
    return (
      <motion.div
        variants={cardHover}
        initial="rest"
        whileHover="hover"
        whileTap="tap"
        onClick={onClick}
        className={cn(
          'flex items-center gap-4 p-4 bg-card rounded-2xl border border-border cursor-pointer',
          'shadow-card',
          className
        )}
      >
        <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center overflow-hidden">
          {image ? (
            <img src={image} alt={`${make} ${model}`} className="w-full h-full object-cover" />
          ) : (
            <Car className="w-8 h-8 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground truncate">
            {make} {model} {variant && <span className="text-muted-foreground font-normal">• {variant}</span>}
          </h4>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            {licensePlate}
            {fuelType && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                {fuelType}
              </span>
            )}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={cardHover}
      initial="rest"
      whileHover="hover"
      whileTap="tap"
      onClick={onClick}
      className={cn(
        'relative p-4 bg-card rounded-2xl border border-border cursor-pointer w-full min-w-0 max-w-full flex gap-4',
        'shadow-card',
        className
      )}
    >
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-3 right-3 p-2 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}

      <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl bg-muted flex-shrink-0 flex items-center justify-center overflow-hidden relative">
        {status && (
            <div className={`absolute top-2 left-2 px-2 py-1 rounded-full text-[10px] font-bold z-10 ${
                status === 'Idle' ? 'bg-background/80 text-muted-foreground backdrop-blur-sm' : 'bg-primary text-primary-foreground'
            }`}>
                {status}
            </div>
        )}
        {image ? (
          <img src={image} alt={`${make} ${model}`} className="w-full h-full object-cover" />
        ) : (
          <Car className="w-10 h-10 sm:w-16 sm:h-16 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-foreground leading-tight tracking-tight">
            {make}
          </h3>
          <p className="text-base font-medium text-foreground/80 leading-tight">
            {model}
          </p>
          {variant && (
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400 leading-tight">
              {variant}
            </p>
          )}
        </div>
        
        <div className="mt-2.5 flex items-center gap-2">
          <span className="text-[11px] font-mono text-muted-foreground/60 uppercase tracking-wider">{licensePlate}</span>
          {fuelType && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30">
              {fuelType}
            </span>
          )}
        </div>

        {infoRows.length > 0 && (
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {infoRows.map((r) => (
              <div key={r.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className={cn('font-medium tabular-nums break-words', r.expired ? 'text-destructive' : 'text-foreground')}>
                  {r.value}
                  {r.expired && <span className="ml-1 text-xs font-normal">(expired)</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {nextService && (
          <div className="mt-3 flex items-center gap-1.5 p-1.5 bg-accent/5 rounded-lg w-fit">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-[10px] text-accent font-medium">
              Next Service: {nextService}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default VehicleCard;
