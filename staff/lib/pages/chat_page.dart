import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../services/socket_service.dart';
import '../core/storage.dart';
import '../core/env.dart';
import '../core/app_colors.dart';
import '../widgets/states/skeleton.dart';

const carzziGreetingMessage = '''Hi 👋 Hope you’re doing well! 
Welcome to Carzzi Support Chat  🚗 
Through this chat, you can easily communicate with your assigned merchant regarding your requests. You will also receive updates here about the approval or rejection of parts  submitted. 
If you have any questions, need assistance, or want to follow up on a request, feel free to message here anytime — we’re here to help you! 
Thank you for choosing Carzzi 🙌''';

class StaffChatPage extends StatefulWidget {
  final String bookingId;
  final String orderNumber;

  const StaffChatPage({
    super.key,
    required this.bookingId,
    required this.orderNumber,
  });

  @override
  State<StaffChatPage> createState() => _StaffChatPageState();
}

class _StaffChatPageState extends State<StaffChatPage> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<Map<String, dynamic>> _messages = [];
  late SocketService _socketService;
  String? _currentUserId;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _socketService = SocketService();
    _loadCurrentUser();
    _setupSocketListeners();

    // Join room and request existing messages
    _socketService.joinRoom('booking_${widget.bookingId}');
    _socketService.emit('getMessages', {'bookingId': widget.bookingId});
  }

  Future<void> _loadCurrentUser() async {
    final userJson = await AppStorage().getUserJson();
    if (userJson != null) {
      final user = jsonDecode(userJson);
      if (mounted) {
        setState(() {
          _currentUserId = user['_id'] ?? user['id'];
        });
      }
    }
  }

  void _setupSocketListeners() {
    _socketService.on('receiveMessage', _handleReceiveMessage);
    _socketService.on('loadMessages', _handleLoadMessages);
    // Staff also needs to listen to newApproval to see updates in real-time
    _socketService.on('newApproval', _handleNewApproval);
  }

  void _handleNewApproval(dynamic data) {
    if (!mounted) return;
    // When a new approval status changes via socket, request messages again to update UI
    _socketService.emit('getMessages', {'bookingId': widget.bookingId});
  }

  void _handleReceiveMessage(dynamic data) {
    if (!mounted) return;
    if (data != null && data is Map) {
      final message = Map<String, dynamic>.from(data);
      if (message['bookingId'] == widget.bookingId) {
        setState(() {
          // Check if message already exists (by real ID)
          final index = _messages.indexWhere((m) => m['_id'] == message['_id']);
          if (index != -1) {
            _messages[index] = message;
          } else {
            // Check if it's an update for an optimistic message
            final tempIndex = _messages.indexWhere(
              (m) =>
                  m['_id'].toString().startsWith('temp_') &&
                  m['text'] == message['text'] &&
                  (m['sender']?['_id'] == message['sender']?['_id'] ||
                      m['senderId'] == message['sender']?['_id']),
            );

            if (tempIndex != -1) {
              _messages[tempIndex] = message; // Replace temp with real
            } else {
              _messages.add(message);
            }
          }
        });
        _scrollToBottom();
      }
    }
  }

  void _handleLoadMessages(dynamic data) {
    if (!mounted) return;
    if (data != null && data is List) {
      final List<Map<String, dynamic>> loadedMessages = data
          .map((m) => Map<String, dynamic>.from(m))
          .toList();
      setState(() {
        _messages.clear();
        _messages.addAll(loadedMessages);
        _isLoading = false;
      });
      _scrollToBottom();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    // Emit message to socket
    _socketService.emit('sendMessage', {
      'bookingId': widget.bookingId,
      'text': text,
      'recipientRole': 'all', // Staff messages are visible to all
    });

    // Optimistically add message
    final tempId = 'temp_${DateTime.now().millisecondsSinceEpoch}';
    final newMessage = {
      '_id': tempId,
      'bookingId': widget.bookingId,
      'sender': {'_id': _currentUserId, 'name': 'You', 'role': 'staff'},
      'text': text,
      'createdAt': DateTime.now().toIso8601String(),
    };

    setState(() {
      _messages.add(newMessage);
    });

    _messageController.clear();
    _scrollToBottom();
  }

  @override
  void dispose() {
    _socketService.off('receiveMessage', _handleReceiveMessage);
    _socketService.off('loadMessages', _handleLoadMessages);
    _socketService.off('newApproval', _handleNewApproval);
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String? _resolveImageUrl(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.startsWith('/')) return '${Env.baseUrl}$raw';
    return '${Env.baseUrl}/$raw';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Support Chat',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            Text(
              'Order #${widget.orderNumber}',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: _isLoading
                ? const SkeletonList(itemCount: 5, showLeading: false)
                : _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.chat_bubble_outline,
                          size: 48,
                          color: Colors.grey[300],
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'No messages yet',
                          style: TextStyle(color: Colors.grey),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final message = _messages[index];
                      final sender = message['sender'];
                      final isSelf =
                          sender != null && (sender['_id'] == _currentUserId);

                      return _buildMessageBubble(message, isSelf);
                    },
                  ),
          ),
          _buildMessageInput(),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(Map<String, dynamic> message, bool isSelf) {
    final sender = message['sender'];
    final senderName = sender?['name'] ?? 'Unknown';
    final text = message['text'] ?? '';
    final createdAt =
        DateTime.tryParse(message['createdAt'] ?? '') ?? DateTime.now();

    return Align(
      alignment: isSelf ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: isSelf
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          if (!isSelf && senderName != 'Carzzi')
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 4),
              child: Text(
                senderName,
                style: const TextStyle(fontSize: 10, color: Colors.grey),
              ),
            ),
          Container(
            margin: const EdgeInsets.symmetric(vertical: 4),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.8,
            ),
            decoration: BoxDecoration(
              color: isSelf ? AppColors.primaryPurple : const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(16),
                topRight: const Radius.circular(16),
                bottomLeft: isSelf ? const Radius.circular(16) : Radius.zero,
                bottomRight: isSelf ? Radius.zero : const Radius.circular(16),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  text,
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    color: isSelf ? Colors.white : Colors.black87,
                  ),
                ),
                if (message['type'] == 'approval' &&
                    message['approval'] != null)
                  _buildApprovalCard(message['approval'], isSelf),
                const SizedBox(height: 6),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    '${createdAt.hour}:${createdAt.minute.toString().padLeft(2, '0')}',
                    style: TextStyle(
                      fontSize: 10,
                      color: isSelf
                          ? Colors.white.withValues(alpha: 0.6)
                          : Colors.grey.shade500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildApprovalCard(Map<String, dynamic> approval, bool isSelf) {
    final status = approval['status'] ?? 'pending';
    final bool isPending = status == 'pending';
    final bool isApproved = status == 'approved';
    final String? imageUrl = _resolveImageUrl(approval['image']);

    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isPending
              ? Colors.orange.withValues(alpha: 0.3)
              : (isApproved
                    ? Colors.green.withValues(alpha: 0.3)
                    : Colors.red.withValues(alpha: 0.3)),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (imageUrl != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  imageUrl,
                  fit: BoxFit.cover,
                  width: double.infinity,
                  height: 120,
                  errorBuilder: (context, error, stackTrace) => Container(
                    height: 120,
                    color: Colors.grey.shade100,
                    child: const Icon(Icons.broken_image, color: Colors.grey),
                  ),
                ),
              ),
            ),
          Text(
            approval['partName'] ?? 'Additional Part',
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: Colors.black,
            ),
          ),
          Text(
            'Amount: ₹${approval['amount']}',
            style: const TextStyle(fontSize: 12, color: Colors.grey),
          ),
          const Divider(height: 16),
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: isPending
                      ? Colors.orange
                      : (isApproved ? Colors.green : Colors.red),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                status.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  color: isPending
                      ? Colors.orange
                      : (isApproved ? Colors.green : Colors.red),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMessageInput() {
    return Container(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 12,
        bottom: MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey[200]!)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFF3F4F6),
                borderRadius: BorderRadius.circular(24),
              ),
              child: TextField(
                controller: _messageController,
                style: const TextStyle(color: Colors.black87),
                decoration: const InputDecoration(
                  hintText: 'Type a message...',
                  border: InputBorder.none,
                  hintStyle: TextStyle(fontSize: 14, color: Colors.grey),
                ),
                onSubmitted: (_) => _sendMessage(),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            decoration: const BoxDecoration(
              color: AppColors.primaryPurple,
              shape: BoxShape.circle,
            ),
            child: IconButton(
              icon: const Icon(Icons.send, color: Colors.white, size: 20),
              onPressed: _sendMessage,
            ),
          ),
        ],
      ),
    );
  }
}
