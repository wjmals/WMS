'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { firebaseSendPasswordReset } from '../../lib/firebase-client';
import { Lock, Mail, UserCheck, ArrowRight, ShieldCheck, Info } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('아이디/이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const ok = await login(email, password);
      if (ok) {
        router.push('/');
      } else {
        setError('로그인 실패: 아이디 또는 비밀번호가 올바르지 않습니다.');
      }
    } catch (err) {
      setError('로그인 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    const resetEmail = email.trim();
    if (!resetEmail || !resetEmail.includes('@')) {
      setError('비밀번호를 찾을 이메일 주소를 먼저 입력해주세요.');
      return;
    }
    setResetting(true);
    setError('');
    setResetMessage('');
    try {
      await firebaseSendPasswordReset(resetEmail);
      setResetMessage('비밀번호 재설정 이메일을 보냈습니다. 메일함을 확인해주세요.');
    } catch (err: any) {
      setError(err?.code === 'EMAIL_NOT_FOUND'
        ? 'Firebase Authentication에 등록된 이메일이 없습니다.'
        : '비밀번호 재설정 이메일을 보내지 못했습니다.');
    } finally {
      setResetting(false);
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

        {resetMessage && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-100">
            {resetMessage}
          </div>
        )}



        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              아이디 또는 이메일 주소
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="아이디 또는 name@company.com"
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
                required
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

        <button
          type="button"
          onClick={handlePasswordReset}
          disabled={resetting}
          className="w-full mt-4 text-xs font-semibold text-textMuted hover:text-primary disabled:opacity-50"
        >
          {resetting ? '재설정 이메일 보내는 중...' : '비밀번호를 잊으셨나요?'}
        </button>

        <div className="mt-8 text-center text-xs text-textMuted border-t border-gray-100 dark:border-gray-800 pt-6">
          계정이 없으신가요?{' '}
          <a href="/signup" className="text-primary font-bold hover:underline ml-1">
            창고지기 회원가입하기
          </a>
        </div>
      </div>
    </div>
  );
}
