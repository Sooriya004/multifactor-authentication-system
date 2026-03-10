import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi, setToken, getToken, type ApiUser } from './api';
import { useHouse, type HouseInfo } from './houseContext';

interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  address: string | null;
  dob: string | null;
  // These are derived from the active house
  role: 'admin' | 'member';
  isPrimaryAdmin: boolean;
  houseId: string;
  houseCode: string;
  status: 'active' | 'blocked' | 'pending';
}

interface AuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (data: SignupData) => Promise<{ success: boolean; houseCode?: string; pendingApproval?: boolean }>;
  logout: () => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  isAuthenticated: boolean;
  loading: boolean;
  isMockMode: boolean;
}

interface SignupData {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  address?: string;
  dob?: string;
  role: 'admin' | 'member';
  houseCode?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

function mapApiUserMemberships(apiUser: any): HouseInfo[] {
  if (apiUser.memberships && Array.isArray(apiUser.memberships)) {
    return apiUser.memberships.map((m: any) => ({
      id: m.house_id,
      name: m.house_name,
      code: m.house_code,
      role: m.role,
      isPrimaryAdmin: m.is_primary_admin,
      status: m.status,
      joinedAt: m.joined_at,
    }));
  }
  // Legacy fallback
  if (apiUser.house_id) {
    return [{
      id: apiUser.house_id,
      name: 'My House',
      code: apiUser.house_code || '',
      role: apiUser.role || 'member',
      isPrimaryAdmin: apiUser.is_primary_admin || false,
      status: apiUser.status || 'active',
      joinedAt: apiUser.joined_at || null,
    }];
  }
  return [];
}

function buildAuthUser(apiUser: any, activeHouse: HouseInfo | null): AuthUser {
  return {
    id: apiUser.id || apiUser.user?.id,
    fullName: apiUser.full_name || apiUser.fullName,
    email: apiUser.email,
    phone: apiUser.phone || null,
    address: apiUser.address || null,
    dob: apiUser.dob || null,
    role: activeHouse?.role || apiUser.role || 'member',
    isPrimaryAdmin: activeHouse?.isPrimaryAdmin || apiUser.is_primary_admin || false,
    houseId: activeHouse?.id || apiUser.house_id || '',
    houseCode: activeHouse?.code || apiUser.house_code || '',
    status: activeHouse?.status || apiUser.status || 'active',
  };
}

// ─── Mock helpers ───────────────────────────────────────────────
const MOCK_STORAGE_KEY = 'fortinest_mock_user';
const MOCK_HOUSES_KEY = 'fortinest_mock_houses';

function saveMockData(user: any, houses: HouseInfo[]) {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(user));
  localStorage.setItem(MOCK_HOUSES_KEY, JSON.stringify(houses));
}

function loadMockData(): { user: any; houses: HouseInfo[] } | null {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    const housesRaw = localStorage.getItem(MOCK_HOUSES_KEY);
    if (!raw) return null;
    return {
      user: JSON.parse(raw),
      houses: housesRaw ? JSON.parse(housesRaw) : [],
    };
  } catch { return null; }
}

function clearMockData() {
  localStorage.removeItem(MOCK_STORAGE_KEY);
  localStorage.removeItem(MOCK_HOUSES_KEY);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setHouses, activeHouse, houses } = useHouse();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [rawUser, setRawUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isMockMode, setIsMockMode] = useState(false);

  // Sync user when active house changes
  useEffect(() => {
    if (rawUser && activeHouse) {
      setUser(buildAuthUser(rawUser, activeHouse));
    }
  }, [activeHouse, rawUser]);

  // Restore session on mount
  useEffect(() => {
    const token = getToken();
    if (token) {
      authApi.me()
        .then(apiUser => {
          setRawUser(apiUser);
          const h = mapApiUserMemberships(apiUser);
          setHouses(h);
        })
        .catch((err) => {
          if (err.message === '__MOCK__') {
            setIsMockMode(true);
            const mock = loadMockData();
            if (mock) {
              setRawUser(mock.user);
              setHouses(mock.houses);
            }
          }
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      const mock = loadMockData();
      if (mock) {
        setRawUser(mock.user);
        setHouses(mock.houses);
        setIsMockMode(true);
      }
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await authApi.login(email, password);
      setToken(res.access_token);
      const apiUser = res.user;
      setRawUser(apiUser);
      const h = mapApiUserMemberships(apiUser);
      setHouses(h);
      const active = h.find(x => x.status === 'active') || h[0] || null;
      setUser(buildAuthUser(apiUser, active));
      setIsMockMode(false);
      return true;
    } catch (err: any) {
      if (err.message === '__MOCK__') {
        setIsMockMode(true);
        const mockRaw = {
          id: '1', full_name: 'Alex Morgan', email, phone: null,
          address: null, dob: null,
        };
        const mockHouses: HouseInfo[] = [
          { id: 'h1', name: 'Main House', code: 'NEST-A1B2', role: 'admin', isPrimaryAdmin: true, status: 'active', joinedAt: '2025-01-15' },
          { id: 'h2', name: 'Beach House', code: 'NEST-C3D4', role: 'member', isPrimaryAdmin: false, status: 'active', joinedAt: '2025-06-01' },
        ];
        setRawUser(mockRaw);
        setHouses(mockHouses);
        const active = mockHouses.find(x => x.status === 'active') || mockHouses[0] || null;
        setUser(buildAuthUser(mockRaw, active));
        saveMockData(mockRaw, mockHouses);
        setToken('mock-token');
        return true;
      }
      throw err;
    }
  }, [setHouses]);

  const signup = useCallback(async (data: SignupData) => {
    try {
      const res = await authApi.signup({
        full_name: data.fullName, email: data.email, password: data.password,
        phone: data.phone, address: data.address, dob: data.dob,
        role: data.role, house_code: data.houseCode,
      });
      setToken(res.access_token);
      const apiUser = res.user;
      setRawUser(apiUser);
      const h = mapApiUserMemberships(apiUser);
      setHouses(h);
      setIsMockMode(false);
      return { success: true, houseCode: res.house_code, pendingApproval: res.pending_approval };
    } catch (err: any) {
      if (err.message === '__MOCK__') {
        setIsMockMode(true);
        const code = data.role === 'admin' ? `NEST-${Math.random().toString(36).substring(2, 6).toUpperCase()}` : undefined;
        const mockRaw = {
          id: crypto.randomUUID(), full_name: data.fullName, email: data.email,
          phone: data.phone || null, address: data.address || null, dob: data.dob || null,
        };
        const mockHouses: HouseInfo[] = [{
          id: crypto.randomUUID(), name: 'My House', code: code || data.houseCode || '',
          role: data.role, isPrimaryAdmin: data.role === 'admin',
          status: data.role === 'admin' ? 'active' : 'pending', joinedAt: new Date().toISOString(),
        }];
        setRawUser(mockRaw);
        setHouses(mockHouses);
        saveMockData(mockRaw, mockHouses);
        setToken('mock-token');
        return { success: true, houseCode: code, pendingApproval: data.role === 'member' };
      }
      throw err;
    }
  }, [setHouses]);

  const logout = useCallback(() => {
    setToken(null);
    clearMockData();
    setUser(null);
    setRawUser(null);
    setIsMockMode(false);
    setHouses([]);
  }, [setHouses]);

  const updateUser = useCallback((updates: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
    // Also update rawUser for persistence
    if (isMockMode) {
      setRawUser((prev: any) => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (updates.fullName) updated.full_name = updates.fullName;
        if (updates.email) updated.email = updates.email;
        if (updates.phone !== undefined) updated.phone = updates.phone;
        saveMockData(updated, houses);
        return updated;
      });
    }
  }, [isMockMode, houses]);

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, updateUser, isAuthenticated: !!user, loading, isMockMode }}>
      {children}
    </AuthContext.Provider>
  );
};
