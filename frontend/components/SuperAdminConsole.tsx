'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, UserCheck, Clock, Users, RefreshCw, CheckCircle2, Trash2, ChevronDown, ChevronUp, Sparkles, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface PendingAdmin {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  status: string;
}

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  warehouseId?: string;
  adminEmail?: string;
  createdAt?: string;
}

export default function SuperAdminConsole() {
  const { user } = useAuth();
  const [pendingAdmins, setPendingAdmins] = useState<PendingAdmin[]>([]);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedManagerEmail, setExpandedManagerEmail] = useState<string | null>(null);

  const fetchAdminData = useCallback(async () => {
    if (!user || user.role !== '서버 관리자') return;
    try {
      setLoading(true);
      const [pendingRes, allRes] = await Promise.all([
        fetch('/api/users?action=list_admin_requests'),
        fetch('/api/users'),
      ]);

      if (pendingRes.ok) {
        const pData = await pendingRes.json();
        setPendingAdmins(Array.isArray(pData) ? pData : []);
      }

      if (allRes.ok) {
        const uData = await allRes.json();
        setAllUsers(Array.isArray(uData) ? uData : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // 1. 창고 관리자 가입 신청 승인 처리 (Confirm + 자동 새로고침)
  const handleApproveAdmin = async (targetEmail: string) => {
    if (!confirm(`'${targetEmail}' 계정을 '창고 관리자'로 정말 승인하시겠습니까?`)) {
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_admin',
          targetEmail,
        }),
      });

      if (res.ok) {
        alert(`'${targetEmail}' 계정이 '창고 관리자'로 정상 승인되었습니다.`);
        window.location.reload();
      } else {
        alert('관리자 승인 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      alert('통신 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 2. 서버 관리자가 임의로 계정 (관리자 또는 창고지기) 삭제
  const handleDeleteUser = async (targetEmail: string, roleName: string) => {
    if (targetEmail === 'wjmals' || targetEmail === user?.email) {
      alert('서버 총괄 관리자 계정은 삭제할 수 없습니다.');
      return;
    }

    if (!confirm(`'${targetEmail}' (${roleName}) 계정을 정말 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) {
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_user',
          targetEmail,
        }),
      });

      if (res.ok) {
        alert(`'${targetEmail}' 계정이 성공적으로 삭제되었습니다.`);
        await fetchAdminData();
      } else {
        const err = await res.json();
        alert(err.error || '계정 삭제 실패');
      }
    } catch (e) {
      alert('삭제 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role !== '서버 관리자') return null;

  const warehouseAdmins = allUsers.filter(u => u.role === '관리자' && u.email !== user.email);
  const warehouseKeepers = allUsers.filter(u => u.role === '창고지기');
  const unassignedKeepers = warehouseKeepers.filter((keeper) => (
    !keeper.adminEmail || !warehouseAdmins.some((admin) => admin.email.toLowerCase() === keeper.adminEmail?.toLowerCase())
  ));

  return (
    <div className="flex flex-col gap-8 max-w-[1200px] mx-auto font-sans pb-16">
      
      {/* 👑 서버 관리자 메인 헤더 */}
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 text-white p-8 rounded-3xl shadow-xl border border-indigo-800/40 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/30">
              <Sparkles className="w-4 h-4 text-purple-400" />
              SYSTEM SUPER ADMIN MANAGEMENT DASHBOARD
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              👑 서버 총괄 관리자 (wjmals) 계정 승인 & 회원 관제
            </h1>
            <p className="text-xs text-indigo-200/80">
              신규 창고 관리자 승인, 소속 창고지기 계정 조회 및 멀티 테넌트 사용자 삭제 관리
            </p>
          </div>

          <button
            onClick={fetchAdminData}
            disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/40 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            데이터 새로고침
          </button>
        </div>

        {/* 상단 3대 서버 KPI 요약 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10">
          <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
            <span className="text-[11px] font-bold text-indigo-300 uppercase block">승인 대기 관리자</span>
            <strong className="text-2xl font-black text-amber-400 mt-1 block">
              {pendingAdmins.length} 명
            </strong>
            <span className="text-[10px] text-indigo-200/70">신규 가입 수락 대기 중</span>
          </div>

          <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
            <span className="text-[11px] font-bold text-indigo-300 uppercase block">승인된 창고 관리자</span>
            <strong className="text-2xl font-black text-blue-400 mt-1 block">
              {warehouseAdmins.filter(a => a.status === 'APPROVED').length} 명
            </strong>
            <span className="text-[10px] text-indigo-200/70">등록된 총 관리자</span>
          </div>

          <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
            <span className="text-[11px] font-bold text-indigo-300 uppercase block">등록된 소속 창고지기</span>
            <strong className="text-2xl font-black text-emerald-400 mt-1 block">
              {warehouseKeepers.length} 명
            </strong>
            <span className="text-[10px] text-indigo-200/70">전체 창고 현장 팀원</span>
          </div>
        </div>
      </header>

      {/* 1. 신규 창고 관리자 가입 신청 승인 센터 (PENDING_ADMIN) */}
      <section className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/40 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4 dark:border-gray-800">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-amber-600"><Clock className="h-4 w-4" />WAREHOUSE MANAGER APPROVAL CENTER</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">신규 창고 관리자 회원가입 승인 신청 ({pendingAdmins.length}건)</h2>
            <p className="mt-0.5 text-xs text-textMuted">관리자로 가입 신청한 계정입니다.</p>
          </div>
        </div>
        {pendingAdmins.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-8 text-center text-sm text-textMuted dark:border-gray-800 dark:bg-gray-800/40">현재 승인 대기 중인 신규 창고 관리자가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {pendingAdmins.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div>
                  <span className="mb-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">창고 관리자 가입 요청</span>
                  <h4 className="text-base font-extrabold text-gray-900 dark:text-white">{request.name}</h4>
                  <p className="font-mono text-xs text-textMuted">{request.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => handleApproveAdmin(request.email)} disabled={loading} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"><UserCheck className="h-4 w-4" />창고 관리자 승인</button>
                  <button onClick={() => handleDeleteUser(request.email, '신청 관리자')} disabled={loading} className="rounded-xl bg-red-100 p-2 text-red-600 transition-all hover:bg-red-200 disabled:opacity-50 dark:bg-red-950/50" title="신청 거절/삭제"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. 관리자별 소속 창고지기 디렉터리 */}
      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div className="border-b border-gray-100 pb-4 dark:border-gray-800">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-primary"><Users className="h-4 w-4" />MANAGERS & KEEPERS DIRECTORY</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">창고 관리자별 사용자 목록 ({warehouseAdmins.length}개 창고 관리자)</h2>
          <p className="mt-0.5 text-xs text-textMuted">관리자를 열면 소속 창고지기와 승인 상태를 확인할 수 있습니다.</p>
        </div>
        {warehouseAdmins.length === 0 ? (
          <div className="rounded-2xl bg-gray-50 p-8 text-center text-xs text-textMuted dark:bg-gray-800/40">등록된 창고 관리자가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {warehouseAdmins.map((admin) => {
              const groupKey = `users:${admin.email}`;
              const isExpanded = expandedManagerEmail === groupKey;
              const members = warehouseKeepers.filter((keeper) => keeper.adminEmail?.toLowerCase() === admin.email.toLowerCase());
              return (
                <section key={admin.id} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="flex items-center gap-2 p-3">
                    <button aria-expanded={isExpanded} onClick={() => setExpandedManagerEmail(isExpanded ? null : groupKey)} className="flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      {isExpanded ? <ChevronUp size={17} className="shrink-0 text-primary" /> : <ChevronDown size={17} className="shrink-0 text-textMuted" />}
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-gray-900 dark:text-white">창고 관리자 {admin.name} ({members.length}명)</strong>
                        <span className="block truncate text-xs text-textMuted">{admin.email} · {admin.warehouseId || '창고 미배정'} · {admin.status === 'APPROVED' ? '승인됨' : '승인 대기'}</span>
                      </span>
                    </button>
                    <button onClick={() => handleDeleteUser(admin.email, '창고 관리자')} disabled={loading} title="창고 관리자 삭제" className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><Trash2 size={15} /></button>
                  </div>
                  {isExpanded && (
                    <div className="space-y-2 border-t border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-900/50">
                      {members.length === 0 ? <p className="px-2 py-3 text-xs text-textMuted">소속 창고지기가 없습니다.</p> : members.map((member) => (
                        <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                          <div className="min-w-0"><strong className="block truncate text-xs text-gray-900 dark:text-white">{member.name}</strong><span className="block truncate font-mono text-[11px] text-textMuted">{member.email}</span></div>
                          <div className="flex shrink-0 items-center gap-2"><span className={`text-[11px] font-bold ${member.status === 'APPROVED' ? 'text-emerald-600' : 'text-amber-600'}`}>{member.status === 'APPROVED' ? '승인됨' : '창고 승인 대기'}</span><button onClick={() => handleDeleteUser(member.email, '창고지기')} disabled={loading} title="창고지기 삭제" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><Trash2 size={14} /></button></div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. 미배정 창고지기 */}
      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">미배정 창고지기 ({unassignedKeepers.length}명)</h2>
          <p className="mt-0.5 text-xs text-textMuted">연결된 창고 관리자 그룹을 찾을 수 없는 계정입니다.</p>
        </div>
        {unassignedKeepers.length === 0 ? (
          <p className="rounded-xl bg-gray-50 p-4 text-center text-xs text-textMuted">미배정 계정이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {unassignedKeepers.map((keeper) => (
              <div key={keeper.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div><strong className="block text-sm">{keeper.name}</strong><span className="text-xs text-textMuted">{keeper.email} · {keeper.status === 'APPROVED' ? '승인됨' : '창고 승인 대기'}</span></div>
                <button onClick={() => handleDeleteUser(keeper.email, '창고지기')} disabled={loading} title="창고지기 삭제" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
