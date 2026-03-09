import { motion } from 'framer-motion';
import { ScrollText, Users, AlertTriangle, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/authContext';
import { useHouse } from '@/lib/houseContext';
import Navbar from '@/components/Navbar';
import LogsPanel from '@/components/LogsPanel';
import UserManagement from '@/components/UserManagement';
import UnlockDoor from '@/components/UnlockDoor';
import ESPStatus from '@/components/ESPStatus';
import EmergencyUnlock from '@/components/EmergencyUnlock';
import EmergencyLock from '@/components/EmergencyLock';
import SelfBlockButton from '@/components/SelfBlockButton';
import { Navigate } from 'react-router-dom';

const Dashboard = () => {
  const { user, isAuthenticated, loading } = useAuth();
  const { activeHouse } = useHouse();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return <Navigate to="/signin" />;

  // Use active house context for role
  const role = activeHouse?.role || user.role;
  const isPrimaryAdmin = activeHouse?.isPrimaryAdmin || user.isPrimaryAdmin;
  const status = activeHouse?.status || user.status;
  const isAdmin = role === 'admin';

  if (status === 'pending') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-2xl p-10 max-w-md text-center">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">Pending Approval</h2>
          <p className="text-muted-foreground">Your join request for <strong>{activeHouse?.name || 'this house'}</strong> is awaiting admin approval.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-3xl font-bold text-foreground">
              Welcome, <span className="text-gradient">{user.fullName}</span>
            </h1>
            {!isAdmin && !isPrimaryAdmin && <SelfBlockButton />}
          </div>
          <p className="text-muted-foreground mb-8">
            {isAdmin
              ? `Manage ${activeHouse?.name || 'your house'}, monitor access logs, and oversee members.`
              : `View your access logs for ${activeHouse?.name || 'your house'}.`}
          </p>

          {/* Action widgets */}
          {isAdmin ? (
            <div className={`grid gap-4 mb-8 ${isPrimaryAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
              <ESPStatus />
              <UnlockDoor />
              <EmergencyUnlock />
              {isPrimaryAdmin && <EmergencyLock />}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              <ESPStatus />
              <UnlockDoor />
            </div>
          )}

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
