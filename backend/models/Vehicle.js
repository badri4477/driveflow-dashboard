import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  make: { type: String, required: true, maxlength: 50 },
  model: { type: String, required: true, maxlength: 50 },
  variant: { type: String, maxlength: 50 },
  year: { type: Number },
  licensePlate: { type: String, required: true, maxlength: 15 },
  color: { type: String, maxlength: 30 },
  image: { type: String }, // URL
  vin: { type: String, maxlength: 30 },
  mileage: { type: Number },
  fuelType: { type: String, maxlength: 20 },
  // From Vahan at add time (server-side cache only; blank for manual entry).
  bodyType: { type: String, maxlength: 60 },
  manufacturingMonthYear: { type: String, maxlength: 20 },
  insuranceValidUpto: { type: String, maxlength: 20 },
  registrationValidUpto: { type: String, maxlength: 20 },
  vahanFetchedAt: { type: Date },
  frontTyres: { type: String, maxlength: 100 },
  rearTyres: { type: String, maxlength: 100 },
  batteryDetails: { type: String, maxlength: 100 },
  pickupDropPrice: { type: String, maxlength: 20 },
  type: { type: String, enum: ['Car'], default: 'Car' },
  status: { type: String, enum: ['Idle', 'On Route', 'In Service'], default: 'Idle' },
  location: {
    lat: { type: Number },
    lng: { type: Number },
    address: { type: String },
    updatedAt: { type: Date }
  },
  geo: {
    type: {
      type: String,
      default: 'Point',
      enum: ['Point']
    },
    coordinates: {
      type: [Number],
      index: '2dsphere'
    }
  },
  lastService: { type: Date },
  nextService: { type: Date },
  /** When set, all health UI shows the same %: 100 minus 1 per calendar day since this date (any health save refreshes it). */
  healthPercentBaselineAt: { type: Date },
  documents: [{
    name: { type: String },
    type: { type: String, enum: ['Registration', 'Battery Warranty', 'Tire Warranty', 'Other'] },
    url: { type: String },
    expiryDate: { type: Date },
    uploadedAt: { type: Date, default: Date.now }
  }],
  healthIndicators: {
    generalService: {
      value: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
      lastServiceDate: { type: Date },
      lastServiceKm: { type: Number, default: 0 },
      fixedKm: { type: Number, default: 0 },
      fixedDays: { type: Number, default: 0 }
    },
    brakePads: {
      value: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
      lastServiceDate: { type: Date },
      lastServiceKm: { type: Number, default: 0 },
      fixedKm: { type: Number, default: 0 },
      fixedDays: { type: Number, default: 0 }
    },
    tires: {
      value: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
      lastServiceDate: { type: Date },
      lastServiceKm: { type: Number, default: 0 },
      fixedKm: { type: Number, default: 0 },
      fixedDays: { type: Number, default: 0 }
    },
    battery: {
      value: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
      lastServiceDate: { type: Date },
      lastServiceKm: { type: Number, default: 0 },
      fixedKm: { type: Number, default: 0 },
      fixedDays: { type: Number, default: 0 }
    },
    wiperBlade: {
      value: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
      lastServiceDate: { type: Date },
      lastServiceKm: { type: Number, default: 0 },
      fixedKm: { type: Number, default: 0 },
      fixedDays: { type: Number, default: 0 }
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Helper to calculate health (skipped for indicators without intervals when daily baseline mode is active)
vehicleSchema.methods.calculateHealth = function() {
  const vehicle = this;
  if (!vehicle.healthIndicators) return;

  const now = new Date();
  const currentKm = vehicle.mileage || 0;

  const keys = ['generalService', 'brakePads', 'tires', 'battery', 'wiperBlade'];
  
  keys.forEach(key => {
    const indicator = vehicle.healthIndicators[key];
    if (indicator) {
      const hasInterval = (indicator.fixedKm || 0) > 0 || (indicator.fixedDays || 0) > 0;
      if (vehicle.healthPercentBaselineAt && !hasInterval) {
        return;
      }

      if (indicator.lastServiceDate) {
        const lastDate = new Date(indicator.lastServiceDate);
        // Normalize dates to midnight to get accurate day difference
        const lastDateMidnight = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
        const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffTime = Math.abs(nowMidnight - lastDateMidnight);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        const lastKm = indicator.lastServiceKm || 0;
        const diffKm = Math.max(0, currentKm - lastKm);
        const fixedKm = indicator.fixedKm || 0;
        const fixedDays = indicator.fixedDays || 0;

        // Calculate service progress based on days (if fixedDays > 0)
        const progressFromDays = fixedDays > 0 ? Math.min(100, (diffDays / fixedDays) * 100) : 0;
        
        // Calculate service progress based on KM (if fixedKm > 0)
        const progressFromKm = fixedKm > 0 ? Math.min(100, (diffKm / fixedKm) * 100) : 0;

        // Service progress is the maximum of both (whichever comes first)
        indicator.value = Math.round(Math.max(progressFromDays, progressFromKm));
      } else {
        // If no service date has been set by a merchant, all indicators must be zero
        indicator.value = 0;
        indicator.fixedKm = 0;
        indicator.fixedDays = 0;
      }
    }
  });
};

vehicleSchema.pre('save', async function() {
  this.calculateHealth();
});

vehicleSchema.index({ user: 1, createdAt: -1 });

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

export default Vehicle;
