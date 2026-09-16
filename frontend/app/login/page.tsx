'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { Lock, Mail, UserCheck, ArrowRight, ShieldCheck, Warehouse, Truck } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      setError('로그인 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (demoEmail: string) => {
    setLoading(true);
    try {
      await login(demoEmail, '123456');
      router.push('/');
    } catch (err) {
      setError('빠른 로그인 오류');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[440px] mx-auto py-12 px-4">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-8 shadow-xl backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-primary to-blue-400 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
            <UserCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            WMS 통합 물류 로그인
          </h1>
          <p className="text-sm text-textMuted mt-1">
            스마트 재고 관리 및 물류 모니터링 시스템
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-600 text-xs font-semibold border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              이메일 주소
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white dark:focus:bg-gray-900 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              비밀번호
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white dark:focus:bg-gray-900 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3.5 px-4 bg-primary hover:bg-blue-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? '로그인 중...' : '로그인하기'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-800"></div>
          </div>
          <span className="relative px-3 bg-white dark:bg-gray-900 text-xs text-textMuted">
            테스트 계정 바로 접속
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleQuickLogin('admin@wms.com')}
            className="flex flex-col items-center justify-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-gray-100 dark:border-gray-700 transition-all group"
          >
            <ShieldCheck className="w-5 h-5 text-blue-500 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">총괄 관리자</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('manager@wms.com')}
            className="flex flex-col items-center justify-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-gray-100 dark:border-gray-700 transition-all group"
          >
            <Warehouse className="w-5 h-5 text-emerald-500 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">창고지기</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('driver@wms.com')}
            className="flex flex-col items-center justify-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-gray-100 dark:border-gray-700 transition-all group"
          >
            <Truck className="w-5 h-5 text-purple-500 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">운송기사</span>
          </button>
        </div>

        <div className="mt-8 text-center text-xs text-textMuted">
          계정이 없으신가요?{' '}
          <a href="/signup" className="text-primary font-bold hover:underline">
            회원가입하기
          </a>
        </div>
      </div>
    </div>
  );
}
