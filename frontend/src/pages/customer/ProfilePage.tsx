import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { User, Mail, Phone, MapPin, Save, Plus, Trash2, Home, Car, LogOut, Pencil } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { vehicleService, Vehicle } from '@/services/vehicleService';
import { userService } from '@/services/userService';
import VehicleCard from '@/components/VehicleCard';
import VehicleDetailModal from '@/components/VehicleDetailModal';
import LocationPicker, { LocationValue } from '@/components/LocationPicker';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isValidName, hasExcessiveRepeatedChars, isValidEmail, isValidPhone10, MAX_NAME_LENGTH, isNameTooLong } from '@/lib/formValidation';
import { logoutUser } from '@/lib/logout';
import { authService } from '@/services/authService';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';


/** Admin-created customers may have a hidden placeholder email; never show it. */
const visibleEmail = (email?: string | null) =>
  email && !email.toLowerCase().endsWith('@customer.carzzi.in') ? email : '';

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: visibleEmail(user?.email),
    phone: user?.phone || '',
  });
  // Personal details are read-only until the customer presses Edit.
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const resetForm = () =>
    setFormData({ name: user?.name || '', email: visibleEmail(user?.email), phone: user?.phone || '' });
  const [myVehicles, setMyVehicles] = useState<Vehicle[]>([]);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [selectedVehicleForDetail, setSelectedVehicleForDetail] = useState<Vehicle | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Address Form State
  const [newAddress, setNewAddress] = useState({ label: 'Home', address: '', lat: 12.9716, lng: 77.5946 });

  const availableAddressLabels = useMemo(() => {
    const usedLabels = new Set((user?.addresses || []).map((a) => a.label.trim().toLowerCase()));
    return ['Home', 'Work', 'Other'].filter((l) => l === 'Other' || !usedLabels.has(l.toLowerCase()));
  }, [user?.addresses]);

  useEffect(() => {
    const fetchData = async () => {
        try {
            const [vehicles, userData] = await Promise.all([
                vehicleService.getVehicles(),
                userService.getProfile()
            ]);
            setMyVehicles(vehicles);
            updateUser(userData);
        } catch (error) {
            console.error('Failed to fetch data', error);
        }
    };
    if (user) {
        fetchData();
    }
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setFormData({ ...formData, phone: value.replace(/\D/g, '').slice(0, 10) });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate name
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      toast.error('Full name is required');
      return;
    }
    if (isNameTooLong(trimmedName)) {
      toast.error(`Name cannot exceed ${MAX_NAME_LENGTH} characters`);
      return;
    }
    if (!isValidName(trimmedName)) {
      toast.error('Invalid name format');
      return;
    }
    if (hasExcessiveRepeatedChars(trimmedName)) {
      toast.error('Name contains excessive repeated characters');
      return;
    }

    // Validate email
    // Optional: customers booked by an admin may not have an email yet.
    const trimmedEmail = formData.email.trim();
    const emailValidation = trimmedEmail ? isValidEmail(trimmedEmail) : { valid: true };
    if (!emailValidation.valid) {
      toast.error(emailValidation.error || 'Please enter a valid email address');
      return;
    }

    // Validate phone
    const trimmedPhone = formData.phone.trim();
    if (!trimmedPhone) {
      toast.error('Phone number is required');
      return;
    }
    if (!isValidPhone10(trimmedPhone)) {
      toast.error('Enter a valid 10-digit phone number');
      return;
    }
    
    setIsSaving(true);
    try {
      const updated = await userService.updateProfile({ 
        name: trimmedName, 
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        phone: trimmedPhone.replace(/\D/g, '')
      });
      updateUser(updated);
      toast.success('Profile updated successfully!');
      setIsEditing(false);
    } catch (error) {
      toast.error('Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAddress = async () => {
    const trimmedLabel = newAddress.label.trim();
    const trimmedAddress = newAddress.address.trim();

    if (!trimmedLabel) {
      toast.error('Address label is required');
      return;
    }
    if (trimmedLabel.length > 50) {
      toast.error('Address label cannot exceed 50 characters');
      return;
    }
    if (hasExcessiveRepeatedChars(trimmedLabel)) {
      toast.error('Address label contains invalid characters');
      return;
    }

    if (!trimmedAddress) {
      toast.error('Full address is required');
      return;
    }
    if (trimmedAddress.length > 500) {
      toast.error('Address cannot exceed 500 characters');
      return;
    }
    if (hasExcessiveRepeatedChars(trimmedAddress)) {
      toast.error('Address contains invalid characters');
      return;
    }

    const currentAddresses = user?.addresses || [];
    const duplicateLabel = currentAddresses.some(
      (a) => a.label.trim().toLowerCase() === trimmedLabel.toLowerCase()
    );
    if (duplicateLabel) {
      toast.error(`A "${trimmedLabel}" address already exists. Please edit or delete it first, or choose a different label.`);
      return;
    }

    try {
      const updatedAddresses = [...currentAddresses, {
        ...newAddress, 
        label: trimmedLabel, 
        address: trimmedAddress,
        isDefault: currentAddresses.length === 0 
      }];
      const updatedUser = await userService.updateProfile({ addresses: updatedAddresses });
      updateUser(updatedUser);
      setIsAddressModalOpen(false);
      setNewAddress({ label: 'Home', address: '', lat: 12.9716, lng: 77.5946 });
      toast.success('Address added');
    } catch (error) {
      toast.error('Failed to add address');
    }
  };

  const handleDeleteAddress = async (index: number) => {
    try {
      const currentAddresses = user?.addresses || [];
      const updatedAddresses = currentAddresses.filter((_, i) => i !== index);
      const updatedUser = await userService.updateProfile({ addresses: updatedAddresses });
      updateUser(updatedUser);
      toast.success('Address removed');
    } catch (error) {
      toast.error('Failed to remove address');
    }
  };

  return (
    <div className="w-full h-full py-4 lg:py-6 space-y-6 sm:space-y-8">
      <h1 className="text-xl sm:text-2xl font-bold text-foreground">Profile</h1>

      {/* Avatar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg">
            <User className="w-10 h-10 text-white" />
          </div>
        </div>
        <h2 className="mt-4 text-xl font-semibold">{user?.name || 'User'}</h2>
        {visibleEmail(user?.email) && <p className="text-muted-foreground">{visibleEmail(user?.email)}</p>}
      </motion.div>

      {/* Personal Details */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <User className="w-5 h-5 text-primary" /> Personal Details
          </h3>
          {!isEditing && (
            <Button type="button" variant="outline" className="gap-2" onClick={() => setIsEditing(true)}>
              <Pencil className="w-4 h-4" /> Edit
            </Button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="name" name="name" value={formData.name} onChange={handleChange} readOnly={!isEditing} aria-readonly={!isEditing} className={`pl-10 ${isEditing ? '' : 'bg-muted/40 cursor-default focus-visible:ring-0 focus-visible:ring-offset-0'}`} placeholder={isEditing ? 'John Doe' : undefined} maxLength={MAX_NAME_LENGTH} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="email" name="email" value={formData.email} onChange={handleChange} readOnly={!isEditing} aria-readonly={!isEditing} className={`pl-10 ${isEditing ? '' : 'bg-muted/40 cursor-default focus-visible:ring-0 focus-visible:ring-offset-0'}`} placeholder={isEditing ? undefined : 'Not added'} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="phone" name="phone" value={formData.phone} onChange={handleChange} readOnly={!isEditing} aria-readonly={!isEditing} className={`pl-10 ${isEditing ? '' : 'bg-muted/40 cursor-default focus-visible:ring-0 focus-visible:ring-offset-0'}`} placeholder={isEditing ? '9876543210' : undefined} maxLength={10} inputMode="numeric" />
              </div>
            </div>
          </div>
          {isEditing && (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => {
                  resetForm();
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" className="gap-2" disabled={isSaving}>
                <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </form>
      </section>

      {/* Saved Addresses */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" /> Saved Addresses
          </h3>
          <Dialog
            open={isAddressModalOpen}
            onOpenChange={(open) => {
              setIsAddressModalOpen(open);
              if (open) {
                setNewAddress((prev) => ({
                  ...prev,
                  label: availableAddressLabels[0] || 'Other',
                }));
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Plus className="w-4 h-4" /> Add Address
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
              <DialogHeader>
                <DialogTitle>Add New Address</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2 min-w-0">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <select
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={newAddress.label}
                    onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })}
                  >
                    {availableAddressLabels.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Full Address</Label>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <LocationPicker
                      value={{
                        address: newAddress.address,
                        lat: newAddress.lat,
                        lng: newAddress.lng
                      }}
                      onChange={(val: LocationValue) => {
                        setNewAddress({
                          ...newAddress,
                          address: val.address,
                          lat: val.lat || 0,
                          lng: val.lng || 0
                        });
                      }}
                      mapClassName="h-[250px]"
                    />
                  </div>
                </div>
                <Button onClick={handleAddAddress} className="w-full min-h-[44px]">Save Address</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {user?.addresses && user.addresses.length > 0 ? (
            user.addresses.map((addr, index) => (
              <div key={index} className="bg-card border border-border rounded-xl p-4 flex justify-between items-start group hover:border-primary/50 transition-colors">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Home className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{addr.label}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{addr.address}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDeleteAddress(index)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-8 text-muted-foreground bg-muted/30 rounded-xl border border-dashed border-border">
              No saved addresses yet.
            </div>
          )}
        </div>
      </section>

      {/* Vehicles */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Car className="w-5 h-5 text-primary" /> My Vehicles
        </h3>
        <div className="space-y-3">
          {myVehicles.length > 0 ? (
             myVehicles.map((v) => (
                <VehicleCard 
                  key={v._id} 
                  id={v._id} 
                  {...v} 
                  compact 
                  onClick={() => navigate(`/vehicles/${v._id}`)} 
                />
              ))
          ) : (
            <p className="text-muted-foreground text-sm">No vehicles found.</p>
          )}
        </div>
      </section>

      {/* Account actions */}
      <section className="bg-card rounded-2xl border border-border p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Account</h3>
          <p className="text-sm text-muted-foreground">Sign out of this device or permanently delete your account.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:shrink-0">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto sm:min-w-[140px]"
          onClick={async () => {
            await logoutUser();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto sm:min-w-[160px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete your profile, vehicles, and notifications.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeletingAccount}
                onClick={async (e) => {
                  e.preventDefault();
                  setIsDeletingAccount(true);
                  try {
                    await authService.deleteAccount();
                    useAuthStore.getState().logout();
                    navigate('/login', { replace: true });
                  } catch (error: unknown) {
                    const err = error as { response?: { data?: { message?: string } } };
                    toast.error(err.response?.data?.message || 'Failed to delete account');
                  } finally {
                    setIsDeletingAccount(false);
                  }
                }}
              >
                Delete Account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
      </section>

      {/* Vehicle Detail Modal */}
      <VehicleDetailModal
        vehicle={selectedVehicleForDetail}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedVehicleForDetail(null);
        }}
      />
    </div>
  );
};

export default ProfilePage;
