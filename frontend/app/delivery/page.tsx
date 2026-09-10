"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Truck, Package, Search, Plus, Trash2, RefreshCw, CheckCircle2, 
  Clock, ArrowRight, MapPin, AlertCircle, Sparkles, ChevronRight, X, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type TrackingStep = {
  time: string;
  where: string;
  kind: string;
  tel?: string;
};

type DeliveryItem = {
  id: number;
  invoice_no: string;
  carrier_code: string;
  carrier_name: string;
  item_name: string;
  sender_name: string;
  receiver_name: string;
  status: string;
  status_code: 'PREPARING' | 'AT_PICKUP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  current_location: string;
  delivered_at: string | null;
  tracking_details: TrackingStep[] | string | null;
  created_at: string;
  updated_at: string;
  minutes_until_expiration: number | null;
};

const STEPS = [
  { key: 'AT_PICKUP', label: '상품인수' },
  { key: 'IN_TRANSIT', label: '허브이동' },
  { key: 'OUT_FOR_DELIVERY', label: '배달출발' },
  { key: 'DELIVERED', label: '배송완료' },
];

function getStepIndex(statusCode: string): number {
  switch (statusCode) {
    case 'PREPARING': return 0;
    case 'AT_PICKUP': return 1;
    case 'IN_TRANSIT': return 2;
    case 'OUT_FOR_DELIVERY': return 3;
    case 'DELIVERED': return 4;
    default: return 2;
  }
}

export default function DeliveryManagementPage() {
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('전체');

  // 등록 폼 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [invoiceInput, setInvoiceInput] = useState('');
  const [carrierInput, setCarrierInput] = useState('04');
  const [itemNameInput, setItemNameInput] = useState('');
  const [receiverInput, setReceiverInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 상세 모달
  const [selectedItem, setSelectedItem] = useState<DeliveryItem | null>(null);

  // 배송 목록 불러오기 (택배사 API 실시간 자동 동기화)
  const fetchDeliveries = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch('/api/delivery');
      const data = await res.json();
      setDeliveries(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeliveries();
    // 10초마다 백그라운드에서 실시간 택배사 API 자동 동기화
    const autoSyncTimer = setInterval(() => {
      fetchDeliveries(false);
    }, 10000);
    return () => clearInterval(autoSyncTimer);
  }, [fetchDeliveries]);

  const [detectedCarrier, setDetectedCarrier] = useState<{ code: string; name: string }>({ code: '04', name: 'CJ대한통운' });

  // 운송장 입력 시 택배사 실시간 100% 자동 감지
  const handleInvoiceChange = async (val: string) => {
    setInvoiceInput(val);
    const clean = val.replace(/[^0-9]/g, '');
    if (clean.length >= 8) {
      try {
        const res = await fetch(`/api/delivery?detect=${clean}`);
        if (res.ok) {
          const detected = await res.json();
          if (detected && detected.name) {
            setDetectedCarrier(detected);
            setCarrierInput(detected.code);
            return;
          }
        }
      } catch {}
    }

    // fallback 로컬 규칙
    if (clean.length === 13) setDetectedCarrier({ code: '01', name: '우체국택배' });
    else if (clean.length === 10) setDetectedCarrier({ code: '05', name: '한진택배' });
    else if (clean.length === 11) setDetectedCarrier({ code: '06', name: '로젠택배' });
    else if (clean.startsWith('2') || clean.startsWith('3')) setDetectedCarrier({ code: '08', name: '롯데택배' });
    else setDetectedCarrier({ code: '04', name: 'CJ대한통운' });
  };

  // 등록 (택배사 자동 판별 적용)
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceInput.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_no: invoiceInput.trim(),
          carrier_code: detectedCarrier.code,
          carrier_name: detectedCarrier.name,
          item_name: itemNameInput.trim() || '출고 물품',
          receiver_name: receiverInput.trim() || '고객님',
        }),
      });

      if (res.ok) {
        setInvoiceInput('');
        setItemNameInput('');
        setReceiverInput('');
        setShowAddModal(false);
        fetchDeliveries();
      }
    } catch (err) {
      alert('등록 중 오류 발생');
    } finally {
      setSubmitting(false);
    }
  };

  // 삭제
  const handleDelete = async (id: number, invoiceNo: string) => {
    if (!confirm(`운송장 [${invoiceNo}] 배송건을 목록에서 삭제하시겠습니까?`)) return;
    try {
      await fetch(`/api/delivery?id=${id}`, { method: 'DELETE' });
      fetchDeliveries();
    } catch (e) {
      alert('삭제 실패');
    }
  };

  const [sortOrder, setSortOrder] = useState<'stage' | 'newest'>('stage');

  // 필터링 및 첫 번째 진행상태부터 순서대로 정렬
  const filtered = deliveries
    .filter(item => {
      const matchesSearch = 
        item.invoice_no.includes(search) || 
        item.item_name.includes(search) || 
        item.carrier_name.includes(search) ||
        item.receiver_name.includes(search);

      if (!matchesSearch) return false;
      if (filterStatus === '전체') return true;
      if (filterStatus === '1. 상품인수') return item.status_code === 'AT_PICKUP' || item.status_code === 'PREPARING';
      if (filterStatus === '2. 허브이동') return item.status_code === 'IN_TRANSIT';
      if (filterStatus === '3. 배달출발') return item.status_code === 'OUT_FOR_DELIVERY';
      if (filterStatus === '4. 배송완료') return item.status_code === 'DELIVERED';
      return true;
    })
    .sort((a, b) => {
      if (sortOrder === 'stage') {
        // 첫 번째 진행상태부터 순서대로 (1.상품인수 -> 2.허브이동 -> 3.배달출발 -> 4.배송완료)
        const stepA = getStepIndex(a.status_code);
        const stepB = getStepIndex(b.status_code);
        if (stepA !== stepB) return stepA - stepB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
    });

  const totalCount = deliveries.length;
  const inTransitCount = deliveries.filter(d => d.status_code !== 'DELIVERED').length;
  const deliveredCount = deliveries.filter(d => d.status_code === 'DELIVERED').length;

  return (
    <div className="flex flex-col gap-8 font-sans pb-16">
      
      {/* 헤더 & 통계 배너 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-primary font-bold text-xs tracking-wider uppercase mb-1">
            <Truck size={16} />
            DELIVERY TRACKING & WMS LOGISTICS
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-textMain dark:text-white">
            실시간 배송 관리 및 운송장 추적
          </h1>
          <p className="text-sm text-textMuted mt-1">
            스마트택배 API 연동 기반 실시간 운송장 추적 • 배송 완료건은 24시간 후 자동 정리됩니다.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-bold text-green-700 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3.5 py-2 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            택배사 API 자동 동기화 활성 (실시간 단계 자동 갱신)
          </div>

          <button
            onClick={() => fetchDeliveries()}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 text-textMain dark:text-gray-200 px-4 py-2.5 rounded-xl shadow-sm text-sm font-medium transition-all"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            즉시 조회
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl shadow-sm text-sm font-semibold transition-all"
          >
            <Plus size={16} />
            운송장 등록
          </button>
        </div>
      </div>

      {/* KPI 통계 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-textMuted uppercase">전체 배송 추적</p>
            <h3 className="text-2xl font-bold text-textMain dark:text-white mt-1">{totalCount}건</h3>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-primary">
            <Package size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-textMuted uppercase">실시간 이동/배송중</p>
            <h3 className="text-2xl font-bold text-blue-600 mt-1">{inTransitCount}건</h3>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
            <Truck size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-textMuted uppercase">배송 완료 (보관중)</p>
            <h3 className="text-2xl font-bold text-green-600 mt-1">{deliveredCount}건</h3>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center text-green-600">
            <CheckCircle2 size={24} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-textMuted uppercase">배송완료 자동삭제 정책</p>
            <h3 className="text-sm font-bold text-orange-600 mt-1">완료 후 24시간</h3>
            <span className="text-[11px] text-textMuted">자동 만료 및 DB 정리</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center text-orange-500">
            <Clock size={24} />
          </div>
        </div>
      </div>

      {/* 필터 & 정렬 & 검색 바 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-4">
        {/* 진행 단계 순서대로 정렬된 필터 탭 */}
        <div className="flex gap-2 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
          {[
            { label: '전체', count: totalCount },
            { label: '1. 상품인수', count: deliveries.filter(d => d.status_code === 'AT_PICKUP' || d.status_code === 'PREPARING').length },
            { label: '2. 허브이동', count: deliveries.filter(d => d.status_code === 'IN_TRANSIT').length },
            { label: '3. 배달출발', count: deliveries.filter(d => d.status_code === 'OUT_FOR_DELIVERY').length },
            { label: '4. 배송완료', count: deliveredCount },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => setFilterStatus(item.label)}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                filterStatus === item.label
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-textMuted hover:bg-gray-200'
              }`}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto">
          {/* 정렬 순서 선택 토글 */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl text-xs font-semibold shrink-0">
            <button
              onClick={() => setSortOrder('stage')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                sortOrder === 'stage'
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm font-bold'
                  : 'text-textMuted hover:text-textMain'
              }`}
              title="첫 번째 단계(상품인수)부터 순서대로 정렬"
            >
              진행단계 순
            </button>
            <button
              onClick={() => setSortOrder('newest')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                sortOrder === 'newest'
                  ? 'bg-white dark:bg-gray-700 text-primary shadow-sm font-bold'
                  : 'text-textMuted hover:text-textMain'
              }`}
            >
              최신순
            </button>
          </div>

          {/* 검색창 */}
          <div className="relative flex-1 lg:w-64">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="운송장, 품목, 수령인..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </div>

      {/* 배송 목록 카드 리스트 */}
      <div className="flex flex-col gap-4">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-textMuted gap-2">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <p className="text-sm">배송 현황을 조회하는 중입니다...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center text-textMuted gap-3">
            <Truck size={48} className="text-gray-300 dark:text-gray-700" />
            <p className="text-base font-medium">등록된 배송 정보가 없습니다.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-blue-600 transition-colors"
            >
              신규 운송장 등록하기
            </button>
          </div>
        ) : (
          filtered.map((item) => {
            const currentStep = getStepIndex(item.status_code);
            const isDelivered = item.status_code === 'DELIVERED';
            const remainingHours = item.minutes_until_expiration 
              ? Math.max(0, Math.floor(item.minutes_until_expiration / 60)) 
              : null;
            const remainingMinutes = item.minutes_until_expiration 
              ? Math.max(0, item.minutes_until_expiration % 60) 
              : null;

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col gap-5"
              >
                {/* 상단 메타 바 */}
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 border-b border-gray-100 dark:border-gray-800 pb-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-900/30 text-primary border border-blue-100 dark:border-blue-800">
                      {item.carrier_name}
                    </span>
                    <span className="font-mono text-sm font-semibold text-textMain dark:text-white">
                      운송장: {item.invoice_no}
                    </span>
                    <span className="text-xs text-textMuted">
                      수령인: <strong className="text-textMain dark:text-gray-200">{item.receiver_name}</strong>
                    </span>
                    <span className="text-xs text-textMuted">
                      발송처: {item.sender_name}
                    </span>
                  </div>

                  {/* 배송완료 24시간 자동 정리 알림 뱃지 */}
                  {isDelivered && (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-xl text-xs font-semibold">
                      <Clock size={14} className="animate-pulse" />
                      <span>
                        배송완료 후 자동 정리까지{' '}
                        {remainingHours !== null ? `${remainingHours}시간 ${remainingMinutes}분 남음` : '대기중'}
                      </span>
                    </div>
                  )}
                </div>

                {/* 본문: 상품정보 & 진행상황 */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                  <div className="lg:col-span-4 min-w-0">
                    <h3 className="text-lg font-bold text-textMain dark:text-white truncate">
                      {item.item_name}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-textMuted mt-1">
                      <MapPin size={14} className="text-primary shrink-0" />
                      <span className="truncate">현재 위치: <strong className="text-textMain dark:text-gray-200">{item.current_location}</strong></span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      최근 업데이트: {new Date(item.updated_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  {/* 4단계 프로그레스 바 */}
                  <div className="lg:col-span-8 flex flex-col gap-2">
                    <div className="grid grid-cols-4 gap-2 text-center text-xs font-semibold">
                      {STEPS.map((s, idx) => {
                        const stepNum = idx + 1;
                        const isDone = currentStep >= stepNum;
                        const isCurrent = currentStep === stepNum;
                        return (
                          <div 
                            key={s.key} 
                            className={`flex flex-col items-center gap-1 ${
                              isCurrent 
                                ? 'text-primary font-bold' 
                                : isDone 
                                ? 'text-gray-700 dark:text-gray-300' 
                                : 'text-gray-300 dark:text-gray-700'
                            }`}
                          >
                            <div className="relative flex items-center justify-center">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                                isCurrent 
                                  ? 'bg-primary text-white ring-4 ring-blue-100 dark:ring-blue-900/40 shadow-sm' 
                                  : isDone 
                                  ? 'bg-green-500 text-white' 
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                              }`}>
                                {isDone && !isCurrent ? <CheckCircle2 size={16} /> : stepNum}
                              </div>
                            </div>
                            <span className="text-[11px] whitespace-nowrap">{s.label}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* 프로그레스 바 라인 */}
                    <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden mt-1">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-500 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(10, (currentStep / 4) * 100))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* 하단 액션 버튼 */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      isDelivered 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                      ● {item.status}
                    </span>
                    <span className="text-xs text-textMuted hidden sm:inline">
                      등록일시: {new Date(item.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedItem(item)}
                      className="px-3.5 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 border border-gray-200 dark:border-gray-700 text-textMain dark:text-gray-200 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1"
                    >
                      상세 타임라인
                      <ChevronRight size={14} />
                    </button>

                    <button
                      onClick={() => handleDelete(item.id, item.invoice_no)}
                      className="p-1.5 text-textMuted hover:text-red-500 hover:bg-red-50 rounded-xl text-xs transition-colors"
                      title="배송건 삭제"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* 신규 운송장 등록 모달 */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800"
            >
              <div className="flex justify-between items-center pb-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-primary flex items-center justify-center">
                    <Truck size={18} />
                  </div>
                  <h3 className="text-lg font-bold text-textMain dark:text-white">신규 운송장 배송 등록</h3>
                </div>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleAddSubmit} className="flex flex-col gap-4 mt-5">
                <div>
                  <label className="text-xs font-bold text-textMuted uppercase mb-1.5 block">
                    운송장 번호 * (숫자만 입력)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="예: 658291048210 (CJ대한통운), 120485930219 (롯데)"
                    value={invoiceInput}
                    onChange={(e) => handleInvoiceChange(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  
                  {/* 실시간 택배사 자동 감지 결과 뱃지 */}
                  <div className="mt-2 flex items-center justify-between p-3 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-textMuted">택배사 자동 판별:</span>
                      <strong className="text-sm font-bold text-primary">{detectedCarrier.name}</strong>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-md font-semibold">
                      스마트 자동 감지
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-textMuted uppercase mb-1.5 block">
                      수령인 (고객명)
                    </label>
                    <input
                      type="text"
                      placeholder="예: 홍길동 고객님"
                      value={receiverInput}
                      onChange={(e) => setReceiverInput(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-textMuted uppercase mb-1.5 block">
                    상품명 (품목)
                  </label>
                  <input
                    type="text"
                    placeholder="예: 영광 굴비 세트 10미, 완도 전복 1kg"
                    value={itemNameInput}
                    onChange={(e) => setItemNameInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl flex items-start gap-2.5 text-xs text-blue-800 dark:text-blue-300 mt-1">
                  <Info size={16} className="shrink-0 mt-0.5" />
                  <span>
                    등록 즉시 스마트 배송 추적 API 조회가 수행되며, <strong>배송완료</strong> 시점부터 <strong>1일(24시간) 후 자동으로 데이터가 정리</strong>됩니다.
                  </span>
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t border-gray-100 dark:border-gray-800 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50"
                  >
                    {submitting ? '조회 및 등록 중...' : '운송장 등록'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 상세 타임라인 모달 */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-between items-center pb-4 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <span className="text-xs font-bold text-primary">{selectedItem.carrier_name}</span>
                  <h3 className="text-lg font-bold text-textMain dark:text-white">
                    운송장: {selectedItem.invoice_no}
                  </h3>
                  <p className="text-xs text-textMuted">{selectedItem.item_name} • 수령인: {selectedItem.receiver_name}</p>
                </div>
                <button 
                  onClick={() => setSelectedItem(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-5 pr-1 space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                  <span className="text-xs text-textMuted font-semibold">현재 진행 상태</span>
                  <span className="text-sm font-bold text-primary">{selectedItem.status}</span>
                </div>

                <div className="space-y-4 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200 dark:before:bg-gray-700">
                  {(() => {
                    let steps: TrackingStep[] = [];
                    if (typeof selectedItem.tracking_details === 'string') {
                      try { steps = JSON.parse(selectedItem.tracking_details); } catch {}
                    } else if (Array.isArray(selectedItem.tracking_details)) {
                      steps = selectedItem.tracking_details;
                    }
                    if (steps.length === 0) {
                      return <p className="text-xs text-textMuted pl-8">등록된 상세 이력이 없습니다.</p>;
                    }
                    return steps.map((s, idx) => (
                      <div key={idx} className="relative flex items-start gap-4 pl-8">
                        <div className={`absolute left-1.5 top-1.5 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 flex items-center justify-center text-[9px] font-bold text-white ${
                          idx === steps.length - 1 ? 'bg-primary ring-4 ring-blue-100' : 'bg-gray-400 dark:bg-gray-600'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0 bg-gray-50/50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="text-[10px] font-bold text-primary uppercase">
                              STEP 0{idx + 1} • {s.kind}
                            </span>
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">{s.time}</span>
                          </div>
                          <p className="text-xs text-textMuted mt-1">{s.where} {s.tel && `(${s.tel})`}</p>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                <button
                  onClick={() => setSelectedItem(null)}
                  className="px-5 py-2 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition-colors"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
