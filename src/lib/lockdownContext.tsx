import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { espApi } from './api';

interface LockdownContextType {
  isLockdown: boolean;
  lockdownBy: string | null;
  lockdownAt: string | null;
  loading: boolean;
  toggleLockdown: () => Promise<void>;
  refresh: () => Promise<void>;
}

const LockdownContext = createContext<LockdownContextType | null>(null);

export const useLockdown = () => {
  const ctx = useContext(LockdownContext);
  if (!ctx) throw new Error('useLockdown must be used within LockdownProvider');
  return ctx;
};

export const LockdownProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLockdown, setIsLockdown] = useState(false);
  const [lockdownBy, setLockdownBy] = useState<string | null>(null);
  const [lockdownAt, setLockdownAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await espApi.getLockdownStatus();
      setIsLockdown(res.lockdown);
      setLockdownBy(res.lockdown_by);
      setLockdownAt(res.lockdown_at);
    } catch {
      // Mock: default to not locked down
      // keep current state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll every 10s
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const toggleLockdown = useCallback(async () => {
    try {
      const res = await espApi.setLockdown(!isLockdown);
      setIsLockdown(res.lockdown);
      if (res.lockdown) {
        setLockdownAt(new Date().toISOString());
      } else {
        setLockdownAt(null);
        setLockdownBy(null);
      }
    } catch {
      // Mock fallback
      setIsLockdown(prev => !prev);
      if (!isLockdown) {
        setLockdownAt(new Date().toISOString());
      } else {
        setLockdownAt(null);
        setLockdownBy(null);
      }
    }
  }, [isLockdown]);

  return (
    <LockdownContext.Provider value={{ isLockdown, lockdownBy, lockdownAt, loading, toggleLockdown, refresh }}>
      {children}
    </LockdownContext.Provider>
  );
};
