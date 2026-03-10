import { useState } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, Copy, Check, Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { espApi } from '@/lib/api';
import { toast } from 'sonner';

const OTPPanel = () => {
  const [otp, setOtp] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateOTP = async () => {
    setLoading(true);
    try {
      const data = await espApi.generateOTP();
      setOtp(data.otp);
      setExpiresIn(data.expires_in);
      toast.success('OTP generated');
    } catch {
      // Mock fallback
      const code = String(Math.floor(100000 + Math.random() * 900000));
      setOtp(code);
      setExpiresIn('5 minutes');
      toast.success('OTP generated (demo mode)');
    } finally {
      setLoading(false);
    }
  };

  const copyOTP = () => {
    if (otp) {
      navigator.clipboard.writeText(otp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Guest OTP</h3>
          <p className="text-xs text-muted-foreground">Generate a one-time code for temporary access</p>
        </div>
      </div>

      {otp ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <div className="flex items-center justify-center gap-3 p-4 rounded-xl bg-secondary">
            <span className="text-3xl font-mono font-bold text-primary tracking-[0.3em]">{otp}</span>
            <button onClick={copyOTP} className="text-muted-foreground hover:text-primary transition-colors">
              {copied ? <Check className="w-5 h-5 text-primary" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          <div className="flex items-center justify-center gap-1 text-xs text-warning">
            <Clock className="w-3 h-3" />
            Expires in {expiresIn}
          </div>
          <Button onClick={() => { setOtp(null); generateOTP(); }} disabled={loading} variant="ghost" size="sm" className="w-full text-muted-foreground">
            Generate New
          </Button>
        </motion.div>
      ) : (
        <Button onClick={generateOTP} disabled={loading} className="w-full gradient-primary text-primary-foreground gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
          Generate OTP
        </Button>
      )}
    </div>
  );
};

export default OTPPanel;
