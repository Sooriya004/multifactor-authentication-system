import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Nfc, Fingerprint, KeySquare, Smartphone, GripVertical, Info, Link as LinkIcon, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/authContext';
import { credentialsApi, type ApiAuthMethod } from '@/lib/api';
import { mockAuthMethods } from '@/lib/mockData';
import Navbar from '@/components/Navbar';
import { Navigate, Link } from 'react-router-dom';
import { toast } from 'sonner';

const methodMeta: Record<string, { icon: typeof Nfc; label: string }> = {
  rfid: { icon: Nfc, label: 'RFID Tag' },
  fingerprint: { icon: Fingerprint, label: 'Fingerprint' },
  keypad: { icon: KeySquare, label: 'Keypad' },
  otp: { icon: Smartphone, label: 'OTP' },
};

function toApiMethod(m: typeof mockAuthMethods[0]): ApiAuthMethod {
  return { id: m.id, type: m.type, enabled: m.enabled, priority: m.priority, has_credential: m.hasCredential };
}

const AuthSettings = () => {
  const { user, isAuthenticated } = useAuth();
  const [methods, setMethods] = useState<ApiAuthMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);

  const fetchMethods = async () => {
    try {
      const data = await credentialsApi.getAuthMethods();
      setMethods(data);
    } catch {
      setIsMock(true);
      setMethods(mockAuthMethods.map(toApiMethod));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMethods(); }, []);

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  const toggleMethod = async (id: string) => {
    const method = methods.find(m => m.id === id);
    if (!method) return;
    if (!method.has_credential && !method.enabled && method.type !== 'otp') {
      toast.error('Register this credential first');
      return;
    }

    const updated = methods.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    setMethods(updated);

    if (!isMock) {
      try {
        await credentialsApi.updateAuthMethods(updated.map(m => ({ type: m.type, enabled: m.enabled, priority: m.priority })));
      } catch { fetchMethods(); }
    }
    toast.success('Auth method updated');
  };

  const reorder = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= methods.length) return;
    const newMethods = [...methods];
    [newMethods[idx], newMethods[target]] = [newMethods[target], newMethods[idx]];
    const reordered = newMethods.map((m, i) => ({ ...m, priority: i + 1 }));
    setMethods(reordered);
    if (!isMock) {
      try {
        await credentialsApi.updateAuthMethods(reordered.map(m => ({ type: m.type, enabled: m.enabled, priority: m.priority })));
      } catch { fetchMethods(); }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-foreground mb-2">Authentication Settings</h1>
          <p className="text-muted-foreground mb-8">Configure which methods are used for access and their priority order.</p>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {methods.map((method, idx) => {
                const meta = methodMeta[method.type];
                if (!meta) return null;
                const Icon = meta.icon;
                const canEnable = method.has_credential || method.type === 'otp';

                return (
                  <motion.div key={method.id} layout transition={{ duration: 0.2 }}
                    className={`glass-card rounded-xl p-5 flex items-center justify-between gap-4 ${!canEnable ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col gap-1">
                        <button onClick={() => reorder(idx, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={idx === 0}>
                          <GripVertical className="w-4 h-4 rotate-180" />
                        </button>
                        <button onClick={() => reorder(idx, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={idx === methods.length - 1}>
                          <GripVertical className="w-4 h-4" />
                        </button>
                      </div>
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${method.enabled ? 'bg-primary/10' : 'bg-secondary'}`}>
                        <Icon className={`w-6 h-6 ${method.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground flex items-center gap-2">
                          {meta.label}
                          <span className="text-xs font-mono text-muted-foreground">Priority {method.priority}</span>
                        </div>
                        {!canEnable && (
                          <div className="flex items-center gap-1 mt-1">
                            <Info className="w-3 h-3 text-warning" />
                            <span className="text-xs text-warning">No credential registered — </span>
                            <Link to="/credentials" className="text-xs text-primary hover:underline flex items-center gap-1">
                              <LinkIcon className="w-3 h-3" /> Register
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>

                    {canEnable ? (
                      <Switch checked={method.enabled} onCheckedChange={() => toggleMethod(method.id)} />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger>
                          <Switch checked={false} disabled />
                        </TooltipTrigger>
                        <TooltipContent className="bg-card border-border text-foreground">
                          Register this credential first to enable it
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default AuthSettings;
