import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LockOpen,
  Loader2,
  X,
  Nfc,
  Fingerprint,
  KeySquare,
  Smartphone,
  CheckCircle,
  XCircle,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { espApi } from '@/lib/api';
import { useLockdown } from '@/lib/lockdownContext';
import { toast } from 'sonner';

type AuthMethod = 'rfid' | 'fingerprint' | 'keypad' | 'otp';
type AuthStatus = 'idle' | 'authenticating' | 'success' | 'failure';

const methodIcons: Record<AuthMethod, typeof Nfc> = {
  rfid: Nfc,
  fingerprint: Fingerprint,
  keypad: KeySquare,
  otp: Smartphone,
};

const methodLabels: Record<AuthMethod, string> = {
  rfid: 'RFID Tag',
  fingerprint: 'Fingerprint',
  keypad: 'Keypad PIN',
  otp: 'OTP Code',
};

const methodPlaceholders: Record<AuthMethod, string> = {
  rfid: 'Enter RFID UID (e.g., A1B2C3D4)',
  fingerprint: 'Enter Fingerprint ID',
  keypad: 'Enter PIN code',
  otp: 'Enter 6-digit OTP',
};

const statusConfig: Record<AuthStatus, { color: string; label: string }> = {
  idle: { color: 'text-muted-foreground', label: 'Ready to authenticate' },
  authenticating: { color: 'text-primary', label: 'Authenticating...' },
  success: { color: 'text-success', label: 'Door Unlocked!' },
  failure: { color: 'text-destructive', label: 'Authentication Failed' },
};

const UnlockDoor = () => {
  const { isLockdown } = useLockdown();

  // Auth flow state
  const [order, setOrder] = useState<AuthMethod[]>([]);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [step, setStep] = useState(0);
  const [payload, setPayload] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);

  // Fetch device config
  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const cfg = await espApi.getDeviceConfig();
      if (cfg.order.length === 0) {
        toast.error('No authentication methods configured on the device');
        return;
      }
      setOrder(cfg.order as AuthMethod[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load device config';
      if (message !== '__MOCK__') {
        toast.error(message);
      }
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // Load config on mount
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Start authentication flow
  const handleStart = () => {
    if (order.length === 0) {
      toast.error('No authentication methods available');
      return;
    }
    setStep(1);
    setPayload('');
    setSessionId(undefined);
    setStatus('authenticating');
  };

  // Verify current step
  const handleVerify = async () => {
    if (order.length === 0 || step < 1 || !payload.trim()) {
      toast.error('Please enter a credential');
      return;
    }

    const currentMethod = order[step - 1];

    try {
      setLoading(true);
      const res = await espApi.verifyFactor({
        method_used: currentMethod,
        payload: payload.trim(),
        step,
        session_id: sessionId,
      });

      if (res.status === 'success') {
        setStatus('success');
        toast.success('Door unlocked successfully!');
        return;
      }

      if (res.status === 'authenticating') {
        // More steps required
        setStatus('authenticating');
        setPayload('');
        if (res.session_id) {
          setSessionId(res.session_id);
        }
        setStep((s) => s + 1);
        toast.success(`Step ${step} verified. Proceed to next step.`);
        return;
      }

      // Failure
      setStatus('failure');
      toast.error('Invalid credentials. Authentication failed.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      if (message === '__MOCK__') {
        toast.error('Backend unreachable. Cannot verify credentials.');
      } else {
        toast.error(message);
      }
      setStatus('failure');
    } finally {
      setLoading(false);
    }
  };

  // Handle Enter key in input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && payload.trim() && !loading) {
      handleVerify();
    }
  };

  // Reset to initial state
  const handleReset = () => {
    setStep(0);
    setPayload('');
    setSessionId(undefined);
    setStatus('idle');
  };

  const currentMethod = step > 0 && step <= order.length ? order[step - 1] : null;
  const isTerminal = status === 'success' || status === 'failure';
  const hasStarted = step > 0;
  const totalSteps = order.length;

  return (
    <div className="glass-card rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <LockOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Unlock Door</h3>
            <p className="text-xs text-muted-foreground">
              {totalSteps === 0
                ? 'Loading config...'
                : totalSteps === 1
                ? `Single-factor: ${methodLabels[order[0]] || order[0]}`
                : `${totalSteps}-factor authentication`}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={fetchConfig}
          disabled={configLoading}
          title="Refresh device config"
        >
          <RefreshCw className={`w-4 h-4 ${configLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {/* Lockdown State */}
        {isLockdown ? (
          <motion.div
            key="lockdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-2 py-6 text-center"
          >
            <ShieldAlert className="w-10 h-10 text-destructive" />
            <p className="text-sm font-medium text-destructive">House is in lockdown</p>
            <p className="text-xs text-muted-foreground">
              All access is blocked by the primary admin
            </p>
          </motion.div>
        ) : !hasStarted ? (
          /* Idle State - Ready to Start */
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* Show configured methods */}
            {order.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center">
                {order.map((method, idx) => {
                  const Icon = methodIcons[method] || Smartphone;
                  return (
                    <div
                      key={method}
                      className="flex items-center gap-1.5 px-2 py-1 bg-secondary/50 rounded-md text-xs"
                    >
                      <Icon className="w-3 h-3 text-muted-foreground" />
                      <span className="text-muted-foreground">{methodLabels[method]}</span>
                      {order.length > 1 && (
                        <span className="text-[10px] text-muted-foreground/60">#{idx + 1}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              onClick={handleStart}
              disabled={order.length === 0 || configLoading}
              className="w-full gradient-primary text-primary-foreground gap-2 h-12 text-base font-semibold"
            >
              {configLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <LockOpen className="w-5 h-5" />
              )}
              Start Authentication
            </Button>
          </motion.div>
        ) : (
          /* Active Authentication State */
          <motion.div
            key="active"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* Progress through auth methods */}
            <div className="space-y-2">
              {order.map((method, idx) => {
                const Icon = methodIcons[method] || Smartphone;
                const label = methodLabels[method] || method;
                const stepNumber = idx + 1;
                const isCurrent = step === stepNumber && status === 'authenticating';
                const isPast = step > stepNumber || (status === 'success' && step >= stepNumber);
                const isFailed = status === 'failure' && step === stepNumber;

                return (
                  <motion.div
                    key={method}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-all border ${
                      isCurrent
                        ? 'bg-primary/10 border-primary/30'
                        : isPast
                        ? 'bg-success/5 border-success/20'
                        : isFailed
                        ? 'bg-destructive/5 border-destructive/20'
                        : 'bg-secondary/50 border-transparent'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        isCurrent
                          ? 'bg-primary/20'
                          : isPast
                          ? 'bg-success/10'
                          : isFailed
                          ? 'bg-destructive/10'
                          : 'bg-secondary'
                      }`}
                    >
                      {isCurrent && !loading ? (
                        <Icon className="w-4 h-4 text-primary" />
                      ) : isCurrent && loading ? (
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      ) : isPast ? (
                        <CheckCircle className="w-4 h-4 text-success" />
                      ) : isFailed ? (
                        <XCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <Icon className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span
                        className={`text-sm font-medium ${
                          isCurrent
                            ? 'text-primary'
                            : isPast
                            ? 'text-success'
                            : isFailed
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {label}
                      </span>
                      {isCurrent && (
                        <p className="text-xs text-primary/70 mt-0.5">
                          Enter your {label.toLowerCase()} below
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {stepNumber}/{totalSteps}
                    </span>
                  </motion.div>
                );
              })}
            </div>

            {/* Status indicator */}
            <div className="flex items-center justify-center gap-2 py-2">
              {status === 'success' ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : status === 'failure' ? (
                <XCircle className="w-5 h-5 text-destructive" />
              ) : loading ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}
              <span className={`text-sm font-medium ${statusConfig[status]?.color}`}>
                {loading ? 'Verifying...' : statusConfig[status]?.label}
              </span>
            </div>

            {/* Actions */}
            {isTerminal ? (
              <Button
                onClick={handleReset}
                variant="outline"
                className="w-full gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {status === 'success' ? 'Done' : 'Try Again'}
              </Button>
            ) : (
              <div className="space-y-2">
                <input
                  type={currentMethod === 'keypad' || currentMethod === 'otp' ? 'password' : 'text'}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={currentMethod ? methodPlaceholders[currentMethod] : 'Enter credential'}
                  disabled={loading}
                  autoFocus
                  className="w-full h-11 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                />
                <Button
                  onClick={handleVerify}
                  disabled={loading || !payload.trim()}
                  className="w-full h-10 gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  Verify Step {step} of {totalSteps}
                </Button>
                <Button
                  onClick={handleReset}
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  className="w-full text-destructive hover:bg-destructive/10 gap-1"
                >
                  <X className="w-4 h-4" /> Cancel
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UnlockDoor;
