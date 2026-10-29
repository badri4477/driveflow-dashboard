import 'package:shared_preferences/shared_preferences.dart';

/// Remembers when this device last viewed a booking's chat, so the unread
/// badge survives leaving/reopening the screen (same behaviour as web).
class ChatSeenStore {
  static String _key(String bookingId) => 'chat_last_seen_$bookingId';

  static Future<DateTime?> lastSeen(String bookingId) async {
    final prefs = await SharedPreferences.getInstance();
    final ms = prefs.getInt(_key(bookingId));
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms);
  }

  static Future<void> markSeen(String bookingId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_key(bookingId), DateTime.now().millisecondsSinceEpoch);
  }

  /// Messages from someone other than [selfId] sent after [lastSeen].
  static int countUnread(
    List<dynamic> messages,
    DateTime? lastSeen,
    String? selfId,
  ) {
    var count = 0;
    for (final m in messages) {
      if (m is! Map) continue;
      final sender = m['sender'];
      final senderId = sender is Map
          ? (sender['_id'] ?? sender['id'] ?? '').toString()
          : (m['senderId'] ?? '').toString();
      if (selfId != null && senderId == selfId) continue;
      final createdAt = DateTime.tryParse('${m['createdAt'] ?? ''}');
      if (lastSeen == null ||
          (createdAt != null && createdAt.isAfter(lastSeen))) {
        count++;
      }
    }
    return count;
  }
}
