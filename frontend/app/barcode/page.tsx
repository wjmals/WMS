'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  QrCode,
  Search,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  Plus,
  Minus,
  RefreshCw,
  Warehouse,
  ArrowUpRight,
  ArrowDownLeft,
  Barcode as BarcodeIcon,
  Zap
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface InventoryItem {
  id: string;
  name: string;
  current: number;
  safe: number;
  status: string;
  statusLabel: string;
  diffText: string;
  recommendation: string;
  cycle: string;
  date: string;
}

export default function BarcodeScannerPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<number>(100);
  const [updateMsg, setUpdateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Fetch items from DB
  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/inventory?warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data);
        if (data.length > 0 && !selectedItem) {
          setSelectedItem(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load inventory items', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [user]);

  // Handle camera start/stop
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      setScanning(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('카메라를 활성화할 수 없습니다:', err);
      setUpdateMsg({ type: 'error', text: '카메라 접근 권한이 없거나 지원되지 않는 브라우저입니다.' });
      setIsCameraActive(false);
      setScanning(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Search item by barcode or name
  const handleSearch = (query: string) => {
    setBarcodeInput(query);
    if (!query.trim()) return;

    const matched = items.find(
      (item) =>
        item.id.toLowerCase() === query.trim().toLowerCase() ||
        item.name.toLowerCase().includes(query.trim().toLowerCase())
    );

    if (matched) {
      setSelectedItem(matched);
      setUpdateMsg({ type: 'success', text: `'${matched.name}' (${matched.id}) 바코드 인식 완료!` });
    } else {
      setUpdateMsg({ type: 'error', text: `바코드 또는 상품명 '${query}'에 일치하는 항목이 없습니다.` });
    }
  };

  // Stock update (입고 / 출고)
  const handleStockAdjust = async (delta: number) => {
    if (!selectedItem) return;

    const newCurrent = Math.max(0, selectedItem.current + delta);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedItem.id,
          current: newCurrent,
          safe: selectedItem.safe,
          warehouseId: user?.warehouseId,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setSelectedItem((prev) => (prev ? { ...prev, ...updated } : null));
        setItems((prev) =>
          prev.map((item) => (item.id === selectedItem.id ? { ...item, ...updated } : item))
        );
        const actionText = delta > 0 ? `+${delta.toLocaleString()}톤 입고` : `${delta.toLocaleString()}톤 출고`;
        setUpdateMsg({
          type: 'success',
          text: `[${selectedItem.name}] ${actionText} 처리 완료! (현재 재고: ${newCurrent.toLocaleString()}톤)`
        });
      } else {
        setUpdateMsg({ type: 'error', text: '재고 수량 변경 중 오류가 발생했습니다.' });
      }
    } catch (err) {
      setUpdateMsg({ type: 'error', text: '통신 오류가 발생했습니다.' });
    }
  };

  // Assign zone location dynamically
  const getWarehouseZone = (idStr: string) => {
    const num = parseInt(idStr.replace(/\D/g, ''), 10) || 1;
    const zones = ['A구역 - 냉동 보관 (동관 01-A)', 'B구역 - 냉동 보관 (서관 02-B)', 'C구역 - 저온 서늘 보관 (남관 03-C)'];
    return zones[num % zones.length];
  };

  return (
    <div className="max-w-[1000px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-primary font-bold text-sm mb-1">
            <BarcodeIcon className="w-5 h-5" />
            <span>Smart Warehouse Barcode Scanner</span>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            바코드 찍어서 재고 확인 및 조정
          </h1>
          <p className="text-textMuted text-sm mt-1">
            스마트폰 카메라 또는 바코드 리더기로 상품을 스캔하여 재고 및 창고 위치를 확인하고 실시간 입출고를 등록하세요.
          </p>
        </div>

        <button
          onClick={fetchItems}
          className="self-start md:self-auto px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-semibold flex items-center gap-2 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          DB 동기화
        </button>
      </div>

      {/* Alert Banner */}
      {updateMsg && (
        <div
          className={`p-4 rounded-2xl border text-sm font-semibold flex items-center justify-between transition-all ${
            updateMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
              : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {updateMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            )}
            <span>{updateMsg.text}</span>
          </div>
          <button
            onClick={() => setUpdateMsg(null)}
            className="text-xs opacity-60 hover:opacity-100 underline ml-4"
          >
            닫기
          </button>
        </div>
      )}

      {/* Main Grid: Scanner + Item Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Scanner & Quick Input (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Camera Scanner Box */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Camera className="w-5 h-5 text-primary" />
                실시간 카메라 스캐너
              </h2>
              {isCameraActive && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping mr-1.5"></span>
                  스캐닝 중
                </span>
              )}
            </div>

            <div className="relative w-full h-[220px] bg-black rounded-2xl overflow-hidden flex flex-col items-center justify-center border border-gray-800">
              {isCameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  {/* Laser Beam Animation */}
                  <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-red-500 shadow-[0_0_12px_#ef4444] animate-pulse"></div>
                  <div className="absolute inset-8 border-2 border-dashed border-white/50 rounded-xl pointer-events-none flex items-center justify-center">
                    <span className="text-[10px] text-white/80 bg-black/60 px-2 py-1 rounded">
                      바코드를 사각형 안에 맞춰주세요
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-center px-4">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gray-800 text-gray-400 flex items-center justify-center">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <p className="text-xs text-gray-400 font-medium">카메라를 켜거나 아래의 바코드를 클릭하세요</p>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              {!isCameraActive ? (
                <button
                  onClick={startCamera}
                  className="w-full py-3 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all"
                >
                  <Camera className="w-4 h-4" />
                  카메라 스캐너 시작
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                >
                  카메라 정지
                </button>
              )}
            </div>
          </div>

          {/* Barcode Search Box */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
              바코드 번호 또는 품목명 직접 입력
            </h3>
            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={barcodeInput}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="예: SEA-2026-001 또는 고등어"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white dark:focus:bg-gray-900 transition-all"
              />
            </div>

            {/* Quick Pick Buttons */}
            <div>
              <span className="text-xs text-textMuted font-semibold block mb-2">
                테스트 빠른 스캔 선택 (DB 보유 품목):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {items.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSearch(item.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      selectedItem?.id === item.id
                        ? 'bg-primary text-white border-primary shadow-sm'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {item.name} ({item.id})
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Scanned Item Details & Stock Adjustment (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {selectedItem ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-sm space-y-6">
              {/* Top Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs font-mono font-bold text-gray-800 dark:text-gray-200">
                      {selectedItem.id}
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                        selectedItem.status === 'shortage'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                          : selectedItem.status === 'overstock'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      }`}
                    >
                      {selectedItem.statusLabel}
                    </span>
                  </div>
                  <h2 className="text-2xl font-black text-gray-900 dark:text-white">
                    {selectedItem.name}
                  </h2>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-2xl border border-gray-100 dark:border-gray-700/50 flex items-center gap-3">
                  <Warehouse className="w-6 h-6 text-primary" />
                  <div>
                    <span className="text-[10px] text-textMuted uppercase font-bold block">창고 보관 구역</span>
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                      {getWarehouseZone(selectedItem.id)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stock Numbers Display */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 rounded-2xl p-4">
                  <span className="text-xs font-semibold text-textMuted block mb-1">현재 실시간 재고</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-primary">
                      {selectedItem.current.toLocaleString()}
                    </span>
                    <span className="text-sm font-bold text-gray-500">톤</span>
                  </div>
                  <span className="text-[11px] text-gray-500 mt-1 block">
                    {selectedItem.diffText}
                  </span>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-2xl p-4">
                  <span className="text-xs font-semibold text-textMuted block mb-1">적정 안전 재고</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-gray-800 dark:text-gray-200">
                      {selectedItem.safe.toLocaleString()}
                    </span>
                    <span className="text-sm font-bold text-gray-500">톤</span>
                  </div>
                  <span className="text-[11px] text-gray-500 mt-1 block">
                    점검 주기: {selectedItem.cycle}
                  </span>
                </div>
              </div>

              {/* Recommendation Box */}
              <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/50 text-xs">
                <span className="font-bold text-amber-900 dark:text-amber-300 block mb-1">
                  💡 AI 재고 조치 가이드:
                </span>
                <p className="text-amber-800 dark:text-amber-400 font-medium">
                  {selectedItem.recommendation}
                </p>
              </div>

              {/* Stock Adjustment Controls */}
              <div className="border-t border-gray-100 dark:border-gray-800 pt-6 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  실시간 현장 재고 입출고 처리
                </h3>

                {/* Adjust Amount Presets */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-textMuted">조정 수량 (톤):</span>
                  {[50, 100, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setAdjustAmount(amt)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        adjustAmount === amt
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      {amt}톤
                    </button>
                  ))}
                </div>

                {/* Inbound / Outbound Action Buttons */}
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => handleStockAdjust(adjustAmount)}
                    className="py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all"
                  >
                    <ArrowDownLeft className="w-5 h-5" />
                    +{adjustAmount.toLocaleString()}톤 입고 처리
                  </button>

                  <button
                    onClick={() => handleStockAdjust(-adjustAmount)}
                    className="py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-600/20 active:scale-[0.98] transition-all"
                  >
                    <ArrowUpRight className="w-5 h-5" />
                    -{adjustAmount.toLocaleString()}톤 출고 처리
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-12 text-center text-textMuted">
              <PackageCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-semibold">바코드를 스캔하거나 위에서 품목을 선택하세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
