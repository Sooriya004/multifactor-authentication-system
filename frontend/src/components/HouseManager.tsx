import { useState } from 'react';
import { Home, Plus, LogIn, Loader2, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { housesApi, setActiveHouseId } from '@/lib/api';
import { useHouse, type HouseInfo } from '@/lib/houseContext';
import { useAuth } from '@/lib/authContext';
import { toast } from 'sonner';

interface HouseManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const HouseManager = ({ open, onOpenChange }: HouseManagerProps) => {
  const { houses, setHouses, setActiveHouse } = useHouse();
  const { isMockMode } = useAuth();
  const [tab, setTab] = useState<string>('create');
  const [loading, setLoading] = useState(false);
  const [houseName, setHouseName] = useState('');
  const [houseCode, setHouseCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!houseName.trim()) { toast.error('Enter a house name'); return; }
    setLoading(true);
    try {
      if (isMockMode) {
        const code = `NEST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const newHouse: HouseInfo = {
          id: crypto.randomUUID(),
          name: houseName.trim(),
          code,
          role: 'admin',
          isPrimaryAdmin: true,
          status: 'active',
          joinedAt: new Date().toISOString(),
        };
        setHouses([...houses, newHouse]);
        setActiveHouse(newHouse);
        setActiveHouseId(newHouse.id);
        setGeneratedCode(code);
        toast.success('House created!');
      } else {
        const res = await housesApi.create(houseName.trim());
        const newHouse: HouseInfo = {
          id: res.house_id,
          name: res.house_name,
          code: res.house_code,
          role: 'admin',
          isPrimaryAdmin: true,
          status: 'active',
          joinedAt: new Date().toISOString(),
        };
        setHouses([...houses, newHouse]);
        setActiveHouse(newHouse);
        setActiveHouseId(newHouse.id);
        setGeneratedCode(res.house_code);
        toast.success('House created!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create house');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!houseCode.trim()) { toast.error('Enter a house code'); return; }
    setLoading(true);
    try {
      if (isMockMode) {
        const newHouse: HouseInfo = {
          id: crypto.randomUUID(),
          name: 'Joined House',
          code: houseCode.trim().toUpperCase(),
          role: 'member',
          isPrimaryAdmin: false,
          status: 'pending',
          joinedAt: new Date().toISOString(),
        };
        setHouses([...houses, newHouse]);
        toast.success('Join request sent! Waiting for admin approval.');
        onOpenChange(false);
      } else {
        const res = await housesApi.join(houseCode.trim());
        const newHouse: HouseInfo = {
          id: res.house_id,
          name: res.house_name,
          code: res.house_code,
          role: 'member',
          isPrimaryAdmin: false,
          status: 'pending',
          joinedAt: new Date().toISOString(),
        };
        setHouses([...houses, newHouse]);
        toast.success(res.message || 'Join request sent!');
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to join house');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (o: boolean) => {
    if (!o) {
      setHouseName('');
      setHouseCode('');
      setGeneratedCode('');
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Home className="w-5 h-5 text-primary" /> Manage Houses
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a new house or join an existing one with a code.
          </DialogDescription>
        </DialogHeader>

        {generatedCode ? (
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center space-y-2">
              <p className="text-sm text-muted-foreground">Your house code</p>
              <p className="text-2xl font-mono font-bold text-primary tracking-wider">{generatedCode}</p>
              <p className="text-xs text-muted-foreground">Share this code with people you want to invite.</p>
            </div>
            <Button onClick={handleCopy} variant="outline" className="w-full gap-2">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Code'}
            </Button>
            <Button onClick={() => handleClose(false)} className="w-full gradient-primary text-primary-foreground">
              Done
            </Button>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="w-full grid grid-cols-2 bg-secondary">
              <TabsTrigger value="create" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Create
              </TabsTrigger>
              <TabsTrigger value="join" className="gap-1.5">
                <LogIn className="w-3.5 h-3.5" /> Join
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="text-foreground">House Name</Label>
                <Input
                  placeholder="e.g. Beach House"
                  value={houseName}
                  onChange={e => setHouseName(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
              <p className="text-xs text-muted-foreground">You'll be the primary admin of this house. A unique code will be generated to invite members.</p>
              <Button onClick={handleCreate} disabled={loading} className="w-full gradient-primary text-primary-foreground gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create House
              </Button>
            </TabsContent>

            <TabsContent value="join" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="text-foreground">House Code</Label>
                <Input
                  placeholder="e.g. NEST-A1B2"
                  value={houseCode}
                  onChange={e => setHouseCode(e.target.value.toUpperCase())}
                  className="bg-secondary border-border font-mono tracking-wider"
                  maxLength={9}
                />
              </div>
              <p className="text-xs text-muted-foreground">Ask the house admin for the code. Your request will need admin approval.</p>
              <Button onClick={handleJoin} disabled={loading} className="w-full gradient-primary text-primary-foreground gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                Request to Join
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default HouseManager;
