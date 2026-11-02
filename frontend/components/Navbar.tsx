'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { QrCode, LogOut, Shield, Warehouse, Lock, Users } from 'lucide-react';
import AdminUserConsole from './AdminUserConsole';

const NAV_LINKS = [
  { href: '/barcode', label: '바코드 스캔', icon: true },
  { href: '/delivery', label: '배송 관리' },
  { href: '/', label: '재고 현황' },
  { href: '/report', label: 'AI 리포트' },
  { href: '/monitor', label: '실시간 모니터링', live: true },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname() || '/';
  const [showConsole, setShowConsole] = useState(false);

  const isSuperAdmin = user?.role === '서버 관리자';
  const isWarehouseAdmin = user?.role === '관리자' || user?.role === '총괄';
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      <nav className="sticky top-0 z-50 w-full backdrop-blur-[20px] bg-white/70 dark:bg-black/70 border-b border-gray-200 dark:border-gray-800 font-sans">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-2 lg:py-0 lg:h-14 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <a href={user ? '/' : '/login'} className="font-bold text-lg tracking-tight text-textMain dark:text-white flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center text-xs font-black">W</span>
            AI Native WMS
          </a>

          {user ? (
            <div className="contents lg:flex lg:items-center lg:gap-5 text-sm font-semibold text-textMuted">
              {/* 서버 관리자(wjmals)가 아닐 때만 일반 창고 메뉴 표시 */}
              {!isSuperAdmin && (
                <div className="order-last lg:order-none w-full lg:w-auto flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0">
                  {NAV_LINKS.map((link) => {
                    const active = isActive(link.href);
                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        aria-current={active ? 'page' : undefined}
                        className={`whitespace-nowrap px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors ${
                          active
                            ? 'bg-primary text-white font-bold shadow-sm'
                            : link.live
                            ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary'
                        }`}
                      >
                        {link.icon && <QrCode className="w-4 h-4" />}
                        {link.live && <span className={`w-2 h-2 rounded-full animate-pulse ${active ? 'bg-white' : 'bg-red-500'}`}></span>}
                        {link.label}
                      </a>
                    );
                  })}
                </div>
              )}

              {/* User Profile, Admin Member Console & Logout */}
              <div className="lg:border-l border-gray-200 dark:border-gray-700 lg:pl-4 lg:ml-1 flex items-center gap-2 sm:gap-3 min-w-0">
                {/* 창고 관리자 전용 소속 창고지기 승인 콘솔 버튼 */}
                {isWarehouseAdmin && (
                  <button
                    onClick={() => setShowConsole(true)}
                    className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-primary border border-blue-200 dark:border-blue-900/50 hover:bg-blue-100 transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  >
                    <Users className="w-3.5 h-3.5" />
                    멤버 승인/관리
                  </button>
                )}

                <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-xl min-w-0">
                  {isSuperAdmin ? (
                    <Shield className="w-3.5 h-3.5 text-purple-600" />
                  ) : isWarehouseAdmin ? (
                    <Shield className="w-3.5 h-3.5 text-blue-500" />
                  ) : (
                    <Warehouse className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
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
      {isWarehouseAdmin && <AdminUserConsole isOpen={showConsole} onClose={() => setShowConsole(false)} />}
    </>
  );
}
