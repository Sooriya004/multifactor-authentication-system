import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Eye, EyeOff, ArrowLeft, Crown, User, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/authContext';
import { toast } from 'sonner';

const SignUp = () => {
  const [form, setForm] = useState({
    fullName: '', dob: '', email: '', phone: '', address: '', password: '', confirmPassword: '', role: '' as 'admin' | 'member' | '', houseCode: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.email || !form.password || !form.role) { toast.error('Please fill all required fields'); return; }
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (form.role === 'member' && !form.houseCode) { toast.error('Please enter a House Code'); return; }

    setLoading(true);
    try {
      await signup({ fullName: form.fullName, email: form.email, password: form.password, role: form.role, houseCode: form.houseCode });
      if (form.role === 'admin') {
        const code = `NEST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        setGeneratedCode(code);
        toast.success('House created! Share your code with members.');
      } else {
        toast.success('Join request sent! Waiting for admin approval.');
        navigate('/dashboard');
      }
    } catch {
      toast.error('Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  if (generatedCode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-card rounded-2xl p-10 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Crown className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Your Nest is Ready!</h2>
          <p className="text-muted-foreground mb-6">Share this code with members so they can join your house.</p>
          <div className="flex items-center justify-center gap-3 p-4 rounded-xl bg-secondary mb-6">
            <span className="text-2xl font-mono font-bold text-primary tracking-widest">{generatedCode}</span>
            <button onClick={copyCode} className="text-muted-foreground hover:text-primary transition-colors">
              {codeCopied ? <Check className="w-5 h-5 text-primary" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          <Button onClick={() => navigate('/dashboard')} className="gradient-primary text-primary-foreground font-semibold glow-primary w-full">
            Go to Dashboard
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative">
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(hsl(160 70% 42% / 0.05) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg relative z-10">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        <div className="glass-card rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-8">
            <Shield className="w-8 h-8 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Create Account</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Role Selection */}
            <div className="space-y-2">
              <Label className="text-foreground">Select Role *</Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'admin', icon: Crown, label: 'Admin', desc: 'Create a House' },
                  { value: 'member', icon: User, label: 'Member', desc: 'Join a House' },
                ].map(r => (
                  <button key={r.value} type="button" onClick={() => update('role', r.value)}
                    className={`p-4 rounded-xl border text-left transition-all ${form.role === r.value ? 'border-primary bg-primary/5 glow-primary' : 'border-border bg-secondary hover:border-muted-foreground'}`}>
                    <r.icon className={`w-5 h-5 mb-2 ${form.role === r.value ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className={`font-semibold text-sm ${form.role === r.value ? 'text-foreground' : 'text-secondary-foreground'}`}>{r.label}</div>
                    <div className="text-xs text-muted-foreground">{r.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground">Full Name *</Label>
                <Input placeholder="John Doe" value={form.fullName} onChange={e => update('fullName', e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Date of Birth</Label>
                <Input type="date" value={form.dob} onChange={e => update('dob', e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-foreground">Email *</Label>
              <Input type="email" placeholder="you@example.com" value={form.email} onChange={e => update('email', e.target.value)} className="bg-secondary border-border" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground">Phone</Label>
                <Input type="tel" placeholder="+1234567890" value={form.phone} onChange={e => update('phone', e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Address</Label>
                <Input placeholder="123 Main St" value={form.address} onChange={e => update('address', e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground">Password *</Label>
                <div className="relative">
                  <Input type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={form.password} onChange={e => update('password', e.target.value)} className="bg-secondary border-border pr-10" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Confirm Password *</Label>
                <Input type="password" placeholder="••••••••" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <AnimatePresence>
              {form.role === 'member' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-2">
                  <Label className="text-foreground">House Code *</Label>
                  <Input placeholder="NEST-XXXX" value={form.houseCode} onChange={e => update('houseCode', e.target.value.toUpperCase())} className="bg-secondary border-border font-mono tracking-widest" />
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" disabled={loading} className="w-full gradient-primary text-primary-foreground font-semibold glow-primary h-11 mt-2">
              {loading ? 'Creating...' : form.role === 'admin' ? 'Create Your Nest' : 'Request to Join'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground mt-6 text-center">
            Already have an account?{' '}
            <Link to="/signin" className="text-primary hover:underline font-medium">Sign In</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default SignUp;
