import React, { useState } from 'react';
import { redirectAfterCountdown } from '@/lib/countdownRedirect';
import { useNavigate } from 'react-router-dom';
import { isValidDate } from '@/lib/formValidation';
import { toast } from 'sonner';
import { Upload, X, FileText, Camera } from 'lucide-react';
import { motion } from 'framer-motion';
import { bookingService, Booking } from '../../services/bookingService';
import { uploadService } from '../../services/uploadService';
import { searchVehicleReference } from '../../services/vehicleReferenceService';
import { Vehicle } from '../../services/vehicleService';
import { PICKUP_FLOW_ORDER, NO_PICKUP_FLOW_ORDER, getFlowForService } from '@/lib/statusFlow';
import { sumBookingServicesSubtotal, getBaseServiceOverride } from '@/lib/vehicleServicePricing';

interface BillUploadPanelProps {
  booking: Booking;
  onUploadComplete: () => void;
}

/** Parts line already reflected on `booking.totalAmount` after inspection/parts save — do not add again as "base". */
const getRecordedPartsTotal = (b: Booking): number => {
  const fromBilling = b.billing?.partsTotal;
  if (fromBilling != null) {
    const n = Number(fromBilling);
    if (!Number.isNaN(n)) return n;
  }
  if (Array.isArray(b.parts) && b.parts.length > 0) {
    return b.parts.reduce((acc, p) => acc + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
  }
  return 0;
};

const getBaseServiceAmount = (b: Booking, vehicleRef: any = null) => {
  const override = getBaseServiceOverride(b);
  if (override !== null) return override;

  // Prefer calculating from services array for accuracy
  if (Array.isArray(b.services) && b.services.length > 0) {
    const serviceList = b.services.filter((s): s is any => typeof s === 'object' && s !== null);
    if (serviceList.length > 0) {
      return sumBookingServicesSubtotal(serviceList, vehicleRef, b.selectedBrands, b.serviceQuantities);
    }
  }

  const total = b.totalAmount || 0;
  const parts = getRecordedPartsTotal(b);
  const pickup = Number(b.pickupDropPrice) || 0;
  const labour = Number(b.billing?.labourCost) || 0;
  const gst = Number(b.billing?.gst) || 0;
  
  if (total >= (parts + pickup + labour + gst)) {
    return Math.max(0, total - parts - pickup - labour - gst);
  }
  return Math.max(0, total - parts - labour - gst);
};

const BillUploadPanel: React.FC<BillUploadPanelProps> = ({ booking, onUploadComplete }) => {
  const navigate = useNavigate();
  const [vehicleRef, setVehicleRef] = useState<Record<string, any> | null>(null);
  const recordedParts = getRecordedPartsTotal(booking);
  const baseAtInit = getBaseServiceAmount(booking);
  const partsAtInit =
    booking.billing?.partsTotal != null
      ? Number(booking.billing.partsTotal)
      : recordedParts;
  const labourAtInit = Number(booking.billing?.labourCost) || 0;
  const gstAtInit = Number(booking.billing?.gst) || 0;
  const pickupDropAtInit = Number(booking.billing?.pickupDropPrice) || Number(booking.pickupDropPrice) || 0;
  const initialTotal =
    booking.billing?.total != null
      ? Number(booking.billing.total)
      : baseAtInit + partsAtInit + labourAtInit + gstAtInit + pickupDropAtInit;

  const [formData, setFormData] = useState({
    invoiceNumber: booking.billing?.invoiceNumber || '',
    invoiceDate: booking.billing?.invoiceDate ? new Date(booking.billing.invoiceDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    partsCost: partsAtInit > 0 ? String(partsAtInit) : '',
    labourCost: booking.billing?.labourCost != null ? String(booking.billing.labourCost) : '',
    gst: booking.billing?.gst != null ? String(booking.billing.gst) : '',
    pickupDropPrice: pickupDropAtInit > 0 ? String(pickupDropAtInit) : '',
    totalAmount: String(Number.isFinite(initialTotal) ? initialTotal : baseAtInit + partsAtInit + labourAtInit + gstAtInit + pickupDropAtInit),
  });
  const [file, setFile] = useState<File | null>(null);
  const [isUploaded, setIsUploaded] = useState(!!booking.billing?.fileUrl);
  const [loading, setLoading] = useState(false);
  const [pickupDropLoading, setPickupDropLoading] = useState(false);

  const recalcTotal = (
    partsCost: string,
    labourCost: string,
    gst: string,
    pickupDrop: number,
    ref = vehicleRef
  ) => {
    const parts = parseFloat(partsCost) || 0;
    const labour = parseFloat(labourCost) || 0;
    const gstNum = parseFloat(gst) || 0;
    const baseAmount = getBaseServiceAmount(booking, ref);
    return (baseAmount + parts + labour + gstNum + pickupDrop).toString();
  };

  // Fetch pickup/drop price from vehicle reference (brand + model + variant)
  React.useEffect(() => {
    let cancelled = false;

    const loadPickupDropPrice = async () => {
      const fallback =
        Number(booking.billing?.pickupDropPrice) ||
        Number(booking.pickupDropPrice) ||
        0;

      const vehicle =
        typeof booking.vehicle === 'object' ? (booking.vehicle as Vehicle) : null;

      if (!vehicle?.make?.trim() || !vehicle?.model?.trim()) {
        if (!cancelled) {
          setFormData((prev) => ({
            ...prev,
            pickupDropPrice: fallback > 0 ? String(fallback) : '',
            totalAmount: recalcTotal(prev.partsCost, prev.labourCost, prev.gst, fallback, null),
          }));
        }
        return;
      }

      setPickupDropLoading(true);
      try {
        const details = await searchVehicleReference(
          vehicle.make,
          vehicle.model,
          vehicle.variant,
          vehicle.fuelType
        );
        const fromReference = details?.pickup_drop_price != null
          ? Number(details.pickup_drop_price)
          : NaN;
        const price = !Number.isNaN(fromReference) && fromReference >= 0
          ? fromReference
          : fallback;

        if (!cancelled) {
          setVehicleRef(details ?? null);
          setFormData((prev) => {
            const baseAmount = getBaseServiceAmount(booking, details);
            const parts = parseFloat(prev.partsCost) || 0;
            const labour = parseFloat(prev.labourCost) || 0;
            const gstNum = parseFloat(prev.gst) || 0;
            return {
              ...prev,
              pickupDropPrice: price > 0 ? String(price) : '0',
              totalAmount: (baseAmount + parts + labour + gstNum + price).toString(),
            };
          });
        }
      } catch {
        if (!cancelled) {
          setFormData((prev) => ({
            ...prev,
            pickupDropPrice: fallback > 0 ? String(fallback) : '',
            totalAmount: recalcTotal(prev.partsCost, prev.labourCost, prev.gst, fallback, null),
          }));
        }
      } finally {
        if (!cancelled) setPickupDropLoading(false);
      }
    };

    loadPickupDropPrice();
    return () => {
      cancelled = true;
    };
  }, [
    booking._id,
    booking.pickupDropPrice,
    booking.billing?.pickupDropPrice,
    typeof booking.vehicle === 'object'
      ? `${(booking.vehicle as Vehicle).make}|${(booking.vehicle as Vehicle).model}|${(booking.vehicle as Vehicle).variant ?? ''}`
      : booking.vehicle,
  ]);

  // Sync form data with booking prop changes (e.g. when parts are added in Inspection)
  React.useEffect(() => {
    setFormData(prev => {
        const partsNum =
          booking.billing?.partsTotal != null
            ? Number(booking.billing.partsTotal)
            : getRecordedPartsTotal(booking) || parseFloat(String(prev.partsCost)) || 0;
        const labourCost = parseFloat(prev.labourCost.toString() || '0');
        const gst = parseFloat(prev.gst.toString() || '0');
        const pickupDrop = parseFloat(prev.pickupDropPrice.toString() || '0');
        const baseAmount = getBaseServiceAmount(booking, vehicleRef);

        return {
            ...prev,
            partsCost: partsNum > 0 ? String(partsNum) : prev.partsCost,
            totalAmount: (baseAmount + partsNum + labourCost + gst + pickupDrop).toString()
        };
    });
  }, [booking.billing?.partsTotal, booking.totalAmount, booking.parts, booking.baseServiceAmountOverride, vehicleRef]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === 'invoiceDate') {
      if (value && value.length > 10) {
        toast.error('Too long data: Please enter a valid date');
        return;
      }
    }

    if (name === 'invoiceNumber') {
      // Accept only alphanumeric characters (letters and digits), no special characters
      const sanitized = value.replace(/[^a-zA-Z0-9]/g, '');
      if (value !== sanitized) {
        toast.error('Invoice Number must contain only letters and digits (no special characters)');
        return;
      }
      if (value.length > 20) {
        toast.error('Invoice Number cannot exceed 20 characters');
        return;
      }
    }

    if (['partsCost', 'labourCost', 'gst'].includes(name)) {
      if (value !== '') {
        // Only allow digits (no decimals, no negative signs, no exponent 'e')
        const isOnlyDigits = /^\d+$/.test(value);
        if (!isOnlyDigits) {
          toast.error(`${name === 'partsCost' ? 'Parts Cost' : name === 'labourCost' ? 'Labour Cost' : 'GST'} must be digits only`);
          return;
        }
        if (value.length > 6) {
          toast.error(`${name === 'partsCost' ? 'Parts Cost' : name === 'labourCost' ? 'Labour Cost' : 'GST'} cannot exceed 6 digits`);
          return;
        }
      }
    }

    setFormData(prev => {
        const newData = { ...prev, [name]: value };
        if (['partsCost', 'labourCost', 'gst'].includes(name)) {
            const pickupDrop = parseFloat(newData.pickupDropPrice.toString()) || 0;
            newData.totalAmount = recalcTotal(
              newData.partsCost,
              newData.labourCost,
              newData.gst,
              pickupDrop,
              vehicleRef
            );
        }
        return newData;
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFile(file);
    }
    // Reset input value
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Invoice Number validation
    const invoiceNumStr = formData.invoiceNumber.trim();
    if (!invoiceNumStr) {
      toast.error('Invoice Number is required');
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(invoiceNumStr)) {
      toast.error('Invoice Number must contain only letters and digits (no special characters)');
      return;
    }
    if (invoiceNumStr.length > 20) {
      toast.error('Invoice Number cannot exceed 20 characters');
      return;
    }

    // Invoice Date validation
    if (!isValidDate(formData.invoiceDate)) {
      toast.error('Please enter a valid invoice date');
      return;
    }
    const invoiceDateObj = new Date(formData.invoiceDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (invoiceDateObj > today) {
      toast.error('Invoice date cannot be a future date');
      return;
    }

    // Parts Cost validation
    if (formData.partsCost !== '') {
      if (!/^\d+$/.test(formData.partsCost)) {
        toast.error('Parts Cost must contain only digits');
        return;
      }
      if (formData.partsCost.length > 6) {
        toast.error('Parts Cost cannot exceed 6 digits');
        return;
      }
    }

    // Labour Cost validation
    if (formData.labourCost !== '') {
      if (!/^\d+$/.test(formData.labourCost)) {
        toast.error('Labour Cost must contain only digits');
        return;
      }
      if (formData.labourCost.length > 6) {
        toast.error('Labour Cost cannot exceed 6 digits');
        return;
      }
    }

    // GST validation
    if (formData.gst !== '') {
      if (!/^\d+$/.test(formData.gst)) {
        toast.error('GST must contain only digits');
        return;
      }
      if (formData.gst.length > 6) {
        toast.error('GST cannot exceed 6 digits');
        return;
      }
    }
    
    // Check if Inspection is completed
    if (!booking.inspection?.completedAt) {
      toast.error('Please complete the Inspection in the "Inspection" tab before uploading the bill.');
      return;
    }

    // Check if QC is completed
    if (!booking.qc?.completedAt) {
      toast.error('Please complete the QC Check in the "QC Check" tab before uploading the bill.');
      return;
    }

    if (!file && !isUploaded) {
      toast.error('Please upload a bill image or PDF');
      return;
    }
    
    setLoading(true);
    try {
        let fileUrl = booking.billing?.fileUrl || '';

        if (file) {
            const res = await uploadService.uploadFile(file);
            fileUrl = res.url;
        }

        const updateData: any = {
            billing: {
                invoiceNumber: formData.invoiceNumber,
                invoiceDate: formData.invoiceDate,
                partsTotal: parseFloat(formData.partsCost.toString()) || 0,
                labourCost: parseFloat(formData.labourCost.toString()) || 0,
                gst: parseFloat(formData.gst.toString()) || 0,
                pickupDropPrice: parseFloat(formData.pickupDropPrice.toString()) || 0,
                total: parseFloat(formData.totalAmount.toString()) || 0,
                fileUrl: fileUrl
            }
        };

        // Automatically move status to SERVICE_COMPLETED and set jobEndTime
        const activeFlow = getFlowForService(booking.services || []);
        const currentIndex = activeFlow.indexOf(booking.status as (typeof activeFlow)[number]);
        const completedIndex = activeFlow.indexOf('SERVICE_COMPLETED' as (typeof activeFlow)[number]);

        if (currentIndex < completedIndex && currentIndex !== -1) {
            // Also set jobEndTime if not set
            if (!booking.serviceExecution?.jobEndTime) {
                updateData.serviceExecution = {
                    jobEndTime: new Date().toISOString()
                };
            }
        }

        await bookingService.updateBookingDetails(booking._id, updateData);

        // If status update is still needed (backend updateBookingDetails handles SERVICE_STARTED -> SERVICE_COMPLETED)
        if (currentIndex < completedIndex && currentIndex !== -1 && booking.status !== 'SERVICE_STARTED') {
            await bookingService.updateBookingStatus(booking._id, 'SERVICE_COMPLETED');
        }

        setIsUploaded(true);
        onUploadComplete();
        redirectAfterCountdown(navigate, '/merchant/dashboard', 'Bill uploaded and service marked as completed');
    } catch (error) {
        console.error(error);
        toast.error('Failed to save bill details');
    } finally {
        setLoading(false);
    }
  };

  if (isUploaded && !file) { // Show uploaded state if already uploaded (and not currently editing with new file)
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-6 h-6 text-green-600" />
        </div>
        <h3 className="text-lg font-semibold text-green-800">Bill Uploaded</h3>
        {booking.billing?.fileUrl && (
            <a 
                href={booking.billing.fileUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-green-700 underline text-sm mb-2 block hover:text-green-900"
            >
                View Uploaded Document
            </a>
        )}
        <p className="text-green-600 mb-4">Invoice #{formData.invoiceNumber}</p>
        <p className="text-sm text-green-700">Total: ₹{formData.totalAmount}</p>
        <button 
            onClick={() => setIsUploaded(false)} // Allow edit
            className="text-sm text-primary underline"
        >
            Edit Bill Details
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <FileText className="w-5 h-5 text-primary" />
        Upload Bill (Mandatory)
      </h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Invoice Number</label>
            <input
              type="text"
              name="invoiceNumber"
              value={formData.invoiceNumber}
              onChange={handleInputChange}
              required
              className="w-full p-2 border border-input rounded-lg bg-background"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Invoice Date</label>
            <input
              type="date"
              name="invoiceDate"
              value={formData.invoiceDate}
              onChange={handleInputChange}
              onBlur={(e) => {
                const val = e.target.value;
                if (val && !isValidDate(val)) {
                  toast.error('Please enter a valid invoice date');
                }
              }}
              required
              maxLength={10}
              min="1900-01-01"
              max={new Date().toISOString().split('T')[0]}
              className="w-full p-2 border border-input rounded-lg bg-background"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Parts Cost</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              name="partsCost"
              value={formData.partsCost}
              onChange={handleInputChange}
              className="w-full p-2 border border-input rounded-lg bg-background"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Labour Cost</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              name="labourCost"
              value={formData.labourCost}
              onChange={handleInputChange}
              className="w-full p-2 border border-input rounded-lg bg-background"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">GST</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              name="gst"
              value={formData.gst}
              onChange={handleInputChange}
              className="w-full p-2 border border-input rounded-lg bg-background"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Pickup/Drop Price</label>
            <input
              type="number"
              name="pickupDropPrice"
              value={pickupDropLoading ? '' : formData.pickupDropPrice}
              readOnly
              disabled
              placeholder={pickupDropLoading ? 'Loading...' : '0'}
              className="w-full p-2 border border-input rounded-lg bg-muted text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">
              Auto-filled from vehicle brand &amp; model (not editable)
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Total Amount</label>
            <input
              type="number"
              name="totalAmount"
              value={formData.totalAmount}
              readOnly
              className="w-full p-2 border border-input rounded-lg bg-muted text-muted-foreground"
            />
          </div>
        </div>

        <div className="border-2 border-dashed border-input rounded-xl p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer relative">
          <input
            type="file"
            onChange={handleFileChange}
            accept="image/*,application/pdf"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="flex flex-col items-center gap-2 pointer-events-none">
            {file ? (
              <>
                <FileText className="w-8 h-8 text-primary" />
                <p className="font-medium text-primary">{file.name}</p>
              </>
            ) : (
              <>
                <Camera className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium">Click to upload or drag & drop</p>
                <p className="text-xs text-muted-foreground">Camera image, PDF, Scanned copy</p>
              </>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors"
        >
          {loading ? 'Saving...' : 'Upload Bill & Submit'}
        </button>
      </form>
    </div>
  );
};

export default BillUploadPanel;
