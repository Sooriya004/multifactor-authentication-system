import { useState } from 'react';
import { motion } from 'framer-motion';
import { ScrollText, Users, Shield, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/authContext';
import Navbar from '@/components/Navbar';
import LogsPanel from '@/components/LogsPanel';
import UserManagement from '@/components/UserManagement';
import { Navigate } from 'react-router-dom';

const Dashboard = () => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  if (user.status === 'pending') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-2xl p-10 max-w-md text-center">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">Pending Approval</h2>
          <p className="text-muted-foreground">Your join request is awaiting admin approval. You'll be able to access the dashboard once approved.</p>
        </motion.div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            Welcome, <span className="text-gradient">{user.fullName}</span>
          </h1>
          <p className="text-muted-foreground mb-8">
            {isAdmin ? 'Manage your house, monitor access logs, and oversee members.' : 'View your access logs and monitor activity.'}
          </p>

          {isAdmin ? (
            <Tabs defaultValue="logs" className="space-y-6">
              <TabsList className="bg-secondary border border-border">
                <TabsTrigger value="logs" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <ScrollText className="w-4 h-4" /> Logs
                </TabsTrigger>
                <TabsTrigger value="users" className="gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                  <Users className="w-4 h-4" /> User Management
                </TabsTrigger>
              </TabsList>
              <TabsContent value="logs"><LogsPanel /></TabsContent>
              <TabsContent value="users"><UserManagement /></TabsContent>
            </Tabs>
          ) : (
            <LogsPanel userOnly userId={user.id} />
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default Dashboard;
