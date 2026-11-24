import axios from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/authStore';
import { getApiBaseUrl } from '@/lib/apiBase';
import { clearMemoryAccessToken, getMemoryAccessToken } from '@/lib/authToken';

const api = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 10000,
  withCredentials: true,
});

let handlingUnauthorized = false;
let lastNetworkToastAt = 0;
const NETWORK_TOAST_COOLDOWN_MS = 4000;

// Only fires for errors no screen already has specific copy for: total
// network failure (offline, DNS, timeout — axios gives no `response` at
// all) or a 5xx from our own server. Expected 4xx validation errors are
// left to each screen's own catch block, so nothing double-toasts.
const showGlobalErrorToast = (error: unknown) => {
  const err = error as { response?: { status?: number }; code?: string; message?: string };

  const isNetworkFailure = !err.response;
  const isServerError = (err.response?.status ?? 0) >= 500;
  if (!isNetworkFailure && !isServerError) return;

  const now = Date.now();
  if (now - lastNetworkToastAt < NETWORK_TOAST_COOLDOWN_MS) return;
  lastNetworkToastAt = now;

  let message: string;
  if (isServerError) {
    message = 'Something went wrong on our end. Please try again shortly.';
  } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
    message = 'No internet connection. Please check your network and try again.';
  } else if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
    message = 'The request timed out. Please try again.';
  } else {
    message = 'Unable to reach the server. Please try again shortly.';
  }

  toast.error(message);
};

api.interceptors.request.use((config) => {
  config.headers['X-Client-Platform'] = 'web';

  const memoryToken = getMemoryAccessToken();
  if (memoryToken) {
    config.headers.Authorization = `Bearer ${memoryToken}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      console.error('API Error:', {
        url: error.config?.url,
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
    }

    // The Vahan lookup shows its own inline message and falls back to manual entry.
    if (!String(error.config?.url || '').includes('/vehicles/vahan/')) showGlobalErrorToast(error);

    if (error.response?.status === 401 || error.response?.status === 403) {
      const errorCode = error.response.data?.code;
      const url = String(error.config?.url || '');
      const isAuthRequest = url.includes('/auth/');
      const { isAuthenticated, authHydrated } = useAuthStore.getState();

      if (errorCode === 'PENDING_APPROVAL') {
        return Promise.reject(error);
      }

      if (
        !isAuthRequest &&
        authHydrated &&
        isAuthenticated &&
        !handlingUnauthorized
      ) {
        handlingUnauthorized = true;
        clearMemoryAccessToken();
        useAuthStore.getState().logout();
        window.setTimeout(() => {
          handlingUnauthorized = false;
        }, 1000);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
