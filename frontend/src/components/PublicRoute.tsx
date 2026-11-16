import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { Skeleton } from '@/components/ui/skeleton';

const PublicRoute: React.FC = () => {
  const { isAuthenticated, authHydrated } = useAuthStore();
  const location = useLocation();

  if (!authHydrated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-4">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }

  // The booking-link "Sign in to track" flow always shows the form; LoginPage
  // itself navigates to `from` after a successful sign-in.
  const forceLogin = (location.state as { forceLogin?: boolean } | null)?.forceLogin === true;

  if (isAuthenticated && !forceLogin) {
    // Honour a return path (e.g. the booking link's "Sign in to track") so the
    // auth redirect doesn't race the login page's own navigation.
    const from = (location.state as { from?: { pathname?: string } | string } | null)?.from;
    const target = typeof from === 'string' ? from : from?.pathname;
    return <Navigate to={target && target.startsWith('/') ? target : '/dashboard'} replace />;
  }

  return <Outlet />;
};

export default PublicRoute;
