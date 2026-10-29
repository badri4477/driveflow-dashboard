import express from 'express';
import {
  createReview,
  getAllReviews,
  getTargetReviews,
  getBookingReviews,
  getMyReviews,
  deleteReview,
  getPublicReviews,
  updateReviewStatus,
} from '../controllers/reviewController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/public', getPublicReviews);
router.post('/', protect, createReview);
router.get('/my', protect, getMyReviews);
router.get('/myreviews', protect, getMyReviews);
router.get('/all', protect, admin, getAllReviews);
router.get('/booking/:bookingId', protect, getBookingReviews);
router.get('/target/:targetId', protect, getTargetReviews);
router.put('/:id/status', protect, admin, updateReviewStatus);
router.delete('/:id', protect, admin, deleteReview);

export default router;
