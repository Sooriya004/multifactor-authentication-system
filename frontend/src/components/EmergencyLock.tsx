import { useState } from 'react';
import { Lock, Unlock, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useLockdown } from '@/lib/lockdownContext';
import { toast } from 'sonner';

const EmergencyLock = () => {
  const { isLockdown, lockdownAt, toggleLockdown } = useLockdown();
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      await toggleLockdown();
      toast.success(isLockdown ? 'Lockdown lifted' : 'House locked down');
    } catch {
      toast.error('Failed to toggle lockdown');
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <div className={`glass-card rounded-xl p-6 ${isLockdown ? 'ring-2 ring-destructive/40' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isLockdown ? 'bg-destructive/10' : 'bg-destructive/5'}`}>
            <ShieldAlert className={`w-5 h-5 ${isLockdown ? 'text-destructive' : 'text-destructive/60'}`} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Emergency Lock</h3>
            <p className="text-xs text-muted-foreground">
              {isLockdown
                ? `Lockdown active since ${lockdownAt ? new Date(lockdownAt).toLocaleString() : 'now'}`
                : 'Lock the house — blocks all access'}
            </p>
          </div>
        </div>

        {isLockdown ? (
          <Button onClick={() => setShowConfirm(true)} variant="outline"
            className="w-full border-success/30 text-success hover:bg-success/10 gap-2">
            <Unlock className="w-4 h-4" /> Lift Lockdown
          </Button>
        ) : (
          <Button onClick={() => setShowConfirm(true)} variant="outline"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 gap-2">
            <Lock className="w-4 h-4" /> Activate Lockdown
          </Button>
        )}
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <ShieldAlert className={`w-5 h-5 ${isLockdown ? 'text-success' : 'text-destructive'}`} />
              {isLockdown ? 'Lift Lockdown' : 'Activate Emergency Lockdown'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {isLockdown ? (
                <p>This will restore normal access. All members will be able to authenticate and unlock the door again.</p>
              ) : (
                <div className="space-y-3 pt-1">
                  <p>This will <strong className="text-destructive">immediately block all access</strong> to the house.</p>
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive text-xs space-y-1">
                    <p className="font-semibold">While lockdown is active:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>No one can unlock the door — including admins</li>
                      <li>Emergency unlock is disabled</li>
                      <li>ESP32 will reject all authentication attempts</li>
                      <li>Only you (primary admin) can lift the lockdown</li>
                    </ul>
                  </div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={handleToggle} disabled={loading}
              className={isLockdown ? 'bg-success text-success-foreground hover:bg-success/90' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isLockdown ? 'Lift Lockdown' : 'Lock Down Now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EmergencyLock;
