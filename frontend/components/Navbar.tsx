'use client';

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { QrCode, LogOut, Shield, Warehouse, Lock, Users } from 'lucide-react';
import AdminUserConsole from './AdminUserConsole';

export default function Navbar() {
  const { user, logout } = useAuth();
  const [showConsole, setShowConsole] = useState(false);

  const isAdmin = user?.role === '관리자' || user?.role === '총괄';

  return (
    <>
      <nav className="sticky top-0 z-50 w-full backdrop-blur-[20px] bg-white/70 dark:bg-black/70 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <a href={user ? '/' : '/login'} className="font-bold text-lg tracking-tight text-textMain dark:text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center text-xs font-black">W</span>
            AI Native WMS
          </a>

          {user ? (
            <div className="flex items-center gap-5 text-sm font-semibold text-textMuted">
              {/* Nav links visible for authenticated users */}
              <a href="/barcode" className="hover:text-primary transition-colors flex items-center gap-1.5 text-primary font-bold">
                <QrCode className="w-4 h-4" />
                바코드 스캔
              </a>

              <a href="/delivery" className="hover:text-primary transition-colors">배송 관리</a>
              <a href="/" className="hover:text-primary transition-colors">재고 현황</a>
              <a href="/report" className="hover:text-primary transition-colors">AI 리포트</a>
              <a href="/monitor" className="hover:text-red-500 transition-colors flex items-center gap-1.5 text-red-500 font-bold">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                실시간 모니터링
              </a>

              {/* User Profile, Admin Member Console & Logout */}
              <div className="border-l border-gray-200 dark:border-gray-700 pl-4 ml-1 flex items-center gap-3">
                {isAdmin && (
                  <button
                    onClick={() => setShowConsole(true)}
                    className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-primary border border-blue-200 dark:border-blue-900/50 hover:bg-blue-100 transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  >
                    <Users className="w-3.5 h-3.5" />
                    멤버 승인/관리
                  </button>
                )}

                <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-xl">
                  {isAdmin ? (
                    <Shield className="w-3.5 h-3.5 text-blue-500" />
                  ) : (
                    <Warehouse className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    {user.name} ({user.role})
                  </span>
                </div>

                <button
                  onClick={logout}
                  title="로그아웃"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* When logged out: Only show Login / Signup buttons */
            <div className="flex items-center gap-2">
              <a
                href="/login"
                className="px-4 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-bold text-gray-800 dark:text-gray-200 transition-all flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                로그인
              </a>
              <a
                href="/signup"
                className="px-4 py-1.5 rounded-xl bg-primary hover:bg-blue-600 text-white text-xs font-bold shadow-sm transition-all"
              >
                회원가입
              </a>
            </div>
          )}
        </div>
      </nav>

      {/* Admin User Management Modal */}
      {isAdmin && <AdminUserConsole isOpen={showConsole} onClose={() => setShowConsole(false)} />}
    </>
  );
}
