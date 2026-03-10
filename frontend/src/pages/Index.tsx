import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shield, Lock, Fingerprint, Wifi, ChevronRight, Zap, Users, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  { icon: Shield, title: 'House-Based Access', desc: 'Group users by house with unique codes and role-based permissions.' },
  { icon: Fingerprint, title: 'Multi-Factor Auth', desc: 'RFID, fingerprint, keypad, and OTP — configure your security stack.' },
  { icon: Eye, title: 'Real-Time Monitoring', desc: 'Track every access attempt with detailed logs and smart alerts.' },
  { icon: Users, title: 'Team Management', desc: 'Approve requests, assign roles, and manage your household members.' },
];

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.12 } } },
  item: { hidden: { opacity: 0, y: 30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } },
};

const Index = () => {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold tracking-tight text-foreground">FortiNest</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/signin">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">Sign In</Button>
            </Link>
            <Link to="/signup">
              <Button className="gradient-primary text-primary-foreground font-semibold glow-primary">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-6">
        {/* Grid background */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(hsl(160 70% 42% / 0.08) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }} />
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full gradient-hero opacity-40 blur-3xl" />
        </div>

        <div className="container mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl mx-auto text-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 mb-8"
            >
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-primary">Smart Access Management</span>
            </motion.div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 text-foreground leading-[1.1]">
              Secure Your Home,{' '}
              <span className="text-gradient">Intelligently</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              FortiNest brings enterprise-grade access control to your household.
              Manage credentials, monitor access, and protect what matters most.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="gradient-primary text-primary-foreground font-semibold text-lg px-8 h-13 glow-primary group">
                  Create Your Nest
                  <ChevronRight className="ml-1 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/signin">
                <Button size="lg" variant="outline" className="text-lg px-8 h-13 border-border hover:bg-secondary">
                  Sign In
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="mt-20 grid grid-cols-3 max-w-lg mx-auto gap-8"
          >
            {[
              { value: '256-bit', label: 'Encryption' },
              { value: '99.9%', label: 'Uptime' },
              { value: '<50ms', label: 'Response' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold text-primary font-mono">{s.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="container mx-auto">
          <motion.div
            variants={stagger.container}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {features.map((f) => (
              <motion.div key={f.title} variants={stagger.item}>
                <div className="glass-card rounded-xl p-6 h-full hover:border-primary/30 transition-all duration-300 group">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:glow-primary transition-shadow">
                    <f.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Security banner */}
      <section className="py-16 px-6">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="glass-card rounded-2xl p-10 md:p-14 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 gradient-hero opacity-30" />
            <div className="relative z-10">
              <Lock className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Security First, Always</h2>
              <p className="text-muted-foreground max-w-xl mx-auto mb-8">
                Built with RBAC, brute-force protection, audit logging, and encrypted credential storage from the ground up.
              </p>
              <Link to="/signup">
                <Button className="gradient-primary text-primary-foreground font-semibold glow-primary">
                  Start Protecting Your Home
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">FortiNest</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2026 FortiNest. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
