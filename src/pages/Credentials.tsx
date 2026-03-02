import { useState } from 'react';
import { motion } from 'framer-motion';
import { Nfc, Fingerprint, KeySquare, CheckCircle, XCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/authContext';
import { mockCredentials, type Credential } from '@/lib/mockData';
import Navbar from '@/components/Navbar';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

const credentialMeta = {
  rfid: { icon: Nfc, label: 'RFID Tag', desc: 'Contactless NFC/RFID card or tag' },
  fingerprint: { icon: Fingerprint, label: 'Fingerprint', desc: 'Biometric fingerprint scanner' },
  keypad: { icon: KeySquare, label: 'Keypad Password', desc: 'Numeric or alphanumeric code' },
};

const Credentials = () => {
  const { user, isAuthenticated } = useAuth();
  const [credentials, setCredentials] = useState(mockCredentials);
  const [registerType, setRegisterType] = useState<Credential['type'] | null>(null);
  const [formValue, setFormValue] = useState('');

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  const handleRegister = () => {
    if (!formValue.trim()) { toast.error('Please enter a value'); return; }
    setCredentials(c => c.map(cr => cr.type === registerType ? { ...cr, registered: true, registeredAt: new Date().toISOString().split('T')[0] } : cr));
    toast.success(`${credentialMeta[registerType!].label} registered successfully`);
    setRegisterType(null);
    setFormValue('');
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-foreground mb-2">Register Credentials</h1>
          <p className="text-muted-foreground mb-8">Manage your authentication credentials for access control.</p>

          <div className="grid md:grid-cols-3 gap-6">
            {credentials.map((cred) => {
              const meta = credentialMeta[cred.type];
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
                    <div className="text-xs text-muted-foreground">Since {cred.registeredAt}</div>
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
        </motion.div>
      </main>

      <Dialog open={!!registerType} onOpenChange={() => setRegisterType(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Register {registerType && credentialMeta[registerType].label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-foreground">
                {registerType === 'rfid' ? 'Tag ID' : registerType === 'fingerprint' ? 'Scan Fingerprint' : 'Set Password'}
              </Label>
              <Input placeholder={registerType === 'rfid' ? 'Scan or enter RFID tag ID' : registerType === 'keypad' ? 'Enter keypad password' : 'Place finger on scanner'}
                value={formValue} onChange={e => setFormValue(e.target.value)} className="bg-secondary border-border" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegisterType(null)}>Cancel</Button>
            <Button onClick={handleRegister} className="gradient-primary text-primary-foreground">Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Credentials;
