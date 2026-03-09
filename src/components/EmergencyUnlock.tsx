import { useState } from 'react';
import { LockOpen, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useLockdown } from '@/lib/lockdownContext';
import { toast } from 'sonner';

const EmergencyUnlock = () => {
  const { isLockdown } = useLockdown();
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleUnlock = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/esp/emergency-unlock`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('fortinest_token')}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (data.action === 'unlock') {
        toast.success('Door unlocked remotely');
      } else {
        toast.error('Unlock failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send unlock command');
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <div className="glass-card rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
            <LockOpen className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Emergency Unlock</h3>
            <p className="text-xs text-muted-foreground">Remotely unlock the door in emergencies</p>
          </div>
        </div>
        {isLockdown ? (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <ShieldAlert className="w-6 h-6 text-destructive" />
            <p className="text-xs text-destructive font-medium">Blocked during lockdown</p>
          </div>
        ) : (
          <Button onClick={() => setShowConfirm(true)} variant="outline" className="w-full border-warning/30 text-warning hover:bg-warning/10 gap-2">
            <LockOpen className="w-4 h-4" /> Remote Unlock
          </Button>
        )}
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" /> Emergency Unlock
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will send an immediate unlock command to the ESP32 device. This action will be logged as an emergency override.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={handleUnlock} disabled={loading} className="bg-warning text-warning-foreground hover:bg-warning/90">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Confirm Unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EmergencyUnlock;
