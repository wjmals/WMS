'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { Lock, ArrowRight } from 'lucide-react';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const publicPaths = ['/login', '/signup'];
  const isPublicPath = publicPaths.includes(pathname);

  useEffect(() => {
    if (!isLoading && !user && !isPublicPath) {
      router.push('/login');
    }
  }, [user, isLoading, isPublicPath, router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-semibold text-textMuted">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          보안 사용자 인증 확인 중...
        </div>
      </div>
    );
  }

  // If user is not logged in and trying to access a protected page, block rendering & show login redirect prompt
  if (!user && !isPublicPath) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
        <div className="w-16 h-16 mb-4 rounded-3xl bg-blue-50 dark:bg-blue-950/40 text-primary flex items-center justify-center border border-blue-100 dark:border-blue-900/50 shadow-sm">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          보안 로그인 필요
        </h2>
        <p className="text-sm text-textMuted max-w-sm mb-6">
          WMS 재고 및 물류 관리 데이터 보호를 위해 로그인 후 서비스를 이용해주시기 바랍니다.
        </p>
        <a
          href="/login"
          className="px-6 py-3 bg-primary hover:bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all"
        >
          로그인 페이지로 이동
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
