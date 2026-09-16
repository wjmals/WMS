'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface User {
  id: string;
  email: string;
  name: string;
  role: '관리자' | '창고지기' | string;
  status: 'APPROVED' | 'PENDING_ADMIN' | 'PENDING_WAREHOUSE';
  warehouseId?: string;
  adminEmail?: string;
  requestedAdminEmail?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password?: string) => Promise<boolean>;
  signup: (email: string, password?: string, name?: string, role?: string) => Promise<boolean>;
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // DB에서 최신 유저 데이터 갱신
  const refreshUser = useCallback(async () => {
    const savedUser = localStorage.getItem('wms_auth_user');
    if (!savedUser) {
      setIsLoading(false);
      return;
    }

    try {
      const parsed: User = JSON.parse(savedUser);
      // 로컬 스토리지 데이터로 우선 빠른 복원
      setUser(parsed);
      setIsLoading(false);

      // 백그라운드에서 최신 정보 동기화
      const res = await fetch(`/api/users?action=get_user&email=${encodeURIComponent(parsed.email)}`);
      if (res.ok) {
        const dbUser = await res.json();
        const updated: User = {
          id: dbUser.id || parsed.id,
          email: dbUser.email,
          name: dbUser.name,
          role: dbUser.role || '창고지기',
          status: dbUser.status || 'APPROVED',
          warehouseId: dbUser.warehouseId,
          adminEmail: dbUser.adminEmail,
          requestedAdminEmail: dbUser.requestedAdminEmail,
        };
        setUser(updated);
        localStorage.setItem('wms_auth_user', JSON.stringify(updated));
      }
    } catch (e) {
      console.error('Failed to refresh user', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // 초기 마운트 시 localStorage에서 유저 복원
    const savedUser = localStorage.getItem('wms_auth_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {}
    }
    setIsLoading(false);
    refreshUser();
  }, [refreshUser]);

  const login = async (emailInput: string, passwordInput?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          email: emailInput,
          username: emailInput,
          password: passwordInput,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || '로그인에 실패했습니다.');
        return false;
      }

      const data = await res.json();
      if (data.success && data.user) {
        const loggedUser: User = {
          id: data.user.id || `usr_${Date.now()}`,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role || '창고지기',
          status: data.user.status || 'APPROVED',
          warehouseId: data.user.warehouseId,
          adminEmail: data.user.adminEmail,
          requestedAdminEmail: data.user.requestedAdminEmail,
        };
        setUser(loggedUser);
        localStorage.setItem('wms_auth_user', JSON.stringify(loggedUser));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Login error:', err);
      alert('로그인 처리 중 오류가 발생했습니다.');
      return false;
    }
  };

  const signup = async (emailInput: string, passwordInput?: string, nameInput?: string, roleInput?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'signup',
          email: emailInput,
          password: passwordInput,
          name: nameInput,
          role: roleInput || '창고지기',
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || '회원가입 실패');
        return false;
      }

      const data = await res.json();
      if (data.success && data.user) {
        const newUser: User = {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          status: data.user.status,
          warehouseId: data.user.warehouseId,
          adminEmail: data.user.adminEmail,
        };
        setUser(newUser);
        localStorage.setItem('wms_auth_user', JSON.stringify(newUser));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Signup error:', err);
      alert('회원가입 처리 중 오류가 발생했습니다.');
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('wms_auth_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
