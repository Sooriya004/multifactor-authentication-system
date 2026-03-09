import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Phone, MapPin, Calendar, Shield, Loader2, Save, Lock, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/authContext';
import { usersApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import Navbar from '@/components/Navbar';
import { Navigate } from 'react-router-dom';

const Profile = () => {
  const { user, isAuthenticated, loading, updateUser } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullName: user?.fullName || '',
    phone: user?.phone || '',
    address: user?.address || '',
    dob: user?.dob || '',
  });

  // Email change
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [savingEmail, setSavingEmail] = useState(false);

  // Password change
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPassword, setSavingPassword] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  const handleSave = async () => {
    setSaving(true);
    try {
      await usersApi.updateProfile({
        full_name: form.fullName,
        phone: form.phone || undefined,
        address: form.address || undefined,
        dob: form.dob || undefined,
      });
      updateUser({
        fullName: form.fullName,
        phone: form.phone || null,
        address: form.address || null,
        dob: form.dob || null,
      });
      toast({ title: 'Profile updated', description: 'Your account details have been saved.' });
    } catch (err: any) {
      if (err.message === '__MOCK__') {
        updateUser({
          fullName: form.fullName,
          phone: form.phone || null,
          address: form.address || null,
          dob: form.dob || null,
        });
        toast({ title: 'Profile updated (mock)', description: 'Changes saved locally.' });
      } else {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!emailForm.newEmail || !emailForm.password) return;
    setSavingEmail(true);
    try {
      await usersApi.changeEmail(emailForm.newEmail, emailForm.password);
      updateUser({ email: emailForm.newEmail });
      setEmailForm({ newEmail: '', password: '' });
      toast({ title: 'Email updated', description: 'Your email has been changed.' });
    } catch (err: any) {
      if (err.message === '__MOCK__') {
        updateUser({ email: emailForm.newEmail });
        setEmailForm({ newEmail: '', password: '' });
        toast({ title: 'Email updated (mock)', description: 'Email changed locally.' });
      } else {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({ title: 'Error', description: 'New passwords do not match.', variant: 'destructive' });
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast({ title: 'Error', description: 'Password must be at least 8 characters.', variant: 'destructive' });
      return;
    }
    setSavingPassword(true);
    try {
      await usersApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast({ title: 'Password updated', description: 'Your password has been changed.' });
    } catch (err: any) {
      if (err.message === '__MOCK__') {
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        toast({ title: 'Password updated (mock)', description: 'Password changed locally.' });
      } else {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12 max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-foreground mb-2">Profile</h1>
          <p className="text-muted-foreground mb-8">Manage your account details</p>

          {/* Profile Info Card */}
          <div className="glass-card rounded-2xl p-6 space-y-6">
            {/* Read-only info */}
            <div className="flex items-center gap-4 pb-4 border-b border-border">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-7 h-7 text-primary" />
              </div>
              <div>
                <div className="text-lg font-semibold text-foreground">{user.fullName}</div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="w-3.5 h-3.5" /> {user.email}
                </div>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1">
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {user.isPrimaryAdmin ? '👑 Primary Admin' : user.role === 'admin' ? '🛡️ Admin' : '👤 Member'}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">House: {user.houseCode}</span>
              </div>
            </div>

            {/* Editable fields */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName" className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" /> Full Name
                </Label>
                <Input id="fullName" value={form.fullName}
                  onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                  className="bg-secondary border-border" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" /> Phone
                </Label>
                <Input id="phone" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+1234567890"
                  className="bg-secondary border-border" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address" className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> Address
                </Label>
                <Input id="address" value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="123 Main Street"
                  className="bg-secondary border-border" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dob" className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" /> Date of Birth
                </Label>
                <Input id="dob" type="date" value={form.dob}
                  onChange={e => setForm(f => ({ ...f, dob: e.target.value }))}
                  className="bg-secondary border-border" />
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving || !form.fullName.trim()} className="w-full gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </Button>
          </div>
        </motion.div>

        {/* Change Email Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="glass-card rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" /> Change Email
            </h2>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="newEmail">New Email</Label>
                <Input id="newEmail" type="email" value={emailForm.newEmail}
                  onChange={e => setEmailForm(f => ({ ...f, newEmail: e.target.value }))}
                  placeholder="newemail@example.com"
                  className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailPassword">Current Password</Label>
                <Input id="emailPassword" type="password" value={emailForm.password}
                  onChange={e => setEmailForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Enter your password to confirm"
                  className="bg-secondary border-border" />
              </div>
            </div>
            <Button onClick={handleChangeEmail}
              disabled={savingEmail || !emailForm.newEmail || !emailForm.password}
              variant="outline" className="w-full gap-2">
              {savingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Update Email
            </Button>
          </div>
        </motion.div>

        {/* Change Password Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="glass-card rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Change Password
            </h2>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input id="currentPassword" type="password" value={passwordForm.currentPassword}
                  onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))}
                  placeholder="Enter current password"
                  className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" value={passwordForm.newPassword}
                  onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))}
                  placeholder="Min 8 characters"
                  className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input id="confirmPassword" type="password" value={passwordForm.confirmPassword}
                  onChange={e => setPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="Re-enter new password"
                  className="bg-secondary border-border" />
              </div>
            </div>
            <Button onClick={handleChangePassword}
              disabled={savingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
              variant="outline" className="w-full gap-2">
              {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Update Password
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default Profile;
