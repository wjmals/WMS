"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, CheckCircle, Package, TrendingUp, ArrowRight, ShieldCheck,
  Warehouse, Settings, X, Edit2, Camera, Sparkles, Barcode, Plus, Trash2, Box
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import SuperAdminConsole from '../components/SuperAdminConsole';
import { normalizeApiNumbers } from '../lib/normalizeApiNumbers';

type InventoryItem = {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  current: number;
  safe: number;
  unit: string;
  packageUnit?: string | null;
  packageSize?: number;
  diffText: string;
  cycle?: string;
};

type ZoneData = {
  id: string;
  name: string;
  state: string;
  stateLabel: string;
  emptyRatio: number;
  temp: string;
  items: string[];
  capacity?: number;
  capacityUnit?: string;
  currentStockSum?: number;
};

type MovementDay = {
  day: string;
  inbound: number;
  outbound: number;
  adjustments: number;
  movementCount: number;
};

type ForecastItem = {
  itemId: string;
  itemName: string;
  unit: string;
  historyDays: number;
  status: string;
  forecastOutflow7d: number | null;
  mapePct: number | null;
  accuracyPct: number | null;
  mapeSampleDays: number;
};

type ForecastData = {
  model: string;
  status: string;
  minimumHistoryDays: number;
  mapePct: number | null;
  accuracyPct: number | null;
  targetAccuracyPct: number;
  targetMet: boolean;
  stockoutRatePct: number | null;
  stockoutMetricReason: string;
  items: ForecastItem[];
};

function getOutboundTrend(rows: MovementDay[]) {
  const active = rows.filter((row) => row.movementCount > 0);
  if (active.length < 2) return '실제 변동 데이터가 2일 이상 쌓이면 출고 추세를 계산합니다.';
  const midpoint = Math.floor(active.length / 2);
  const average = (values: MovementDay[]) => values.reduce((sum, row) => sum + row.outbound, 0) / values.length;
  const firstHalf = average(active.slice(0, midpoint));
  const secondHalf = average(active.slice(midpoint));
  if (firstHalf === 0 && secondHalf === 0) return '선택 기간에 기록된 출고가 없습니다.';
  const change = firstHalf === 0 ? 100 : ((secondHalf - firstHalf) / firstHalf) * 100;
  if (Math.abs(change) < 5) return '최근 기록 기준 출고량이 대체로 비슷합니다.';
  return `최근 출고량이 이전 구간보다 ${Math.abs(Math.round(change))}% ${change > 0 ? '증가' : '감소'}했습니다. 과거 기록 요약이며 미래 예측은 아닙니다.`;
}

export default function InventoryDashboard() {
  const { user } = useAuth();
  
  // 역할 구분: wjmals는 서버 관리자(사장님/대표), 창고 관리자는 재고/구역 수기 관리자
  const isSuperAdmin = user?.role === '서버 관리자';
  const isWarehouseAdmin = user?.role === '관리자' || user?.role === '총괄';
  const canRegisterInventory = isWarehouseAdmin || user?.role === '창고지기';

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [movementDays, setMovementDays] = useState<MovementDay[]>([]);
  const [forecastData, setForecastData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);

  // 구역 설정 모달 상태
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [editingZone, setEditingZone] = useState<ZoneData | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [savingZone, setSavingZone] = useState(false);

  // 수기 재고 품목 추가 모달 상태
  const [showAddInvModal, setShowAddInvModal] = useState(false);
  const [newInvName, setNewInvName] = useState('');
  const [newInvBarcode, setNewInvBarcode] = useState('');
  const [newInvCurrent, setNewInvCurrent] = useState<number>(10000);
  const [newInvSafe, setNewInvSafe] = useState<number>(8000);
  const [newInvUnit, setNewInvUnit] = useState('톤');
  const [newInvPackageUnit, setNewInvPackageUnit] = useState('');
  const [newInvPackageSize, setNewInvPackageSize] = useState<number>(1);
  const [newInvCycle, setNewInvCycle] = useState('월간');
  const [savingInv, setSavingInv] = useState(false);

  // 수기 창고 구역 추가 모달 상태
  const [showAddZoneModal, setShowAddZoneModal] = useState(false);
  const [newZoneId, setNewZoneId] = useState('');
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneTemp, setNewZoneTemp] = useState('-20°C');
  const [newZoneCapacity, setNewZoneCapacity] = useState<number>(100000);
  const [newZoneCapacityUnit, setNewZoneCapacityUnit] = useState('톤');
  const [newZoneSelectedItems, setNewZoneSelectedItems] = useState<string[]>([]);
  const [creatingZone, setCreatingZone] = useState(false);

  // 재고 및 구역 데이터 불러오기
  const fetchData = useCallback(async () => {
    if (!user) return;
    const warehouseId = encodeURIComponent(user.warehouseId || 'wh_wjmals');
    try {
      const [invRes, zoneRes, movementRes, forecastRes] = await Promise.all([
        fetch(`/api/inventory?warehouseId=${warehouseId}`),
        fetch(`/api/zones?warehouseId=${warehouseId}`),
        fetch(`/api/inventory/movements?warehouseId=${warehouseId}&days=30`),
        fetch(`/api/inventory/forecast?warehouseId=${warehouseId}&historyDays=90`)
      ]);
      const invData = await invRes.json();
      const zoneData = await zoneRes.json();
      const movementData = await movementRes.json();
      const forecastResult = await forecastRes.json();

      if (Array.isArray(invData)) setItems(normalizeApiNumbers(invData));
      if (Array.isArray(zoneData)) setZones(normalizeApiNumbers(zoneData));
      if (Array.isArray(movementData)) setMovementDays(normalizeApiNumbers(movementData));
      if (forecastRes.ok && forecastResult && Array.isArray(forecastResult.items)) setForecastData(normalizeApiNumbers(forecastResult));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData();
      const timer = setInterval(fetchData, 15000);
      return () => clearInterval(timer);
    }
  }, [user, fetchData]);

  // 수요예측 필터 선택

  // 창고 관리자가 재고 품목 수기 신규 등록
  const handleAddInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvName.trim()) return;
    setSavingInv(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newInvName.trim(),
          barcode: newInvBarcode.trim() || undefined,
          current: Number(newInvCurrent),
          safe: Number(newInvSafe),
          unit: newInvUnit.trim(),
          packageUnit: newInvPackageUnit.trim() || undefined,
          packageSize: Number(newInvPackageSize),
          note: '초기 재고 등록',
          cycle: newInvCycle,
          warehouseId: user?.warehouseId,
        }),
      });
      if (res.ok) {
        setShowAddInvModal(false);
        setNewInvName('');
        setNewInvBarcode('');
        setNewInvCurrent(10000);
        setNewInvSafe(8000);
        setNewInvUnit('톤');
        setNewInvPackageUnit('');
        setNewInvPackageSize(1);
        await fetchData();
      } else {
        alert('재고 품목 추가 실패');
      }
    } catch (err) {
      alert('오류가 발생했습니다.');
    } finally {
      setSavingInv(false);
    }
  };

  // 재고 품목 삭제
  const handleDeleteInventory = async (id: string, name: string) => {
    if (!confirm(`'${name}' 재고 품목을 정말 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/inventory?id=${encodeURIComponent(id)}&warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchData();
      } else {
        alert('삭제 실패');
      }
    } catch (e) {
      alert('삭제 중 오류 발생');
    }
  };

  // 창고 구역 수기 신규 추가
  const handleAddZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneId.trim() || !newZoneName.trim()) return;
    setCreatingZone(true);
    try {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newZoneId.trim(),
          name: newZoneName.trim(),
          temp: newZoneTemp,
          capacity: Number(newZoneCapacity),
          capacityUnit: newZoneCapacityUnit.trim(),
          items: newZoneSelectedItems,
          warehouseId: user?.warehouseId,
        }),
      });
      if (res.ok) {
        setShowAddZoneModal(false);
        setNewZoneId('');
        setNewZoneName('');
        setNewZoneSelectedItems([]);
        await fetchData();
      } else {
        alert('구역 추가 실패');
      }
    } catch (e) {
      alert('오류 발생');
    } finally {
      setCreatingZone(false);
    }
  };

  // 창고 구역 삭제
  const handleDeleteZone = async (id: string, name: string) => {
    if (!confirm(`'${name}' 구역을 정말 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/zones?id=${encodeURIComponent(id)}&warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchData();
      } else {
        alert('삭제 실패');
      }
    } catch (e) {
      alert('삭제 중 오류 발생');
    }
  };

  // 비로그인 상태일 때: 시스템 소개 & 랜딩 쇼케이스 페이지 출력
  if (!user) {
    return (
      <div className="flex flex-col gap-12 font-sans pb-16 max-w-[1100px] mx-auto">
        {/* Hero Section */}
        <section className="text-center py-12 px-6 bg-gradient-to-b from-blue-50/80 via-white to-gray-50/50 dark:from-gray-900 dark:to-gray-950 rounded-3xl border border-blue-100/60 dark:border-gray-800 shadow-sm space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100/80 dark:bg-blue-900/50 text-primary font-bold text-xs">
            <Sparkles className="w-4 h-4 text-blue-500" />
            AI Native Smart Warehouse Management System
          </div>

          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-gray-900 dark:text-white leading-tight">
            차세대 스마트 물류 & 재고 관리 플랫폼
          </h1>

          <p className="text-base md:text-lg text-textMuted max-w-2xl mx-auto leading-relaxed">
            바코드 판독, 재고 입출고 장부, 실재고 기반 구역 점유율과 택배사 조회를 지원합니다. 미래 수요 예측은 제공하지 않습니다.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <a
              href="/login"
              className="px-8 py-4 bg-primary hover:bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/25 flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
            >
              로그인하고 접속하기
              <ArrowRight className="w-4 h-4" />
            </a>

            <a
              href="/signup"
              className="px-8 py-4 bg-white dark:bg-gray-800 hover:bg-gray-100 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-2xl font-bold text-sm transition-all cursor-pointer"
            >
              창고 관리자 / 창고지기 가입
            </a>
          </div>
        </section>

        {/* 4 Core Pillars Grid */}
        <section className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              스마트 WMS 4대 핵심 기능
            </h2>
            <p className="text-xs text-textMuted mt-1">현장 물류 효율성을 극대화하기 위한 지능형 핵심 모듈</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-primary flex items-center justify-center font-bold">
                <Barcode className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                1. 품목 검색 및 입출고 수량 조정
              </h3>
              <p className="text-xs text-textMuted leading-relaxed">
                ZXing 카메라 판독 또는 입력한 바코드/SKU·품목 ID·이름으로 재고를 찾아 입고와 출고를 기록합니다.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 flex items-center justify-center font-bold">
                <Camera className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                2. 이미지 레퍼런스 기반 비전 분석
              </h3>
              <p className="text-xs text-textMuted leading-relaxed">
                선택한 카메라 프레임을 Groq Vision에 보내 분석하고 결과를 이력으로 저장합니다. API 키가 필요하며 분석 결과가 검증된 실측값을 뜻하지는 않습니다.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center font-bold">
                <Warehouse className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                3. 창고 구역 및 용량 관리
              </h3>
              <p className="text-xs text-textMuted leading-relaxed">
                창고 구역의 이름, 보관 온도, 용량, 품목 메타데이터를 관리합니다. 재고로 자동 계산되는 공실률은 아직 제공하지 않습니다.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                4. 서버 관리자 & 창고 관리자 역할 분리
              </h3>
              <p className="text-xs text-textMuted leading-relaxed">
                서버 관리자는 신규 창고 관리자 가입을 총괄 승인하고, 창고 관리자는 본인 창고의 재고/구역을 수기로 관리합니다.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // 👑 서버 관리자(wjmals) 로그인 시: 전용 계정 승인 & 전체 창고 관제 센터만 전면 출력
  if (isSuperAdmin) {
    return <SuperAdminConsole />;
  }

  // 로그인 상태일 때: 현재 재고와 창고 현황 대시보드 출력
  const stockTotalsByUnit = Array.from(items.reduce((totals, item) => {
    const unit = item.unit || '단위 미지정';
    const current = totals.get(unit) || { current: 0, safe: 0 };
    current.current += item.current || 0;
    current.safe += item.safe || 0;
    totals.set(unit, current);
    return totals;
  }, new Map<string, { current: number; safe: number }>()).entries());
  const shortageItems = items.filter(i => i.status === 'shortage');
  const overstockItems = items.filter(i => i.status === 'overstock');
  const safeItems = items.filter(i => i.status === 'safe');

  // 구역 수정 모달 열기
  const handleOpenZoneEdit = (zone: ZoneData) => {
    setEditingZone(zone);
    setSelectedItems(zone.items || []);
    setShowZoneModal(true);
  };

  // 품목 선택 토글
  const toggleItemSelection = (itemName: string) => {
    setSelectedItems(prev =>
      prev.includes(itemName)
        ? prev.filter(i => i !== itemName)
        : [...prev, itemName]
    );
  };

  const toggleNewZoneItemSelection = (itemName: string) => {
    setNewZoneSelectedItems(prev =>
      prev.includes(itemName)
        ? prev.filter(i => i !== itemName)
        : [...prev, itemName]
    );
  };

  // 구역 설정 저장
  const handleSaveZone = async () => {
    if (!editingZone) return;
    setSavingZone(true);
    try {
      await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editingZone,
          items: selectedItems,
          warehouseId: user?.warehouseId,
        }),
      });
      setShowZoneModal(false);
      fetchData();
    } catch (e) {
      alert('구역 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingZone(false);
    }
  };

  return (
    <div className="flex flex-col gap-10 font-sans pb-16">
      
      {/* 👑 서버 관리자(wjmals) 전용 관제 콘솔 */}
      {isSuperAdmin && <SuperAdminConsole />}

      {/* 상단 헤더 */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 dark:border-gray-800 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-primary text-xs font-bold tracking-wider uppercase block">
              SMART WMS INVENTORY OPERATIONS
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
              isSuperAdmin
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
                : isWarehouseAdmin
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
            }`}>
              {user.role} 접속 중
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-textMain dark:text-white">
            스마트 재고 관리 대시보드
          </h1>
          <p className="text-sm text-textMuted mt-1">
            현재 재고 상태와 창고 구역 정보를 확인하고 운영 기록을 관리합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 창고 관리자(role === '관리자') 전용 수기 추가 버튼들 */}
          {canRegisterInventory && (
            <button
              onClick={() => setShowAddInvModal(true)}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all"
            >
              <Plus size={16} />
              재고 품목 수기 추가
            </button>
          )}

          {isWarehouseAdmin && (
            <>
              <button
                onClick={() => setShowAddZoneModal(true)}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all"
              >
                <Plus size={16} />
                창고 구역 수기 추가
              </button>
            </>
          )}

          <a
            href="/report"
            className="flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-semibold text-xs shadow-sm transition-all"
          >
            AI 리포트 상세 분석
            <ArrowRight size={15} />
          </a>
        </div>
      </header>

      {/* 핵심 지표 KPI 카드 (DB 실시간 연동) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">총 보관 재고량</span>
            <Warehouse size={18} className="text-primary" />
          </div>
          <h3 className="text-2xl font-bold text-textMain dark:text-white">
            {loading ? '—' : stockTotalsByUnit.length
              ? stockTotalsByUnit.map(([unit, totals]) => `${totals.current.toLocaleString()} ${unit}`).join(' · ')
              : '0'}
          </h3>
          <p className="text-xs text-textMuted mt-1">총 {items.length}개 보관 품목 운용 중</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">안전 재고 품목</span>
            <ShieldCheck size={18} className="text-green-500" />
          </div>
          <h3 className="text-2xl font-bold text-green-600">
            {loading ? '—' : `${safeItems.length} 개`}
          </h3>
          <p className="text-xs text-textMuted mt-1">정상 수급 유지 중</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">재고 부족 (긴급발주)</span>
            <AlertTriangle size={18} className="text-red-500" />
          </div>
          <h3 className="text-2xl font-bold text-red-600">
            {loading ? '—' : `${shortageItems.length} 개`}
          </h3>
          <p className="text-xs text-red-500 font-semibold mt-1">
            {shortageItems.length > 0 ? `${shortageItems.map(s => s.name).join(', ')} 등` : '부족 품목 없음'}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">재고 과다 (조기출하)</span>
            <Package size={18} className="text-amber-500" />
          </div>
          <h3 className="text-2xl font-bold text-amber-600">
            {loading ? '—' : `${overstockItems.length} 개`}
          </h3>
          <p className="text-xs text-textMuted mt-1">창고 점유율 초과 주의</p>
        </div>
      </section>

      {/* 보관 재고 품목 목록 & 수량 관리 테이블 */}
      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-lg font-bold text-textMain dark:text-white flex items-center gap-2">
              <Box className="w-5 h-5 text-emerald-600" />
              보관 재고 품목 상세 현황 ({items.length}개)
            </h2>
            <p className="text-xs text-textMuted mt-0.5">실재고 수치 및 창고 관리자 수기 데이터 편집</p>
          </div>

          {canRegisterInventory && (
            <button
              onClick={() => setShowAddInvModal(true)}
              className="px-3.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-emerald-100 transition-all"
            >
              <Plus size={14} />
              품목 수기 추가
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/40 rounded-xl space-y-2">
            <p className="text-xs text-textMuted">등록된 재고 품목이 없습니다. 창고 관리자 권한 계정으로 로그인 후 수기로 등록할 수 있습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-textMuted uppercase font-bold">
                  <th className="py-2.5 px-3">품목명</th>
                  <th className="py-2.5 px-3">현재 보관량</th>
                  <th className="py-2.5 px-3">안전 재고량</th>
                  <th className="py-2.5 px-3">상태</th>
                  <th className="py-2.5 px-3">보관 주기</th>
                  {isWarehouseAdmin && <th className="py-2.5 px-3 text-right">작업</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 font-semibold">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    <td className="py-3 px-3 font-bold text-gray-900 dark:text-white">
                      📦 {item.name}
                    </td>
                    <td className="py-3 px-3 font-mono text-primary font-bold">
                      {item.current.toLocaleString()} {item.unit}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-500">
                      {item.safe.toLocaleString()} {item.unit}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        item.status === 'safe'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : item.status === 'shortage'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                      }`}>
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-textMuted">{item.cycle || '월간'}</td>
                    {isWarehouseAdmin && (
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleDeleteInventory(item.id, item.name)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all"
                          title="품목 삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 창고 보관 구역 모니터링 섹션 (DB 연동 + 구역/품목 배치 설정) */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-textMain dark:text-white">
              창고 보관 구역 모니터링 및 품목 배치
            </h2>
            <p className="text-xs text-textMuted mt-0.5">각 창고 구역별 보관 품목 및 온도/공실률 실시간 상태</p>
          </div>

          {isWarehouseAdmin && (
            <button
              onClick={() => setShowAddZoneModal(true)}
              className="px-3.5 py-2 bg-purple-50 dark:bg-purple-950/40 text-purple-600 border border-purple-200 dark:border-purple-800 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-purple-100 transition-all shadow-sm"
            >
              <Plus size={14} />
              수기 구역 추가
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {zones.map((zone, idx) => {
            const isNormal = zone.state === 'normal';
            const isWarning = zone.state === 'warning';
            const isEmpty = zone.state === 'empty';
            const currentSum = zone.currentStockSum || 0;
            const capacity = zone.capacity || 100000;

            return (
              <motion.div 
                key={zone.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4 relative group"
              >
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold font-mono text-primary">{zone.id}</span>
                    <div className="flex items-center gap-1.5">
                      {isWarehouseAdmin && (
                        <>
                          <button
                            onClick={() => handleOpenZoneEdit(zone)}
                            className="p-1 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all"
                            title="구역 및 품목 배치 설정"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteZone(zone.id, zone.name)}
                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all"
                            title="구역 삭제"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                      <span className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        isNormal 
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                          : isWarning 
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' 
                          : isEmpty
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {isNormal ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                        {zone.stateLabel}
                      </span>
                    </div>
                  </div>

                  <h3 className="font-bold text-base text-textMain dark:text-white leading-snug">
                    {zone.name}
                  </h3>

                  {/* 보관 배치 품목 목록 */}
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {zone.items && zone.items.length > 0 ? (
                      zone.items.map(item => (
                        <span key={item} className="text-[11px] font-semibold bg-gray-100 dark:bg-gray-800 text-textMain dark:text-gray-200 px-2 py-0.5 rounded-md">
                          📦 {item}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-textMuted italic">미배치 (빈 구역)</span>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-textMuted">실보관 / 수용용량</span>
                    <strong className="text-textMain dark:text-white font-mono">
                      {currentSum.toLocaleString()} {zone.capacityUnit || '톤'} / {capacity.toLocaleString()} {zone.capacityUnit || '톤'}
                    </strong>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-textMuted">공실률 (빈 공간)</span>
                    <strong className="text-textMain dark:text-white font-mono">{(zone.emptyRatio * 100).toFixed(0)}%</strong>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        zone.emptyRatio > 0.8 ? 'bg-amber-500' : 'bg-primary'
                      }`} 
                      style={{ width: `${(1 - zone.emptyRatio) * 100}%` }} 
                    />
                  </div>
                  <div className="flex justify-between text-xs text-textMuted pt-1">
                    <span>구역 보관온도</span>
                    <strong className="text-primary font-mono">{zone.temp}</strong>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase mb-2">
          <TrendingUp size={16} />
          실제 재고 입출고 기록
        </div>
        <h2 className="text-xl font-bold text-textMain dark:text-white">최근 30일 입고·출고 추이</h2>
        <p className="text-sm text-textMuted mt-2">{getOutboundTrend(movementDays)} 미래 수요나 권장 발주량은 표시하지 않습니다.</p>
        {movementDays.some((row) => row.movementCount > 0) ? (
          <div className="h-[280px] w-full mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={movementDays}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="inbound" name="입고량" stroke="#059669" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="outbound" name="출고량" stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="adjustments" name="기타 조정" stroke="#64748b" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-5 text-sm text-textMuted">
            아직 입출고 변동 기록이 없습니다. 바코드 화면에서 첫 입고 또는 출고를 기록하면 실제 이력이 여기에 표시됩니다.
          </div>
        )}
      </section>

      <section className="border-y border-gray-200 dark:border-gray-800 py-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-primary">Demand baseline · not an AI forecast</p>
            <h2 className="text-xl font-bold text-textMain dark:text-white">7일 출고 기준선 · 28일 이동평균</h2>
            <p className="mt-1 text-xs text-textMuted">실제 outbound 장부만 사용합니다. 최근 7일 rolling backtest MAPE이며, 실제 품절률과 예측 성능 보증을 뜻하지 않습니다.</p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-xs font-bold ${forecastData?.status === 'measured' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {forecastData?.status === 'measured' ? '백테스트 가능' : '실측 데이터 부족'}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs text-textMuted">백테스트 MAPE / 정확도 기준</p>
            <p className="mt-2 text-lg font-bold">{forecastData?.mapePct == null ? '측정 불가' : `${forecastData.mapePct.toFixed(1)}% MAPE`}</p>
            <p className="text-xs text-textMuted">목표 정확도 {forecastData?.targetAccuracyPct ?? 92}% {forecastData?.status === 'measured' ? (forecastData.targetMet ? '달성' : '미달성') : '평가 대기'}</p>
          </div>
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs text-textMuted">품절률 KPI</p>
            <p className="mt-2 text-lg font-bold">산출 불가</p>
            <p className="text-xs text-textMuted">{forecastData?.stockoutMetricReason || '미충족 수요 기록이 없습니다.'}</p>
          </div>
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <p className="text-xs text-textMuted">품목별 7일 기준 출고량</p>
            {forecastData?.items.length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {forecastData.items.slice(0, 4).map((forecast) => <li key={forecast.itemId} className="flex justify-between gap-2"><span className="truncate">{forecast.itemName}</span><span className="shrink-0 font-mono">{forecast.forecastOutflow7d == null ? `기록 ${forecast.historyDays}일` : `${forecast.forecastOutflow7d.toLocaleString()} ${forecast.unit}`}</span></li>)}
              </ul>
            ) : <p className="mt-2 text-xs text-textMuted">활성 품목 또는 장부가 없습니다.</p>}
          </div>
        </div>
        <p className="text-[11px] text-textMuted">모델: {forecastData?.model || '28-day moving-average baseline'} · 품절률은 주문 미충족/품절 시도를 기록하지 않아 계산하지 않습니다. 데이터가 부족한 품목은 예측값을 표시하지 않습니다.</p>
      </section>

      {/* 1. 수기 재고 품목 추가 모달 (창고 관리자 전용) */}
      <AnimatePresence>
        {showAddInvModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                <h3 className="font-bold text-lg text-textMain dark:text-white flex items-center gap-2">
                  <Box className="w-5 h-5 text-emerald-600" />
                  재고 품목 수기 신규 등록
                </h3>
                <button onClick={() => setShowAddInvModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleAddInventory} className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-textMuted uppercase block mb-1">품목명 (예: 고등어, 삼치)</label>
                  <input
                    type="text"
                    required
                    placeholder="예: 갈치(국내산)"
                    value={newInvName}
                    onChange={e => setNewInvName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-textMuted uppercase block mb-1">바코드 / SKU</label>
                  <input
                    type="text"
                    value={newInvBarcode}
                    onChange={e => setNewInvBarcode(e.target.value)}
                    placeholder="라벨에 인쇄된 코드 (선택)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">현재 수량 ({newInvUnit})</label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.000001"
                      value={newInvCurrent}
                      onChange={e => setNewInvCurrent(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">안전 재고 수량 ({newInvUnit})</label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.000001"
                      value={newInvSafe}
                      onChange={e => setNewInvSafe(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="text-xs font-bold text-textMuted">기준 단위
                    <input required maxLength={16} value={newInvUnit} onChange={(event) => setNewInvUnit(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-textMain" />
                  </label>
                  <label className="text-xs font-bold text-textMuted">포장 단위
                    <input maxLength={16} placeholder="상자" value={newInvPackageUnit} onChange={(event) => setNewInvPackageUnit(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-textMain" />
                  </label>
                  <label className="text-xs font-bold text-textMuted">포장당 {newInvUnit}
                    <input type="number" required min="0.000001" step="0.000001" value={newInvPackageSize} onChange={(event) => setNewInvPackageSize(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-textMain" />
                  </label>
                </div>

                <div>
                  <label className="font-bold text-textMuted uppercase block mb-1">보관/출하 주기</label>
                  <select
                    value={newInvCycle}
                    onChange={e => setNewInvCycle(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="월간">월간 보관</option>
                    <option value="주간">주간 보관</option>
                    <option value="일간">일간 보관</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setShowAddInvModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={savingInv}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-all"
                  >
                    {savingInv ? '저장 중...' : '품목 등록'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. 수기 창고 구역 추가 모달 (창고 관리자 전용) */}
      <AnimatePresence>
        {showAddZoneModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-4"
            >
              <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                <h3 className="font-bold text-lg text-textMain dark:text-white flex items-center gap-2">
                  <Warehouse className="w-5 h-5 text-purple-600" />
                  창고 보관 구역 수기 신규 추가
                </h3>
                <button onClick={() => setShowAddZoneModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleAddZone} className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">구역 ID (예: zone_C1)</label>
                    <input
                      type="text"
                      required
                      placeholder="zone_C1"
                      value={newZoneId}
                      onChange={e => setNewZoneId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">구역 명칭</label>
                    <input
                      type="text"
                      required
                      placeholder="C-1 구역 (저온 보관실)"
                      value={newZoneName}
                      onChange={e => setNewZoneName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">보관 온도</label>
                    <input
                      type="text"
                      required
                      placeholder="-20°C"
                      value={newZoneTemp}
                      onChange={e => setNewZoneTemp(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">최대 수용 용량 ({newZoneCapacityUnit})</label>
                    <input
                      type="number"
                      required
                      min="1000"
                      step="0.000001"
                      value={newZoneCapacity}
                      onChange={e => setNewZoneCapacity(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">용량 단위</label>
                    <input required maxLength={16} value={newZoneCapacityUnit} onChange={(event) => setNewZoneCapacityUnit(event.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold" />
                  </div>
                </div>

                <div>
                  <label className="font-bold text-textMuted uppercase block mb-1">
                    이 구역에 배치할 품목 선택
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
                    {items.map(item => {
                      const isChecked = newZoneSelectedItems.includes(item.name);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleNewZoneItemSelection(item.name)}
                          className={`flex items-center gap-2 p-2 rounded-lg text-left text-xs font-semibold transition-all ${
                            isChecked
                              ? 'bg-purple-600 text-white shadow-sm'
                              : 'bg-white dark:bg-gray-700 text-textMain dark:text-gray-200 border border-gray-200 dark:border-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          <span>{isChecked ? '☑' : '☐'}</span>
                          <span className="truncate">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setShowAddZoneModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={creatingZone}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-all"
                  >
                    {creatingZone ? '생성 중...' : '구역 등록'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. 창고 구역 편집 모달 */}
      <AnimatePresence>
        {showZoneModal && editingZone && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-5"
            >
              <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-primary flex items-center justify-center font-bold">
                    <Settings size={18} />
                  </div>
                  <h3 className="font-bold text-lg text-textMain dark:text-white">
                    창고 구역 및 품목 배치 설정
                  </h3>
                </div>
                <button
                  onClick={() => setShowZoneModal(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-bold text-textMuted uppercase block mb-1">구역 명칭</label>
                  <input
                    type="text"
                    value={editingZone.name}
                    onChange={e => setEditingZone({ ...editingZone, name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">보관 온도</label>
                    <input
                      type="text"
                      value={editingZone.temp}
                      onChange={e => setEditingZone({ ...editingZone, temp: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">최대 수용 용량 ({editingZone.capacityUnit || '톤'})</label>
                    <input
                      type="number"
                      min="1000"
                      step="0.000001"
                      value={editingZone.capacity || 100000}
                      onChange={e => setEditingZone({ ...editingZone, capacity: Number(e.target.value) })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-textMuted uppercase block mb-1">용량 단위</label>
                    <input required maxLength={16} value={editingZone.capacityUnit || '톤'} onChange={(event) => setEditingZone({ ...editingZone, capacityUnit: event.target.value })} className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold" />
                  </div>
                </div>

                <div>
                  <label className="font-bold text-textMuted uppercase block mb-1">
                    이 구역에 보관 배치할 품목 선택 (멀티 선택 가능)
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
                    {items.map(item => {
                      const isChecked = selectedItems.includes(item.name);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleItemSelection(item.name)}
                          className={`flex items-center gap-2 p-2 rounded-lg text-left text-xs font-semibold transition-all ${
                            isChecked
                              ? 'bg-primary text-white shadow-sm'
                              : 'bg-white dark:bg-gray-700 text-textMain dark:text-gray-200 border border-gray-200 dark:border-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          <span>{isChecked ? '☑' : '☐'}</span>
                          <span className="truncate">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => setShowZoneModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveZone}
                  disabled={savingZone}
                  className="px-6 py-2.5 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-all"
                >
                  {savingZone ? '저장 중...' : '설정 저장'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
