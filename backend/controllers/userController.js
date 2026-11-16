import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Notification from '../models/Notification.js';
import { sendEmail } from '../utils/emailService.js';
import { getIO } from '../socket.js';
import { emitEntitySync } from '../utils/syncService.js';
import { isValidName, isValidPhone10, hasExcessiveRepeatedChars, isValidEmail } from '../utils/validation.js';
import { isPlaceholderEmail, publicEmail } from '../utils/placeholderEmail.js';

// @desc    Get all users (with optional filtering)
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = async (req, res) => {
  try {
    const query = {};
    if (req.query.role) query.role = req.query.role;
    if (req.query.subRole) query.subRole = req.query.subRole;

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update FCM Token
// @route   POST /api/users/fcm-token
// @access  Private
export const updateFCMToken = async (req, res) => {
  try {
    const { token, deviceType } = req.body;
    if (!token) return res.status(400).json({ message: 'Token is required' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Remove token if it exists elsewhere to avoid duplicate notifications
    await User.updateMany(
      { 'fcmTokens.token': token },
      { $pull: { fcmTokens: { token: token } } }
    );

    // Add or update token for this user
    const tokenIndex = user.fcmTokens.findIndex(t => t.token === token);
    if (tokenIndex > -1) {
      user.fcmTokens[tokenIndex].lastUpdated = Date.now();
      user.fcmTokens[tokenIndex].deviceType = deviceType || user.fcmTokens[tokenIndex].deviceType;
    } else {
      user.fcmTokens.push({ token, deviceType: deviceType || 'android' });
    }

    // Limit tokens per user to 5 to prevent document size issues
    if (user.fcmTokens.length > 5) {
      user.fcmTokens.shift();
    }

    await user.save();
    res.json({ message: 'FCM token updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/users/me
// @access  Private
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').lean();

    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (user) {
      const userId = user._id;
      await user.deleteOne();
      
      // Global Real-time Sync
      emitEntitySync('user', 'deleted', { _id: userId });
      
      res.json({ message: 'User removed' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Self-service account deletion. Permanently removes the user's
//          profile, vehicles, and notifications. Bookings and payments are
//          deliberately kept as-is (orphaned, still pointing at this now-
//          deleted user id) — admin needs them for audits, and since a new
//          signup with the same email/phone gets a fresh user id, none of
//          this old history is reachable from — or attributable to — the
//          "new" account.
// @route   DELETE /api/users/me
// @access  Private
export const deleteMyAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    await Vehicle.deleteMany({ user: userId });
    await Notification.deleteMany({ userId });
    await User.deleteOne({ _id: userId });

    emitEntitySync('user', 'deleted', { _id: userId });

    res.json({ message: 'Account deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
    // Validate name if provided
    if (req.body.name !== undefined) {
      const trimmedName = req.body.name.trim();
      if (!trimmedName) {
        return res.status(400).json({ message: 'Name is required' });
      }
      if (trimmedName.length > 50) {
        return res.status(400).json({ message: 'Name cannot exceed 50 characters' });
      }
      if (!isValidName(trimmedName)) {
        return res.status(400).json({ message: 'Invalid name format' });
      }
      if (hasExcessiveRepeatedChars(trimmedName)) {
        return res.status(400).json({ message: 'Name contains excessive repeated characters' });
      }
      user.name = trimmedName;
    }
    
    const keepPlaceholder = isPlaceholderEmail(user.email) && !String(req.body.email ?? '').trim();
    if (req.body.email !== undefined && !keepPlaceholder) {
      const normalizedEmail = req.body.email.toLowerCase().trim();
      if (user.role === 'staff' && normalizedEmail !== user.email) {
        return res.status(403).json({ message: 'Staff cannot change email address' });
      }
      const emailValidation = isValidEmail(normalizedEmail);
      if (!emailValidation.valid) {
        return res.status(400).json({ message: emailValidation.error || 'Invalid email' });
      }
      user.email = normalizedEmail;
    }
      if (req.body.password) {
        user.password = req.body.password;
      }
      if (req.body.phone !== undefined) {
        const trimmedPhone = req.body.phone.trim();
        if (trimmedPhone) {
          if (!isValidPhone10(trimmedPhone)) {
            return res.status(400).json({ message: 'Enter a valid 10-digit phone number' });
          }
          user.phone = trimmedPhone;
        } else {
          return res.status(400).json({ message: 'Phone number is required' });
        }
      }
      if (req.body.addresses) {
        const seenLabels = new Set();
        for (const addr of req.body.addresses) {
          const normalizedLabel = (addr?.label || '').trim().toLowerCase();
          if (normalizedLabel && seenLabels.has(normalizedLabel)) {
            return res.status(400).json({
              message: `Duplicate address label "${addr.label}". Only one address per label is allowed.`,
            });
          }
          seenLabels.add(normalizedLabel);
        }
        user.addresses = req.body.addresses;
      }
      if (req.body.paymentMethods) {
        user.paymentMethods = req.body.paymentMethods;
      }
      if (typeof req.body.isShopOpen !== 'undefined') {
        user.isShopOpen = req.body.isShopOpen;

        // Emit status update
        try {
          const io = getIO();
          io.to('admin').emit('userStatusUpdate', {
            userId: user._id,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen,
            isShopOpen: user.isShopOpen
          });
        } catch (err) {
          
        }
      }
      if (req.body.location) {
        user.location = req.body.location;
        
        // Emit liveLocation event for real-time map update
        try {
          const io = getIO();
          io.to('admin').emit('liveLocation', {
            userId: user._id,
            role: user.role,
            subRole: user.subRole,
            lat: req.body.location.lat,
            lng: req.body.location.lng,
            timestamp: new Date().toISOString()
          });
        } catch (err) {
          
        }
      }

      const updatedUser = await user.save();

      // Emit user updated event
      try {
        const io = getIO();
        const updatePayload = {
          userId: updatedUser._id,
          name: updatedUser.name,
          email: publicEmail(updatedUser.email),
          role: updatedUser.role,
          phone: updatedUser.phone,
          location: updatedUser.location
        };
        
        io.to('admin').emit('userUpdated', updatePayload);
        io.to(`user_${updatedUser._id}`).emit('userUpdated', updatePayload);
        
        // Global Real-time Sync
        emitEntitySync('user', 'updated', updatedUser);
      } catch (err) {
        
      }

      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: publicEmail(updatedUser.email),
        role: updatedUser.role,
        phone: updatedUser.phone,
        location: updatedUser.location,
        addresses: updatedUser.addresses,
        paymentMethods: updatedUser.paymentMethods,
        token: req.body.token, // Usually we don't return token on update, but preserving if needed
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private/Admin
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user (Admin)
// @route   PUT /api/users/:id
// @access  Private/Admin
export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (user) {
      user.name = req.body.name || user.name;
      const keepPlaceholder = isPlaceholderEmail(user.email) && !String(req.body.email ?? '').trim();
      if (req.body.email !== undefined && !keepPlaceholder) {
        const normalizedEmail = req.body.email.toLowerCase().trim();
        const emailValidation = isValidEmail(normalizedEmail);
        if (!emailValidation.valid) {
          return res.status(400).json({ message: emailValidation.error || 'Invalid email' });
        }
        user.email = normalizedEmail;
      }
      user.phone = req.body.phone || user.phone;
      user.category = req.body.category || user.category;
      
      if (req.body.location) {
        user.location = req.body.location;
      }

      if (req.body.password) {
        user.password = req.body.password;
      }

      const updatedUser = await user.save();

      // Global Real-time Sync
      emitEntitySync('user', 'updated', updatedUser);

      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: publicEmail(updatedUser.email),
        role: updatedUser.role,
        phone: updatedUser.phone,
        category: updatedUser.category,
        location: updatedUser.location,
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user role
// @route   PUT /api/users/:id/role
// @access  Private/Admin
// @desc    Approve user (Garage)
// @route   PUT /api/users/:id/approve
// @access  Private/Admin
export const approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (user) {
      user.isApproved = true;
      user.rejectionReason = null; // Clear any previous rejection
      const updatedUser = await user.save();
      
      // Global Real-time Sync
      emitEntitySync('user', 'updated', updatedUser);
      
      res.json(updatedUser);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reject user
// @route   PUT /api/users/:id/reject
// @access  Private/Admin
export const rejectUser = async (req, res) => {
  const { reason } = req.body;
  try {
    const user = await User.findById(req.params.id);
    if (user) {
      user.isApproved = false;
      user.rejectionReason = reason;
      const updatedUser = await user.save();
      
      // Global Real-time Sync
      emitEntitySync('user', 'updated', updatedUser);
      
      res.json(updatedUser);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUserRole = async (req, res) => {
  const { role, subRole, status } = req.body;
  try {
    const user = await User.findById(req.params.id);
    if (user) {
      if (role) user.role = role;
      if (subRole !== undefined) user.subRole = subRole;
      if (status) user.status = status;
      const updatedUser = await user.save();

      // Emit socket event for real-time role update
      try {
        const io = getIO();
        io.to(`user_${updatedUser._id}`).emit('user_role_updated', {
          _id: updatedUser._id,
          role: updatedUser.role,
          subRole: updatedUser.subRole,
          status: updatedUser.status
        });
        
        // Global Real-time Sync
        emitEntitySync('user', 'updated', updatedUser);
      } catch (err) {
        console.error('Socket emit error on role update:', err);
      }

      res.json(updatedUser);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const queueWelcomeEmail = ({ name, email, password, role }) => {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return;

  const readableRole = role === 'merchant' ? 'Merchant' : role === 'staff' ? 'Staff' : 'User';
  const subject = `Welcome to Carzzi - ${readableRole} Account Created`;
  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Your ${readableRole.toLowerCase()} account has been created on Carzzi.`,
    '',
    `Login Email: ${email}`,
    password ? `Temporary Password: ${password}` : '',
    '',
    'Please log in and change your password after first login.',
    '',
    'Best regards,',
    'Carzzi Team',
  ]
    .filter(Boolean)
    .join('\n');

  setImmediate(() => {
    sendEmail(email, subject, text).catch(() => {});
  });
};

// @desc    Create new user (Admin only)
// @route   POST /api/users
// @access  Private/Admin
export const createUser = async (req, res) => {
  const { name, email, password, role, subRole, phone, location, category } = req.body;
  
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const emailValidation = isValidEmail(normalizedEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({ message: emailValidation.error || 'Invalid email' });
    }
    
    const userExists = await User.exists({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ message: 'Email already exists.' });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role,
      subRole,
      phone,
      location,
      category,
      isApproved: true
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid user data' });
    }

    queueWelcomeEmail({ name, email, password, role });

    const safeUser = await User.findById(user._id).select('-password').lean();
    emitEntitySync('user', 'created', safeUser);

    res.status(201).json(safeUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update online status
// @route   PUT /api/users/online-status
// @access  Private
export const updateOnlineStatus = async (req, res) => {
  const { isOnline } = req.body;
  
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    
    
    const user = await User.findById(req.user._id);
    
    if (user) {
      user.isOnline = isOnline;
      if (isOnline) {
        user.lastSeen = Date.now();
      }
      
      await user.save();
      

      // Emit socket event for real-time status update
      try {
        const io = getIO();
        io.to('admin').emit('userStatusUpdate', {
            userId: user._id,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen,
            isShopOpen: user.isShopOpen,
            location: user.location
        });
        
      } catch (err) {
        
      }

      res.json({ 
        message: 'Status updated', 
        isOnline: user.isOnline,
        lastSeen: user.lastSeen 
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    
    res.status(500).json({ message: error.message, stack: error.stack });
  }
};

// Device token APIs removed – push notifications disabled

