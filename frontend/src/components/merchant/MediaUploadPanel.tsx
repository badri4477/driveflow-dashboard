import React, { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, X, Plus, Trash2, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { bookingService, Booking } from '../../services/bookingService';
import { uploadService } from '../../services/uploadService';

interface MediaUploadPanelProps {
  bookingId: string;
  booking?: Booking;
  onUploadComplete: () => void;
}

const MediaUploadPanel: React.FC<MediaUploadPanelProps> = ({ bookingId, booking, onUploadComplete }) => {
  // Check if booking is completed (read-only mode)
  const isReadOnly = booking?.status === 'COMPLETED' || booking?.status === 'DELIVERED' || booking?.paymentStatus === 'paid';
  
  const [serviceParts, setServiceParts] = useState<Array<{
    name: string;
    price: number;
    quantity: number;
    image?: File;
    imageUrl?: string;
    fromInspection?: boolean;
    inspectionPartId?: string;
    oldImage?: string;
    needsNewImage?: boolean;
  }>>([]);
  
  // State for existing images (URLs) - only after service
  const [existingAfter, setExistingAfter] = useState<string[]>(
    booking?.serviceExecution?.afterPhotos || []
  );

  // State for existing service parts
  const [existingServiceParts, setExistingServiceParts] = useState<Array<{
    name: string;
    price: number;
    quantity: number;
    approved: boolean;
    approvalStatus?: 'Pending' | 'Approved' | 'Rejected';
    image?: string;
    oldImage?: string;
    addedDuringService?: boolean;
    fromInspection?: boolean;
    inspectionPartId?: string;
  }>>(
    booking?.serviceExecution?.serviceParts || []
  );

  // Get approved additional parts from inspection that can be sent to service
  const approvedInspectionParts = booking?.inspection?.additionalParts
    ? booking.inspection.additionalParts
        .map((part, index) => ({ ...part, originalIndex: index }))
        .filter(part => part.approvalStatus?.toLowerCase() === 'approved' || part.approved)
    : [];

  // Track which inspection parts have been sent to service
  const [sentInspectionParts, setSentInspectionParts] = useState<string[]>(
    existingServiceParts
      .filter(part => part.fromInspection)
      .map(part => part.inspectionPartId || '')
      .filter(Boolean)
  );

  const [newImagesForExistingParts, setNewImagesForExistingParts] = useState<Record<number, File>>({});
  const [loading, setLoading] = useState(false);

  // Initialize service parts from existing data
  useEffect(() => {
    if (booking?.serviceExecution?.afterPhotos) {
      setExistingAfter(booking.serviceExecution.afterPhotos);
    }
    
    const existingParts = booking?.serviceExecution?.serviceParts || [];
    setExistingServiceParts(existingParts);
    
    // Automatically add approved inspection parts to serviceParts if they haven't been sent yet
    if (booking?.inspection?.additionalParts) {
      const approvedPartsWithIndices = booking.inspection.additionalParts
        .map((part, index) => ({ part, originalIndex: index }))
        .filter(item => item.part.approvalStatus?.toLowerCase() === 'approved' || item.part.approved);

      setServiceParts(currentServiceParts => {
        const sentIds = existingParts
          .filter(part => part.fromInspection)
          .map(part => part.inspectionPartId || '')
          .filter(Boolean);

        const partsToAutoAdd = approvedPartsWithIndices.filter((item) => {
          const inspectionPartId = `inspection_${item.originalIndex}`;
          return !sentIds.includes(inspectionPartId) && 
                 !currentServiceParts.some(sp => sp.inspectionPartId === inspectionPartId);
        });

        if (partsToAutoAdd.length > 0) {
          const newServiceParts = partsToAutoAdd.map((item) => {
            return {
              name: item.part.name,
              price: item.part.price,
              quantity: item.part.quantity,
              imageUrl: item.part.image,
              fromInspection: true,
              inspectionPartId: `inspection_${item.originalIndex}`,
              oldImage: item.part.image,
              needsNewImage: true
            };
          });
          return [...currentServiceParts, ...newServiceParts];
        }
        return currentServiceParts;
      });
    }
  }, [booking]);

  // Derived state for sent inspection parts
  const allSentInspectionParts = [
    ...existingServiceParts
      .filter(part => part.fromInspection)
      .map(part => part.inspectionPartId || ''),
    ...serviceParts
      .filter(part => part.fromInspection)
      .map(part => part.inspectionPartId || '')
  ].filter(Boolean);

  const uploadAfterPhotos = async (files: File[]) => {
    if (files.length === 0) return;

    const remaining = Math.max(0, 4 - existingAfter.length);
    if (remaining === 0) {
      toast.warning('Maximum 4 after service photos already uploaded');
      return;
    }

    const toUpload = files.slice(0, remaining);
    if (files.length > toUpload.length) {
      toast.warning(`Only ${toUpload.length} more photo(s) can be added (maximum 4 total)`);
    }

    setLoading(true);
    try {
      const res: { files: { url: string }[] } = await uploadService.uploadFiles(toUpload);
      const newUrls = res.files.map((f) => f.url);
      const finalAfter = [...existingAfter, ...newUrls].slice(0, 4);

      await bookingService.updateBookingDetails(bookingId, {
        serviceExecution: {
          ...booking?.serviceExecution,
          afterPhotos: finalAfter,
        },
      });

      setExistingAfter(finalAfter);
      toast.success(
        toUpload.length === 1 ? 'Photo uploaded' : `${toUpload.length} photos uploaded`
      );
    } catch (error) {
      console.error(error);
      toast.error('Failed to upload photo');
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length > 0) {
      const nonImages = files.filter(file => !file.type.startsWith('image/'));
      if (nonImages.length > 0) {
        toast.error('Only image files (JPEG, PNG, WEBP, etc.) are allowed for service photos.');
        return;
      }
      await uploadAfterPhotos(files);
    }
  };

  const removeExistingImage = (index: number) => {
    setExistingAfter(prev => prev.filter((_, i) => i !== index));
  };

  const sendInspectionPartToService = (inspectionPart: any, inspectionPartIndex: number) => {
    const inspectionPartId = `inspection_${inspectionPartIndex}`;
    
    if (sentInspectionParts.includes(inspectionPartId)) {
      toast.info('This part has already been sent to service');
      return;
    }

    const servicePart = {
      name: inspectionPart.name,
      price: inspectionPart.price,
      quantity: inspectionPart.quantity,
      imageUrl: inspectionPart.image, // Old image from inspection
      fromInspection: true,
      inspectionPartId: inspectionPartId,
      oldImage: inspectionPart.image, // Keep reference to old image
      needsNewImage: true // Flag to indicate new image needed
    };

    setServiceParts(prev => [...prev, servicePart]);
    setSentInspectionParts(prev => [...prev, inspectionPartId]);
    toast.success(`${inspectionPart.name} sent to service - upload new image after replacement`);
  };

  const addServicePart = () => {
    setServiceParts(prev => [...prev, {
      name: '',
      price: 0,
      quantity: 1,
      needsNewImage: true
    }]);
  };

  const updateServicePart = (index: number, field: string, value: any) => {
    setServiceParts(prev => prev.map((part, i) => 
      i === index ? { ...part, [field]: value } : part
    ));
  };

  const removeServicePart = (index: number) => {
    const part = serviceParts[index];
    if (part.fromInspection && part.inspectionPartId) {
      setSentInspectionParts(prev => prev.filter(id => id !== part.inspectionPartId));
    }
    setServiceParts(prev => prev.filter((_, i) => i !== index));
  };

  // Auto-save: part after-images are uploaded and persisted as soon as they're
  // picked, so a page refresh doesn't lose them.
  const persistServiceParts = async (parts: typeof existingServiceParts) => {
    await bookingService.updateBookingDetails(bookingId, {
      serviceExecution: {
        ...booking?.serviceExecution,
        afterPhotos: existingAfter,
        serviceParts: parts,
      },
    });
    setExistingServiceParts(parts);
  };

  const handleServicePartImageChange = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files (JPEG, PNG, WEBP, etc.) are allowed.');
      return;
    }
    const part = serviceParts[index];
    if (!part.name.trim() || part.price <= 0 || part.quantity <= 0) {
      // Incomplete part: keep the file locally until Save Service Data.
      updateServicePart(index, 'image', file);
      updateServicePart(index, 'needsNewImage', false);
      return;
    }
    setLoading(true);
    try {
      const res: { files: { url: string }[] } = await uploadService.uploadFiles([file]);
      const savedPart = {
        name: part.name,
        price: part.price,
        quantity: part.quantity,
        image: res.files[0].url,
        oldImage: part.oldImage,
        approved: !!part.fromInspection,
        approvalStatus: (part.fromInspection ? 'Approved' : 'Pending') as 'Approved' | 'Pending',
        addedDuringService: !part.fromInspection,
        fromInspection: part.fromInspection || false,
        inspectionPartId: part.inspectionPartId,
      };
      await persistServiceParts([...existingServiceParts, savedPart]);
      setServiceParts(prev => prev.filter((_, i) => i !== index));
      toast.success(`After image saved for ${part.name}`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to save image');
    } finally {
      setLoading(false);
    }
  };

  const handleExistingPartImageChange = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files (JPEG, PNG, WEBP, etc.) are allowed.');
      return;
    }
    setLoading(true);
    try {
      const res: { files: { url: string }[] } = await uploadService.uploadFiles([file]);
      const updated = existingServiceParts.map((p, i) => (i === index ? { ...p, image: res.files[0].url } : p));
      await persistServiceParts(updated);
      toast.success('Image updated');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save image');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    // 1. Validate After Service Photos (mandatory 4 photos for non-battery/tire services)
    const isBatteryTire = booking?.batteryTire?.isBatteryTireService;
    if (!isBatteryTire && existingAfter.length < 4) {
      toast.error('Please upload all 4 after service photos before saving.');
      return;
    }

    // 2. Validate new service parts (mandatory name, price, quantity, and after image)
    for (let i = 0; i < serviceParts.length; i++) {
      const part = serviceParts[i];
      if (!part.name.trim()) {
        toast.error('Please enter the name for all new parts');
        return;
      }
      if (part.price <= 0) {
        toast.error(`Please enter a valid price for part: ${part.name}`);
        return;
      }
      if (part.quantity <= 0) {
        toast.error(`Please enter a valid quantity for part: ${part.name}`);
        return;
      }
      if (!part.image) {
        toast.error(`Please upload the After Image for part: ${part.name}`);
        return;
      }
    }

    // 3. Validate existing service parts (mandatory after image)
    for (let i = 0; i < existingServiceParts.length; i++) {
      const part = existingServiceParts[i];
      if (!part.image && !newImagesForExistingParts[i]) {
        toast.error(`Please upload the After Image for existing part: ${part.name}`);
        return;
      }
    }

    const savedAfterPhotos = booking?.serviceExecution?.afterPhotos ?? [];
    const afterPhotosUnchanged =
      existingAfter.length === savedAfterPhotos.length &&
      existingAfter.every((url, i) => url === savedAfterPhotos[i]);

    const servicePartsUnchanged =
      serviceParts.length === 0 &&
      Object.keys(newImagesForExistingParts).length === 0 &&
      existingServiceParts.length === (booking?.serviceExecution?.serviceParts?.length ?? 0);

    if (servicePartsUnchanged && afterPhotosUnchanged) {
      if (existingAfter.length >= 4) {
        onUploadComplete();
        toast.success('Service photos complete. Proceed to QC Check.');
        return;
      }
      toast.info('No changes to save');
      return;
    }
    
    setLoading(true);
    try {
        // After service photos are uploaded immediately on selection

        // Process existing service parts with new images
        const updatedExistingParts = [...existingServiceParts];
        for (const [indexStr, file] of Object.entries(newImagesForExistingParts)) {
          const index = parseInt(indexStr);
          const res: { files: { url: string }[] } = await uploadService.uploadFiles([file]);
          updatedExistingParts[index] = {
            ...updatedExistingParts[index],
            image: res.files[0].url
          };
        }

        // Process new service parts
        const processedServiceParts = [];
        for (const part of serviceParts) {
          let newImageUrl = part.imageUrl; // Keep old image as fallback
          
          // Handle single image upload
          if (part.image) {
            const res: { files: { url: string }[] } = await uploadService.uploadFiles([part.image]);
            newImageUrl = res.files[0].url;
          } else if (part.fromInspection && part.needsNewImage) {
            // Warn if a part from inspection doesn't have a new image yet
            // We'll allow it but it's better to have one
          }
          
          processedServiceParts.push({
            name: part.name,
            price: part.price,
            quantity: part.quantity,
            image: newImageUrl, // New image after replacement
            oldImage: part.oldImage, // Keep reference to old image from inspection
            approved: part.fromInspection ? true : false,
            approvalStatus: part.fromInspection ? 'Approved' : 'Pending',
            addedDuringService: !part.fromInspection,
            fromInspection: part.fromInspection || false,
            inspectionPartId: part.inspectionPartId
          });
        }

        const finalServiceParts = [...updatedExistingParts, ...processedServiceParts];
        
        await bookingService.updateBookingDetails(bookingId, {
            serviceExecution: {
                ...booking?.serviceExecution,
                afterPhotos: existingAfter,
                serviceParts: finalServiceParts,
                // Marks service data as saved → unlocks QC Check (app + web).
                jobEndTime: new Date().toISOString(),
            }
        });

        // Update existing state
        setExistingServiceParts(finalServiceParts);
        setServiceParts([]);
        setNewImagesForExistingParts({});

        onUploadComplete();
        if (existingAfter.length >= 4) {
          toast.success('Service data saved. Proceed to QC Check.');
        } else {
          toast.success('Service data updated successfully');
        }
    } catch (error) {
        console.error(error);
        toast.error('Failed to upload data');
    } finally {
        setLoading(false);
    }
  };

  const totalImages = existingAfter.length;

  return (
    <div className="space-y-6">
      {/* Approved Inspection Parts - Can be sent to service */}
      {!isReadOnly && approvedInspectionParts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Plus className="w-5 h-5 text-green-600" />
                  Approved Additional Parts from Inspection
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Customer approved these parts. Send to service and upload new images after replacement.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {approvedInspectionParts.map((part) => {
              const inspectionPartId = `inspection_${part.originalIndex}`;
              const alreadySent = allSentInspectionParts.includes(inspectionPartId);
              
              return (
                <div key={inspectionPartId} className="flex items-center gap-4 p-4 border border-green-200 bg-green-50/50 rounded-lg">
                  <div className="flex flex-col items-center gap-2">
                    {part.image && (
                      <img src={part.image} alt={part.name} className="w-16 h-16 object-cover rounded" />
                    )}
                    <span className="text-xs text-muted-foreground">Before</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{part.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Qty: {part.quantity} • Price: ₹{part.price}
                    </p>
                    <span className="text-xs text-green-600 font-medium">✓ Customer Approved</span>
                  </div>
                  <button
                    onClick={() => sendInspectionPartToService(part, part.originalIndex)}
                    disabled={alreadySent}
                    className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                      alreadySent 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {alreadySent ? 'Sent' : 'Send to Service'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Service Parts - Upload new images of replaced parts */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
                <Camera className="w-5 h-5 text-primary" />
                {isReadOnly ? 'Service Parts Completed' : 'Service Parts - Upload New Images'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isReadOnly 
                ? 'Parts that were replaced/serviced during the booking'
                : 'Upload new images of parts after replacement/installation'
              }
            </p>
          </div>
          {/* "Add New Discovery" hidden — new parts go through inspection approval instead. */}
        </div>

        {/* Existing Service Parts */}
        {existingServiceParts.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {isReadOnly ? 'Service Parts Completed' : 'Current Service Parts'}
            </h4>
            <div className="space-y-3">
              {existingServiceParts.map((part, index) => (
                <div key={`existing-service-part-${index}`} className={`flex flex-col md:flex-row md:items-center gap-4 p-3 rounded-lg ${
                  part.fromInspection ? 'bg-green-50 border border-green-200' : 'bg-muted/50'
                }`}>
                  <div className="flex gap-2 shrink-0">
                    {part.oldImage && (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() => window.open(part.oldImage!, '_blank')}
                          className="w-16 h-16 object-cover rounded hover:opacity-90 transition-opacity"
                        >
                          <img src={part.oldImage} alt="Before" className="w-full h-full object-cover rounded" />
                        </button>
                        <span className="text-[10px] text-muted-foreground uppercase">Before</span>
                      </div>
                    )}
                    <div className="flex flex-col items-center gap-1">
                      <div className="relative group">
                        {(newImagesForExistingParts[index] || part.image) ? (
                          <button
                            onClick={() => window.open(newImagesForExistingParts[index] ? URL.createObjectURL(newImagesForExistingParts[index]) : part.image!, '_blank')}
                            className="w-16 h-16 object-cover rounded hover:opacity-90 transition-opacity border border-border overflow-hidden"
                          >
                            <img 
                              src={newImagesForExistingParts[index] ? URL.createObjectURL(newImagesForExistingParts[index]) : part.image} 
                              alt="After" 
                              className="w-full h-full object-cover" 
                            />
                          </button>
                        ) : (
                          <div className="w-16 h-16 rounded bg-muted flex items-center justify-center border border-dashed border-border">
                            <ImageIcon className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {newImagesForExistingParts[index] ? 'New Image' : 'After'}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{part.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Qty: {part.quantity} • Price: ₹{part.price}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        part.fromInspection ? 'text-green-600' : 'text-blue-600'
                      }`}>
                        {part.fromInspection ? '✓ Inspection' : '⚡ Discovery'}
                      </span>
                      {newImagesForExistingParts[index] && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                          Unsaved Changes
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {!isReadOnly && (
                      <label
                        className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-primary/30 bg-background text-primary text-sm font-medium cursor-pointer hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary transition-colors ${
                          loading ? 'opacity-50 pointer-events-none' : ''
                        }`}
                      >
                        <ImageIcon className="w-4 h-4" />
                        {part.image ? 'Change after image' : 'Upload after image'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={loading}
                          onChange={(e) => handleExistingPartImageChange(index, e)}
                          className="sr-only"
                        />
                      </label>
                    )}
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                      part.approvalStatus?.toLowerCase() === 'approved' ? 'bg-green-100 text-green-800' :
                      part.approvalStatus?.toLowerCase() === 'rejected' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {part.approvalStatus || 'Pending'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* New Service Parts */}
        {!isReadOnly && serviceParts.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">New Service Parts</h4>
            {serviceParts.map((part, index) => (
              <div key={`new-service-part-${index}`} className={`grid grid-cols-1 md:grid-cols-6 gap-4 p-4 border rounded-lg ${
                part.fromInspection ? 'border-green-200 bg-green-50/50' : 'border-border'
              }`}>
                <div>
                  <label className="block text-sm font-medium mb-1">Part Name</label>
                  <input
                    type="text"
                    value={part.name}
                    onChange={(e) => updateServicePart(index, 'name', e.target.value)}
                    className="w-full p-2 border border-input rounded-lg"
                    placeholder="Enter part name"
                    disabled={part.fromInspection}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Price (₹)</label>
                  <input
                    type="number"
                    value={part.price}
                    onChange={(e) => updateServicePart(index, 'price', parseFloat(e.target.value) || 0)}
                    className="w-full p-2 border border-input rounded-lg"
                    placeholder="0"
                    disabled={part.fromInspection}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Quantity</label>
                  <input
                    type="number"
                    value={part.quantity}
                    onChange={(e) => updateServicePart(index, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-full p-2 border border-input rounded-lg"
                    min="1"
                    disabled={part.fromInspection}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Before Image</label>
                  <div className="w-full h-16 rounded-lg overflow-hidden border border-border bg-muted flex items-center justify-center">
                    {part.oldImage ? (
                      <img src={part.oldImage} alt="Before" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-muted-foreground">No before image</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    After Image {part.needsNewImage && <span className="text-red-500">*</span>}
                  </label>
                  <div className="flex flex-col gap-2">
                    {part.image && (
                      <div className="w-full h-16 rounded-lg overflow-hidden border border-border">
                        <img src={URL.createObjectURL(part.image)} alt="Preview" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <label className={`p-2 border border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors text-center ${
                      part.needsNewImage ? 'border-red-300 bg-red-50' : 'border-border'
                    }`}>
                      <span className="text-sm text-muted-foreground">
                        {part.image ? 'Change image' : part.needsNewImage ? 'Upload after image' : 'Choose image'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleServicePartImageChange(index, e)}
                      />
                    </label>
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => removeServicePart(index)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {serviceParts.length === 0 && existingServiceParts.length === 0 && !isReadOnly && (
          <div className="text-center py-8 text-muted-foreground">
            <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No service parts added yet</p>
            <p className="text-sm">Send approved inspection parts or add new discoveries during service</p>
          </div>
        )}
      </div>

      {/* After Service Photos */}
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-primary" />
              {isReadOnly ? 'Service Completion Photos' : 'After Service Photos'}
          </h3>
          <span className="text-sm text-muted-foreground">
            {isReadOnly 
              ? `${totalImages} photos taken after service completion`
              : `${totalImages}/4 images`
            }
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Existing Images */}
          {existingAfter.map((url, i) => (
              <div key={`existing-after-${i}`} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                  <button
                    onClick={() => window.open(url, '_blank')}
                    className="w-full h-full hover:opacity-90 transition-opacity"
                  >
                    <img src={url} alt={`After Service ${i + 1}`} className="w-full h-full object-cover" />
                  </button>
                  {!isReadOnly && (
                    <button
                        onClick={() => removeExistingImage(i)}
                        className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <X className="w-4 h-4" />
                    </button>
                  )}
              </div>
          ))}
          
          {/* Add Photo Button - only show if less than 4 total images */}
          {!isReadOnly && totalImages < 4 && (
            <label className={`aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center transition-all ${
              loading ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-primary/50 hover:bg-muted/50'
            }`}>
              <Upload className="w-8 h-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground text-center">
                {loading ? 'Uploading...' : 'Add Photo'}
              </span>
              <input 
                type="file" 
                accept="image/*" 
                multiple 
                className="hidden" 
                disabled={loading}
                onChange={handleImageChange} 
              />
            </label>
          )}
        </div>

        {totalImages === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">
              {isReadOnly ? 'No service photos available' : 'No after service photos yet'}
            </p>
            <p className="text-sm">
              {isReadOnly 
                ? 'No photos were taken after service completion'
                : 'Upload 4 photos, then click Save Service Data to continue to QC Check'
              }
            </p>
          </div>
        )}
      </div>

      {/* Save Button */}
      {!isReadOnly && (
        <div className="flex justify-end">
          <button 
              onClick={handleUpload}
              disabled={loading}
              className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
              {loading ? 'Saving...' : 'Save Service Data'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MediaUploadPanel;