import Vehicle from '../models/Vehicle.js';
import { emitEntitySync } from '../utils/syncService.js';
import { attachHealthPercentDisplay } from '../utils/vehicleHealthDisplay.js';
import axios from 'axios';
import { savedVahanFields } from '../services/vahanService.js';

// ... (existing imports)

// @desc    Get all vehicles (Admin)
// @route   GET /api/vehicles/all
// @access  Private/Admin
export const getAllVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({}).populate('user', 'name email phone');
    vehicles.forEach(v => v.calculateHealth());
    const out = vehicles.map((v) => {
      const o = v.toObject({ virtuals: true });
      attachHealthPercentDisplay(o);
      return o;
    });
    res.json(out);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get vehicle by ID
// @route   GET /api/vehicles/:id
// @access  Private
export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate('user', 'name email phone');
    if (vehicle) {
      // Check if user is authorized: owner, admin, merchant, or staff
      const isOwner = vehicle.user?._id?.toString() === req.user._id.toString() || 
                      vehicle.user?.toString() === req.user._id.toString();
      const isElevated = ['admin', 'merchant', 'staff'].includes(req.user.role?.toLowerCase());
      
      if (!isOwner && !isElevated) {
        return res.status(403).json({ message: 'Not authorized to view this vehicle' });
      }

      vehicle.calculateHealth();
      const o = vehicle.toObject({ virtuals: true });
      attachHealthPercentDisplay(o);
      res.json(o);
    } else {
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get vehicles by user ID
// @route   GET /api/vehicles/user/:userId
// @access  Private
export const getUserVehicles = async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Check authorization: Owner, Admin, Merchant, or Staff
    const isOwner = userId === req.user._id.toString();
    const isElevated = ['admin', 'merchant', 'staff'].includes(req.user.role?.toLowerCase());
    
    if (!isOwner && !isElevated) {
      return res.status(403).json({ message: 'Not authorized to view these vehicles' });
    }

    const vehicles = await Vehicle.find({ user: userId });
    vehicles.forEach(v => v.calculateHealth());
    const out = vehicles.map((v) => {
      const o = v.toObject({ virtuals: true });
      attachHealthPercentDisplay(o);
      return o;
    });
    res.json(out);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user vehicles
// @route   GET /api/vehicles
// @access  Private
export const getVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ user: req.user._id });
    vehicles.forEach(v => v.calculateHealth());
    const out = vehicles.map((v) => {
      const o = v.toObject({ virtuals: true });
      attachHealthPercentDisplay(o);
      return o;
    });
    res.json(out);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Fetch vehicle RC details from RapidAPI V2
// @route   POST /api/vehicles/rc-details
// @access  Private
export const getVehicleRCDetails = async (req, res) => {
  const { vehicle_number } = req.body;

  if (!vehicle_number) {
    return res.status(400).json({ message: 'Vehicle number is required' });
  }

  // Normalize: No spaces, all uppercase, O -> 0
  const normalizedPlate = vehicle_number.replace(/\s/g, '').toUpperCase().replace(/O/g, '0');

  try {
    const rapidKey = process.env.RAPID_API_KEY || process.env.RAPIDAPI_KEY;
    const rapidHost = process.env.RAPIDAPI_HOST || 'vehicle-rc-information.p.rapidapi.com';
    const rapidUrl = process.env.RAPIDAPI_ENDPOINT || `https://${rapidHost}/advanced`;

    if (!rapidKey) {
      return res.status(500).json({ message: 'RapidAPI key not configured' });
    }

    const options = {
      method: 'POST',
      url: rapidUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': rapidHost,
        'x-rapidapi-key': rapidKey
      },
      data: {
        vehicle_number: normalizedPlate
      }
    };

    const response = await axios.request(options);
    const data = response.data;

    // Based on RapidAPI V2 structure (as per requirement and common patterns)
    if (data && data.status === 'success' && data.data) {
      const rcData = data.data;
      return res.json({
        found: true,
        brand_name: rcData.brand_name || '',
        brand_model: rcData.brand_model || '',
        fuel_type: rcData.fuel_type || '',
        color: rcData.color || '',
        variant: rcData.variant || '',
        engine_number: rcData.engine_number || '',
        chassis_number: rcData.chassis_number || '',
        owner_name: rcData.owner_name || ''
      });
    } else if (data && data.brand_name) {
      // Fallback: Some APIs return data directly without status/data wrapper
      return res.json({
        found: true,
        brand_name: data.brand_name || '',
        brand_model: data.brand_model || '',
        fuel_type: data.fuel_type || '',
        color: data.color || '',
        variant: data.variant || '',
      });
    } else {
      return res.json({
        found: false,
        message: data?.message || 'Vehicle details not found'
      });
    }
  } catch (error) {
    console.error('RapidAPI Error details:', error.response?.data || error.message);
    
    // Detailed error handling for RapidAPI provider issues (502, 503, 504)
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    if (status === 502 || status === 503 || status === 504) {
      return res.status(status).json({ 
        message: 'RapidAPI Provider Error: The vehicle database provider is temporarily unavailable. Please try again after some time or enter details manually.' 
      });
    }
    
    const isHtmlError = typeof errorData === 'string' && errorData.includes('<!DOCTYPE html>');
    const message = isHtmlError 
      ? 'RapidAPI Provider Error: The API provider is currently down or misconfigured. Please try again later.'
      : (errorData?.message || error.message || 'Failed to fetch vehicle details');
      
    res.status(status || 500).json({ message });
  }
};

// @desc    Fetch vehicle details from external API (Mock/Simulated)
// @route   POST /api/vehicles/fetch-details
// @access  Private
export const fetchVehicleDetails = async (req, res) => {
  const { licensePlate } = req.body;

  if (!licensePlate) {
    return res.status(400).json({ message: 'License plate is required' });
  }

  // Normalize license plate (handle common O vs 0 confusion)
  const normalizedPlate = licensePlate.replace(/\s/g, '').toUpperCase().replace(/O/g, '0');

  try {
    // 1. Try RapidAPI if configured
    if (process.env.RAPIDAPI_KEY && process.env.RAPIDAPI_HOST) {
      try {
        
        const options = {
          method: 'GET',
          url: `https://${process.env.RAPIDAPI_HOST}/`,
          params: { registrationNumber: normalizedPlate }, // Changed from license_plate to registrationNumber
          headers: {
            'x-rapidapi-key': process.env.RAPIDAPI_KEY,
            'x-rapidapi-host': process.env.RAPIDAPI_HOST
          }
        };

        const response = await axios.request(options);
        const data = response.data;
         // Log response for debugging

        // Check if API returned valid data
        if (data && (data.make || data.maker_name || data.model || data.maker_model)) {
          const mappedData = {
            make: data.maker_name || data.make || '',
            model: data.maker_model || data.model || '',
            variant: data.variant || data.vehicle_class || '',
            fuelType: data.fuel_type || data.fuel || '',
            year:
              parseInt(data.manufacturing_year) ||
              parseInt(data.reg_date?.split('-')[2]) ||
              new Date().getFullYear(),
            color: data.color || '',
            vin: data.chassis_no || data.vin || '',
            engineNumber: data.engine_no || '',
          };
          return res.json({ found: true, ...mappedData });
        } else {
          return res.json({
            found: false,
            message: 'Vehicle details not found in API',
          });
        }
      } catch (apiError) {
        
        const status = apiError.response?.status;

        if (status === 404) {
          return res.json({
            found: false,
            message: 'Vehicle details not found in API',
          });
        }

        const message =
          apiError.response?.data?.message ||
          apiError.message ||
          'Failed to fetch from RapidAPI';

        return res.status(500).json({ message });
      }
    } else {
      return res.status(500).json({ message: 'RapidAPI not configured' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

// @desc    Add a vehicle
// @route   POST /api/vehicles
// @access  Private
export const addVehicle = async (req, res) => {
  const { licensePlate, make, model, variant, year, fuelType, type, color, image, vin, frontTyres, rearTyres, batteryDetails, pickupDropPrice } = req.body;

  try {
    const vahan = licensePlate ? savedVahanFields(licensePlate) : {};
    const vehicle = new Vehicle({
      ...vahan,
      user: req.user._id,
      licensePlate,
      make,
      model,
      variant,
      year: year || vahan.year,
      fuelType,
      type: type || 'Car',
      color: vahan.color || color,
      image,
      vin,
      frontTyres,
      rearTyres,
      batteryDetails,
      pickupDropPrice
    });

    const createdVehicle = await vehicle.save();

    // Emit vehicle created event
    try {
      const io = (await import('../socket.js')).getIO();
      const payload = {
        vehicleId: createdVehicle._id,
        userId: createdVehicle.user,
        licensePlate: createdVehicle.licensePlate
      };
      io.to('admin').emit('vehicleCreated', payload);
      io.to(`user_${createdVehicle.user}`).emit('vehicleCreated', payload);
      
      // Global Real-time Sync
      emitEntitySync('vehicle', 'created', createdVehicle);
    } catch (err) {
      
    }

    res.status(201).json(createdVehicle);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update vehicle
// @route   PUT /api/vehicles/:id
// @access  Private (owner or admin)
export const updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }

    const isOwner = vehicle.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role?.toLowerCase() === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const {
      licensePlate, make, model, variant, year, fuelType, type, color,
      image, vin, frontTyres, rearTyres, batteryDetails, pickupDropPrice,
    } = req.body;

    if (licensePlate !== undefined) vehicle.licensePlate = licensePlate;
    if (make !== undefined) vehicle.make = make;
    if (model !== undefined) vehicle.model = model;
    if (variant !== undefined) vehicle.variant = variant;
    if (year !== undefined) vehicle.year = year;
    if (fuelType !== undefined) vehicle.fuelType = fuelType;
    if (type !== undefined) vehicle.type = type;
    if (color !== undefined) vehicle.color = color;
    if (image !== undefined) vehicle.image = image;
    if (vin !== undefined) vehicle.vin = vin;
    if (frontTyres !== undefined) vehicle.frontTyres = frontTyres;
    if (rearTyres !== undefined) vehicle.rearTyres = rearTyres;
    if (batteryDetails !== undefined) vehicle.batteryDetails = batteryDetails;
    if (pickupDropPrice !== undefined) vehicle.pickupDropPrice = pickupDropPrice;

    const updatedVehicle = await vehicle.save();

    try {
      const io = (await import('../socket.js')).getIO();
      const payload = { vehicleId: updatedVehicle._id, userId: updatedVehicle.user };
      io.to('admin').emit('vehicleUpdated', payload);
      io.to(`user_${updatedVehicle.user}`).emit('vehicleUpdated', payload);
      emitEntitySync('vehicle', 'updated', updatedVehicle);
    } catch (err) {
      // Non-fatal — the update itself succeeded.
    }

    res.json(updatedVehicle);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete vehicle
// @route   DELETE /api/vehicles/:id
// @access  Private
export const deleteVehicle = async (req, res) => {
  try {
    // console.log('[deleteVehicle] Attempting to delete vehicle with id:', req.params.id);
    // console.log('[deleteVehicle] User id:', req.user._id, 'Role:', req.user.role);

    const vehicle = await Vehicle.findById(req.params.id);

    if (vehicle) {
      // console.log('[deleteVehicle] Found vehicle, owned by:', vehicle.user);
      
      // Get string representations for comparison
      const vehicleUserId = vehicle.user.toString();
      const reqUserId = req.user._id.toString();
      const isOwner = vehicleUserId === reqUserId;
      const isAdmin = req.user.role?.toLowerCase() === 'admin';

      // console.log('[deleteVehicle] isOwner:', isOwner, 'isAdmin:', isAdmin);

      if (!isOwner && !isAdmin) {
        return res.status(401).json({ message: 'Not authorized' });
      }
      const vehicleId = vehicle._id;
      const userId = vehicle.user;

      await Vehicle.findByIdAndDelete(vehicleId);

      // Emit vehicle deleted event
      try {
        const io = (await import('../socket.js')).getIO();
        const payload = {
          vehicleId,
          userId
        };
        io.to('admin').emit('vehicleDeleted', payload);
        io.to(`user_${userId}`).emit('vehicleDeleted', payload);
        
        // Global Real-time Sync
        emitEntitySync('vehicle', 'deleted', { _id: vehicleId, userId });
        // console.log('[deleteVehicle] Vehicle deleted successfully');
      } catch (err) {
        console.error('[deleteVehicle] Socket error:', err);
      }

      res.json({ message: 'Vehicle removed' });
    } else {
      // console.log('[deleteVehicle] Vehicle not found');
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    console.error('[deleteVehicle] Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update vehicle health indicators
// @route   PUT /api/vehicles/:id/health
// @access  Private (Admin/Merchant)
export const updateVehicleHealth = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);

    if (vehicle) {
      // Check if user is merchant or admin
      if (req.user.role !== 'admin' && req.user.role !== 'merchant') {
        return res.status(401).json({ message: 'Not authorized. Only Admin or Merchant can update health stats.' });
      }

      const { healthIndicators } = req.body;
      
      if (healthIndicators) {
        if (!vehicle.healthIndicators) {
          vehicle.healthIndicators = {};
        }

        // Check if it's a complete reset request
        if (healthIndicators.resetAll) {
          const keys = ['generalService', 'brakePads', 'tires', 'battery', 'wiperBlade'];
          keys.forEach(key => {
            vehicle.healthIndicators[key] = {
              value: 0,
              lastUpdated: Date.now(),
              lastServiceDate: null,
              lastServiceKm: 0,
              fixedKm: 0,
              fixedDays: 0
            };
          });
        } else {
          const keys = ['generalService', 'brakePads', 'tires', 'battery', 'wiperBlade'];
          keys.forEach(key => {
            if (healthIndicators[key] !== undefined) {
              const indicator = healthIndicators[key];
              const existing = vehicle.healthIndicators[key] || {};
              
              const fixedKm = typeof indicator === 'object' ? (indicator.fixedKm ?? existing.fixedKm ?? 0) : (existing.fixedKm ?? 0);
              const fixedDays = typeof indicator === 'object' ? (indicator.fixedDays ?? existing.fixedDays ?? 0) : (existing.fixedDays ?? 0);
              const hasInterval = fixedKm > 0 || fixedDays > 0;

              let newValue = typeof indicator === 'object' ? (indicator.value ?? 0) : indicator;
              let lastServiceDate = existing.lastServiceDate;
              let lastServiceKm = existing.lastServiceKm || 0;

              if (hasInterval) {
                newValue = 0; // 0% wear = 100% health
                lastServiceDate = Date.now();
                lastServiceKm = vehicle.mileage || 0;
              } else {
                const isReset = newValue === 0;
                lastServiceDate = isReset || !existing.lastServiceDate ? Date.now() : existing.lastServiceDate;
                lastServiceKm = isReset || !existing.lastServiceDate ? (vehicle.mileage || 0) : (existing.lastServiceKm || 0);
              }

              vehicle.healthIndicators[key] = {
                value: newValue,
                lastUpdated: Date.now(),
                lastServiceDate,
                lastServiceKm,
                fixedKm,
                fixedDays
              };
            }
          });
        }

        // All indicators show 100% after any health save; UI drops 1% per calendar day from this moment.
        vehicle.healthPercentBaselineAt = new Date();
        vehicle.markModified('healthPercentBaselineAt');

        // Mark modified to ensure Mongoose saves the nested object
        vehicle.markModified('healthIndicators');
        const updatedVehicle = await vehicle.save();

        // Emit sync event
        emitEntitySync('vehicle', 'updated', updatedVehicle);

        const o = updatedVehicle.toObject({ virtuals: true });
        attachHealthPercentDisplay(o);
        res.json(o);
      } else {
        res.status(400).json({ message: 'No health indicators provided' });
      }
    } else {
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
