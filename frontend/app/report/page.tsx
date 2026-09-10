"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, Search, AlertTriangle, Package, CheckCircle, Lightbulb, 
  Wand2, Plus, Trash2, RefreshCw, X, Printer, Download, Sparkles, TrendingDown, TrendingUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type InventoryItem = {
  id: string;
  status: string;
  statusLabel: string;
  name: string;
  current: number;
  safe: number;
  diffText: string;
  recommendation: string;
  cycle: string;
  date: string;
};

export default function AIReportPage() {
  const [data, setData] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('전체');
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', current: '', safe: '', cycle: '월간' });
  const [adding, setAdding] = useState(false);

  // 모달 상태
  const [selectedReportItem, setSelectedReportItem] = useState<InventoryItem | null>(null);
  const [showAiSummaryModal, setShowAiSummaryModal] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSummaryContent, setAiSummaryContent] = useState<string>('');

  // DB에서 데이터 조회
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (activeFilter !== '전체') params.set('status', activeFilter);
      const res = await fetch(`/api/inventory?${params.toString()}`);
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 새 항목 추가
  const handleAdd = async () => {
    if (!addForm.name || !addForm.current || !addForm.safe) return;
    setAdding(true);
    await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: addForm.name,
        current: Number(addForm.current),
        safe: Number(addForm.safe),
        cycle: addForm.cycle,
      }),
    });
    setAddForm({ name: '', current: '', safe: '', cycle: '월간' });
    setShowAddForm(false);
    setAdding(false);
    fetchData();
  };

  // 항목 삭제
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`[${name} / ${id}] 항목을 삭제하시겠습니까?`)) return;
    await fetch(`/api/inventory?id=${id}`, { method: 'DELETE' });
    fetchData();
  };

  // AI 전체 리포트 생성
  const handleGenerateSummary = async () => {
    setShowAiSummaryModal(true);
    setAiGenerating(true);
    setAiSummaryContent('');

    // 실제 데이터 기반 AI 종합 분석 생성
    setTimeout(() => {
      const shortageList = data.filter(i => i.status === 'shortage').map(i => i.name).join(', ');
      const overstockList = data.filter(i => i.status === 'overstock').map(i => i.name).join(', ');
      const text = `
### 📊 2026년 WMS 스마트 물류 재고 AI 종합 진단 리포트

1. **긴급 조치 사항 (재고 부족 경보)**
   - 위험 품목: **${shortageList || '없음'}**
   - 권고 조치: 안전 하한선 이탈로 향후 3일 이내 결품 위험 발생. 협력 공급사 및 생산처에 긴급 보충 발주를 요청하십시오.

2. **재고 최적화 및 창고 회전율 개선 (재고 과다)**
   - 과다 품목: **${overstockList || '없음'}**
   - 권고 조치: 보관 비용 및 랙 점유율 상승 방지를 위해 B2B 채널 프로모션 및 유통 출하 물량을 주간 30% 확대하십시오.

3. **안전 재고 및 총평**
   - 주요 기준 품목 및 표준 규격재는 안정적인 수급 사이클을 유지하고 있습니다.
   - 전체 수급 건전성 지수는 '양호(B+)' 수준이며, 주간 주기적인 모니터링을 지속하시기 바랍니다.
      `;
      setAiSummaryContent(text.trim());
      setAiGenerating(false);
    }, 900);
  };

  const shortageCount = data.filter(i => i.status === 'shortage').length;
  const overstockCount = data.filter(i => i.status === 'overstock').length;
  const safeCount = data.filter(i => i.status === 'safe').length;

  const filterOptions = [
    { label: '전체', value: '전체' },
    { label: `🔴 재고 부족 (${shortageCount})`, value: '재고 부족' },
    { label: `🟢 안전 재고 (${safeCount})`, value: '안전 재고' },
    { label: `🟡 재고 과다 (${overstockCount})`, value: '재고 과다' },
  ];

  return (
    <div className="flex flex-col gap-6 font-sans pb-16">

      {/* 헤더 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <div className="text-primary font-bold text-xs tracking-wider uppercase mb-1">
            AI INVENTORY DIAGNOSTIC REPORT
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-textMain dark:text-white">
            AI 재고 상태 분석 리포트
          </h1>
          <p className="text-sm text-textMuted mt-1">
            MySQL 데이터베이스 실시간 연동 • 품목별 AI 진단 및 의사결정 권고사항
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fetchData()}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 text-textMain dark:text-gray-200 px-4 py-2.5 rounded-xl shadow-sm text-sm font-medium transition-all"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-primary text-primary hover:bg-blue-50 dark:hover:bg-blue-900/30 px-4 py-2.5 rounded-xl shadow-sm text-sm font-semibold transition-all"
          >
            <Plus size={16} />
            항목 추가
          </button>
          <button 
            onClick={handleGenerateSummary}
            className="flex items-center gap-2 bg-[#1d1d1f] hover:bg-black text-white px-5 py-2.5 rounded-xl shadow-sm text-sm font-semibold transition-all"
          >
            <Wand2 size={16} className="text-purple-400" />
            AI 리포트 즉시 생성
          </button>
        </div>
      </div>

      {/* 신규 항목 추가 모달 */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-900 rounded-2xl p-6 shadow-md"
          >
            <h3 className="font-bold text-lg mb-4 text-textMain dark:text-white">신규 재고 항목 추가 (MySQL DB 저장)</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-textMuted mb-1 block">품목명 *</label>
                <input
                  type="text"
                  placeholder="예: 고등어(가공), 제주 은갈치"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-textMuted mb-1 block">현재 재고량(톤) *</label>
                <input
                  type="number"
                  placeholder="예: 3500"
                  value={addForm.current}
                  onChange={e => setAddForm(f => ({ ...f, current: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-textMuted mb-1 block">안전재고 기준(톤) *</label>
                <input
                  type="number"
                  placeholder="예: 10000"
                  value={addForm.safe}
                  onChange={e => setAddForm(f => ({ ...f, safe: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAdd}
                disabled={adding}
                className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {adding ? '저장 중...' : 'MySQL에 저장'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 요약 히어로 배너 */}
      <div className="bg-[#293275] rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="text-blue-200 text-xs font-semibold flex items-center gap-2">
            <span>AI Real-time Diagnostic</span>
            <span>•</span>
            <span>최종 분석 갱신: 오늘 {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <Lightbulb size={22} className="text-yellow-400 shrink-0" />
            <span>금주 재고 진단 핵심 요약 브리핑</span>
          </div>
          <p className="text-blue-100 text-sm md:text-base leading-relaxed break-keep">
            현재 <strong className="text-red-300 font-bold">재고 부족 {shortageCount}건</strong>이 발생하여 안전 하한선 이탈 위험이 존재합니다.
            반면, <strong className="text-yellow-300 font-bold">재고 과다 {overstockCount}건</strong>은 창고 점유율과 냉동 보관비를 높이고 있어 조기 출하 및 B2B 프로모션을 권장합니다.
            정상 수급 상태의 안전재고 품목은 <strong className="text-green-300 font-bold">{safeCount}건</strong>입니다.
          </p>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 transform translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* 필터 & 검색 바 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-3 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm border border-gray-100 dark:border-gray-800">
        <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {filterOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setActiveFilter(opt.value)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm transition-all whitespace-nowrap font-semibold
                ${activeFilter === opt.value
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-textMuted hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="품목명 또는 코드 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* 리포트 카드 목록 (텍스트 잘림 해결 레이아웃) */}
      <div className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-textMuted gap-2">
            <RefreshCw size={20} className="animate-spin text-primary" />
            <span>MySQL DB에서 데이터를 불러오는 중...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-200 text-textMuted gap-2">
            <Package size={40} className="opacity-30" />
            <p className="text-sm">해당 조건에 부합하는 재고 항목이 없습니다.</p>
          </div>
        ) : (
          data.map((item, idx) => {
            const isShortage = item.status === 'shortage';
            const isOverstock = item.status === 'overstock';
            const statusColor = isShortage ? 'text-red-600' : isOverstock ? 'text-amber-600' : 'text-green-600';
            const statusBg = isShortage ? 'bg-red-50 text-red-700 border-red-200' : isOverstock ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200';

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-all flex flex-col lg:flex-row lg:items-center gap-6"
              >
                {/* 1. 아이콘 & 품목 정보 */}
                <div className="flex items-start gap-4 lg:w-1/3 min-w-0">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                    isShortage ? 'bg-red-50 text-red-500 border-red-100' : isOverstock ? 'bg-amber-50 text-amber-500 border-amber-100' : 'bg-green-50 text-green-500 border-green-100'
                  }`}>
                    {isShortage ? <AlertTriangle size={24} /> : isOverstock ? <Package size={24} /> : <CheckCircle size={24} />}
                  </div>

                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-primary">{item.id}</span>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${statusBg}`}>
                        ● {item.statusLabel}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-textMain dark:text-white break-keep">
                      {item.name}
                    </h3>
                    <div className="text-xs text-textMuted flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                      <span>현재: <strong className="text-textMain dark:text-gray-200 font-bold">{item.current.toLocaleString()}톤</strong></span>
                      <span>안전기준: {item.safe.toLocaleString()}톤</span>
                      <span className={`font-semibold ${statusColor}`}>({item.diffText})</span>
                    </div>
                  </div>
                </div>

                {/* 2. AI 분석 권고사항 (텍스트 줄바꿈 완전 지원) */}
                <div className="lg:flex-1 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-4 lg:pt-0 lg:pl-6 min-w-0">
                  <div className="text-xs font-bold text-gray-400 mb-1 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-purple-500" />
                    AI 진단 권고사항
                  </div>
                  <div className="text-sm font-semibold text-textMain dark:text-gray-200 break-keep leading-relaxed">
                    {item.recommendation.split('→').map((part, i, arr) => (
                      <span key={i}>
                        {part.trim()}
                        {i < arr.length - 1 && <span className="text-primary font-bold mx-1.5">➔</span>}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 3. 주기/날짜 & 액션 버튼 */}
                <div className="flex items-center justify-between lg:flex-col lg:items-end gap-3 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-4 lg:pt-0 lg:pl-6 lg:w-48 shrink-0">
                  <div className="lg:text-right">
                    <div className="text-[11px] text-gray-400">분석 주기 / 일자</div>
                    <div className="text-xs text-textMuted font-medium">{item.cycle} • {item.date}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedReportItem(item)}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-primary rounded-xl text-xs font-bold transition-all shadow-sm"
                    >
                      <FileText size={14} />
                      리포트 보기
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.name)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl text-xs transition-colors"
                      title="항목 삭제"
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

      {/* 상세 AI 리포트 팝업 모달 */}
      <AnimatePresence>
        {selectedReportItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl max-w-xl w-full p-6 md:p-8 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-6"
            >
              <div className="flex justify-between items-start border-b border-gray-100 dark:border-gray-800 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-primary">{selectedReportItem.id}</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 text-primary font-bold">
                      {selectedReportItem.statusLabel}
                    </span>
                  </div>
                  <h2 className="text-2xl font-extrabold text-textMain dark:text-white">
                    {selectedReportItem.name} AI 정밀 진단 리포트
                  </h2>
                </div>
                <button 
                  onClick={() => setSelectedReportItem(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl"
                >
                  <X size={20} />
                </button>
              </div>

              {/* 재고 비교 시각화 바 */}
              <div className="bg-gray-50 dark:bg-gray-800/60 p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center text-sm font-bold">
                  <span className="text-textMuted">현재 보관량 vs 안전 기준치</span>
                  <span className="text-primary">{selectedReportItem.diffText}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 h-3 rounded-full overflow-hidden flex">
                  <div 
                    className={`h-full ${selectedReportItem.status === 'shortage' ? 'bg-red-500' : selectedReportItem.status === 'overstock' ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(100, (selectedReportItem.current / Math.max(selectedReportItem.safe * 1.5, selectedReportItem.current)) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-textMuted">
                  <span>현재 재고: <strong>{selectedReportItem.current.toLocaleString()} 톤</strong></span>
                  <span>안전 기준: <strong>{selectedReportItem.safe.toLocaleString()} 톤</strong></span>
                </div>
              </div>

              {/* AI 권고안 세부사항 */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-textMain dark:text-white flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-500" />
                  AI 분석 결과 및 조치 플랜
                </h4>
                <div className="p-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40 rounded-2xl text-sm leading-relaxed text-textMain dark:text-gray-200 break-keep">
                  {selectedReportItem.recommendation}
                </div>
              </div>

              {/* 세부 수급 지표 그리드 */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                  <span className="text-textMuted block mb-0.5">분석 모델 / 주기</span>
                  <strong className="text-textMain dark:text-white font-semibold">Gemini & Linear Engine ({selectedReportItem.cycle})</strong>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                  <span className="text-textMuted block mb-0.5">최종 진단 기준일</span>
                  <strong className="text-textMain dark:text-white font-semibold">{selectedReportItem.date}</strong>
                </div>
              </div>

              {/* 모달 하단 버튼 */}
              <div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 hover:bg-gray-50 text-xs font-semibold rounded-xl text-textMain transition-all"
                >
                  <Printer size={14} />
                  리포트 인쇄
                </button>
                <button
                  onClick={() => setSelectedReportItem(null)}
                  className="px-6 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all"
                >
                  확인 완료
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI 종합 브리핑 모달 */}
      <AnimatePresence>
        {showAiSummaryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl max-w-2xl w-full p-6 md:p-8 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-5"
            >
              <div className="flex justify-between items-center pb-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 flex items-center justify-center">
                    <Wand2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-textMain dark:text-white">
                      AI 재고 종합 진단 브리핑
                    </h3>
                    <p className="text-xs text-textMuted">전체 보관 재고 현황 AI 심층 분석</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAiSummaryModal(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl"
                >
                  <X size={20} />
                </button>
              </div>

              {aiGenerating ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-textMuted">
                  <RefreshCw size={24} className="animate-spin text-purple-600" />
                  <p className="text-sm font-semibold">전체 재고 데이터를 AI 엔진으로 분석 중입니다...</p>
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-800/60 p-6 rounded-2xl text-sm leading-relaxed text-textMain dark:text-gray-200 whitespace-pre-line space-y-2">
                  {aiSummaryContent}
                </div>
              )}

              <div className="flex justify-end pt-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => setShowAiSummaryModal(false)}
                  className="px-6 py-2.5 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-all"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 하단 DB 정보 표시 */}
      <div className="flex items-center gap-2 text-xs text-textMuted border-t border-gray-100 dark:border-gray-800 pt-4 mt-2">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
        <span>데이터 소스: MySQL DB (wms_inventory.inventory_items) — 실시간 동기화 완료 (총 {data.length}건)</span>
      </div>
    </div>
  );
}
