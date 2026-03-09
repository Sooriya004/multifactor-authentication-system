import { useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { usersApi } from '@/lib/api';
import { useAuth } from '@/lib/authContext';
import { toast } from 'sonner';

const SelfBlockButton = () => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const { logout } = useAuth();

  const handleSelfBlock = async () => {
    setLoading(true);
    try {
      await usersApi.selfBlock();
      toast.success('Account blocked. Contact your admin to unblock.');
      logout();
    } catch (err: any) {
      toast.error(err.message || 'Failed to block account');
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <Button onClick={() => setShowConfirm(true)} variant="outline" size="sm"
        className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-2">
        <ShieldAlert className="w-4 h-4" /> Block My Account
      </Button>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" /> Block Your Account
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              If you suspect suspicious activity, blocking your account will immediately revoke all access.
              You'll need to contact an admin to unblock your account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={handleSelfBlock} disabled={loading} variant="destructive">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Block My Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SelfBlockButton;
