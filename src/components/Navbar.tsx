import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Shield, ScrollText, KeyRound, Settings, LogOut, User, ChevronDown, Home, Check, Plus } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useHouse } from '@/lib/houseContext';
import { setActiveHouseId } from '@/lib/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import HouseManager from '@/components/HouseManager';

const navItems = [
  { to: '/dashboard', icon: ScrollText, label: 'Logs' },
  { to: '/credentials', icon: KeyRound, label: 'Register Credentials' },
  { to: '/auth-settings', icon: Settings, label: 'Auth Settings' },
];

const Navbar = () => {
  const { user, logout } = useAuth();
  const { houses, activeHouse, setActiveHouse } = useHouse();
  const location = useLocation();
  const navigate = useNavigate();
  const [houseManagerOpen, setHouseManagerOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/'); };

  const handleSwitchHouse = (house: typeof houses[0]) => {
    setActiveHouse(house);
    setActiveHouseId(house.id);
  };

  const roleEmoji = activeHouse?.isPrimaryAdmin ? '👑' : activeHouse?.role === 'admin' ? '🛡️' : '👤';
  const roleLabel = activeHouse?.isPrimaryAdmin ? 'Primary Admin' : activeHouse?.role === 'admin' ? 'Admin' : 'Member';

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold text-foreground">FortiNest</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {navItems.map(item => (
            <Link key={item.to} to={item.to}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${location.pathname === item.to ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 text-foreground">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-sm font-medium leading-tight">{user?.fullName}</span>
                {activeHouse && (
                  <span className="text-[10px] text-muted-foreground leading-tight">{activeHouse.name} · {activeHouse.code}</span>
                )}
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-card border-border w-56">
            <DropdownMenuItem className="text-muted-foreground text-xs cursor-default">
              {roleEmoji} {roleLabel}
            </DropdownMenuItem>

            {/* House switcher */}
            {houses.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-pointer">
                    <Home className="w-4 h-4 mr-2" /> Switch House
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="bg-card border-border">
                    {houses.filter(h => h.status === 'active').map(house => (
                      <DropdownMenuItem
                        key={house.id}
                        onClick={() => handleSwitchHouse(house)}
                        className="cursor-pointer flex items-center justify-between gap-3"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{house.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">{house.code} · {house.role}</span>
                        </div>
                        {activeHouse?.id === house.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setHouseManagerOpen(true)}
                      className="cursor-pointer text-primary gap-2"
                    >
                      <Plus className="w-4 h-4" /> Add House
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}

            {houses.length <= 1 && (
              <>
                {activeHouse && (
                  <DropdownMenuItem className="text-muted-foreground text-xs cursor-default font-mono">
                    House: {activeHouse.code}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => setHouseManagerOpen(true)}
                  className="cursor-pointer text-primary gap-2"
                >
                  <Plus className="w-4 h-4" /> Add House
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer">
              <User className="w-4 h-4 mr-2" /> Edit Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <HouseManager open={houseManagerOpen} onOpenChange={setHouseManagerOpen} />
      </div>
    </nav>
  );
};

export default Navbar;
