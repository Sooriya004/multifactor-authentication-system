import React, { createContext, useContext, useState, useCallback } from 'react';

interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'member';
  isPrimaryAdmin: boolean;
  houseId: string;
  houseCode: string;
  status: 'active' | 'blocked' | 'pending';
}

interface AuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (data: SignupData) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}

interface SignupData {
  fullName: string;
  email: string;
  password: string;
  role: 'admin' | 'member';
  houseCode?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback(async (_email: string, _password: string) => {
    // Mock login - in production this would hit the backend
    setUser({
      id: '1',
      fullName: 'Alex Morgan',
      email: _email,
      role: 'admin',
      isPrimaryAdmin: true,
      houseId: 'h1',
      houseCode: 'NEST-A1B2',
      status: 'active',
    });
    return true;
  }, []);

  const signup = useCallback(async (data: SignupData) => {
    if (data.role === 'admin') {
      const code = `NEST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      setUser({
        id: crypto.randomUUID(),
        fullName: data.fullName,
        email: data.email,
        role: 'admin',
        isPrimaryAdmin: true,
        houseId: crypto.randomUUID(),
        houseCode: code,
        status: 'active',
      });
    } else {
      setUser({
        id: crypto.randomUUID(),
        fullName: data.fullName,
        email: data.email,
        role: 'member',
        isPrimaryAdmin: false,
        houseId: '',
        houseCode: data.houseCode || '',
        status: 'pending',
      });
    }
    return true;
  }, []);

  const logout = useCallback(() => setUser(null), []);

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};
