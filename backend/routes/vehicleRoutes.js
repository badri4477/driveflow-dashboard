import express from 'express';
import {
  getVehicles,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  getAllVehicles,
  fetchVehicleDetails,
  getUserVehicles,
  getVehicleById,
  getVehicleRCDetails,
  updateVehicleHealth,
} from '../controllers/vehicleController.js';
import { protect, admin, merchant } from '../middleware/authMiddleware.js';
import { vahanLookup, vahanStatus } from '../controllers/vahanController.js';
import { vahanLookupLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

router.put('/:id/health', protect, updateVehicleHealth);

router.get('/vahan/status', protect, vahanStatus);
router.post('/vahan/lookup', protect, vahanLookupLimiter, vahanLookup);

router.post('/rc-details', protect, getVehicleRCDetails);
router.post('/fetch-details', protect, fetchVehicleDetails);

router.route('/')
  .get(protect, getVehicles)
  .post(protect, addVehicle);

router.route('/all').get(protect, merchant, getAllVehicles);
router.route('/user/:userId').get(protect, getUserVehicles);

router.route('/:id')
  .get(protect, getVehicleById)
  .put(protect, updateVehicle)
  .delete(protect, deleteVehicle);

export default router;
