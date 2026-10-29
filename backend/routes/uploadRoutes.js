import express from 'express';
import {
  upload,
  uploadFile,
  uploadFiles,
  generatePresignedUrl,
  getResumeSignedUrl,
  getDownloadSignedUrl,
} from '../controllers/uploadController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { publicUploadLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();

router.get('/presigned-url', protect, generatePresignedUrl);
router.get('/resume/signed-url', protect, admin, getResumeSignedUrl);
router.get('/download-url', protect, getDownloadSignedUrl);

router.post('/', protect, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'File upload failed' });
    }
    next();
  });
}, uploadFile);

router.post('/public', publicUploadLimiter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'File upload failed' });
    }
    next();
  });
}, uploadFile);

router.post('/multiple', protect, (req, res, next) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'File upload failed' });
    }
    next();
  });
}, uploadFiles);

export default router;
