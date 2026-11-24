import api from './api';

export const importVehicleReference = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/vehicle-reference/import', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const getVehicleReference = async () => {
  const response = await api.get('/vehicle-reference');
  return response.data;
};

export const searchVehicleReference = async (
  brand_name: string,
  model: string,
  variant?: string,
  fuel_type?: string,
  year?: number | null,
) => {
  const b = (brand_name || '').trim();
  const m = (model || '').trim();
  if (!b || !m) return null;
  const params = new URLSearchParams({ brand_name: b, model: m });
  const v = (variant || '').trim();
  if (v) params.set('variant', v);
  const f = (fuel_type || '').trim();
  if (f) params.set('fuel_type', f);
  // Catalogue rows are per year range (PDF rule: manufacturing year picks the period).
  if (year && year > 1950) params.set('year', String(year));
  try {
    const response = await api.get(`/vehicle-reference/search?${params.toString()}`);
    return response.data;
  } catch {
    return null;
  }
};

export const createVehicleReference = async (data: any) => {
  const response = await api.post('/vehicle-reference', data);
  return response.data;
};

export const updateVehicleReference = async (id: string, data: any) => {
  const response = await api.put(`/vehicle-reference/${id}`, data);
  return response.data;
};

export const deleteVehicleReference = async (id: string) => {
  const response = await api.delete(`/vehicle-reference/${id}`);
  return response.data;
};

export const deleteAllVehicleReference = async () => {
  const response = await api.delete('/vehicle-reference/all');
  return response.data;
};

export interface VehicleReferenceColumn {
  key: string;
  label: string;
  category: 'tyre' | 'battery';
  fieldName: string;
  createdAt?: string;
}

export const getVehicleReferenceColumns = async (): Promise<VehicleReferenceColumn[]> => {
  const response = await api.get('/vehicle-reference/columns');
  return response.data;
};

export const addVehicleReferenceColumn = async (label: string, category: 'tyre' | 'battery') => {
  const response = await api.post('/vehicle-reference/columns', { label, category });
  return response.data as VehicleReferenceColumn;
};

export const deleteVehicleReferenceColumn = async (category: string, key: string) => {
  const response = await api.delete(`/vehicle-reference/columns/${category}/${key}`);
  return response.data;
};

export const renameVehicleReferenceColumn = async (category: string, key: string, label: string) => {
  const response = await api.put(`/vehicle-reference/columns/${category}/${key}`, { label });
  return response.data as VehicleReferenceColumn;
};

export interface VehicleReferenceBuiltinColumn {
  key: string;
  label: string;
  category: 'tyre' | 'battery';
  fieldName: string;
  hidden: boolean;
}

export const getVehicleReferenceBuiltinColumns = async (): Promise<VehicleReferenceBuiltinColumn[]> => {
  const response = await api.get('/vehicle-reference/builtin-columns');
  return response.data;
};

export const setVehicleReferenceBuiltinColumnHidden = async (key: string, hidden: boolean) => {
  const response = await api.put(`/vehicle-reference/builtin-columns/${key}`, { hidden });
  return response.data as VehicleReferenceBuiltinColumn;
};

export const renameVehicleReferenceBuiltinColumn = async (key: string, label: string) => {
  const response = await api.put(`/vehicle-reference/builtin-columns/${key}`, { label });
  return response.data as VehicleReferenceBuiltinColumn;
};
