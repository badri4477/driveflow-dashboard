
import React, { useState } from 'react';
import { AlertTriangle, Plus, Trash2, CheckCircle, Clock, Upload, Image as ImageIcon } from 'lucide-react';
import { bookingService, Booking, BookingDetailsUpdate } from '../../services/bookingService';
import { createApproval } from '../../services/approvalService';
import { uploadService } from '../../services/uploadService';
import { toast } from 'sonner';
import BaseServiceAmountEditor from './BaseServiceAmountEditor';

interface InspectionPanelProps {
  booking: Booking;
  onUpdate: () => void;
}

type BookingAdditionalPart =
  NonNullable<NonNullable<Booking['inspection']>['additionalParts']>[number];

const InspectionPanel: React.FC<InspectionPanelProps> = ({ booking, onUpdate }) => {
  const [damageReport, setDamageReport] = useState(booking.inspection?.damageReport || '');
  const [frontPhoto, setFrontPhoto] = useState<string>(booking.inspection?.frontPhoto || '');
  const [backPhoto, setBackPhoto] = useState<string>(booking.inspection?.backPhoto || '');
  const [leftPhoto, setLeftPhoto] = useState<string>(booking.inspection?.leftPhoto || '');
  const [rightPhoto, setRightPhoto] = useState<string>(booking.inspection?.rightPhoto || '');
  const [uploadingSides, setUploadingSides] = useState<Record<string, boolean>>({});
  
  const [loading, setLoading] = useState(false);

  const handleAddSidePhoto = async (side: 'front' | 'back' | 'left' | 'right', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files (JPEG, PNG, WEBP, etc.) are allowed for vehicle photos.');
      e.target.value = '';
      return;
    }
    
    setUploadingSides(prev => ({ ...prev, [side]: true }));
    try {
      const res = await uploadService.uploadFile(file);
      switch (side) {
        case 'front': setFrontPhoto(res.url); break;
        case 'back': setBackPhoto(res.url); break;
        case 'left': setLeftPhoto(res.url); break;
        case 'right': setRightPhoto(res.url); break;
      }
      toast.success(`${side.charAt(0).toUpperCase() + side.slice(1)} photo uploaded`);
    } catch (err) {
      toast.error(`Failed to upload ${side} photo`);
    } finally {
      setUploadingSides(prev => ({ ...prev, [side]: false }));
      e.target.value = '';
    }
  };

  const handleRemoveSidePhoto = (side: 'front' | 'back' | 'left' | 'right') => {
    switch (side) {
      case 'front': setFrontPhoto(''); break;
      case 'back': setBackPhoto(''); break;
      case 'left': setLeftPhoto(''); break;
      case 'right': setRightPhoto(''); break;
    }
  };



  const handleSave = async (isFinal: boolean = false) => {
    if (isFinal) {
      if (!frontPhoto || !backPhoto || !leftPhoto || !rightPhoto) {
        toast.error('Please upload all 4 sides of vehicle photos');
        return;
      }
    }

    setLoading(true);
    try {
      const inspectionUpdate: BookingDetailsUpdate['inspection'] = {
        damageReport,
        frontPhoto,
        backPhoto,
        leftPhoto,
        rightPhoto,
        // additionalParts are now managed via chat/approvals, so we just preserve the existing ones.
        additionalParts: booking.inspection?.additionalParts || [],
      };

      if (isFinal && inspectionUpdate) {
        inspectionUpdate.completedAt = new Date().toISOString();
      }

      // The `parts` for billing are updated via the approval system,
      // so we only update the inspection details here.
      await bookingService.updateBookingDetails(booking._id, {
        inspection: inspectionUpdate,
      });

      if (isFinal) {
        toast.success('Inspection completed successfully');
      } else {
        toast.success('Inspection details saved');
      }
      
      onUpdate();
    } catch (error) {
      console.error(error);
      toast.error('Failed to save inspection details');
    } finally {
      setLoading(false);
    }
  };

  const isCompleted = !!booking.inspection?.completedAt;
  const canAddParts = !['SERVICE_COMPLETED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(booking.status);

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            Vehicle Inspection
        </h3>
        {isCompleted && (
            <div className="flex items-center gap-1 text-green-600 font-medium text-sm">
                <CheckCircle className="w-4 h-4" />
                Inspection Confirmed
            </div>
        )}
      </div>

      {/* Damage Report & Photos Section */}
      <div className="space-y-4 pt-2 border-t border-border">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Damage Report / Inspection Findings</label>
          <textarea
            value={damageReport}
            onChange={(e) => setDamageReport(e.target.value)}
            disabled={isCompleted}
            placeholder="Describe any damages or findings from the initial inspection..."
            className="w-full p-3 border border-input rounded-md text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-3 block">Vehicle Photos (4 Sides Required)</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {(['front', 'back', 'left', 'right'] as const).map((side) => {
              const url = side === 'front' ? frontPhoto : side === 'back' ? backPhoto : side === 'left' ? leftPhoto : rightPhoto;
              const isUploading = uploadingSides[side];
              
              return (
                <div key={side} className="space-y-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground block text-center">{side} side</span>
                  <div className="relative group aspect-square rounded-lg overflow-hidden border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors">
                    {url ? (
                      <>
                        <img src={url} alt={side} className="w-full h-full object-cover" />
                        {!isCompleted && (
                          <button
                            onClick={() => handleRemoveSidePhoto(side)}
                            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </>
                    ) : (
                      <label className={`w-full h-full flex flex-col items-center justify-center ${isCompleted ? 'cursor-not-allowed bg-gray-50' : 'cursor-pointer hover:bg-muted/50'} transition-colors`}>
                        {isUploading ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                        ) : (
                          <>
                            <Upload className="w-5 h-5 text-muted-foreground" />
                            <span className="text-[10px] mt-1 text-muted-foreground font-medium uppercase">Upload {side}</span>
                          </>
                        )}
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*" 
                          onChange={(e) => handleAddSidePhoto(side, e)}
                          disabled={isCompleted}
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <BaseServiceAmountEditor booking={booking} onUpdate={onUpdate} />

      <div className="pt-4 border-t flex gap-4">
        <button
          onClick={() => handleSave(false)}
          disabled={loading || isCompleted}
          className={`flex-1 flex items-center justify-center gap-2 py-2 border rounded-lg transition-colors font-medium ${loading || isCompleted ? 'bg-gray-50 text-gray-400 cursor-not-allowed border-gray-200' : 'bg-white text-gray-700 hover:bg-gray-50 border-input'}`}
        >
          {loading ? 'Saving...' : 'Save Inspection Details'}
        </button>
        {!isCompleted && (
          <button
            onClick={() => handleSave(true)}
            disabled={loading}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-white rounded-lg transition-colors font-medium ${loading ? 'bg-green-600/50 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {loading ? 'Completing...' : 'Confirm Inspection'}
          </button>
        )}
      </div>
    </div>
  );
};

export default InspectionPanel;
