import api from './api';

export interface Vehicle {
    _id: string;
    make: string;
    model: string;
    variant?: string;
    year?: number;
    licensePlate: string;
    color?: string;
    image?: string;
    vin?: string;
    mileage?: number;
    fuelType?: string;
    /** Saved from Vahan when the vehicle was added (blank for manual entry). */
    bodyType?: string;
    manufacturingMonthYear?: string;
    insuranceValidUpto?: string;
    registrationValidUpto?: string;
    frontTyres?: string;
    rearTyres?: string;
    batteryDetails?: string;
    type?: 'Car';
    status?: 'Idle' | 'On Route' | 'In Service';
    lastService?: string;
    nextService?: string;
    /** Set on any health save; UI shows 100% minus 1 per calendar day since this moment for all indicators. */
    healthPercentBaselineAt?: string | Date;
    /** Server-computed display % for baseline mode (same for all indicators). Prefer over client-only decay when present. */
    healthPercentDisplay?: number;
    user?: string | { _id: string; name: string; email: string; phone?: string }; // User ID or Populated User
    healthIndicators?: {
        generalService?: { value: number; lastUpdated: string; fixedKm: number; fixedDays: number; lastServiceKm?: number; lastServiceDate?: string };
        brakePads?: { value: number; lastUpdated: string; fixedKm: number; fixedDays: number; lastServiceKm?: number; lastServiceDate?: string };
        tires?: { value: number; lastUpdated: string; fixedKm: number; fixedDays: number; lastServiceKm?: number; lastServiceDate?: string };
        battery?: { value: number; lastUpdated: string; fixedKm: number; fixedDays: number; lastServiceKm?: number; lastServiceDate?: string };
        wiperBlade?: { value: number; lastUpdated: string; fixedKm: number; fixedDays: number; lastServiceKm?: number; lastServiceDate?: string };
    };
}

export const vehicleService = {
    getVehicles: async () => {
        const response = await api.get('/vehicles');
        return response.data;
    },
    getAllVehicles: async () => {
        const response = await api.get('/vehicles/all');
        return response.data;
    },
    getVehicleById: async (id: string) => {
        const response = await api.get(`/vehicles/${id}`);
        return response.data;
    },
    getUserVehicles: async (userId: string) => {
        const response = await api.get(`/vehicles/user/${userId}`);
        return response.data;
    },
    addVehicle: async (data: Partial<Omit<Vehicle, '_id'>>) => {
        const response = await api.post('/vehicles', data);
        return response.data;
    },
    updateVehicle: async (id: string, data: Partial<Omit<Vehicle, '_id'>>) => {
        const response = await api.put(`/vehicles/${id}`, data);
        return response.data;
    },
    deleteVehicle: async (id: string) => {
        const response = await api.delete(`/vehicles/${id}`);
        return response.data;
    },
    fetchVehicleDetails: async (licensePlate: string) => {
        const response = await api.post('/vehicles/fetch-details', { licensePlate });
        return response.data;
    },
    getVehicleRCDetails: async (vehicleNumber: string) => {
        const response = await api.post('/vehicles/rc-details', { vehicle_number: vehicleNumber });
        return response.data;
    },
    updateVehicleHealth: async (id: string, healthIndicators: Record<string, any>) => {
        const response = await api.put(`/vehicles/${id}/health`, { healthIndicators });
        return response.data;
    },
};

/** Normalised Vahan (Parivahan) lookup result — vehicle attributes only, no owner PII. */
export interface VahanVehicle {
    found: boolean;
    registrationNumber: string;
    maker: string;
    makerMasked: boolean;
    model: string;
    modelMasked: boolean;
    fuelRaw: string;
    fuelType: string;
    year: number | null;
    color: string;
    chassisNumber: string;
    engineNumber: string;
    bodyType: string;
    vehicleClass: string;
    /** The 19 Annexure-I fields, always all present in agreement order (provided=false when Vahan sent nothing). */
    details?: { sno: number; group: string; key: string; label: string; value: string; provided: boolean; masked: boolean }[];
}

export const vahanService = {
    status: async (): Promise<{ enabled: boolean }> => (await api.get('/vehicles/vahan/status')).data,
    byRegistration: async (regnNo: string): Promise<VahanVehicle> =>
        (await api.post('/vehicles/vahan/lookup', { regnNo }, { timeout: 30000 })).data,
    byChassisEngine: async (chasiNo: string, engNo: string): Promise<VahanVehicle> =>
        (await api.post('/vehicles/vahan/lookup', { chasiNo, engNo })).data,
};
