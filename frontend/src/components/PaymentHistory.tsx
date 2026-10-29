import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  CreditCard, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  Download
} from 'lucide-react';
import { toast } from 'sonner';
import { paymentService, PaymentData, PaymentHistory as PaymentHistoryType } from '@/services/paymentService';
import { socketService } from '@/services/socket';
import GlobalSyncRefresh from '@/components/GlobalSyncRefresh';
import { isValidDate } from '@/lib/formValidation';
import { useSearchParams } from 'react-router-dom';

interface PaymentHistoryProps {
  userId?: string;
  isAdmin?: boolean;
}

const PaymentHistory: React.FC<PaymentHistoryProps> = ({ userId, isAdmin = false }) => {
  const [searchParams] = useSearchParams();
  const [payments, setPayments] = useState<PaymentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    startDate: '',
    endDate: ''
  });
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const statusParam = searchParams.get('status');
    if (statusParam !== null) {
      setFilters(prev => ({ ...prev, status: statusParam }));
    }
  }, [searchParams]);

  useEffect(() => {
    const isStartValid = !filters.startDate || isValidDate(filters.startDate);
    const isEndValid = !filters.endDate || isValidDate(filters.endDate);
    
    if (isStartValid && isEndValid) {
      fetchPayments();
    }

    // Socket Setup
    socketService.connect();
    if (isAdmin) {
      socketService.joinRoom('admin');
    } else if (userId) {
      socketService.joinRoom(`user_${userId}`);
    }

    return () => {
      if (isAdmin) {
        socketService.leaveRoom('admin');
      } else if (userId) {
        socketService.leaveRoom(`user_${userId}`);
      }
    };
  }, [pagination.page, filters, isAdmin, userId]);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      
      let result;
      if (isAdmin) {
        result = await paymentService.getAllPayments(pagination.page, pagination.limit, filters);
      } else {
        result = await paymentService.getPaymentHistory(pagination.page, pagination.limit);
      }

      setPayments(result.data || result.payments);
      setPagination(result.pagination);
    } catch (error: any) {
      console.error('Failed to fetch payments:', error);
      toast.error('Failed to load payment history');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'refunded':
        return <RefreshCw className="w-4 h-4 text-orange-500" />;
      case 'expired':
        return <XCircle className="w-4 h-4 text-gray-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'text-green-600 bg-green-50';
      case 'failed':
        return 'text-red-600 bg-red-50';
      case 'refunded':
        return 'text-orange-600 bg-orange-50';
      case 'expired':
        return 'text-gray-600 bg-gray-50';
      case 'pending':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-yellow-600 bg-yellow-50';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'startDate' || key === 'endDate') {
      if (value && value.length > 10) {
        toast.error('Too long data: Please enter a valid date');
        return;
      }
    }
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to first page
  };

  const clearFilters = () => {
    setFilters({ status: '', startDate: '', endDate: '' });
    setPagination(prev => ({ ...prev, page: 1 }));
    setResetKey(prev => prev + 1);
  };

  return (
    <GlobalSyncRefresh entities={['payment']} onSync={fetchPayments}>
    {loading && payments.length === 0 ? (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    ) : (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Payment History</h2>
        <button
          onClick={fetchPayments}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      {isAdmin && (
        <div className="bg-white p-4 rounded-lg border space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="w-4 h-4" />
            Filters
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">All Status</option>
              <option value="created">Created</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
            </select>

            <input
              key={`start-${resetKey}`}
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              onBlur={(e) => {
                const val = e.target.value;
                if (val && !isValidDate(val)) {
                  toast.error('Please enter a valid start date');
                }
              }}
              className="px-3 py-2 border rounded-lg text-sm"
              placeholder="Start Date"
              maxLength={10}
              min="1900-01-01"
              max="2100-12-31"
            />

            <input
              key={`end-${resetKey}`}
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              onBlur={(e) => {
                const val = e.target.value;
                if (val && !isValidDate(val)) {
                  toast.error('Please enter a valid end date');
                }
              }}
              className="px-3 py-2 border rounded-lg text-sm"
              placeholder="End Date"
              maxLength={10}
              min="1900-01-01"
              max="2100-12-31"
            />

            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {/* Payment List */}
      <div className="space-y-4">
        {payments.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No payments found</p>
          </div>
        ) : (
          payments.map((payment) => (
            <motion.div
              key={payment._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="font-medium">₹{payment.amount}</p>
                    <p className="text-sm text-gray-500">
                      {(payment as any).awaitingPayment
                        ? `Booking #${(payment as any).orderId} · Service completed, awaiting customer payment`
                        : (payment as any).manualPayment
                        ? `Booking #${(payment as any).orderId} · Marked paid by admin on delivery`
                        : String(payment._id).startsWith('booking_')
                        ? `Booking #${(payment as any).orderId}`
                        : payment.cashfreePaymentId || payment.paymentId || 'N/A'}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {getStatusIcon(payment.status)}
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(payment.status)}`}>
                    {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Calendar className="w-4 h-4" />
                  {formatDate(payment.createdAt || payment.date || '')}
                </div>
                
                {isAdmin && payment.user && (
                  <div className="text-gray-600">
                    <span className="font-medium">User:</span> {payment.user.name}
                  </div>
                )}

                {payment.failureReason && (
                  <div className="col-span-full text-red-600 text-xs">
                    <span className="font-medium">Failure Reason:</span> {payment.failureReason}
                  </div>
                )}

                {payment.refundAmount > 0 && (
                  <div className="text-orange-600">
                    <span className="font-medium">Refunded:</span> ₹{payment.refundAmount}
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
          <p className="text-xs sm:text-sm text-gray-600 order-2 sm:order-1">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total} payments
          </p>

          <div className="flex items-center gap-2 order-1 sm:order-2 w-full sm:w-auto justify-between sm:justify-end">
            <button
              onClick={() => { if (pagination.page > 1) handlePageChange(pagination.page - 1); }}
              className={`flex items-center gap-1 px-3 py-2 text-xs sm:text-sm border rounded-lg hover:bg-gray-50 bg-white ${pagination.page === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>

            <span className="px-3 py-2 text-xs sm:text-sm font-medium">
              Page {pagination.page} of {pagination.pages}
            </span>

            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page === pagination.pages}
              className="flex items-center gap-1 px-3 py-2 text-xs sm:text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed bg-white"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
    )}
    </GlobalSyncRefresh>
  );
};

export default PaymentHistory;