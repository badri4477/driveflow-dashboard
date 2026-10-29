import { io, Socket } from 'socket.io-client';
import { getMemoryAccessToken } from '@/lib/authToken';

const getSocketUrl = () => {
  const apiUrl = import.meta.env.VITE_API_URL || '';
  if (!apiUrl || apiUrl.startsWith('/')) return window.location.origin;
  return apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');
};
const SOCKET_URL = getSocketUrl();

class SocketService {
  private socket: Socket | null = null;
  private currentRooms: Set<string> = new Set();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private globalListeners: Set<(data: any) => void> = new Set();

  connect() {
    if (this.socket) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return;
    }

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
      // Function form is re-evaluated on every (re)connect, so reconnects
      // after a server restart or token refresh send the current token.
      auth: (cb) => cb({ token: getMemoryAccessToken() || undefined }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.currentRooms.forEach((room) => {
        this.socket?.emit('join', room);
      });
    });

    this.socket.on('disconnect', () => {
    });

    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('pagehide', this.handleBeforeUnload);
  }

  private handleBeforeUnload = () => {
    this.disconnect();
  };

  disconnect() {
    if (this.socket) {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener('pagehide', this.handleBeforeUnload);
      this.socket.disconnect();
      this.socket = null;
      this.currentRooms.clear();
      this.listeners.clear();
      this.globalListeners.clear();
    }
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  emit(event: string, data: unknown) {
    if (!this.socket?.connected) this.connect();
    this.socket?.emit(event, data);
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.socket) this.connect();
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    this.socket?.on(event, callback);
  }

  onGlobal(event: string, callback: (data: any) => void) {
    this.globalListeners.add(callback);
    this.on(event, callback);
  }

  off(event: string, callback?: (data: any) => void) {
    if (!this.socket) return;
    if (callback) {
      this.listeners.get(event)?.delete(callback);
      this.globalListeners.delete(callback);
      this.socket.off(event, callback);
    } else {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        for (const cb of Array.from(callbacks)) {
          if (!this.globalListeners.has(cb)) {
            this.socket.off(event, cb);
            callbacks.delete(cb);
          }
        }
      }
    }
  }

  offGlobal(event: string, callback: (data: any) => void) {
    if (!this.socket) return;
    this.globalListeners.delete(callback);
    this.off(event, callback);
  }

  onAny(callback: (event: string, data: unknown) => void) {
    if (!this.socket) this.connect();
    const socket = this.socket as Socket & {
      onAny?: (cb: (event: string, ...args: unknown[]) => void) => void;
      offAny?: (cb?: (event: string, ...args: unknown[]) => void) => void;
    };
    socket.onAny?.((event, ...args) => {
      callback(event, args[0]);
    });
  }

  offAny(callback?: (event: string, data: unknown) => void) {
    const socket = this.socket as Socket & {
      offAny?: (cb?: (event: string, ...args: unknown[]) => void) => void;
    };
    if (!callback) {
      socket?.offAny?.();
      return;
    }
    socket?.offAny?.((event, ...args) => {
      callback(event, args[0]);
    });
  }

  joinRoom(room: string) {
    this.currentRooms.add(room);
    this.emit('join', room);
  }

  leaveRoom(room: string) {
    this.currentRooms.delete(room);
    this.emit('leave', room);
  }
}

export const socketService = new SocketService();
