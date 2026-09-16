'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { Lock, ArrowRight, AlertTriangle, ShieldCheck, Mail, RefreshCw, Send, CheckCircle2 } from 'lucide-react';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, refreshUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestResult, setRequestResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const publicPaths = ['/login', '/signup'];
  const isPublicPath = publicPaths.includes(pathname);

  useEffect(() => {
    if (!isLoading && !user && !isPublicPath) {
      router.push('/login');
    }
  }, [user, isLoading, isPublicPath, router, pathname]);

  // 창고지기가 관리자 이메일을 입력하여 승인 요청 전송
  const handleSendAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmailInput || !user) return;
    setSubmitting(true);
    setRequestResult(null);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_access',
          email: user.email,
          name: user.name,
          adminEmail: adminEmailInput.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setRequestResult({ type: 'success', text: data.message });
        await refreshUser();
      } else {
        const err = await res.json();
        setRequestResult({ type: 'error', text: err.error || '요청 실패' });
      }
    } catch (err) {
      setRequestResult({ type: 'error', text: '통신 오류가 발생했습니다.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-semibold text-textMuted">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          보안 사용자 인증 및 창고 권한 확인 중...
        </div>
      </div>
    );
  }

  // 1. 비로그인 사용자 처리
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

  // 2. 창고지기 가입 후 창고 승인 대기 중 (PENDING_WAREHOUSE)
  if (user && user.role === '창고지기' && user.status === 'PENDING_WAREHOUSE' && !isPublicPath) {
    return (
      <div className="max-w-[500px] mx-auto py-12 px-4">
        <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/50 rounded-3xl p-8 shadow-xl text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-amber-50 dark:bg-amber-950/50 text-amber-500 flex items-center justify-center border border-amber-200">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <div>
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold inline-block mb-2">
              창고 권한 승인 필요
            </span>
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">
              창고 관리자에게 권한을 요청하세요
            </h2>
            <p className="text-sm text-textMuted mt-2 leading-relaxed">
              안녕하세요, <strong className="text-gray-900 dark:text-white">{user.name}</strong> 님!<br />
              창고 재고 데이터를 조회하고 입출고를 관리하려면 담당 창고 관리자의 이메일로 접근 권한을 요청해야 합니다.
            </p>
          </div>

          {requestResult && (
            <div
              className={`p-4 rounded-xl text-xs font-semibold ${
                requestResult.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {requestResult.text}
            </div>
          )}

          {user.requestedAdminEmail ? (
            <div className="p-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                담당 관리자 승인 대기 중
              </div>
              <p className="text-xs text-textMuted">
                담당 관리자: <strong className="text-gray-900 dark:text-white font-mono">{user.requestedAdminEmail}</strong>
              </p>
              <button
                onClick={refreshUser}
                className="w-full py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-800 dark:text-gray-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                승인 상태 새로고침
              </button>
            </div>
          ) : (
            <form onSubmit={handleSendAccessRequest} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  담당 창고 관리자 이메일 / 아이디 입력
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={adminEmailInput}
                    onChange={(e) => setAdminEmailInput(e.target.value)}
                    placeholder="예: wjmals 또는 admin@company.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {submitting ? '요청 보내는 중...' : '관리자에게 권한 요청 보내기'}
              </button>
            </form>
          )}

        </div>
      </div>
    );
  }

  // 3. 관리자 가입 후 서버 관리자(wjmals) 승인 대기 중 (PENDING_ADMIN)
  if (user && user.role === '관리자' && user.status === 'PENDING_ADMIN' && !isPublicPath) {
    return (
      <div className="max-w-[480px] mx-auto py-12 px-4">
        <div className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-900/50 rounded-3xl p-8 shadow-xl text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-50 text-primary flex items-center justify-center border border-blue-100">
            <ShieldCheck className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">
              서버 관리자 승인 대기 중
            </h2>
            <p className="text-xs text-textMuted mt-2 leading-relaxed">
              신규 관리자 계정 승인 신청이 접수되었습니다.<br />
              서버 총괄 관리자(<code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded font-bold">wjmals</code>)의 승인 후 관리자 전용 대시보드가 활성화됩니다.
            </p>
          </div>

          <button
            onClick={refreshUser}
            className="w-full py-3 bg-primary text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            승인 상태 확인하기
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
