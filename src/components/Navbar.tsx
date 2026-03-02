import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Shield, ScrollText, KeyRound, Settings, LogOut, User, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const navItems = [
  { to: '/dashboard', icon: ScrollText, label: 'Logs' },
  { to: '/credentials', icon: KeyRound, label: 'Register Credentials' },
  { to: '/auth-settings', icon: Settings, label: 'Auth Settings' },
];

const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/'); };

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
              <span className="hidden sm:inline text-sm font-medium">{user?.fullName}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-card border-border w-48">
            <DropdownMenuItem className="text-muted-foreground text-xs cursor-default">
              {user?.role === 'admin' ? (user?.isPrimaryAdmin ? '👑 Primary Admin' : '🛡️ Admin') : '👤 Member'}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-muted-foreground text-xs cursor-default font-mono">
              House: {user?.houseCode}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
};

export default Navbar;
