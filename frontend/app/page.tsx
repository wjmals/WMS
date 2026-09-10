"use client";

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, CheckCircle, Package, TrendingUp, ArrowRight, ShieldCheck, Warehouse } from 'lucide-react';
import Link from 'next/link';

type InventoryItem = {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  current: number;
  safe: number;
  diffText: string;
};

// 모니터링 구역 데이터 (범용 물류 창고)
const zoneData = [
  { id: 'zone_A1', name: 'A-1 구역 (메인 보관 1창고)', state: 'normal', stateLabel: '정상', emptyRatio: 0.15, temp: '-22°C' },
  { id: 'zone_A2', name: 'A-2 구역 (고밀도 랙 보관소)', state: 'warning', stateLabel: '점검필요', emptyRatio: 0.78, temp: '-20°C' },
  { id: 'zone_B1', name: 'B-1 구역 (항온/항습 보관실)', state: 'normal', stateLabel: '정상', emptyRatio: 0.25, temp: '3°C' },
  { id: 'zone_B2', name: 'B-2 구역 (특수 보관/급속동결실)', state: 'empty', stateLabel: '재고부족', emptyRatio: 0.88, temp: '-25°C' }
];

// 30일 소비 및 수요예측 데이터
const demandForecastData = Array.from({ length: 30 }).map((_, i) => ({
  day: `D-${30 - i}`,
  consumed: Math.floor(120 + Math.sin(i / 3) * 35 + i * 2.5),
  forecast: Math.floor(125 + Math.sin(i / 3) * 30 + i * 2.8),
}));

export default function InventoryDashboard() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/inventory')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setItems(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const totalCurrent = items.reduce((acc, i) => acc + (i.current || 0), 0);
  const shortageItems = items.filter(i => i.status === 'shortage');
  const overstockItems = items.filter(i => i.status === 'overstock');
  const safeItems = items.filter(i => i.status === 'safe');

  return (
    <div className="flex flex-col gap-10 font-sans pb-16">
      
      {/* 상단 헤더 */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 dark:border-gray-800 pb-6">
        <div>
          <span className="text-primary text-xs font-bold tracking-wider uppercase mb-1 block">
            SMART WMS INVENTORY & DEMAND AI
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-textMain dark:text-white">
            스마트 재고 관리 대시보드
          </h1>
          <p className="text-base text-textMuted mt-1">
            실시간 AI 재고 진단, 창고 구역 모니터링 및 시계열 수요 예측 분석
          </p>
        </div>

        <Link
          href="/report"
          className="flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm shadow-sm transition-all"
        >
          AI 리포트 상세 분석
          <ArrowRight size={16} />
        </Link>
      </header>

      {/* 핵심 지표 KPI 카드 (MySQL DB 연동) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">총 보관 재고량</span>
            <Warehouse size={18} className="text-primary" />
          </div>
          <h3 className="text-3xl font-black text-textMain dark:text-white">
            {loading ? '—' : `${totalCurrent.toLocaleString()} 톤`}
          </h3>
          <p className="text-xs text-textMuted mt-1">총 {items.length}개 보관 품목 운용 중</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">안전 재고 품목</span>
            <ShieldCheck size={18} className="text-green-500" />
          </div>
          <h3 className="text-3xl font-black text-green-600">
            {loading ? '—' : `${safeItems.length} 개`}
          </h3>
          <p className="text-xs text-textMuted mt-1">정상 수급 유지 중</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-center text-textMuted mb-2">
            <span className="text-xs font-bold uppercase">재고 부족 (긴급발주)</span>
            <AlertTriangle size={18} className="text-red-500" />
          </div>
          <h3 className="text-3xl font-black text-red-600">
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
          <h3 className="text-3xl font-black text-amber-600">
            {loading ? '—' : `${overstockItems.length} 개`}
          </h3>
          <p className="text-xs text-textMuted mt-1">창고 점유율 초과 주의</p>
        </div>
      </section>

      {/* 창고 구역별 모니터링 섹션 */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-textMain dark:text-white">
            창고 보관 구역 모니터링
          </h2>
          <span className="text-xs text-textMuted">센서 및 모니터링 연동 상태</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {zoneData.map((zone, idx) => {
            const isNormal = zone.state === 'normal';
            const isWarning = zone.state === 'warning';
            return (
              <motion.div 
                key={zone.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold font-mono text-primary">{zone.id}</span>
                    <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      isNormal 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                        : isWarning 
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' 
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {isNormal ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                      {zone.stateLabel}
                    </span>
                  </div>

                  <h3 className="font-bold text-base text-textMain dark:text-white leading-snug">
                    {zone.name}
                  </h3>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-textMuted">공실률 (빈 공간)</span>
                    <strong className="text-textMain dark:text-white">{(zone.emptyRatio * 100).toFixed(0)}%</strong>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${zone.emptyRatio > 0.7 ? 'bg-red-500' : 'bg-primary'}`} 
                      style={{ width: `${zone.emptyRatio * 100}%` }} 
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

      {/* AI 수요 예측 차트 섹션 */}
      <section className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-2 mb-6">
          <div>
            <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase mb-1">
              <TrendingUp size={16} />
              AI FORECASTING ENGINE
            </div>
            <h2 className="text-2xl font-bold text-textMain dark:text-white">
              수요 예측 및 소비 동향 (최근 30일 시계열 분석)
            </h2>
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-blue-600">
              <span className="w-3 h-0.5 bg-blue-600 rounded"></span> 실제 출고량
            </span>
            <span className="flex items-center gap-1.5 text-purple-600">
              <span className="w-3 h-0.5 bg-purple-600 border-t border-dashed rounded"></span> AI 예측치
            </span>
          </div>
        </div>

        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={demandForecastData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#8E8E93', fontSize: 11 }} dy={8} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8E8E93', fontSize: 11 }} dx={-8} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}
                cursor={{ stroke: '#0071E3', strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <Line 
                type="monotone" 
                dataKey="consumed" 
                name="실제 소비량(톤)"
                stroke="#0071E3" 
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#0071E3', stroke: '#fff', strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="forecast" 
                name="AI 예측치(톤)"
                stroke="#8b5cf6" 
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-6 p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div className="flex items-center gap-2 text-primary font-bold text-sm">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            AI 의사결정 권고 인사이트
          </div>
          <p className="text-xs md:text-sm text-textMain dark:text-gray-200">
            현재 소비 추세 기준, <strong>갈치 및 전갱이</strong> 재고가 향후 <strong>3일 내 안전 하한선</strong>에 도달할 예정입니다. 즉시 긴급 조달 발주를 권장합니다.
          </p>
        </div>
      </section>

    </div>
  );
}
