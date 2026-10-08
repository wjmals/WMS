'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface User {
  id: string;
  username?: string;
  email: string;
  name: string;
  role: '서버 관리자' | '관리자' | '창고지기' | string;
  status: 'APPROVED' | 'PENDING_ADMIN' | 'PENDING_WAREHOUSE';
  warehouseId?: string;
  adminEmail?: string;
  requestedAdminEmail?: string;
}

interface AuthContextType {
  user: User | null;
  login: (emailOrUsername: string, password?: string) => Promise<boolean>;
  signup: (email: string, password?: string, name?: string, role?: string, adminEmail?: string) => Promise<boolean>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => false,
  signup: async () => false,
  logout: () => {},
  refreshUser: async () => {},
  isLoading: true,
});

const API_BASE = '/api';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionVerifiedRef = useRef(false);

  const refreshUser = useCallback(async () => {
    const savedUser = localStorage.getItem('wms_auth_user');
    if (!savedUser) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const parsed: User = JSON.parse(savedUser);
      const res = await fetch(`${API_BASE}/users?action=get_user&email=${encodeURIComponent(parsed.email)}`);
      if (res.ok) {
        const dbUser = await res.json();
        if (dbUser && !dbUser.error) {
          const updated: User = {
            id: dbUser.id || parsed.id,
            username: dbUser.username || parsed.username,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role || '창고지기',
            status: dbUser.status || 'APPROVED',
            warehouseId: dbUser.warehouseId,
            adminEmail: dbUser.adminEmail,
            requestedAdminEmail: dbUser.requestedAdminEmail,
          };
          setUser(updated);
          sessionVerifiedRef.current = true;
          localStorage.setItem('wms_auth_user', JSON.stringify(updated));
        } else {
          setUser(null);
          sessionVerifiedRef.current = false;
          localStorage.removeItem('wms_auth_user');
          fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
        }
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        setUser(null);
        sessionVerifiedRef.current = false;
        localStorage.removeItem('wms_auth_user');
        fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
      }
    } catch (e) {
      console.error('Failed to refresh user', e);
      if (!sessionVerifiedRef.current) {
        setUser(null);
        localStorage.removeItem('wms_auth_user');
        fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void refreshUser();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshUser, user?.email]);

  const login = async (emailOrUsername: string, passwordInput?: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: emailOrUsername,
          email: emailOrUsername,
          password: passwordInput,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || '로그인에 실패했습니다.');
        return false;
      }

      const data = await res.json();
      if (data.success && data.user) {
        const loggedUser: User = {
          id: data.user.id || `usr_${Date.now()}`,
          username: data.user.username,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role || '창고지기',
          status: data.user.status || 'APPROVED',
          warehouseId: data.user.warehouseId,
          adminEmail: data.user.adminEmail,
          requestedAdminEmail: data.user.requestedAdminEmail,
        };
        setUser(loggedUser);
        sessionVerifiedRef.current = true;
        localStorage.setItem('wms_auth_user', JSON.stringify(loggedUser));
        return true;
      }
      alert('로그인에 실패했습니다.');
      return false;
    } catch (err) {
      console.error('Login error:', err);
      alert('로그인 처리 중 오류가 발생했습니다.');
      return false;
    }
  };

  const signup = async (
    emailInput: string,
    passwordInput?: string,
    nameInput?: string,
    roleInput?: string,
    adminEmailInput?: string
  ): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'signup',
          email: emailInput,
          username: emailInput.split('@')[0],
          password: passwordInput,
          name: nameInput,
          role: roleInput || '창고지기',
          adminEmail: adminEmailInput,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const error = new Error(errData.error || '회원가입 실패') as Error & { code?: string };
        throw error;
      }

      const data = await res.json();
      return !!(data.success && data.user);
    } catch (err) {
      console.error('Signup error:', err);
      throw err;
    }
  };

  const logout = () => {
    setUser(null);
    sessionVerifiedRef.current = false;
    localStorage.removeItem('wms_auth_user');
    fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
