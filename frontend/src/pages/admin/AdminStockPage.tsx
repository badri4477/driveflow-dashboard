import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Package, FileUp, FileDown, Columns3, CheckCircle, Plus, Edit, Trash2, X } from 'lucide-react';
import {
  getVehicleReference,
  importVehicleReference,
  createVehicleReference,
  updateVehicleReference,
  deleteVehicleReference,
  deleteAllVehicleReference,
  getVehicleReferenceColumns,
  addVehicleReferenceColumn,
  deleteVehicleReferenceColumn,
  renameVehicleReferenceColumn,
  getVehicleReferenceBuiltinColumns,
  setVehicleReferenceBuiltinColumnHidden,
  renameVehicleReferenceBuiltinColumn,
  VehicleReferenceColumn,
  VehicleReferenceBuiltinColumn,
} from '../../services/vehicleReferenceService';
import { socketService } from '../../services/socket';
import GlobalSyncRefresh from '@/components/GlobalSyncRefresh';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface VehicleData {
  _id: string;
  brand_name: string;
  model: string;
  brand_model: string;
  front_tyres: string;
  rear_tyres: string;
  battery_details?: string;
  pickup_drop_price?: string | number;
  tyre_price_bridgestone?: string | number;
  tyre_price_yokohama?: string | number;
  tyre_price_apollo?: string | number;
  tyre_price_michelin?: string | number;
  tyre_price_dummy2?: string | number;
  tyre_price_dummy?: string | number;
  battery_price_amaron?: string | number;
  battery_price_exide?: string | number;
  car_wash_price?: string | number;
  car_wash_exterior_price?: string | number;
  car_wash_interior_exterior_price?: string | number;
  car_wash_interior_exterior_underbody_price?: string | number;
  general_service_price?: string | number;
  fuel_type?: string;
  year_range?: string;
  body_type?: string;
  tyre_size?: string;
  // Admin-defined dynamic brand columns (e.g. tyre_price_continental) ride
  // along under this catch-all instead of being individually declared.
  [dynamicField: string]: string | number | undefined;
}

const AdminVehicleDataPage = () => {
  const [vehicleData, setVehicleData] = useState<VehicleData[]>([]);
  const [columns, setColumns] = useState<VehicleReferenceColumn[]>([]);
  const [builtinColumns, setBuiltinColumns] = useState<VehicleReferenceBuiltinColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [newColumnCategory, setNewColumnCategory] = useState<'tyre' | 'battery'>('tyre');
  const [savingColumn, setSavingColumn] = useState(false);
  const [editingColumnKey, setEditingColumnKey] = useState<string | null>(null);
  const [editingColumnLabel, setEditingColumnLabel] = useState('');
  const [renamingColumn, setRenamingColumn] = useState(false);
  const [formData, setFormData] = useState({
    brand_name: '',
    model: '',
    brand_model: '',
    year_range: '',
    body_type: '',
    tyre_size: '',
    front_tyres: '',
    rear_tyres: '',
    fuel_type: '',
    battery_details: '',
    pickup_drop_price: '',
    tyre_price_bridgestone: '',
    tyre_price_yokohama: '',
    tyre_price_apollo: '',
    tyre_price_michelin: '',
    tyre_price_dummy2: '',
    tyre_price_dummy: '',
    battery_price_amaron: '',
    battery_price_exide: '',
    car_wash_price: '',
    car_wash_exterior_price: '',
    car_wash_interior_exterior_price: '',
    car_wash_interior_exterior_underbody_price: '',
    general_service_price: '',
  });
  // Admin-defined dynamic brand columns, keyed by fieldName (e.g. tyre_price_continental).
  const [dynamicFormData, setDynamicFormData] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchVehicleData(true);
    fetchColumns();
    fetchBuiltinColumns();

    // Socket Setup
    socketService.connect();
    socketService.joinRoom('admin');

    return () => {
      socketService.leaveRoom('admin');
    };
  }, []);

  const fetchBuiltinColumns = async () => {
    try {
      const data = await getVehicleReferenceBuiltinColumns();
      setBuiltinColumns(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load built-in column visibility', error);
    }
  };

  const isBuiltinHidden = (key: string) => builtinColumns.some((c) => c.key === key && c.hidden);

  const handleToggleBuiltinHidden = async (key: string, hidden: boolean, label?: string) => {
    if (hidden) {
      const name = label || key;
      if (!window.confirm(`Remove column "${name}"? It can be restored later from Manage Columns; existing price values are not deleted.`)) {
        return;
      }
    }
    try {
      await setVehicleReferenceBuiltinColumnHidden(key, hidden);
      toast.success(hidden ? 'Column removed' : 'Column restored');
      fetchBuiltinColumns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update column');
    }
  };

  const fetchColumns = async () => {
    try {
      const data = await getVehicleReferenceColumns();
      setColumns(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load dynamic columns', error);
    }
  };

  const fetchVehicleData = async (forceLoading?: any) => {
    try {
      // Only set loading to true on initial fetch (when no data exists) or when explicitly forced (e.g. mount or deleting)
      if (vehicleData.length === 0 || forceLoading === true) {
        setLoading(true);
      }
      const data = await getVehicleReference();
      console.log('Vehicle data received:', data);
      if (Array.isArray(data)) {
        setVehicleData(data);
      } else {
        console.error('Vehicle data is not an array:', data);
        setVehicleData([]);
      }
    } catch (error) {
      toast.error('Failed to load vehicle data');
      setVehicleData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!window.confirm(
      `Import "${file.name}"?\n\nA catalogue workbook (with Year Range) REPLACES all current vehicle data. ` +
      'The current data is backed up first.'
    )) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setUploading(true);
      const result = await importVehicleReference(file);
      toast.success(result?.message || 'Vehicle data imported successfully');
      if (Array.isArray(result?.warnings) && result.warnings.length) {
        toast.error(`${result.warnings.length} row(s) need attention: ${result.warnings[0]}`);
      }
      fetchVehicleData();
      fetchColumns();
      fetchBuiltinColumns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to import data');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleOpenModal = useCallback((vehicle: VehicleData | null = null) => {
    if (vehicle) {
      setEditingVehicle(vehicle);
      setFormData({
        brand_name: vehicle.brand_name,
        model: vehicle.model,
        brand_model: vehicle.brand_model,
        year_range: vehicle.year_range || '',
        body_type: vehicle.body_type || '',
        // Older rows have only front/rear sizes.
        tyre_size: vehicle.tyre_size || (vehicle.front_tyres && vehicle.rear_tyres && vehicle.front_tyres !== vehicle.rear_tyres
          ? `Front: ${vehicle.front_tyres} / Rear: ${vehicle.rear_tyres}` : vehicle.front_tyres || ''),
        front_tyres: vehicle.front_tyres,
        rear_tyres: vehicle.rear_tyres,
        fuel_type: vehicle.fuel_type || '',
        battery_details: vehicle.battery_details || '',
        pickup_drop_price: vehicle.pickup_drop_price?.toString() || '',
        tyre_price_bridgestone: vehicle.tyre_price_bridgestone?.toString() || '',
        tyre_price_yokohama: vehicle.tyre_price_yokohama?.toString() || '',
        tyre_price_apollo: vehicle.tyre_price_apollo?.toString() || '',
        tyre_price_michelin: vehicle.tyre_price_michelin?.toString() || '',
        tyre_price_dummy2: vehicle.tyre_price_dummy2?.toString() || '',
        tyre_price_dummy: vehicle.tyre_price_dummy?.toString() || '',
        battery_price_amaron: vehicle.battery_price_amaron?.toString() || '',
        battery_price_exide: vehicle.battery_price_exide?.toString() || '',
        car_wash_price: vehicle.car_wash_price?.toString() || '',
        car_wash_exterior_price: vehicle.car_wash_exterior_price?.toString() || '',
        car_wash_interior_exterior_price: vehicle.car_wash_interior_exterior_price?.toString() || '',
        car_wash_interior_exterior_underbody_price: vehicle.car_wash_interior_exterior_underbody_price?.toString() || '',
        general_service_price: vehicle.general_service_price?.toString() || '',
      });
      const dynamicValues: Record<string, string> = {};
      columns.forEach((col) => {
        dynamicValues[col.fieldName] = vehicle[col.fieldName]?.toString() || '';
      });
      setDynamicFormData(dynamicValues);
    } else {
      setEditingVehicle(null);
      setFormData({
        brand_name: '',
        model: '',
        brand_model: '',
        year_range: '',
        body_type: '',
        tyre_size: '',
        front_tyres: '',
        rear_tyres: '',
        fuel_type: '',
        battery_details: '',
        pickup_drop_price: '',
        tyre_price_bridgestone: '',
        tyre_price_yokohama: '',
        tyre_price_apollo: '',
        tyre_price_michelin: '',
        tyre_price_dummy2: '',
        tyre_price_dummy: '',
        battery_price_amaron: '',
        battery_price_exide: '',
        car_wash_price: '',
        car_wash_exterior_price: '',
        car_wash_interior_exterior_price: '',
        car_wash_interior_exterior_underbody_price: '',
        general_service_price: '',
      });
      const dynamicValues: Record<string, string> = {};
      columns.forEach((col) => {
        dynamicValues[col.fieldName] = '';
      });
      setDynamicFormData(dynamicValues);
    }
    setIsModalOpen(true);
  }, [columns]);

  const handleDelete = useCallback(async (id: string) => {
    if (window.confirm('Are you sure you want to delete this vehicle reference?')) {
      try {
        await deleteVehicleReference(id);
        toast.success('Vehicle data deleted successfully');
        fetchVehicleData();
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Failed to delete vehicle data');
      }
    }
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.brand_name.trim() || !formData.model.trim() || !formData.brand_model.trim()) {
      toast.error('Brand, model and variant are required');
      return;
    }
    if (!formData.tyre_size.trim()) {
      toast.error('Tyre size is required');
      return;
    }
    if (formData.year_range.trim() && !/^\d{4}\s*([-–—]\s*\d{4}|\s+onwards)$/i.test(formData.year_range.trim())) {
      toast.error('Year range must look like 2016–2020 or 2021 onwards');
      return;
    }
    try {
      const cleaned = {
        ...formData,
        ...dynamicFormData,
        brand_name: formData.brand_name.trim(),
        model: formData.model.trim(),
        brand_model: formData.brand_model.trim(),
        year_range: formData.year_range.trim(),
        body_type: formData.body_type.trim(),
        tyre_size: formData.tyre_size.trim(),
        battery_details: formData.battery_details.trim(),
      };
      // Server derives front/rear from tyre_size.
      delete (cleaned as Record<string, unknown>).front_tyres;
      delete (cleaned as Record<string, unknown>).rear_tyres;
      if (editingVehicle) {
        await updateVehicleReference(editingVehicle._id, cleaned);
        toast.success('Vehicle data updated successfully');
      } else {
        await createVehicleReference(cleaned);
        toast.success('Vehicle data created successfully');
      }
      setIsModalOpen(false);
      fetchVehicleData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to save vehicle data');
    }
  };

  const handleDeleteAll = async () => {
    if (window.confirm('Are you sure you want to delete ALL vehicle reference data? This action cannot be undone.')) {
      try {
        setDeletingAll(true);
        await deleteAllVehicleReference();
        toast.success('All vehicle data deleted successfully');
        await fetchVehicleData();
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Failed to delete all vehicle data');
      } finally {
        setDeletingAll(false);
      }
    }
  };

  const handleAddColumn = async () => {
    const label = newColumnLabel.trim();
    if (!label) {
      toast.error('Enter a brand/column name');
      return;
    }
    try {
      setSavingColumn(true);
      await addVehicleReferenceColumn(label, newColumnCategory);
      toast.success(`Column "${label}" added`);
      setNewColumnLabel('');
      setIsColumnModalOpen(false);
      fetchColumns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to add column');
    } finally {
      setSavingColumn(false);
    }
  };

  const handleDeleteColumn = async (col: VehicleReferenceColumn) => {
    if (!window.confirm(`Remove column "${col.label}"? Existing price values for this brand will no longer be shown, but are not deleted.`)) {
      return;
    }
    try {
      await deleteVehicleReferenceColumn(col.category, col.key);
      toast.success('Column removed');
      fetchColumns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to remove column');
    }
  };

  const startEditingColumn = (key: string, currentLabel: string) => {
    setEditingColumnKey(key);
    setEditingColumnLabel(currentLabel);
  };

  const cancelEditingColumn = () => {
    setEditingColumnKey(null);
    setEditingColumnLabel('');
  };

  const handleRenameDynamicColumn = async (col: VehicleReferenceColumn) => {
    const label = editingColumnLabel.trim();
    if (!label) {
      toast.error('Column name cannot be empty');
      return;
    }
    if (label === col.label) {
      cancelEditingColumn();
      return;
    }
    try {
      setRenamingColumn(true);
      await renameVehicleReferenceColumn(col.category, col.key, label);
      toast.success('Column renamed');
      cancelEditingColumn();
      fetchColumns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to rename column');
    } finally {
      setRenamingColumn(false);
    }
  };

  const handleRenameBuiltinColumn = async (col: VehicleReferenceBuiltinColumn) => {
    const label = editingColumnLabel.trim();
    if (!label) {
      toast.error('Column name cannot be empty');
      return;
    }
    if (label === col.label) {
      cancelEditingColumn();
      return;
    }
    try {
      setRenamingColumn(true);
      await renameVehicleReferenceBuiltinColumn(col.key, label);
      toast.success('Column renamed');
      cancelEditingColumn();
      fetchBuiltinColumns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to rename column');
    } finally {
      setRenamingColumn(false);
    }
  };

  const handleExportExcel = async () => {
    if (vehicleData.length === 0) {
      toast.error('No vehicle data to export');
      return;
    }
    // Same headers as the catalogue workbook, so an export can be edited and re-imported.
    const rows = vehicleData.map((item) => {
      const row: Record<string, string | number> = {
        Brand: item.brand_name,
        Model: item.model,
        Variant: item.brand_model,
        'Year Range': item.year_range ?? '',
        'Fuel Type': item.fuel_type ?? '',
        'Body Type': item.body_type ?? '',
        'Tyre Size': item.tyre_size ?? item.front_tyres ?? '',
        'Battery Details': item.battery_details ?? '',
        'Exterior Wash': item.car_wash_exterior_price ?? '',
        'Interior + Exterior Wash': item.car_wash_interior_exterior_price ?? '',
        'Full Wash': item.car_wash_interior_exterior_underbody_price ?? '',
        'General Service': item.general_service_price ?? '',
        'Pickup & Drop': item.pickup_drop_price ?? '',
      };
      tyreColumns.forEach((col) => {
        row[`Tyre - ${col.label}`] = item[col.fieldName] ?? '';
      });
      return row;
    });

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'in');
    XLSX.writeFile(workbook, `vehicle_reference_data_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const hiddenBuiltinKeys = useMemo(
    () => new Set(builtinColumns.filter((c) => c.hidden).map((c) => c.key)),
    [builtinColumns],
  );

  const tyreColumns = useMemo(
    () => columns.filter((c) => c.category === 'tyre'),
    [columns],
  );

  const batteryColumns = useMemo(
    () => columns.filter((c) => c.category === 'battery'),
    [columns],
  );

  const filteredData = useMemo(() => {
    if (!Array.isArray(vehicleData)) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return vehicleData;
    return vehicleData.filter(
      (item) =>
        item.brand_name?.toLowerCase().includes(term) ||
        item.model?.toLowerCase().includes(term) ||
        item.brand_model?.toLowerCase().includes(term) ||
        String(item.year_range || '').toLowerCase().includes(term),
    );
  }, [vehicleData, searchTerm]);

  const stats = useMemo(
    () => ({
      totalModels: Array.isArray(vehicleData) ? vehicleData.length : 0,
      brands: Array.isArray(vehicleData)
        ? new Set(vehicleData.map((v) => v.brand_name)).size
        : 0,
    }),
    [vehicleData],
  );

  // Sheet rows mark a missing price either with a blank cell or the literal
  // string "NA" — both mean the same "no price" thing, so show both as
  // "NA" rather than mixing a blank-cell "-" with an explicit "NA" text.
  // Real free-text values (e.g. "Contact Carzzi Team...") pass through as-is.
  const formatPrice = (value: unknown) => {
    if (value === null || value === undefined) return 'NA';
    if (typeof value === 'string' && (value.trim() === '' || value.trim().toUpperCase() === 'NA')) return 'NA';
    if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '')) {
      return `₹${value}`;
    }
    return String(value);
  };

  if (loading && (!Array.isArray(vehicleData) || vehicleData.length === 0)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <GlobalSyncRefresh entities={['vehicle', 'vehicle_reference', 'vehicle_reference_column']} onSync={() => { fetchVehicleData(); fetchColumns(); fetchBuiltinColumns(); }}>
    <div className="space-y-4 md:space-y-6 w-full min-w-0 max-w-full overflow-x-hidden pb-24 lg:pb-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <h1 className="text-xl md:text-2xl font-bold text-gray-800">Vehicle Reference Data</h1>
        <div className="flex flex-wrap gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls"
            className="hidden"
          />
          <button
            onClick={() => handleOpenModal()}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
          >
            <Plus size={18} />
            Add New
          </button>
          <button
            onClick={() => setIsColumnModalOpen(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
          >
            <Columns3 size={18} />
            Manage Columns
          </button>
          <button
            onClick={handleDeleteAll}
            disabled={loading || uploading || deletingAll || vehicleData.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {deletingAll ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Trash2 size={18} />
            )}
            {deletingAll ? 'Deleting...' : 'Delete All'}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={vehicleData.length === 0}
            className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <FileUp size={18} />
            Export Excel
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <FileDown size={18} />
            )}
            {uploading ? 'Importing...' : 'Import Excel'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
        <div
          className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100"
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs md:text-sm text-gray-500">Total Models</p>
              <h3 className="text-xl md:text-2xl font-bold text-gray-800 mt-1">{stats.totalModels}</h3>
            </div>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Package size={20} className="md:w-6 md:h-6" />
            </div>
          </div>
        </div>

        <div
          className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100"
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs md:text-sm text-gray-500">Unique Brands</p>
              <h3 className="text-xl md:text-2xl font-bold text-gray-800 mt-1">{stats.brands}</h3>
            </div>
            <div className="p-2 bg-green-50 text-green-600 rounded-lg">
              <CheckCircle size={20} className="md:w-6 md:h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-3 md:gap-4 justify-between items-center">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search by brand, model, variant or year range"
            className="w-full pl-10 pr-4 py-2 text-sm md:text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            maxLength={50}
          />
        </div>
      </div>

      {/* Data View — content-visibility keeps offscreen rows cheap while
          a modal is open and the page re-renders. */}
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-w-0 max-w-full"
        style={{ contentVisibility: 'auto', containIntrinsicSize: '800px' }}
      >
        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredData.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No vehicle data found.</div>
          ) : (
            filteredData.map((item) => (
              <div key={item._id} className="p-4 space-y-2 min-w-0">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Brand</p>
                    <p className="font-semibold text-gray-800">{item.brand_name}</p>
                    <p className="text-xs text-gray-500 uppercase tracking-wide pt-1">Model</p>
                    <p className="text-sm text-gray-700">{item.model}</p>
                    <p className="text-xs text-gray-500 uppercase tracking-wide pt-1">Variant</p>
                    <p className="text-sm text-gray-700 break-all">{item.brand_model}</p>
                    <p className="text-sm text-gray-500 pt-1">
                      {[item.year_range, item.fuel_type, item.body_type].filter(Boolean).join(' · ') || '-'}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleOpenModal(item)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(item._id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto max-w-full">
          <table className="w-full text-left min-w-[1000px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 lg:px-6 py-4 font-semibold text-gray-700 text-left">Brand</th>
                <th className="px-4 lg:px-6 py-4 font-semibold text-gray-700 text-left">Model</th>
                <th className="px-4 lg:px-6 py-4 font-semibold text-gray-700 text-left">Variant</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Year Range</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Fuel Type</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Body Type</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Tyre Size</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Battery Details</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Exterior Wash</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Interior + Exterior Wash</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Full Wash</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">General Service</th>
                <th className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">Pickup &amp; Drop</th>
                {tyreColumns.map((col) => (
                  <th key={col.fieldName} className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
                {batteryColumns.map((col) => (
                  <th key={col.fieldName} className="px-6 py-4 font-semibold text-gray-700 whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
                <th className="px-6 py-4 font-semibold text-gray-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredData.map((item) => (
                <tr key={item._id} className="hover:bg-gray-50">
                  <td className="px-4 lg:px-6 py-4 font-medium text-gray-800 text-left">
                    {item.brand_name}
                  </td>
                  <td className="px-4 lg:px-6 py-4 text-sm text-gray-600 text-left">
                    {item.model}
                  </td>
                  <td className="px-4 lg:px-6 py-4 text-sm text-gray-600 text-left break-words max-w-[220px]">
                    {item.brand_model}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">{item.year_range || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">{item.fuel_type || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">{item.body_type || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 tabular-nums min-w-[140px]">{item.tyre_size || (item.front_tyres === item.rear_tyres ? item.front_tyres : `Front: ${item.front_tyres} / Rear: ${item.rear_tyres}`) || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">{item.battery_details || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">{formatPrice(item.car_wash_exterior_price)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">{formatPrice(item.car_wash_interior_exterior_price)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">{formatPrice(item.car_wash_interior_exterior_underbody_price)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">{formatPrice(item.general_service_price)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">{formatPrice(item.pickup_drop_price)}</td>
                  {tyreColumns.map((col) => (
                    <td key={col.fieldName} className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">
                      {formatPrice(item[col.fieldName])}
                    </td>
                  ))}
                  {batteryColumns.map((col) => (
                    <td key={col.fieldName} className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap tabular-nums">
                      {formatPrice(item[col.fieldName])}
                    </td>
                  ))}
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleOpenModal(item)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(item._id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredData.length === 0 && (
          <div className="hidden md:block p-8 text-center text-gray-500">
            No vehicle data found. Import an Excel file to get started.
          </div>
        )}
      </div>

      {/* Add/Edit Modal — mount only while open so opening does not keep a
          heavy form tree around, and closed state stays cheap. */}
      {isModalOpen && (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingVehicle ? 'Edit Vehicle Reference' : 'Add New Vehicle Reference'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto px-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="brand_name">Brand Name</Label>
                <Input
                  id="brand_name"
                  value={formData.brand_name}
                  onChange={(e) => setFormData({ ...formData, brand_name: e.target.value })}
                  placeholder="e.g. BMW"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="e.g. 3 Series"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand_model">Variant</Label>
              <Input
                id="brand_model"
                value={formData.brand_model}
                onChange={(e) => setFormData({ ...formData, brand_model: e.target.value })}
                placeholder="e.g. 520d Sport Line"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="year_range">Year Range</Label>
                <Input
                  id="year_range"
                  value={formData.year_range}
                  onChange={(e) => setFormData({ ...formData, year_range: e.target.value })}
                  placeholder="e.g. 2016–2020 or 2021 onwards"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="body_type">Body Type</Label>
                <Input
                  id="body_type"
                  value={formData.body_type}
                  onChange={(e) => setFormData({ ...formData, body_type: e.target.value })}
                  placeholder="e.g. SUV"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tyre_size">Tyre Size</Label>
              <Input
                id="tyre_size"
                value={formData.tyre_size}
                onChange={(e) => setFormData({ ...formData, tyre_size: e.target.value })}
                placeholder="e.g. 215/55 R17 or Front: 135/70 R12 / Rear: 155/65 R12"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fuel_type">Fuel Type</Label>
              <select
                id="fuel_type"
                value={formData.fuel_type}
                onChange={(e) => setFormData({ ...formData, fuel_type: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Not set</option>
                <option value="Petrol">Petrol</option>
                <option value="Diesel">Diesel</option>
                <option value="EV">EV</option>
                <option value="CNG">CNG</option>
                <option value="Hybrid">Hybrid</option>
              </select>
            </div>

            <div className="space-y-3 border-t pt-4">
              <h4 className="font-semibold text-sm text-gray-700">Tyre Prices</h4>
              <div className="grid grid-cols-2 gap-4">
                {!isBuiltinHidden('bridgestone') && (
                <div className="space-y-2">
                <Label htmlFor="tyre_price_bridgestone">Bridgestone</Label>
                <Input
                  id="tyre_price_bridgestone"
                  value={formData.tyre_price_bridgestone}
                  onChange={(e) => setFormData({ ...formData, tyre_price_bridgestone: e.target.value })}
                />
              </div>
              )}
              {!isBuiltinHidden('yokohama') && (
              <div className="space-y-2">
                <Label htmlFor="tyre_price_yokohama">Yokohama</Label>
                <Input
                  id="tyre_price_yokohama"
                  value={formData.tyre_price_yokohama}
                  onChange={(e) => setFormData({ ...formData, tyre_price_yokohama: e.target.value })}
                />
              </div>
              )}
              {!isBuiltinHidden('apollo') && (
              <div className="space-y-2">
                <Label htmlFor="tyre_price_apollo">Apollo</Label>
                <Input
                  id="tyre_price_apollo"
                  value={formData.tyre_price_apollo}
                  onChange={(e) => setFormData({ ...formData, tyre_price_apollo: e.target.value })}
                />
              </div>
              )}
              {!isBuiltinHidden('michelin') && (
              <div className="space-y-2">
                <Label htmlFor="tyre_price_michelin">Michelin</Label>
                <Input
                  id="tyre_price_michelin"
                  value={formData.tyre_price_michelin}
                  onChange={(e) => setFormData({ ...formData, tyre_price_michelin: e.target.value })}
                />
              </div>
              )}
              {!isBuiltinHidden('dummy') && (
              <div className="space-y-2">
                <Label htmlFor="tyre_price_dummy">Tyre Price - Dummy</Label>
                <Input
                  id="tyre_price_dummy"
                  value={formData.tyre_price_dummy}
                  onChange={(e) => setFormData({ ...formData, tyre_price_dummy: e.target.value })}
                />
              </div>
              )}
              {!isBuiltinHidden('dummy2') && (
              <div className="space-y-2">
                <Label htmlFor="tyre_price_dummy2">Tyre Price - Dummy 2</Label>
                <Input
                  id="tyre_price_dummy2"
                  value={formData.tyre_price_dummy2}
                  onChange={(e) => setFormData({ ...formData, tyre_price_dummy2: e.target.value })}
                />
              </div>
              )}
              {columns.filter(c => c.category === 'tyre').map((col) => (
                <div className="space-y-2" key={col.fieldName}>
                  <Label htmlFor={col.fieldName}>{col.label}</Label>
                  <Input
                    id={col.fieldName}
                    value={dynamicFormData[col.fieldName] ?? ''}
                    onChange={(e) => setDynamicFormData({ ...dynamicFormData, [col.fieldName]: e.target.value })}
                  />
                </div>
              ))}
              </div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <h4 className="font-semibold text-sm text-gray-700">Service Prices</h4>
              <div className="grid grid-cols-2 gap-4">
                {!isBuiltinHidden('amaron') && (
                <div className="space-y-2">
                  <Label htmlFor="battery_price_amaron">Amaron</Label>
                  <Input
                    id="battery_price_amaron"
                    value={formData.battery_price_amaron}
                    onChange={(e) => setFormData({ ...formData, battery_price_amaron: e.target.value })}
                  />
                </div>
                )}
                {!isBuiltinHidden('exide') && (
                <div className="space-y-2">
                  <Label htmlFor="battery_price_exide">Exide</Label>
                  <Input
                    id="battery_price_exide"
                    value={formData.battery_price_exide}
                    onChange={(e) => setFormData({ ...formData, battery_price_exide: e.target.value })}
                  />
                </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="car_wash_exterior_price">Exterior Wash</Label>
                  <Input
                    id="car_wash_exterior_price"
                    value={formData.car_wash_exterior_price}
                    onChange={(e) => setFormData({ ...formData, car_wash_exterior_price: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="car_wash_interior_exterior_price">Interior + Exterior Wash</Label>
                  <Input
                    id="car_wash_interior_exterior_price"
                    value={formData.car_wash_interior_exterior_price}
                    onChange={(e) => setFormData({ ...formData, car_wash_interior_exterior_price: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="car_wash_interior_exterior_underbody_price">Full Wash</Label>
                  <Input
                    id="car_wash_interior_exterior_underbody_price"
                    value={formData.car_wash_interior_exterior_underbody_price}
                    onChange={(e) => setFormData({ ...formData, car_wash_interior_exterior_underbody_price: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="general_service_price">General Service</Label>
                  <Input
                    id="general_service_price"
                    value={formData.general_service_price}
                    onChange={(e) => setFormData({ ...formData, general_service_price: e.target.value })}
                    placeholder="e.g. 600 or Contact Carzzi"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pickup_drop_price">Pickup &amp; Drop</Label>
                  <Input
                    id="pickup_drop_price"
                    value={formData.pickup_drop_price}
                    onChange={(e) => setFormData({ ...formData, pickup_drop_price: e.target.value })}
                  />
                </div>
                <div className="space-y-2 hidden">
                  <Label htmlFor="car_wash_price">Car Wash Price (Legacy)</Label>
                  <Input
                    id="car_wash_price"
                    value={formData.car_wash_price}
                    onChange={(e) => setFormData({ ...formData, car_wash_price: e.target.value })}
                  />
                </div>
                {columns.filter(c => c.category === 'battery').map((col) => (
                  <div className="space-y-2" key={col.fieldName}>
                    <Label htmlFor={col.fieldName}>{col.label}</Label>
                    <Input
                      id={col.fieldName}
                      value={dynamicFormData[col.fieldName] ?? ''}
                      onChange={(e) => setDynamicFormData({ ...dynamicFormData, [col.fieldName]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="battery_details">Battery Details</Label>
              <Input
                id="battery_details"
                value={formData.battery_details}
                onChange={(e) => setFormData({ ...formData, battery_details: e.target.value })}
                placeholder="e.g. 80Ah AGM"
              />
            </div>

            <DialogFooter className="pt-4 sticky bottom-0 bg-white">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingVehicle ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      )}

      {/* Manage Columns Modal */}
      {isColumnModalOpen && (
      <Dialog
        open={isColumnModalOpen}
        onOpenChange={(open) => {
          setIsColumnModalOpen(open);
          if (!open) cancelEditingColumn();
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Manage Columns</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto px-1">
            <div className="space-y-2">
              <Label>Tyre &amp; Battery Brand Columns</Label>
              <div className="flex flex-col gap-2">
                {[...builtinColumns.filter((c) => !c.hidden), ...columns].length === 0 && (
                  <p className="text-sm text-gray-500">No columns yet.</p>
                )}
                {builtinColumns.filter((c) => !c.hidden).map((c) => {
                  const isEditing = editingColumnKey === `builtin-${c.key}`;
                  return (
                    <div key={`builtin-${c.key}`} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 gap-2">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editingColumnLabel}
                          onChange={(e) => setEditingColumnLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameBuiltinColumn(c);
                            if (e.key === 'Escape') cancelEditingColumn();
                          }}
                          maxLength={40}
                          className="h-8 text-sm"
                        />
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-gray-700 truncate">{c.label}</span>
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{c.category}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 shrink-0">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRenameBuiltinColumn(c)}
                              disabled={renamingColumn}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700 px-1"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingColumn}
                              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-1"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditingColumn(`builtin-${c.key}`, c.label)}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                              title={`Rename ${c.label} column`}
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleBuiltinHidden(c.key, true, c.label)}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                              title={`Remove ${c.label} column`}
                            >
                              <X size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {columns.map((c) => {
                  const isEditing = editingColumnKey === `dynamic-${c.fieldName}`;
                  return (
                    <div key={`dynamic-${c.fieldName}`} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 gap-2">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editingColumnLabel}
                          onChange={(e) => setEditingColumnLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameDynamicColumn(c);
                            if (e.key === 'Escape') cancelEditingColumn();
                          }}
                          maxLength={40}
                          className="h-8 text-sm"
                        />
                      ) : (
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-gray-700 truncate">{c.label}</span>
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{c.category}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 shrink-0">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRenameDynamicColumn(c)}
                              disabled={renamingColumn}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700 px-1"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingColumn}
                              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-1"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditingColumn(`dynamic-${c.fieldName}`, c.label)}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                              title={`Rename ${c.label} column`}
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteColumn(c)}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                              title={`Remove ${c.label} column`}
                            >
                              <X size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {builtinColumns.some((c) => c.hidden) && (
              <div className="space-y-2 border-t pt-4">
                <Label>Hidden Columns</Label>
                <div className="flex flex-col gap-2">
                  {builtinColumns.filter((c) => c.hidden).map((c) => (
                    <div key={c.key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-700">{c.label}</span>
                      <button
                        type="button"
                        onClick={() => handleToggleBuiltinHidden(c.key, false)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 border-t pt-4">
              <Label>Add New Column</Label>
              <div className="grid grid-cols-2 gap-3">
                <select
                  id="new_column_category"
                  value={newColumnCategory}
                  onChange={(e) => setNewColumnCategory(e.target.value as 'tyre' | 'battery')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="tyre">Tyre brand</option>
                  <option value="battery">Battery brand</option>
                </select>
                <Input
                  id="new_column_label"
                  value={newColumnLabel}
                  onChange={(e) => setNewColumnLabel(e.target.value)}
                  placeholder="e.g. Continental"
                  maxLength={40}
                />
              </div>
              <Button type="button" onClick={handleAddColumn} disabled={savingColumn} className="w-full">
                <Plus size={16} className="mr-1" />
                {savingColumn ? 'Adding...' : 'Add Column'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsColumnModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </div>
    </GlobalSyncRefresh>
  );
};

export default AdminVehicleDataPage;
