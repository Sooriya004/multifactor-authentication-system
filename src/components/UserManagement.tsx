import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCheck, UserX, ShieldCheck, ShieldMinus, Ban, Unlock, Trash2, Crown, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { mockUsers, mockJoinRequests, type User, type JoinRequest } from '@/lib/mockData';
import { toast } from 'sonner';

const UserManagement = () => {
  const [users, setUsers] = useState(mockUsers);
  const [requests, setRequests] = useState(mockJoinRequests);
  const [confirmAction, setConfirmAction] = useState<{ type: string; target: string; name: string } | null>(null);

  const statusBadge = (s: User['status']) => {
    if (s === 'active') return 'bg-success/10 text-success border-success/20';
    if (s === 'blocked') return 'bg-destructive/10 text-destructive border-destructive/20';
    return 'bg-warning/10 text-warning border-warning/20';
  };

  const executeAction = () => {
    if (!confirmAction) return;
    const { type, target } = confirmAction;
    if (type === 'approve') {
      setRequests(r => r.map(req => req.id === target ? { ...req, status: 'approved' as const } : req));
      toast.success('Request approved');
    } else if (type === 'reject') {
      setRequests(r => r.map(req => req.id === target ? { ...req, status: 'rejected' as const } : req));
      toast.success('Request rejected');
    } else if (type === 'promote') {
      setUsers(u => u.map(usr => usr.id === target ? { ...usr, role: 'admin' as const } : usr));
      toast.success('User promoted to admin');
    } else if (type === 'demote') {
      setUsers(u => u.map(usr => usr.id === target ? { ...usr, role: 'member' as const } : usr));
      toast.success('User demoted to member');
    } else if (type === 'block') {
      setUsers(u => u.map(usr => usr.id === target ? { ...usr, status: 'blocked' as const } : usr));
      toast.success('User blocked');
    } else if (type === 'unblock') {
      setUsers(u => u.map(usr => usr.id === target ? { ...usr, status: 'active' as const } : usr));
      toast.success('User unblocked');
    } else if (type === 'remove') {
      setUsers(u => u.filter(usr => usr.id !== target));
      toast.success('User removed');
    }
    setConfirmAction(null);
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Join Requests */}
      {pendingRequests.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Pending Join Requests ({pendingRequests.length})
          </h3>
          <div className="space-y-2">
            {pendingRequests.map((req) => (
              <motion.div key={req.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="glass-card rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{req.userName}</div>
                  <div className="text-xs text-muted-foreground">{req.email} · {req.requestedAt}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-success/10 text-success hover:bg-success/20 gap-1"
                    onClick={() => setConfirmAction({ type: 'approve', target: req.id, name: req.userName })}>
                    <UserCheck className="w-4 h-4" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 gap-1"
                    onClick={() => setConfirmAction({ type: 'reject', target: req.id, name: req.userName })}>
                    <UserX className="w-4 h-4" /> Reject
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Users List */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">House Members</h3>
        <div className="space-y-2">
          {users.map((u) => (
            <motion.div key={u.id} layout className="glass-card rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  {u.isPrimaryAdmin ? <Crown className="w-5 h-5 text-primary" /> : <span className="text-sm font-bold text-primary">{u.fullName[0]}</span>}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground flex items-center gap-2">
                    {u.fullName}
                    {u.isPrimaryAdmin && <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">Primary</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email} · {u.role}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={statusBadge(u.status)}>{u.status}</Badge>
                {!u.isPrimaryAdmin && (
                  <div className="flex gap-1">
                    {u.role === 'member' ? (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-primary h-8 px-2"
                        onClick={() => setConfirmAction({ type: 'promote', target: u.id, name: u.fullName })} title="Promote to Admin">
                        <ShieldCheck className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-warning h-8 px-2"
                        onClick={() => setConfirmAction({ type: 'demote', target: u.id, name: u.fullName })} title="Demote to Member">
                        <ShieldMinus className="w-4 h-4" />
                      </Button>
                    )}
                    {u.status === 'active' ? (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive h-8 px-2"
                        onClick={() => setConfirmAction({ type: 'block', target: u.id, name: u.fullName })} title="Block User">
                        <Ban className="w-4 h-4" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-success h-8 px-2"
                        onClick={() => setConfirmAction({ type: 'unblock', target: u.id, name: u.fullName })} title="Unblock User">
                        <Unlock className="w-4 h-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive h-8 px-2"
                      onClick={() => setConfirmAction({ type: 'remove', target: u.id, name: u.fullName })} title="Remove User">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirm Action</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to {confirmAction?.type} <strong>{confirmAction?.name}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button onClick={executeAction} className="gradient-primary text-primary-foreground">Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
