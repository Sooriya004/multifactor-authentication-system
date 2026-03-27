import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Nfc, Fingerprint, KeySquare, CheckCircle, XCircle, Plus, Trash2, Loader2, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const { user, isAuthenticated } = useAuth();
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerType, setRegisterType] = useState<string | null>(null);
  const [formValue, setFormValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [pendingRFID, setPendingRFID] = useState(false);
  const [pendingFingerprint, setPendingFingerprint] = useState(false);
  const pendingCheckRef = useRef<NodeJS.Timeout | null>(null);

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

  // Poll more frequently when waiting for device registration
  useEffect(() => {
    if (isMock) return;

    // Fast polling (every 2s) when pending, normal polling (4s) otherwise
    const pollInterval = (pendingRFID || pendingFingerprint) ? 2000 : 4000;

    const timer = setInterval(() => {
      fetchCredentials().then(() => {
        // Check if the pending credential is now registered
        const rfidCred = credentials.find(c => c.type === 'rfid');
        const fpCred = credentials.find(c => c.type === 'fingerprint');

        if (pendingRFID && rfidCred?.registered) {
          setPendingRFID(false);
          toast.success('RFID card registered successfully!');
        }
        if (pendingFingerprint && fpCred?.registered) {
          setPendingFingerprint(false);
          toast.success('Fingerprint registered successfully!');
        }
      });
    }, pollInterval);

    return () => clearInterval(timer);
  }, [isMock, pendingRFID, pendingFingerprint, credentials]);

  // Timeout for pending registrations (60 seconds)
  useEffect(() => {
    if (pendingRFID || pendingFingerprint) {
      pendingCheckRef.current = setTimeout(() => {
        if (pendingRFID) {
          setPendingRFID(false);
          toast.error('RFID registration timed out. Please try again.');
        }
        if (pendingFingerprint) {
          setPendingFingerprint(false);
          toast.error('Fingerprint registration timed out. Please try again.');
        }
      }, 60000);
    }
    return () => {
      if (pendingCheckRef.current) clearTimeout(pendingCheckRef.current);
    };
  }, [pendingRFID, pendingFingerprint]);

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  const handleRegister = async () => {
    if (!registerType) return;
    if (registerType === 'keypad' && !formValue.trim()) {
      toast.error('Please enter a value');
      return;
    }

    setSubmitting(true);
    if (isMock) {
      setCredentials(c => c.map(cr => cr.type === registerType
        ? { ...cr, registered: true, registered_at: new Date().toISOString(), has_credential_value: true }
        : cr
      ));
      if (registerType === 'fingerprint') {
        toast.success('Fingerprint registration requested. Complete it on ESP32.');
      } else if (registerType === 'rfid') {
        toast.success('RFID registration requested. Scan your RFID tag on ESP32.');
      } else {
        toast.success(`${credentialMeta[registerType]?.label} registered successfully`);
      }
      setRegisterType(null);
      setFormValue('');
      setSubmitting(false);
      return;
    }

    try {
      if (registerType === 'fingerprint') {
        const response = await credentialsApi.requestFingerprintRegistration();
        toast.success(`${response.message} Assigned ID: ${response.fingerprint_id}`);
        setPendingFingerprint(true);
      } else if (registerType === 'rfid') {
        const response = await credentialsApi.requestRFIDRegistration();
        toast.success(response.message);
        setPendingRFID(true);
      } else {
        await credentialsApi.register(registerType, formValue, formValue);
        toast.success(`${credentialMeta[registerType]?.label || registerType} registered successfully`);
      }

      setRegisterType(null);
      setFormValue('');
      await fetchCredentials();
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnregister = async (type: string) => {
    if (isMock) {
      setCredentials(c => c.map(cr => cr.type === type
        ? { ...cr, registered: false, registered_at: null, has_credential_value: false }
        : cr
      ));
      toast.success('Credential unregistered');
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
                const isPending = (cred.type === 'rfid' && pendingRFID) || (cred.type === 'fingerprint' && pendingFingerprint);
                return (
                  <motion.div key={cred.id} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}
                    className={`glass-card rounded-xl p-6 flex flex-col items-center text-center ${isPending ? 'ring-2 ring-primary/50 ring-offset-2' : ''}`}>
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                      isPending ? 'bg-primary/10' : cred.registered ? 'bg-success/10' : 'bg-destructive/10'
                    }`}>
                      {isPending ? (
                        <Radio className="w-8 h-8 text-primary animate-pulse" />
                      ) : (
                        <Icon className={`w-8 h-8 ${cred.registered ? 'text-success' : 'text-destructive'}`} />
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-1">{meta.label}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{meta.desc}</p>
                    <div className="flex items-center gap-2 mb-4">
                      {isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          <span className="text-sm text-primary font-medium">Waiting for ESP32...</span>
                        </>
                      ) : cred.registered ? (
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
                    {isPending ? (
                      <div className="space-y-2">
                        <div className="text-xs text-primary animate-pulse">
                          Scan your {cred.type === 'rfid' ? 'RFID card' : 'fingerprint'} on the device
                        </div>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-muted gap-1"
                          onClick={() => {
                            if (cred.type === 'rfid') setPendingRFID(false);
                            if (cred.type === 'fingerprint') setPendingFingerprint(false);
                          }}>
                          Cancel
                        </Button>
                      </div>
                    ) : cred.registered ? (
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
                        onClick={() => setRegisterType(cred.type)}>
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
              {registerType === 'rfid' && 'This will enable RFID enrollment on ESP32. After you click Start Registration, scan the tag on the ESP32 reader.'}
              {registerType === 'fingerprint' && 'This will enable fingerprint enrollment on ESP32. After you click Start Registration, place your finger on the sensor when prompted on the device screen.'}
              {registerType === 'keypad' && 'Choose a secure PIN/password you\'ll enter on the ESP32 keypad.'}
            </p>
            {registerType === 'keypad' && (
              <div className="space-y-2">
                <Label className="text-foreground">
                  Keypad Password
                </Label>
                <Input
                  placeholder="Enter PIN"
                  value={formValue}
                  onChange={e => setFormValue(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegisterType(null)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={submitting} className="gradient-primary text-primary-foreground">
              {submitting ? 'Registering...' : registerType === 'keypad' ? 'Register' : 'Start Registration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Credentials;
