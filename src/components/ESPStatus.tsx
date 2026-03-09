import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { espApi } from '@/lib/api';

const ESPStatus = () => {
  const [status, setStatus] = useState<'online' | 'offline' | 'loading'>('loading');
  const [message, setMessage] = useState('');

  const checkStatus = async () => {
    setStatus('loading');
    try {
      const data = await espApi.getStatus();
      setStatus(data.status === 'online' ? 'online' : 'offline');
      setMessage(data.message);
    } catch {
      setStatus('offline');
      setMessage('ESP32 not connected — start your backend to enable hardware features');
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          status === 'online' ? 'bg-success/10' : status === 'offline' ? 'bg-destructive/10' : 'bg-secondary'
        }`}>
          {status === 'loading' ? (
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          ) : status === 'online' ? (
            <Wifi className="w-5 h-5 text-success" />
          ) : (
            <WifiOff className="w-5 h-5 text-destructive" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">ESP32 Device</h3>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              status === 'online' ? 'bg-success animate-pulse' : status === 'offline' ? 'bg-destructive' : 'bg-muted-foreground'
            }`} />
            <span className={`text-xs font-medium ${
              status === 'online' ? 'text-success' : status === 'offline' ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {status === 'loading' ? 'Checking...' : status === 'online' ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>
      {message && <p className="text-xs text-muted-foreground mt-3">{message}</p>}
    </div>
  );
};

export default ESPStatus;
