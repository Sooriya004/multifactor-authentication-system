import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LockOpen, Loader2, X, Nfc, Fingerprint, KeySquare, Smartphone, CheckCircle, XCircle, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { espApi, type ApiUnlockSession } from '@/lib/api';
import { useLockdown } from '@/lib/lockdownContext';
import { toast } from 'sonner';

const methodIcons: Record<string, typeof Nfc> = {
  rfid: Nfc,
  fingerprint: Fingerprint,
  keypad: KeySquare,
  otp: Smartphone,
};

const methodLabels: Record<string, string> = {
  rfid: 'RFID Tag',
  fingerprint: 'Fingerprint',
  keypad: 'Keypad PIN',
  otp: 'OTP Code',
};

type SessionStatus = ApiUnlockSession['status'];

const statusConfig: Record<string, { color: string; label: string }> = {
  pending: { color: 'text-warning', label: 'Waiting for device...' },
  authenticating: { color: 'text-primary', label: 'Authenticating...' },
  success: { color: 'text-success', label: 'Door Unlocked!' },
  failed: { color: 'text-destructive', label: 'Authentication Failed' },
  expired: { color: 'text-muted-foreground', label: 'Session Expired' },
  cancelled: { color: 'text-muted-foreground', label: 'Cancelled' },
};

const UnlockDoor = () => {
  const { isLockdown } = useLockdown();
  const [session, setSession] = useState<ApiUnlockSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [mockStep, setMockStep] = useState<number>(-1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (mockTimerRef.current) clearTimeout(mockTimerRef.current);
    };
  }, []);

  const startPolling = (sessionId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const updated = await espApi.getUnlockSession(sessionId);
        setSession(updated);
        if (['success', 'failed', 'expired', 'cancelled'].includes(updated.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (updated.status === 'success') toast.success('Door unlocked!');
          if (updated.status === 'failed') toast.error('Authentication failed');
        }
      } catch {
        // Keep polling on error
      }
    }, 1500);
  };

  // Mock flow for demo mode
  const runMockFlow = (methods: string[]) => {
    setMockStep(0);
    let step = 0;

    const advance = () => {
      step++;
      if (step < methods.length) {
        // Move to next method as if "authenticating"
        setSession(prev => prev ? {
          ...prev,
          status: 'authenticating',
          current_method: methods[step],
        } : prev);
        setMockStep(step);
        mockTimerRef.current = setTimeout(advance, 2000);
      } else {
        // Complete successfully
        setSession(prev => prev ? {
          ...prev,
          status: 'success',
          completed_at: new Date().toISOString(),
        } : prev);
        toast.success('Door unlocked!');
      }
    };

    // Start with first method
    setSession(prev => prev ? {
      ...prev,
      status: 'authenticating',
      current_method: methods[0],
    } : prev);

    mockTimerRef.current = setTimeout(advance, 2500);
  };

  const handleUnlock = async () => {
    setLoading(true);
    try {
      const newSession = await espApi.requestUnlock();
      setSession(newSession);
      startPolling(newSession.id);
    } catch {
      // Mock fallback
      const mockMethods = ['rfid', 'keypad'];
      const mockSession: ApiUnlockSession = {
        id: crypto.randomUUID(),
        user_id: '1',
        status: 'pending',
        auth_methods: mockMethods,
        current_method: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 120000).toISOString(),
        completed_at: null,
      };
      setSession(mockSession);
      // Simulate ESP32 picking up the session after 1.5s
      mockTimerRef.current = setTimeout(() => runMockFlow(mockMethods), 1500);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!session) return;
    try {
      await espApi.cancelUnlock(session.id);
    } catch {
      // Mock
    }
    if (pollRef.current) clearInterval(pollRef.current);
    if (mockTimerRef.current) clearTimeout(mockTimerRef.current);
    setSession(null);
    setMockStep(-1);
  };

  const handleReset = () => {
    setSession(null);
    setMockStep(-1);
  };

  const isTerminal = session && ['success', 'failed', 'expired', 'cancelled'].includes(session.status);

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <LockOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Unlock Door</h3>
          <p className="text-xs text-muted-foreground">Authenticate via your configured methods</p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isLockdown ? (
          <motion.div key="lockdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-2 py-3 text-center">
            <ShieldAlert className="w-8 h-8 text-destructive" />
            <p className="text-sm font-medium text-destructive">House is in lockdown</p>
            <p className="text-xs text-muted-foreground">All access is blocked by the primary admin</p>
          </motion.div>
        ) : !session ? (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button onClick={handleUnlock} disabled={loading}
              className="w-full gradient-primary text-primary-foreground gap-2 h-12 text-base font-semibold">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LockOpen className="w-5 h-5" />}
              Unlock Door
            </Button>
          </motion.div>
        ) : (
          <motion.div key="active" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Auth methods progress */}
            <div className="space-y-2">
              {session.auth_methods.map((method, idx) => {
                const Icon = methodIcons[method] || Smartphone;
                const label = methodLabels[method] || method;
                const isCurrent = session.current_method === method;
                const isPast = session.status === 'success' ||
                  (session.current_method && session.auth_methods.indexOf(session.current_method) > idx);
                const isCompleted = session.status === 'success' && idx <= (mockStep >= 0 ? mockStep : session.auth_methods.length - 1);

                return (
                  <motion.div
                    key={method}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                      isCurrent ? 'bg-primary/10 border border-primary/30' :
                      isCompleted || isPast ? 'bg-success/5 border border-success/20' :
                      'bg-secondary/50 border border-transparent'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isCurrent ? 'bg-primary/20' : isCompleted || isPast ? 'bg-success/10' : 'bg-secondary'
                    }`}>
                      {isCurrent && session.status === 'authenticating' ? (
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      ) : isCompleted || isPast ? (
                        <CheckCircle className="w-4 h-4 text-success" />
                      ) : (
                        <Icon className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className={`text-sm font-medium ${
                        isCurrent ? 'text-primary' : isCompleted || isPast ? 'text-success' : 'text-muted-foreground'
                      }`}>
                        {label}
                      </span>
                      {isCurrent && session.status === 'authenticating' && (
                        <p className="text-xs text-primary/70 mt-0.5">Present your {label.toLowerCase()} now...</p>
                      )}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                  </motion.div>
                );
              })}
            </div>

            {/* Status */}
            <div className="flex items-center justify-center gap-2 py-2">
              {session.status === 'success' ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : session.status === 'failed' ? (
                <XCircle className="w-5 h-5 text-destructive" />
              ) : session.status === 'expired' ? (
                <Clock className="w-5 h-5 text-muted-foreground" />
              ) : (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              )}
              <span className={`text-sm font-medium ${statusConfig[session.status]?.color || 'text-foreground'}`}>
                {statusConfig[session.status]?.label || session.status}
              </span>
            </div>

            {/* Actions */}
            {isTerminal ? (
              <Button onClick={handleReset} variant="ghost" size="sm" className="w-full text-muted-foreground">
                Try Again
              </Button>
            ) : (
              <Button onClick={handleCancel} variant="ghost" size="sm" className="w-full text-destructive hover:bg-destructive/10 gap-1">
                <X className="w-4 h-4" /> Cancel
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UnlockDoor;
