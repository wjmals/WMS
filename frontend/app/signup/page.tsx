'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, Mail, Lock, User, Shield, ArrowRight, Info, CheckCircle2 } from 'lucide-react';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('창고지기');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signedUpSuccess, setSignedUpSuccess] = useState(false);

  const { signup } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      setError('모든 항목을 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const ok = await signup(email, password, name, role);
      if (ok) {
        setSignedUpSuccess(true);
      } else {
        setError('회원가입 요청 처리 중 오류가 발생했습니다.');
      }
    } catch (err) {
      setError('회원가입 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (signedUpSuccess) {
    return (
      <div className="max-w-[480px] mx-auto py-12 px-4 font-sans">
        <div className="bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-900/50 rounded-3xl p-8 shadow-xl text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shadow-sm">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div>
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold inline-block mb-2">
              가입 신청 완료
            </span>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white">
              가입 신청이 진행 중입니다
            </h2>
            <p className="text-xs text-textMuted mt-2 leading-relaxed">
              안녕하세요, <strong className="text-gray-900 dark:text-white">{name}</strong> 님!<br />
              {role === '관리자'
                ? '창고 관리자 계정 가입 신청이 성공적으로 접수되었습니다. 서버 관리자 승인 후 대시보드가 활성화됩니다.'
                : '창고지기 계정 가입 신청이 완료되었습니다. 담당 창고 관리자에게 승인을 요청해 주세요.'}
            </p>
          </div>

          <button
            onClick={() => router.push('/')}
            className="w-full py-3.5 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all"
          >
            대시보드 / 승인 상태 확인하기
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[480px] mx-auto py-12 px-4 font-sans">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-8 shadow-xl backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-teal-500/30">
            <UserPlus className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            WMS 사용자 회원가입
          </h1>
          <p className="text-sm text-textMuted mt-1">
            스마트 물류 시스템 계정을 생성하세요
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-600 text-xs font-semibold border border-red-100">
            {error}
          </div>
        )}

        <div className="mb-6 p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/50 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
          <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block mb-0.5">승인 절차 안내</span>
            가입 신청 후 서버 관리자의 승인(관리자 신청 시) 또는 창고 관리자의 승인(창고지기 신청 시) 완료 시 대시보드를 바로 사용할 수 있습니다.
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              사용자 이름 / 담당자명
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white dark:focus:bg-gray-900 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              이메일 주소
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white dark:focus:bg-gray-900 transition-all"
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
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white dark:focus:bg-gray-900 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              신청 역할 구분
            </label>
            <div className="relative">
              <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white dark:focus:bg-gray-900 transition-all appearance-none font-semibold"
              >
                <option value="창고지기">창고지기 (관리자 승인 필요)</option>
                <option value="관리자">관리자 계정 신청 (서버 관리자 승인 필요)</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? '가입 진행 중...' : '계정 신청하기'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-textMuted border-t border-gray-100 dark:border-gray-800 pt-6">
          이미 계정이 있으신가요?{' '}
          <a href="/login" className="text-emerald-600 font-bold hover:underline ml-1">
            로그인하기
          </a>
        </div>
      </div>
    </div>
  );
}
