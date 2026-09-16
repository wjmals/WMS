'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password?: string) => Promise<boolean>;
  signup: (email: string, password?: string, name?: string, role?: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => false,
  signup: async () => false,
  logout: () => {},
  isLoading: true,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check localStorage on initial load
    const savedUser = localStorage.getItem('wms_auth_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse saved user', e);
      }
    } else {
      // Default to demo admin user if none exists for convenience
      const defaultUser: User = {
        id: 'usr_admin_01',
        email: 'admin@wms-smartstock.ai',
        name: '김관리 (총괄)',
        role: '관리자',
      };
      setUser(defaultUser);
      localStorage.setItem('wms_auth_user', JSON.stringify(defaultUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password?: string): Promise<boolean> => {
    // Determine user name based on email prefix or custom lookup
    const namePart = email.split('@')[0];
    const name = namePart === 'admin' ? '김관리 (총괄)' : `${namePart} 님`;
    const role = email.includes('admin') ? '관리자' : email.includes('driver') ? '운송기사' : '창고지기';

    const loggedUser: User = {
      id: `usr_${Date.now()}`,
      email,
      name,
      role,
    };
    setUser(loggedUser);
    localStorage.setItem('wms_auth_user', JSON.stringify(loggedUser));
    return true;
  };

  const signup = async (email: string, password?: string, name?: string, role?: string): Promise<boolean> => {
    const newUser: User = {
      id: `usr_${Date.now()}`,
      email,
      name: name || email.split('@')[0],
      role: role || '창고지기',
    };
    setUser(newUser);
    localStorage.setItem('wms_auth_user', JSON.stringify(newUser));
    return true;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('wms_auth_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
