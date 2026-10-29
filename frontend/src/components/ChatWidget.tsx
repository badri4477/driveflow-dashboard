import React, { useState, useEffect, useRef } from 'react';
import { MessagesSquare, Send, X, Minimize2, Maximize2, Plus, AlertTriangle } from 'lucide-react';
import { socketService } from '@/services/socket';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { updateApprovalStatus } from '@/services/approvalService';
import { toast } from 'sonner';
import { MAX_CHAT_MESSAGE_LENGTH, validateChatMessage } from '@/lib/formValidation';
import AddPartModal from './merchant/AddPartModal';
import { useLocation } from 'react-router-dom';

const CARZZI_GREETING_MESSAGE = `Hi 👋 Hope you’re doing well! 
Welcome to Carzzi Support Chat  🚗 
Through this chat, you can easily communicate with your assigned merchant regarding your requests. You will also receive updates here about the approval or rejection of parts  submitted. 
If you have any questions, need assistance, or want to follow up on a request, feel free to message here anytime — we’re here to help you! 
Thank you for choosing Carzzi 🙌`;

// This should ideally come from a config or backend, but for now, we'll use a placeholder
const CARZZI_SENDER_ID = 'carzzi-system-user';
const CARZZI_SENDER_NAME = 'Carzzi';
const CARZZI_SENDER_ROLE = 'system';

interface Message {
  _id: string;
  bookingId: string;
  sender: {
    _id: string;
    name: string;
    role: string;
  };
  text: string;
  type?: 'text' | 'approval';
  recipientRole?: 'all' | 'customer' | 'merchant';
  approval?: {
    partName: string;
    amount: number;
    status: 'pending' | 'approved' | 'rejected';
    approvalId: string;
    image?: string;
  };
  createdAt: string;
  senderId?: string;
  senderName?: string;
  senderRole?: string;
}

interface ChatWidgetProps {
  bookingId: string;
  status: string;
  onUpdate?: () => void;
  /** When true, the FAB is not rendered and sockets are not joined (general workshop before service start). */
  forceHidden?: boolean;
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ bookingId, status, onUpdate, forceHidden = false }) => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isPartModalOpen, setIsPartModalOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(socketService.isConnected());
  const [hasSentGreeting, setHasSentGreeting] = useState(false);
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null);
  const { user } = useAuthStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use refs to track isOpen and isMinimized for socket callbacks
  const isOpenRef = useRef(isOpen);
  const isMinimizedRef = useRef(isMinimized);

  // Last time this user viewed this booking's chat, persisted so the unread
  // badge survives refreshes instead of resetting to "all messages".
  const lastSeenKey = `chat_last_seen_${bookingId}_${user?._id ?? 'anon'}`;
  const readLastSeen = () => {
    try {
      return Number(localStorage.getItem(lastSeenKey)) || 0;
    } catch {
      return 0;
    }
  };
  const markSeen = () => {
    try {
      localStorage.setItem(lastSeenKey, String(Date.now()));
    } catch {
      // storage unavailable — badge just won't persist
    }
  };
  const isOwnMessage = (msg: any) =>
    user ? String(msg?.sender?._id) === String(user._id) : msg?.sender?.role === 'customer';
  const countUnread = (msgs: any[]) => {
    const lastSeen = readLastSeen();
    return msgs.filter((m) => !isOwnMessage(m) && new Date(m.createdAt || 0).getTime() > lastSeen).length;
  };

  useEffect(() => {
    isOpenRef.current = isOpen;
    isMinimizedRef.current = isMinimized;

    // Reset unread count when chat is opened and not minimized
    if (isOpen && !isMinimized) {
      setUnreadCount(0);
      markSeen();
    }
  }, [isOpen, isMinimized]);

  useEffect(() => {
    const handleStatus = () => setIsConnected(socketService.isConnected());
    socketService.on('connect', handleStatus);
    socketService.on('disconnect', handleStatus);
    // Initial check
    handleStatus();

    return () => {
      socketService.off('connect', handleStatus);
      socketService.off('disconnect', handleStatus);
    };
  }, []);

  const isEnabled = ![
    'CREATED',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED'
  ].includes(status);
  const isAdminOrStaffDashboard =
    (location.pathname === '/admin/dashboard' || location.pathname === '/staff/dashboard' || location.pathname === '/dashboard') &&
    (user?.role === 'admin' || user?.role === 'staff');

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const chatActive = isEnabled && !forceHidden;

  useEffect(() => {
    if (!chatActive) {
      setIsOpen(false);
      return;
    }

    socketService.connect();
    socketService.joinRoom(`booking_${bookingId}`);

    const handleReceiveMessage = (message: any) => {
      // Filter out messages not meant for the current user's role
      const role = user?.role || 'customer';
      const msgRecipientRole = message.recipientRole;

      if (msgRecipientRole === 'customer') {
        if (role === 'merchant' || role === 'staff') {
          return;
        }
      } else if (msgRecipientRole === 'merchant') {
        if (role === 'customer') {
          return;
        }
      }

      setMessages((prev) => {
        // 1. Check if we already have this message (by real ID)
        const existingIndex = prev.findIndex(m => m._id === message._id);
        if (existingIndex !== -1) {
          const newMessages = [...prev];
          newMessages[existingIndex] = message;
          return newMessages;
        }

        // 2. Check if this is a message we sent (matching text and sender) to replace temp
        const tempIndex = prev.findIndex(m => {
          const isTemp = m._id.startsWith('temp_');
          const textMatches = m.text.trim() === message.text.trim();
          const senderMatches = String(m.sender._id) === String(message.sender._id);
          return isTemp && textMatches && senderMatches;
        });

        if (tempIndex !== -1) {
          const newMessages = [...prev];
          newMessages[tempIndex] = message;
          return newMessages;
        }

        // Only increment unread if not self and chat is closed or minimized
        if (!isOwnMessage(message)) {
          if (!isOpenRef.current || isMinimizedRef.current) {
            setUnreadCount(prev => prev + 1);
          } else {
            markSeen();
          }
        }

        return [...prev, message];
      });
    };

    const handleLoadMessages = (loadedMessages: any[]) => {
      const role = user?.role || 'customer';
      const filteredMessages = loadedMessages.filter((msg: any) => {
        if (msg.recipientRole === 'customer') {
          return role !== 'merchant' && role !== 'staff';
        }
        if (msg.recipientRole === 'merchant') {
          return role !== 'customer';
        }
        return true;
      });

      setMessages(filteredMessages);
      // Only messages from others that arrived after the last view are unread.
      if (!isOpenRef.current || isMinimizedRef.current) {
        setUnreadCount(countUnread(filteredMessages));
      } else {
        markSeen();
      }
    };

    const handleSyncMessages = () => {
      socketService.emit('getMessages', { bookingId });
    };

    socketService.on('receiveMessage', handleReceiveMessage);
    socketService.on('loadMessages', handleLoadMessages);
    socketService.on('bookingUpdated', handleSyncMessages);
    socketService.on('newApproval', handleSyncMessages);

    // Emit after listeners are attached
    socketService.emit('getMessages', { bookingId });

    return () => {
      socketService.off('receiveMessage', handleReceiveMessage);
      socketService.off('loadMessages', handleLoadMessages);
      socketService.off('bookingUpdated', handleSyncMessages);
      socketService.off('newApproval', handleSyncMessages);
      socketService.leaveRoom(`booking_${bookingId}`);
    };
  }, [bookingId, chatActive]);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      // Multiple attempts to scroll to ensure it works after animation and image loads
      const timer1 = setTimeout(scrollToBottom, 100);
      const timer2 = setTimeout(scrollToBottom, 300);
      const timer3 = setTimeout(scrollToBottom, 600);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [isOpen, isMinimized, messages]);

  if (!chatActive || isAdminOrStaffDashboard) return null;

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateChatMessage(inputText);
    if (!validation.valid) {
      toast.error(validation.error || 'Invalid message');
      return;
    }

    const trimmedText = inputText.trim();

    socketService.emit('sendMessage', {
      bookingId,
      text: trimmedText,
    });

    // Optimistically add the message to the UI
    const tempId = `temp_${Date.now()}`;
    const newMessage: Message = {
      _id: tempId,
      bookingId,
      sender: {
        _id: user?._id || 'guest-user',
        name: user?.name || 'Customer',
        role: user?.role || 'customer',
      },
      text: trimmedText,
      createdAt: new Date().toISOString(),
      senderId: user?._id || 'guest-user',
      senderName: user?.name || 'Customer',
      senderRole: user?.role || 'customer',
    };
    setMessages((prev) => [...prev, newMessage]);

    setInputText('');
  };

  const handleApprove = async (approvalId: string) => {
    if (processingApprovalId) return;
    setProcessingApprovalId(approvalId);
    try {
      await updateApprovalStatus(approvalId, 'Approved');
      toast.success('Part approved');
      if (onUpdate) onUpdate();
    } catch (err) {
      toast.error('Failed to approve part');
    } finally {
      setProcessingApprovalId(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    if (processingApprovalId) return;
    const reason = window.prompt('Please provide a reason for rejection (optional):');
    if (reason === null) return;
    setProcessingApprovalId(approvalId);
    try {
      await updateApprovalStatus(approvalId, 'Rejected', reason || undefined);
      toast.success('Part rejected');
      if (onUpdate) onUpdate();
    } catch (err) {
      toast.error('Failed to reject part');
    } finally {
      setProcessingApprovalId(null);
    }
  };

  return (
    <>
      {isPartModalOpen && (
        <AddPartModal
          bookingId={bookingId}
          onClose={() => setIsPartModalOpen(false)}
          onUpdate={() => {
            if (onUpdate) onUpdate();
          }}
        />
      )}
      <div className="fixed bottom-6 right-6 z-[720] flex flex-col items-end">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
                height: isMinimized ? '44px' : '400px'
              }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden mb-3 transition-all duration-300",
                "w-[280px] sm:w-[320px]"
              )}
            >
              {/* Header */}
              <div className="px-3 py-2 bg-primary text-primary-foreground flex items-center justify-between shadow-sm min-h-[44px] relative w-full">
                {/* Left side: Connection status */}
                <div className="flex items-center gap-2 relative z-10">
                  <div className="relative">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      isConnected ? "bg-green-400 animate-pulse" : "bg-red-400"
                    )} />
                    {isConnected && (
                      <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-20" />
                    )}
                  </div>
                  {!isConnected && <span className="text-[8px] font-medium opacity-80 uppercase tracking-widest">(Offline)</span>}
                </div>

                {/* Center: Service Chat title */}
                <h3 className="font-bold text-xs tracking-tight absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                  Service Chat
                </h3>

                {/* Right side: Placeholder for balance */}
                <div className="w-8 h-8 relative z-10" />
              </div>

              {!isMinimized && (
                <>
                  {/* Messages */}
                  <div
                    ref={scrollRef}
                    className="flex-1 w-full overflow-y-auto p-2.5 space-y-2.5 bg-muted/20"
                  >
                    {messages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted-foreground/60">
                        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center mb-2">
                          <MessagesSquare className="w-5 h-5 opacity-40" />
                        </div>
                        <p className="text-[10px] font-medium">Start a conversation.</p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isSelf = user ? (msg.sender._id === user._id) : (msg.sender.role === 'customer');
                        return (
                          <div
                            key={msg._id}
                            className={cn("flex w-full min-w-0", isSelf ? "justify-end" : "justify-start")}
                          >
                            <div className={cn(
                              "max-w-[75%] min-w-0 shrink p-2 rounded-xl shadow-sm overflow-hidden",
                              isSelf
                                ? "bg-primary text-primary-foreground rounded-br-sm"
                                : "bg-card border border-border/50 text-foreground rounded-bl-sm"
                            )}>
                              {!isSelf && (msg.sender.role === 'system' || msg.sender.role === 'merchant' || msg.sender.role === 'admin') && (
                                <p className="text-[8px] font-bold mb-0.5 opacity-70 uppercase tracking-tight break-words">
                                  {msg.sender.role === 'admin' ? 'Carzii' : msg.sender.name}
                                </p>
                              )}
                              <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</p>
                              {msg.type === 'approval' && msg.approval && (
                                <div className={cn(
                                  "mt-2 p-2.5 rounded-lg border transition-all",
                                  msg.approval.status === 'pending'
                                    ? "bg-yellow-500/5 border-yellow-500/20"
                                    : msg.approval.status === 'approved'
                                      ? "bg-green-500/5 border-green-500/20"
                                      : "bg-red-500/5 border-red-500/20"
                                )}>
                                  {msg.approval.image && (
                                    <img src={msg.approval.image} alt={msg.approval.partName} className="rounded-md my-1.5 w-full object-cover max-h-32" />
                                  )}
                                  <p className="font-bold text-xs mb-0.5 break-words [overflow-wrap:anywhere]">{msg.approval.partName}</p>
                                  <p className="text-[10px] opacity-70 mb-2.5 font-medium">Amount: ₹{msg.approval.amount}</p>

                                  {msg.approval.status === 'pending' && !isSelf && (user?.role === 'customer' || !user) && (
                                    <div className="flex gap-1.5">
                                      <button
                                        disabled={processingApprovalId === msg.approval!.approvalId}
                                        onClick={() => handleApprove(msg.approval!.approvalId)}
                                        className="flex-1 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md text-[10px] font-bold transition-colors shadow-sm disabled:opacity-50"
                                      >
                                        {processingApprovalId === msg.approval!.approvalId ? '...' : 'Approve'}
                                      </button>
                                      <button
                                        disabled={processingApprovalId === msg.approval!.approvalId}
                                        onClick={() => handleReject(msg.approval!.approvalId)}
                                        className="flex-1 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-[10px] font-bold transition-colors shadow-sm disabled:opacity-50"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}

                                  {msg.approval.status !== 'pending' && (
                                    <div className={cn(
                                      "flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest",
                                      msg.approval.status === 'approved' ? "text-green-600" : "text-red-600"
                                    )}>
                                      <div className={cn("w-1.5 h-1.5 rounded-full", msg.approval.status === 'approved' ? "bg-green-600" : "bg-red-600")} />
                                      {msg.approval.status}
                                    </div>
                                  )}
                                </div>
                              )}
                              <p className={cn("text-[8px] mt-1 opacity-40 font-medium", isSelf ? "text-right" : "text-left")}>
                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <form
                    onSubmit={handleSendMessage}
                    className="w-full p-2 bg-card border-t border-border flex items-center gap-1.5"
                  >
                    {user?.role === 'merchant' && (
                      <button
                        type="button"
                        onClick={() => setIsPartModalOpen(true)}
                        className="p-1.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Type message..."
                      maxLength={MAX_CHAT_MESSAGE_LENGTH}
                      className="flex-1 bg-muted/50 border-none rounded-lg px-2.5 py-1.5 text-[11px] focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/50"
                    />
                    <button
                      type="submit"
                      disabled={!inputText.trim()}
                      className="p-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 hover:bg-primary/90 transition-all active:scale-95 shadow-sm shadow-primary/20"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </form>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "relative w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300",
            isOpen ? "bg-destructive text-destructive-foreground rotate-90" : "bg-primary text-primary-foreground"
          )}
          aria-label={isOpen ? 'Close service chat' : 'Open service chat with workshop'}
        >
          {isOpen ? <X className="w-6 h-6" /> : <MessagesSquare className="w-6 h-6" strokeWidth={2} />}
          {!isOpen && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-background">
              {unreadCount}
            </span>
          )}
          {isOpen && isMinimized && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-background">
              {unreadCount}
            </span>
          )}
          {!isConnected && !isOpen && (
            <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-500 text-white rounded-full flex items-center justify-center border-2 border-background animate-pulse shadow-sm">
              <AlertTriangle className="w-3 h-3" />
            </span>
          )}
        </motion.button>
      </div>
    </>
  );
};

export default ChatWidget;
