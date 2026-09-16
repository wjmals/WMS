'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, UserPlus, CheckCircle, Clock, Users, X, RefreshCw, Warehouse, Mail, UserCheck } from 'lucide-react';

interface PendingRequest {
  id: string;
  userEmail: string;
  userName: string;
  requestedAt: string;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  approvedAt?: string;
}

export default function AdminUserConsole({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user, refreshUser } = useAuth();
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!user || (user.role !== '관리자' && user.role !== '총괄')) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/users?action=list_requests&adminEmail=${encodeURIComponent(user.email)}`);
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.pendingRequests || []);
        setTeamMembers(data.teamMembers || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      fetchMembers();
    }
  }, [isOpen, fetchMembers]);

  // 창고지기 승인 처리
  const handleApprove = async (targetEmail: string, requestId?: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_user',
          targetEmail,
          adminEmail: user?.email,
          requestId,
        }),
      });
      if (res.ok) {
        setActionMsg({ type: 'success', text: `'${targetEmail}' 창고지기가 성공적으로 승인되었습니다!` });
        await fetchMembers();
        await refreshUser();
      } else {
        setActionMsg({ type: 'error', text: '승인 처리 실패' });
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: '오류가 발생했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  // 관리자가 창고지기 이메일 직접 입력하여 추가 & 승인
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    try {
      setLoading(true);
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite_user',
          targetEmail: inviteEmail.trim(),
          adminEmail: user?.email,
        }),
      });

      if (res.ok) {
        setActionMsg({ type: 'success', text: `'${inviteEmail}' 창고지기를 멤버로 등록하였습니다.` });
        setInviteEmail('');
        await fetchMembers();
      } else {
        const err = await res.json();
        setActionMsg({ type: 'error', text: err.error || '등록 실패' });
      }
    } catch (e) {
      setActionMsg({ type: 'error', text: '통신 오류' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-6 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 text-primary flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-textMain dark:text-white">
                창고 관리자 권한 및 멤버 관리 콘솔
              </h3>
              <p className="text-xs text-textMuted mt-0.5">
                담당 창고지기 승인 및 이메일 직접 등록 관리
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl"
          >
            <X size={20} />
          </button>
        </div>

        {actionMsg && (
          <div
            className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
              actionMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <span>{actionMsg.text}</span>
            <button onClick={() => setActionMsg(null)} className="underline opacity-70">닫기</button>
          </div>
        )}

        {/* 1. 이메일 직접 입력하여 창고지기 멤버 추가 */}
        <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-5 rounded-2xl space-y-3">
          <h4 className="text-xs font-bold uppercase text-primary flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            창고지기 이메일로 팀원 직접 추가 및 승인
          </h4>
          <p className="text-xs text-textMuted">
            창고지기의 이메일을 입력하여 추가하면 해당 창고지기도 동일한 창고 데이터를 확인 및 수량 조정을 할 수 있습니다.
          </p>
          <form onSubmit={handleInvite} className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="창고지기 이메일 입력 (예: manager@company.com)"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              <UserCheck className="w-4 h-4" />
              멤버 추가
            </button>
          </form>
        </div>

        {/* 2. 대기 중인 권한 승인 요청 목록 */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold uppercase text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              승인 대기 중인 권한 요청 ({pendingRequests.length}건)
            </h4>
            <button onClick={fetchMembers} className="p-1 hover:bg-gray-100 rounded text-xs text-textMuted flex items-center gap-1">
              <RefreshCw size={12} /> 새로고침
            </button>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-center text-xs text-textMuted">
              승인 대기 중인 새로운 권한 요청이 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingRequests.map((req) => (
                <div key={req.id} className="p-3.5 rounded-xl border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs text-gray-900 dark:text-white block">{req.userName}</span>
                    <span className="text-xs text-textMuted font-mono">{req.userEmail}</span>
                  </div>
                  <button
                    onClick={() => handleApprove(req.userEmail, req.id)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-sm"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    승인 (권한 부여)
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. 소속 창고지기 목록 */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold uppercase text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Warehouse className="w-4 h-4 text-emerald-500" />
            현재 이 창고 소속 팀원 ({teamMembers.length}명)
          </h4>

          {teamMembers.length === 0 ? (
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-center text-xs text-textMuted">
              아직 등록된 창고지기 팀원이 없습니다. 위에서 이메일로 추가해보세요.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {teamMembers.map((m) => (
                <div key={m.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                    W
                  </div>
                  <div>
                    <span className="font-bold text-xs text-gray-900 dark:text-white block">{m.name}</span>
                    <span className="text-[11px] text-textMuted">{m.email}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
