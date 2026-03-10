import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCheck, UserX, ShieldCheck, ShieldMinus, Ban, Unlock, Trash2, Crown, AlertTriangle, Loader2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { usersApi, type ApiUser, type ApiJoinRequest } from '@/lib/api';
import { mockUsers as rawMockUsers, mockJoinRequests as rawMockJoinRequests } from '@/lib/mockData';
import { useAuth } from '@/lib/authContext';
import { useHouse } from '@/lib/houseContext';
import { toast } from 'sonner';

function toApiUser(m: typeof rawMockUsers[0]): ApiUser {
  return { id: m.id, full_name: m.fullName, email: m.email, phone: m.phone, role: m.role, is_primary_admin: m.isPrimaryAdmin, status: m.status, house_id: m.houseId, joined_at: m.joinedAt };
}
function toApiJoinReq(m: typeof rawMockJoinRequests[0]): ApiJoinRequest {
  return { id: m.id, user_id: m.userId, user_name: m.userName, user_email: m.email, house_code: m.houseCode, requested_at: m.requestedAt, status: m.status };
}

const UserManagement = () => {
  const { user: currentAuthUser, updateUser } = useAuth();
  const { activeHouse } = useHouse();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [requests, setRequests] = useState<ApiJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ type: string; target: string; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [isMock, setIsMock] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([usersApi.getHouseUsers(), usersApi.getJoinRequests()]);
      setUsers(u);
      setRequests(r);
    } catch {
      setIsMock(true);
      setUsers(rawMockUsers.map(toApiUser));
      setRequests(rawMockJoinRequests.map(toApiJoinReq));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const statusBadge = (s: string) => {
    if (s === 'active') return 'bg-success/10 text-success border-success/20';
    if (s === 'blocked') return 'bg-destructive/10 text-destructive border-destructive/20';
    return 'bg-warning/10 text-warning border-warning/20';
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    const { type, target } = confirmAction;

    if (isMock) {
      if (type === 'approve') setRequests(r => r.map(req => req.id === target ? { ...req, status: 'approved' } : req));
      else if (type === 'reject') setRequests(r => r.map(req => req.id === target ? { ...req, status: 'rejected' } : req));
      else if (type === 'promote') setUsers(u => u.map(usr => usr.id === target ? { ...usr, role: 'admin' } : usr));
      else if (type === 'demote') setUsers(u => u.map(usr => usr.id === target ? { ...usr, role: 'member' } : usr));
      else if (type === 'block') setUsers(u => u.map(usr => usr.id === target ? { ...usr, status: 'blocked' } : usr));
      else if (type === 'unblock') setUsers(u => u.map(usr => usr.id === target ? { ...usr, status: 'active' } : usr));
      else if (type === 'remove') setUsers(u => u.filter(usr => usr.id !== target));
      else if (type === 'transfer') {
        setUsers(u => u.map(usr => {
          if (usr.id === target) return { ...usr, is_primary_admin: true };
          if (usr.is_primary_admin) return { ...usr, is_primary_admin: false };
          return usr;
        }));
        updateUser({ isPrimaryAdmin: false });
      }
      toast.success('Action completed');
      setActionLoading(false);
      setConfirmAction(null);
      return;
    }

    try {
      if (type === 'approve') await usersApi.approveJoinRequest(target);
      else if (type === 'reject') await usersApi.rejectJoinRequest(target);
      else if (type === 'promote') await usersApi.updateRole(target, 'admin');
      else if (type === 'demote') await usersApi.updateRole(target, 'member');
      else if (type === 'block') await usersApi.updateStatus(target, 'blocked');
      else if (type === 'unblock') await usersApi.updateStatus(target, 'active');
      else if (type === 'remove') await usersApi.removeUser(target);
      else if (type === 'transfer') {
        await usersApi.transferPrimaryAdmin(target);
        updateUser({ isPrimaryAdmin: false });
      }
      toast.success('Action completed');
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-8">
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
                  <div className="text-sm font-medium text-foreground">{req.user_name}</div>
                  <div className="text-xs text-muted-foreground">{req.user_email} · {new Date(req.requested_at).toLocaleDateString()}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-success/10 text-success hover:bg-success/20 gap-1"
                    onClick={() => setConfirmAction({ type: 'approve', target: req.id, name: req.user_name })}>
                    <UserCheck className="w-4 h-4" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 gap-1"
                    onClick={() => setConfirmAction({ type: 'reject', target: req.id, name: req.user_name })}>
                    <UserX className="w-4 h-4" /> Reject
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">House Members</h3>
        {users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No members yet.</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <motion.div key={u.id} layout className="glass-card rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    {u.is_primary_admin ? <Crown className="w-5 h-5 text-primary" /> : <span className="text-sm font-bold text-primary">{u.full_name[0]}</span>}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground flex items-center gap-2">
                      {u.full_name}
                      {u.is_primary_admin && <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">Primary</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email} · {u.role}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={statusBadge(u.status)}>{u.status}</Badge>
                  {!u.is_primary_admin && (
                    <div className="flex gap-1">
                      {u.role === 'member' ? (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-primary h-8 px-2"
                          onClick={() => setConfirmAction({ type: 'promote', target: u.id, name: u.full_name })} title="Promote to Admin">
                          <ShieldCheck className="w-4 h-4" />
                        </Button>
                      ) : (
                        <>
                          {(activeHouse?.isPrimaryAdmin || currentAuthUser?.isPrimaryAdmin) && (
                            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-primary h-8 px-2"
                              onClick={() => setConfirmAction({ type: 'transfer', target: u.id, name: u.full_name })} title="Transfer Primary Admin">
                              <ArrowRightLeft className="w-4 h-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-warning h-8 px-2"
                            onClick={() => setConfirmAction({ type: 'demote', target: u.id, name: u.full_name })} title="Demote to Member">
                            <ShieldMinus className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {u.status === 'active' ? (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive h-8 px-2"
                          onClick={() => setConfirmAction({ type: 'block', target: u.id, name: u.full_name })} title="Block User">
                          <Ban className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-success h-8 px-2"
                          onClick={() => setConfirmAction({ type: 'unblock', target: u.id, name: u.full_name })} title="Unblock User">
                          <Unlock className="w-4 h-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive h-8 px-2"
                        onClick={() => setConfirmAction({ type: 'remove', target: u.id, name: u.full_name })} title="Remove User">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {confirmAction?.type === 'transfer' ? 'Transfer Primary Admin' : 'Confirm Action'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {confirmAction?.type === 'transfer' ? (
                <div className="space-y-3 pt-1">
                  <p>You are about to transfer the <strong className="text-primary">Primary Admin</strong> role to <strong className="text-foreground">{confirmAction?.name}</strong>.</p>
                  <div className="rounded-lg bg-warning/10 border border-warning/20 p-3 text-warning text-xs space-y-1">
                    <p className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> This action is irreversible without the new primary admin's consent.</p>
                    <p>You will lose the ability to manage house settings and can only regain primary admin status if <strong>{confirmAction?.name}</strong> transfers it back.</p>
                  </div>
                </div>
              ) : (
                <>Are you sure you want to {confirmAction?.type} <strong>{confirmAction?.name}</strong>?</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button onClick={executeAction} disabled={actionLoading}
              className={confirmAction?.type === 'transfer' ? 'bg-warning text-warning-foreground hover:bg-warning/90' : 'gradient-primary text-primary-foreground'}>
              {actionLoading ? 'Processing...' : confirmAction?.type === 'transfer' ? 'Transfer Role' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
