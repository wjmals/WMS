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
        <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-4">
          <div>
            <div className="flex items-center gap-2 text-amber-600 font-bold text-xs uppercase mb-1">
              <Clock className="w-4 h-4" />
              WAREHOUSE MANAGER APPROVAL CENTER
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              📋 신규 창고 관리자 회원가입 승인 신청 ({pendingAdmins.length}건)
            </h2>
            <p className="text-xs text-textMuted mt-0.5">
              창고 관리자로 가입 신청한 계정입니다. 승인 시 정식 관리자 권한이 즉시 부여됩니다.
            </p>
          </div>
        </div>

        {pendingAdmins.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-gray-800 dark:text-gray-200">현재 승인 대기 중인 신규 창고 관리자가 없습니다.</p>
            <p className="text-xs text-textMuted">모든 가입 신청이 정상 처리되었습니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingAdmins.map((req) => (
              <div key={req.id} className="p-5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-center justify-between gap-4">
                <div>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold inline-block mb-1">
                    창고 관리자 가입 요청
                  </span>
                  <h4 className="font-extrabold text-base text-gray-900 dark:text-white">{req.name}</h4>
                  <p className="text-xs font-mono text-textMuted">{req.email}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleApproveAdmin(req.email)}
                    disabled={loading}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
                  >
                    <UserCheck className="w-4 h-4" />
                    창고 관리자 승인
                  </button>

                  <button
                    onClick={() => handleDeleteUser(req.email, '신청 관리자')}
                    disabled={loading}
                    className="p-2 bg-red-100 dark:bg-red-950/50 text-red-600 hover:bg-red-200 rounded-xl transition-all"
                    title="신청 거절/삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. 등록된 창고 관리자 & 하위 소속 창고지기 열람/삭제 관제 (아코디언 형태) */}
      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div className="border-b border-gray-100 dark:border-gray-800 pb-4">
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase mb-1">
            <Users className="w-4 h-4" />
            MANAGERS & KEEPERS DIRECTORY
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            👔 승인된 창고 관리자 & 소속 창고지기 통합 관리 ({warehouseAdmins.length}명)
          </h2>
          <p className="text-xs text-textMuted mt-0.5">
            창고 관리자를 클릭하면 하위에 등록되어 있는 소속 창고지기 목록을 펼쳐볼 수 있으며 계정을 자유롭게 삭제할 수 있습니다.
          </p>
        </div>

        {warehouseAdmins.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-2xl text-xs text-textMuted">
            등록된 창고 관리자가 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {warehouseAdmins.map((admin) => {
              const isExpanded = expandedManagerEmail === admin.email;
              const subKeepers = warehouseKeepers.filter(k => k.adminEmail === admin.email);

              return (
                <div key={admin.id} className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden bg-gray-50/30 dark:bg-gray-800/30 transition-all">
                  
                  {/* 창고 관리자 카드 헤더 */}
                  <div className="p-4 flex items-center justify-between gap-4 bg-white dark:bg-gray-900">
                    <button
                      onClick={() => setExpandedManagerEmail(isExpanded ? null : admin.email)}
                      className="flex items-center gap-3 text-left flex-1 hover:opacity-80 transition-all"
                    >
                      <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/50 text-primary flex items-center justify-center font-bold">
                        👔
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-sm text-gray-900 dark:text-white">{admin.name}</h4>
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 text-[10px] font-bold">
                            창고 관리자
                          </span>
                          <span className="text-xs text-textMuted">
                            (소속 창고지기 {subKeepers.length}명)
                          </span>
                        </div>
                        <p className="text-xs font-mono text-textMuted">{admin.email} • 창고 ID: {admin.warehouseId || 'wh_default'}</p>
                      </div>
                      <div className="text-gray-400 pl-2">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </button>

                    <button
                      onClick={() => handleDeleteUser(admin.email, '창고 관리자')}
                      className="px-3.5 py-2 bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-red-200 dark:border-red-900/40"
                    >
                      <Trash2 size={13} />
                      관리자 계정 삭제
                    </button>
                  </div>

                  {/* 하위 소속 창고지기 목록 (아코디언 펼침) */}
                  {isExpanded && (
                    <div className="p-4 bg-gray-100/60 dark:bg-gray-800/60 border-t border-gray-200 dark:border-gray-700 space-y-2">
                      <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                        📦 '{admin.name}' 관리자 소속 창고지기 목록 ({subKeepers.length}명)
                      </h5>

                      {subKeepers.length === 0 ? (
                        <p className="text-xs text-textMuted italic py-2">
                          현재 이 창고 관리자에 등록된 창고지기가 없습니다.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {subKeepers.map((keeper) => (
                            <div key={keeper.id} className="p-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                              <div>
                                <span className="font-bold text-xs text-gray-900 dark:text-white block">📦 {keeper.name}</span>
                                <span className="text-[11px] font-mono text-textMuted">{keeper.email}</span>
                              </div>

                              <button
                                onClick={() => handleDeleteUser(keeper.email, '창고지기')}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all text-xs font-bold flex items-center gap-1"
                                title="창고지기 삭제"
                              >
                                <Trash2 size={13} />
                                삭제
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. 전체 사용자 목록 통합 보기 */}
      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 md:p-8 shadow-sm space-y-4">
        <div className="border-b border-gray-100 dark:border-gray-800 pb-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              👥 전체 사용자 통합 목록 ({allUsers.length}명)
            </h2>
            <p className="text-xs text-textMuted mt-0.5">시스템 전체 사용자의 계정 권한 및 삭제 관리</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-textMuted font-bold uppercase bg-gray-50 dark:bg-gray-800/60">
                <th className="py-3 px-4">이름</th>
                <th className="py-3 px-4">이메일 계정</th>
                <th className="py-3 px-4">역할 (Role)</th>
                <th className="py-3 px-4">상태</th>
                <th className="py-3 px-4 text-right">계정 삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800 font-semibold">
              {allUsers.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                  <td className="py-3.5 px-4 font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    {u.role === '서버 관리자' ? '👑' : u.role === '관리자' ? '👔' : '📦'} {u.name}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-gray-600 dark:text-gray-300">{u.email}</td>
                  <td className="py-3.5 px-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      u.role === '서버 관리자'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300'
                        : u.role === '관리자'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`flex items-center gap-1 text-[11px] font-bold ${
                      u.status === 'APPROVED' ? 'text-emerald-600' : 'text-amber-600'
                    }`}>
                      <CheckCircle2 size={13} />
                      {u.status === 'APPROVED' ? '승인됨' : '대기 중'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    {u.role !== '서버 관리자' && (
                      <button
                        onClick={() => handleDeleteUser(u.email, u.role)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all"
                        title="계정 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
