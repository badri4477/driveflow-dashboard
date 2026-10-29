import ApprovalRequest from '../models/ApprovalRequest.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { getIO, emitChatMessage } from '../socket.js';
import { emitBookingUpdate, calculateServicesTotal } from './bookingController.js';
import { emitEntitySync } from '../utils/syncService.js';

import { sendPushToUser } from '../utils/pushService.js';
import { sendEmail } from '../utils/emailService.js';
import { getBookingStatusEmail } from '../utils/emailTemplates.js';

import Message from '../models/Message.js';

// @desc    Get all approval requests
// @route   GET /api/approvals
// @access  Private/Admin
export const getApprovals = async (req, res) => {
  try {
    const approvals = await ApprovalRequest.find({})
      .populate('requestedBy', 'name email role')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 });
    
    // We need to populate relatedId dynamically based on relatedModel
    // Mongoose's populate with refPath should handle this if set up correctly,
    // but we can also do it manually if needed. 
    // Let's try explicit population.
    const populatedApprovals = await ApprovalRequest.populate(approvals, {
      path: 'relatedId',
      select: 'name email make model licensePlate status totalAmount orderNumber' // Fields for User and Booking
    });

    res.json(populatedApprovals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get my approvals (User)
// @route   GET /api/approvals/my-approvals
// @access  Private
export const getMyApprovals = async (req, res) => {
  try {
    let bookingIds = [];
    let userId = null;

    if (req.user) {
      userId = req.user._id;
      const BookingModel = (await import('../models/Booking.js')).default;
      const bookings = await BookingModel.find({ user: req.user._id }).select('_id');
      bookingIds = bookings.map(b => b._id);
    }

    const { bookingId } = req.query;
    if (bookingId) {
      bookingIds.push(bookingId);
    }

    const queryConditions = [];
    if (bookingIds.length > 0) {
      queryConditions.push({ relatedModel: 'Booking', relatedId: { $in: bookingIds } });
    }
    if (userId) {
      queryConditions.push({ relatedModel: 'User', relatedId: userId });
    }

    if (queryConditions.length === 0) {
      return res.json([]);
    }

    const approvals = await ApprovalRequest.find({
      $or: queryConditions
    }).sort({ createdAt: -1 });

    res.json(approvals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create an approval request
// @route   POST /api/approvals
// @access  Private (Merchant/Staff)
export const createApproval = async (req, res) => {
  const { type, relatedId, relatedModel, data } = req.body;

  try {
    // Check if a pending approval already exists for this part in the same booking
    if (type === 'PartReplacement' && relatedModel === 'Booking') {
      const existing = await ApprovalRequest.findOne({
        type: 'PartReplacement',
        relatedId,
        relatedModel: 'Booking',
        status: 'Pending',
        'data.name': data.name,
        'data.price': Number(data.price),
        'data.quantity': Number(data.quantity || 1)
      });
      if (existing) {
        return res.status(200).json(existing); // Return existing instead of creating new
      }
    }

    const approval = new ApprovalRequest({
      type,
      relatedId,
      relatedModel,
      data,
      requestedBy: req.user._id,
    });

    const createdApproval = await approval.save();

    // Notify customer
    if (relatedModel === 'Booking') {
      const booking = await Booking.findById(relatedId).populate('user merchant');
      if (booking && booking.user) {
        const io = getIO();
        const userId = booking.user._id.toString();
        
        // Single emit across all rooms — Socket.IO delivers once per socket
        // even if it's in several of these rooms (separate emits duplicated
        // the toast for a customer in both user_ and booking_ rooms).
        const rooms = [`user_${userId}`, `booking_${relatedId}`, 'admin'];
        if (booking.merchant) {
          rooms.push(`user_${booking.merchant._id.toString()}`, 'merchant');
        }
        io.to(rooms).emit('newApproval', createdApproval);

        // Also emit bookingUpdated to trigger a full refresh on clients
        const fullBooking = await Booking.findById(relatedId)
          .populate('user', 'id name email phone')
          .populate('vehicle')
          .populate('services')
          .populate('merchant', 'name email phone location')
          .populate('pickupDriver', 'name email phone')
          .populate('technician', 'name email phone');
        if (fullBooking) {
            emitBookingUpdate(fullBooking);
        }

        // Create a chat message for this approval
        const chatMessage = new Message({
          bookingId: relatedId,
          sender: req.user._id,
          text: `Approval required for part: ${data.name || 'Unnamed Additional Part'} - Amount: ₹${Number(data.price) * Number(data.quantity || 1)}`,
          type: 'approval',
          recipientRole: 'all', // Explicitly set to all so it reflects everywhere
          approval: {
            partName: data.name || 'Unnamed Additional Part',
            amount: Number(data.price) * Number(data.quantity || 1),
            status: 'pending',
            approvalId: createdApproval._id,
            image: data.image
          }
        });
        await chatMessage.save();
        const populatedChatMessage = await chatMessage.populate('sender', '_id name role');
        emitChatMessage(relatedId, populatedChatMessage);

        // Mobile push — merchant approval with part/cost details + tray actions
        const orderNum =
          booking.orderNumber || relatedId.toString().slice(-6).toUpperCase();
        const qty = Number(data?.quantity || 1);
        const unitPrice = Number(
          data?.price ?? data?.amount ?? data?.newAmount ?? 0
        );
        const totalAmount =
          type === 'BillEdit'
            ? Number(data?.newAmount ?? unitPrice)
            : type === 'ExtraCost'
              ? unitPrice
              : unitPrice * qty;
        const partName =
          data?.name || (type === 'ExtraCost' ? 'Extra cost' : 'Additional part');
        const imagePath = data?.image ? String(data.image) : '';
        const imageNote = imagePath ? ' Photo attached — view in app.' : '';

        let pushBody = `Booking #${orderNum}: approval requested.`;
        if (type === 'PartReplacement') {
          pushBody = `Booking #${orderNum}: ${partName} · Qty ${qty} · ₹${totalAmount.toLocaleString('en-IN')} total.${imageNote} Tap Accept or Reject.`;
        } else if (type === 'ExtraCost') {
          const reason = data?.reason ? ` (${data.reason})` : '';
          pushBody = `Booking #${orderNum}: extra cost ₹${totalAmount.toLocaleString('en-IN')}${reason}.${imageNote} Tap Accept or Reject.`;
        } else if (type === 'BillEdit') {
          pushBody = `Booking #${orderNum}: bill update to ₹${totalAmount.toLocaleString('en-IN')}.${imageNote} Tap Accept or Reject.`;
        }

        await sendPushToUser(
          userId,
          'Merchant Approvals',
          pushBody,
          {
            type: 'merchant_approval',
            bookingId: relatedId.toString(),
            approvalId: createdApproval._id.toString(),
            approvalType: type,
            partName,
            quantity: String(qty),
            unitPrice: String(unitPrice),
            totalAmount: String(totalAmount),
            image: imagePath,
          },
          'order',
          { dataOnly: true }
        );

        if (booking.user.email) {
          const orderRef =
            booking.orderNumber || relatedId.toString().slice(-8).toUpperCase();
          const estimateEmail = getBookingStatusEmail('ESTIMATE_APPROVAL_REQUIRED', {
            customerName: booking.user.name,
            bookingId: orderRef,
            vehicleNumber: booking.vehicle?.licensePlate,
            amount: totalAmount,
          });
          void sendEmail(
            booking.user.email,
            estimateEmail.subject,
            estimateEmail.text,
            estimateEmail.html
          ).catch(() => {});
        }

        // Global Real-time Sync
        emitEntitySync('approval', 'created', createdApproval);
      }
    }

    res.status(201).json(createdApproval);
  } catch (error) {
    
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update approval status (Approve/Reject)
// @route   PUT /api/approvals/:id
// @access  Private/Admin/User
export const updateApprovalStatus = async (req, res) => {
  let { status, adminComment } = req.body;

  // Normalize status for consistency (e.g., 'approved' -> 'Approved')
  if (status) {
    status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  try {
    const approval = await ApprovalRequest.findById(req.params.id);

    if (!approval) {
      return res.status(404).json({ message: 'Approval request not found' });
    }

    // Check authorization
    let isAuthorized = false;
    let resolvedBy = null;

    if (req.user) {
      resolvedBy = req.user._id;
      if (req.user.role === 'admin') {
        isAuthorized = true;
      } else {
        // Check if user owns the related resource
        if (approval.relatedModel === 'Booking') {
          const booking = await Booking.findById(approval.relatedId);
          if (booking && booking.user.toString() === req.user._id.toString()) {
            isAuthorized = true;
          }
        } else if (approval.relatedModel === 'User') {
          if (approval.relatedId.toString() === req.user._id.toString()) {
            isAuthorized = true;
          }
        }
      }
    } else {
      // Unauthenticated request (e.g. guest customer on tracking page)
      if (approval.relatedModel === 'Booking') {
        const booking = await Booking.findById(approval.relatedId);
        if (booking) {
          isAuthorized = true;
          resolvedBy = booking.user; // Resolve as the customer of the booking
        }
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({ message: 'Not authorized to update this approval' });
    }

    if (approval.status !== 'Pending') {
      return res.status(400).json({ message: 'Request is already resolved' });
    }

    approval.status = status;
    approval.adminComment = adminComment;
    approval.resolvedAt = Date.now();
    approval.resolvedBy = resolvedBy;

    // Update corresponding chat message
    try {
        const chatMessage = await Message.findOne({ 'approval.approvalId': approval._id });
        if (chatMessage) {
            chatMessage.approval.status = status.toLowerCase();
            if (status === 'Rejected' && adminComment) {
                chatMessage.text = `${chatMessage.text}\nRejection Reason: ${adminComment}`;
            }
            await chatMessage.save();
            const populated = await chatMessage.populate('sender', '_id name role');
            emitChatMessage(approval.relatedId, populated);
        }

        // Post a new message in the chat box to reflect the outcome and rejection reason
        const booking = await Booking.findById(approval.relatedId);
        const partName = approval.data?.name || 'Additional Part';
        const senderId = resolvedBy || (booking ? booking.user : null) || req.user?._id;

        if (senderId) {
            if (status === 'Rejected') {
                const rejectionText = `❌ Rejected part request: ${partName}${adminComment ? ` - Reason: ${adminComment}` : ''}`;
                const rejectionMessage = new Message({
                    bookingId: approval.relatedId,
                    sender: senderId,
                    text: rejectionText,
                    type: 'text',
                    recipientRole: 'all'
                });
                await rejectionMessage.save();
                const populatedRejection = await rejectionMessage.populate('sender', '_id name role');
                emitChatMessage(approval.relatedId, populatedRejection);
            } else if (status === 'Approved') {
                const approvalText = `✅ Approved part request: ${partName}`;
                const approvalMessage = new Message({
                    bookingId: approval.relatedId,
                    sender: senderId,
                    text: approvalText,
                    type: 'text',
                    recipientRole: 'all'
                });
                await approvalMessage.save();
                const populatedApproval = await approvalMessage.populate('sender', '_id name role');
                emitChatMessage(approval.relatedId, populatedApproval);
            }
        }
    } catch (err) {
        console.error('Error updating chat message for approval:', err);
    }

    if (status === 'Approved') {
      // Execute the logic based on type
      if (approval.type === 'BillEdit' && approval.relatedModel === 'Booking') {
        const booking = await Booking.findById(approval.relatedId);
        if (booking && approval.data?.newAmount) {
          booking.totalAmount = approval.data.newAmount;
          booking.finalAmount = Math.max(0, booking.totalAmount - (booking.discountAmount || 0));
          await booking.save();
          
          const populated = await Booking.findById(booking._id)
            .populate('user', 'id name email phone')
            .populate('vehicle')
            .populate('services')
            .populate('merchant', 'name email phone location')
            .populate('pickupDriver', 'name email phone')
            .populate('technician', 'name email phone');
          emitBookingUpdate(populated);
        }
      } else if (approval.type === 'PartReplacement' && approval.relatedModel === 'Booking') {
        const booking = await Booking.findById(approval.relatedId);
        if (booking) {
          const { name, price, quantity, image, oldImage } = approval.data;
          const searchName = (name || 'Unnamed Additional Part').trim().toLowerCase();

          // 1. Update inspection.additionalParts
          let partFound = false;
          if (booking.inspection && booking.inspection.additionalParts) {
            const partIndex = booking.inspection.additionalParts.findIndex(p => {
              const pName = (p.name || 'Unnamed Additional Part').trim().toLowerCase();
              return pName === searchName && 
                     Number(p.price) === Number(price) && 
                     Number(p.quantity) === Number(quantity);
            });
            
            if (partIndex >= 0) {
              booking.inspection.additionalParts[partIndex].approved = true;
              booking.inspection.additionalParts[partIndex].approvalStatus = 'Approved';
              booking.inspection.additionalParts[partIndex].price = Number(price);
              booking.inspection.additionalParts[partIndex].quantity = Number(quantity);
              if (image) booking.inspection.additionalParts[partIndex].image = image;
              if (oldImage) booking.inspection.additionalParts[partIndex].oldImage = oldImage;
              partFound = true;
            }
          }

          if (!partFound) {
            if (!booking.inspection) booking.inspection = {};
            if (!booking.inspection.additionalParts) booking.inspection.additionalParts = [];
            booking.inspection.additionalParts.push({ 
                name: name || 'Unnamed Additional Part', 
                price: Number(price), 
                quantity: Number(quantity), 
                approved: true, 
                approvalStatus: 'Approved', 
                image, 
                oldImage 
            });
          }

          // 2. Add to booking.parts (which affects billing)
          if (!booking.parts) booking.parts = [];

          // Check if part already exists in booking.parts to avoid duplicates if approved multiple times?
          // But status check prevents multiple approvals.
          booking.parts.push({ 
              name: name || 'Unnamed Additional Part', 
              price: Number(price), 
              quantity: Number(quantity),
              image: image 
          });

          // 3. Recalculate totalAmount
          const { total: servicesTotal } = await calculateServicesTotal(booking.services, booking.vehicle, booking.selectedBrands, booking.serviceQuantities);

          const partsTotal = booking.parts.reduce((acc, part) => acc + (Number(part.price) * Number(part.quantity)), 0);

          const labourCost = Number(booking.billing?.labourCost || 0);
          const gst = Number(booking.billing?.gst || 0);
          const pickupDropPrice = Number(booking.billing?.pickupDropPrice || booking.pickupDropPrice || 0);

          const newTotal = servicesTotal + partsTotal + labourCost + gst + pickupDropPrice;
          booking.totalAmount = newTotal;
          booking.finalAmount = Math.max(0, newTotal - (booking.discountAmount || 0));

          // Update billing if exists
          if (booking.billing) {
            booking.billing.partsTotal = partsTotal;
            booking.billing.total = newTotal;
          }

          booking.markModified('inspection');
          booking.markModified('parts');
          if (booking.billing) booking.markModified('billing');
          
          await booking.save();
          
          const populated = await Booking.findById(booking._id)
            .populate('user', 'id name email phone')
            .populate('vehicle')
            .populate('services')
            .populate('merchant', 'name email phone location')
            .populate('pickupDriver', 'name email phone')
            .populate('technician', 'name email phone');
          emitBookingUpdate(populated);
        }
      } else if (approval.type === 'ExtraCost' && approval.relatedModel === 'Booking') {
        const booking = await Booking.findById(approval.relatedId);
        if (booking) {
          const { amount, reason } = approval.data;
          
          // Update billing
          if (!booking.billing) {
            booking.billing = {
              labourCost: 0,
              gst: 0,
              partsTotal: 0,
              total: 0
            };
          }
          
          booking.billing.labourCost = (booking.billing.labourCost || 0) + Number(amount);
          
          // Recalculate billing total
          const { total: servicesTotal } = await calculateServicesTotal(booking.services, booking.vehicle, booking.selectedBrands, booking.serviceQuantities);

          const partsTotal = booking.billing.partsTotal || 0;
          const labourCost = booking.billing.labourCost;
          const gst = booking.billing.gst || 0;
          const pickupDropPrice = booking.billing.pickupDropPrice || 0;
          
          booking.billing.total = servicesTotal + partsTotal + labourCost + gst + pickupDropPrice;
          
          // Update main totalAmount
          booking.totalAmount = (booking.totalAmount || 0) + Number(amount);
          booking.finalAmount = Math.max(0, booking.totalAmount - (booking.discountAmount || 0));
          
          // Add note
          const note = `Extra Cost Approved: ${reason} - $${amount}`;
          booking.notes = booking.notes ? booking.notes + '\n' + note : note;
          
          await booking.save();
          
          const populated = await Booking.findById(booking._id)
            .populate('user', 'id name email phone')
            .populate('vehicle')
            .populate('services')
            .populate('merchant', 'name email phone location')
            .populate('pickupDriver', 'name email phone')
            .populate('technician', 'name email phone');
          emitBookingUpdate(populated);
        }
      }
    } else if (status === 'Rejected') {
      if (approval.type === 'PartReplacement' && approval.relatedModel === 'Booking') {
        const booking = await Booking.findById(approval.relatedId);
        if (booking && booking.inspection && Array.isArray(booking.inspection.additionalParts)) {
          const { name, price, quantity } = approval.data || {};
          const searchName = (name || 'Unnamed Additional Part').trim().toLowerCase();

          const partIndex = booking.inspection.additionalParts.findIndex(p => {
            const pName = (p.name || 'Unnamed Additional Part').trim().toLowerCase();
            return pName === searchName && 
                   Number(p.price) === Number(price) && 
                   Number(p.quantity) === Number(quantity);
          });

          if (partIndex >= 0) {
            booking.inspection.additionalParts[partIndex].approved = false;
            booking.inspection.additionalParts[partIndex].approvalStatus = 'Rejected';
            booking.inspection.additionalParts[partIndex].rejectionReason = adminComment;
            await booking.save();
            
            const populated = await Booking.findById(booking._id)
                .populate('user', 'id name email phone')
                .populate('vehicle')
                .populate('services')
                .populate('merchant', 'name email phone location')
                .populate('pickupDriver', 'name email phone')
                .populate('technician', 'name email phone');
            emitBookingUpdate(populated);
          }
        }
      }
      // Other types (ExtraCost, BillEdit) do not change booking data on rejection for now
    }

    const updatedApproval = await approval.save();

    if (status === 'Approved' && approval.relatedModel === 'Booking') {
      try {
        const emailBooking = await Booking.findById(approval.relatedId)
          .populate('user', 'id name email phone')
          .populate('vehicle');
        if (emailBooking?.user?.email) {
          const orderRef =
            emailBooking.orderNumber || String(emailBooking._id).slice(-8).toUpperCase();
          const approvedEmail = getBookingStatusEmail('ESTIMATE_APPROVED', {
            customerName: emailBooking.user.name,
            bookingId: orderRef,
            vehicleNumber: emailBooking.vehicle?.licensePlate,
            amount: emailBooking.finalAmount ?? emailBooking.totalAmount,
          });
          void sendEmail(
            emailBooking.user.email,
            approvedEmail.subject,
            approvedEmail.text,
            approvedEmail.html
          ).catch(() => {});
        }
      } catch (_) {}
    }

    // Global Real-time Sync
    emitEntitySync('approval', 'updated', updatedApproval);

    res.json(updatedApproval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

