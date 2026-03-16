import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Nfc, Fingerprint, KeySquare, CheckCircle, XCircle, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

import { useAuth } from '@/lib/authContext';
import { credentialsApi, type ApiCredential } from '@/lib/api';
import { mockCredentials } from '@/lib/mockData';
import Navbar from '@/components/Navbar';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

const credentialMeta: Record<string, { icon: typeof Nfc; label: string; desc: string }> = {
  rfid: { icon: Nfc, label: 'RFID Tag', desc: 'Contactless NFC/RFID card or tag' },
  fingerprint: { icon: Fingerprint, label: 'Fingerprint', desc: 'Biometric fingerprint scanner' },
  keypad: { icon: KeySquare, label: 'Keypad Password', desc: 'Numeric or alphanumeric code' },
};

function toApiCred(m: typeof mockCredentials[0]): ApiCredential {
  return { id: m.id, type: m.type, registered: m.registered, registered_at: m.registeredAt || null, has_credential_value: m.registered };
}

const Credentials = () => {
  const { user, isAuthenticated, isMockMode } = useAuth();
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerType, setRegisterType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isMock, setIsMock] = useState(false);

  const fetchCredentials = async () => {
    try {
      const data = await credentialsApi.getAll();
      setCredentials(data.filter(c => c.type !== 'otp'));
    } catch {
      setIsMock(true);
      setCredentials(mockCredentials.map(toApiCred));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCredentials(); }, []);

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  const handleRegister = async () => {
    if (!registerType) return;
    setSubmitting(true);
    if (isMock) {
      toast.error('Backend is offline (mock mode). ESP32 will not receive registration requests.');
      setRegisterType(null);
      setSubmitting(false);
      return;
    }

    try {
      if (registerType === 'fingerprint') {
        const response = await credentialsApi.requestFingerprintRegistration();
        toast.success(`${response.message} Assigned ID: ${response.fingerprint_id}`);
      } else {
        const response = await credentialsApi.requestDeviceRegistration(registerType);
        toast.success(response.message);
      }

      setRegisterType(null);
      await fetchCredentials();
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnregister = async (type: string) => {
    if (isMock) {
      toast.error('Backend is offline (mock mode). Unable to sync credential changes.');
      return;
    }
    try {
      await credentialsApi.unregister(type);
      toast.success('Credential unregistered');
      await fetchCredentials();
    } catch (err: any) {
      toast.error(err.message || 'Failed to unregister');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-foreground mb-2">Register Credentials</h1>
          <p className="text-muted-foreground mb-8">Manage your authentication credentials for access control. Register via your ESP32 device.</p>
          {(isMock || isMockMode) && (
            <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Backend connection not available. Registration/unregistration here will not trigger ESP32 actions.
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {credentials.map((cred) => {
                const meta = credentialMeta[cred.type];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <motion.div key={cred.id} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}
                    className="glass-card rounded-xl p-6 flex flex-col items-center text-center">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${cred.registered ? 'bg-success/10' : 'bg-destructive/10'}`}>
                      <Icon className={`w-8 h-8 ${cred.registered ? 'text-success' : 'text-destructive'}`} />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-1">{meta.label}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{meta.desc}</p>
                    <div className="flex items-center gap-2 mb-4">
                      {cred.registered ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-success" />
                          <span className="text-sm text-success font-medium">Registered</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-destructive" />
                          <span className="text-sm text-destructive font-medium">Not Registered</span>
                        </>
                      )}
                    </div>
                    {cred.registered ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                          Since {cred.registered_at ? new Date(cred.registered_at).toLocaleDateString() : '—'}
                        </div>
                        <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 gap-1"
                          onClick={() => handleUnregister(cred.type)}>
                          <Trash2 className="w-3 h-3" /> Unregister
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" className="gradient-primary text-primary-foreground gap-1"
                        onClick={() => {
                          setRegisterType(cred.type);
                          toast.info('Click "Start Registration" in the popup to send request to ESP32');
                        }}>
                        <Plus className="w-4 h-4" /> Register
                      </Button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </main>

      <Dialog open={!!registerType} onOpenChange={() => setRegisterType(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Register {registerType && credentialMeta[registerType]?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {registerType === 'rfid' && 'Tap your RFID tag on the ESP32 reader when prompted on the device screen.'}
              {registerType === 'fingerprint' && 'This will enable fingerprint enrollment on ESP32. After you click Start, place your finger on the sensor when prompted on the device screen.'}
              {registerType === 'keypad' && 'Enter your PIN on the ESP32 keypad when prompted on the device screen.'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegisterType(null)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={submitting} className="gradient-primary text-primary-foreground">
              {submitting ? 'Starting...' : 'Start Registration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Credentials;
