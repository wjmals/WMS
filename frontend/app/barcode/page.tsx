'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import JsBarcode from 'jsbarcode';
import {
  Camera,
  QrCode,
  Search,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  RefreshCw,
  Warehouse,
  ArrowUpRight,
  ArrowDownLeft,
  Barcode as BarcodeIcon,
  Zap
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { normalizeApiNumbers } from '../../lib/normalizeApiNumbers';
import { formatQty, formatDiffText } from '../../lib/formatQuantity';

interface InventoryItem {
  id: string;
  name: string;
  barcode?: string | null;
  current: number;
  safe: number;
  unit: string;
  packageUnit?: string | null;
  packageSize?: number;
  palletUnit?: string | null;
  palletSize?: number;
  status: string;
  statusLabel: string;
  diffText: string;
  recommendation: string;
  cycle: string;
  date: string;
}

type UnitKey = 'base' | 'package' | 'pallet';
type ScanMode = 'select' | 'inbound' | 'outbound';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

function normalizeCode(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\s-]+/g, '').toLowerCase();
}

function getUnitOptions(item: InventoryItem) {
  const options: Array<{ key: UnitKey; name: string; multiplier: number }> = [{ key: 'base', name: item.unit, multiplier: 1 }];
  if (item.packageUnit) options.push({ key: 'package', name: item.packageUnit, multiplier: item.packageSize || 1 });
  if (item.palletUnit) options.push({ key: 'pallet', name: item.palletUnit, multiplier: item.palletSize || 1 });
  return options;
}

export default function BarcodeScannerPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<string>('1');
  const [adjustUnit, setAdjustUnit] = useState<UnitKey>('base');
  const [scanMode, setScanMode] = useState<ScanMode>('select');
  const [lastScan, setLastScan] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [updateMsg, setUpdateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const busyRef = useRef(false);
  const scanHandlerRef = useRef<(raw: string, fromCamera: boolean) => void>(() => {});

  const unitOptions = selectedItem ? getUnitOptions(selectedItem) : [];
  const activeUnit = unitOptions.find((option) => option.key === adjustUnit) || unitOptions[0];
  const amountNumber = adjustAmount.trim() === '' ? NaN : Number(adjustAmount);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/inventory?warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`);
      if (res.ok) {
        const data = await res.json();
        const normalizedItems: InventoryItem[] = normalizeApiNumbers(data);
        setItems(normalizedItems);
        setSelectedItem((previous) => {
          if (previous) return normalizedItems.find((item) => item.id === previous.id) || normalizedItems[0] || null;
          return normalizedItems[0] || null;
        });
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

  const stopStream = () => {
    if (scanTimerRef.current !== null) window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startCamera = () => {
    setUpdateMsg(null);
    setIsCameraActive(true);
  };

  const stopCamera = () => {
    stopStream();
    setIsCameraActive(false);
  };

  useEffect(() => {
    if (!isCameraActive || !videoRef.current) return;
    let cancelled = false;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('insecure-context'), { name: 'InsecureContext' });
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const NativeDetector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        const nativeDetector = NativeDetector ? new NativeDetector() : null;
        const reader = new BrowserMultiFormatReader();
        const canvas = document.createElement('canvas');
        let scanning = false;
        const report = (rawValue: string) => {
          const value = rawValue.trim();
          const now = Date.now();
          if (!value || (lastScanRef.current.value === value && now - lastScanRef.current.at < 2500)) return;
          lastScanRef.current = { value, at: now };
          scanHandlerRef.current(value, true);
        };
        const scanFrame = async () => {
          if (scanning || cancelled || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA || !video.videoWidth) return;
          scanning = true;
          try {
            if (nativeDetector) {
              const found = await nativeDetector.detect(video);
              if (found[0]?.rawValue) report(found[0].rawValue);
            } else {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const context = canvas.getContext('2d');
              if (!context) return;
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              report(reader.decodeFromCanvas(canvas).getText());
            }
          } catch {
            // 프레임에서 코드를 읽지 못하는 것은 카메라 이동 중 정상적인 상황입니다.
          } finally {
            scanning = false;
          }
        };
        scanTimerRef.current = window.setInterval(() => void scanFrame(), 300);
      } catch (error) {
        if (cancelled) return;
        console.error('카메라를 활성화할 수 없습니다:', error);
        const name = (error as { name?: string })?.name;
        const text = name === 'InsecureContext'
          ? '이 주소에서는 카메라를 쓸 수 없습니다. HTTPS 주소 또는 localhost로 접속하세요.'
          : name === 'NotAllowedError'
          ? '카메라 권한이 거부되었습니다. 브라우저 주소창의 권한 설정에서 카메라를 허용하세요.'
          : name === 'NotFoundError'
          ? '사용 가능한 카메라를 찾지 못했습니다.'
          : name === 'NotReadableError'
          ? '다른 앱이 카메라를 사용 중입니다. 해당 앱을 닫고 다시 시도하세요.'
          : '카메라를 시작하지 못했습니다. 브라우저 지원 여부와 권한을 확인하세요.';
        setUpdateMsg({ type: 'error', text });
        stopStream();
        setIsCameraActive(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isCameraActive]);

  useEffect(() => () => stopStream(), []);

  // 입력창 밖에서 바코드 리더기(키보드 방식)로 입력된 값은 빠른 키 입력 + Enter로 인식한다.
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const now = Date.now();
      if (now - lastKeyAt > 150) buffer = '';
      lastKeyAt = now;
      if (event.key === 'Enter') {
        if (buffer.length >= 3) {
          event.preventDefault();
          scanHandlerRef.current(buffer, false);
        }
        buffer = '';
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const findItem = (rawQuery: string, fromCamera: boolean) => {
    const code = normalizeCode(rawQuery);
    if (!code) return null;
    const exact =
      items.find((item) => item.barcode && normalizeCode(item.barcode) === code) ||
      items.find((item) => normalizeCode(item.id) === code) ||
      items.find((item) => normalizeCode(item.name) === code);
    if (exact) return { item: exact, exact: true };
    const partial = fromCamera ? undefined : items.find((item) => normalizeCode(item.name).includes(code));
    return partial ? { item: partial, exact: false } : null;
  };

  // 바코드/QR/품목명 검색. 정확히 일치하면 scanMode에 따라 입출고까지 자동 처리한다.
  const handleScan = (rawQuery: string, fromCamera: boolean) => {
    const query = rawQuery.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    setBarcodeInput(query);
    if (!query) return;
    const found = findItem(query, fromCamera);
    if (!found) {
      const text = `'${query}' 코드와 일치하는 품목이 없습니다. 품목에 바코드가 등록되어 있는지 확인하세요.`;
      setLastScan({ type: 'error', text });
      setUpdateMsg({ type: 'error', text });
      return;
    }
    const matched = found.item;
    setSelectedItem(matched);
    const text = `'${matched.name}' (${matched.barcode || matched.id}) 인식 완료`;
    setLastScan({ type: 'success', text });
    if (found.exact && scanMode !== 'select') {
      void handleStockAdjust(scanMode, matched);
    } else {
      setUpdateMsg({ type: 'success', text: `${text}! 아래에서 입고/출고를 처리하세요.` });
    }
  };
  scanHandlerRef.current = (raw, fromCamera) => handleScan(raw, fromCamera);

  const handleSearch = (query: string) => handleScan(query, false);

  // Stock update (입고 / 출고)
  const handleStockAdjust = async (direction: 'inbound' | 'outbound', target: InventoryItem | null = selectedItem) => {
    if (!target || busyRef.current) return;
    const options = getUnitOptions(target);
    const unitOption = options.find((option) => option.key === adjustUnit) || options[0];
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setUpdateMsg({ type: 'error', text: '변동 수량을 입력하세요. 0보다 큰 숫자여야 합니다.' });
      return;
    }
    const baseQuantity = amountNumber * unitOption.multiplier;
    if (direction === 'outbound' && baseQuantity > target.current + 1e-9) {
      setUpdateMsg({ type: 'error', text: `현재 재고(${formatQty(target.current)} ${target.unit})보다 많이 출고할 수 없습니다.` });
      return;
    }
    busyRef.current = true;
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: target.id,
          quantity: amountNumber,
          quantityUnit: unitOption.name,
          warehouseId: user?.warehouseId,
          movementType: direction,
          note: `바코드 화면 ${direction === 'inbound' ? '입고' : '출고'}`,
          source: 'barcode',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const updated = normalizeApiNumbers(body) as Partial<InventoryItem>;
        setSelectedItem((prev) => (prev && prev.id === target.id ? { ...prev, ...updated } : prev));
        setItems((prev) => prev.map((item) => (item.id === target.id ? { ...item, ...updated } : item)));
        const actionText = `${formatQty(amountNumber)} ${unitOption.name} ${direction === 'inbound' ? '입고' : '출고'}`;
        const message = `[${target.name}] ${actionText} 처리 완료! (현재 재고: ${formatQty(updated.current ?? target.current)} ${target.unit})`;
        setUpdateMsg({ type: 'success', text: message });
        setLastScan({ type: 'success', text: message });
      } else {
        setUpdateMsg({ type: 'error', text: body?.error || '재고 수량 변경 중 오류가 발생했습니다.' });
      }
    } catch (err) {
      setUpdateMsg({ type: 'error', text: '통신 오류가 발생했습니다.' });
    } finally {
      busyRef.current = false;
    }
  };

  const printLabel = () => {
    if (!selectedItem) return;
    const labelWindow = window.open('', '_blank', 'width=460,height=320');
    if (!labelWindow) {
      setUpdateMsg({ type: 'error', text: '라벨 창이 차단되었습니다. 팝업 허용 후 다시 시도하세요.' });
      return;
    }
    const barcodeText = selectedItem.barcode || selectedItem.id;
    const barcodeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try {
      JsBarcode(barcodeSvg, barcodeText, { format: 'CODE128', displayValue: false, margin: 0 });
    } catch {
      labelWindow.close();
      setUpdateMsg({ type: 'error', text: '라벨에 사용할 바코드 값을 확인해주세요.' });
      return;
    }
    labelWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(selectedItem.name)} 라벨</title><style>body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#111}.label{width:78mm;min-height:42mm;border:1px solid #111;padding:5mm;box-sizing:border-box}.name{font-size:18px;font-weight:700;margin-bottom:8px}.code{font:12px monospace;margin-top:8px}.meta{font-size:11px;color:#333}.barcode{width:100%;height:48px}@media print{@page{size:88mm 52mm;margin:0}body{padding:4mm}.label{border:0}}</style></head><body><div class="label"><div class="name">${escapeHtml(selectedItem.name)}</div><div class="meta">현재 ${formatQty(selectedItem.current)} ${escapeHtml(selectedItem.unit)}</div>${barcodeSvg.outerHTML.replace('<svg ', '<svg class="barcode" ')}<div class="code">${escapeHtml(barcodeText)}</div></div><script>window.onload=()=>window.print();</script></body></html>`);
    labelWindow.document.close();
  };

  return (
    <div className="max-w-[1000px] mx-auto space-y-6 sm:space-y-8 min-w-0">
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
            카메라에서 바코드를 판독하거나 바코드 리더기로 입력해 품목 재고를 확인하고 입출고를 기록합니다.
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
          <div className="flex items-center gap-2 min-w-0">
            {updateMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            )}
            <span className="break-words min-w-0">{updateMsg.text}</span>
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

            <div className="mt-4 space-y-2">
              <span className="text-xs font-semibold text-textMuted block">스캔 시 동작 (카메라·바코드 리더기 공통)</span>
              <div className="grid grid-cols-3 gap-1.5">
                {([['select', '품목만 선택'], ['inbound', '스캔마다 입고'], ['outbound', '스캔마다 출고']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setScanMode(mode)}
                    className={`px-2 py-2 rounded-lg text-[11px] font-bold border transition-all ${
                      scanMode === mode
                        ? mode === 'outbound' ? 'bg-red-600 text-white border-red-600' : mode === 'inbound' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-primary text-white border-primary'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scanMode !== 'select' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  아래 변동 수량·단위({amountNumber > 0 ? formatQty(amountNumber) : '미입력'} {activeUnit?.name || ''})만큼 인식할 때마다 자동으로 {scanMode === 'inbound' ? '입고' : '출고'}됩니다.
                </p>
              )}
              {lastScan && (
                <p className={`text-xs font-semibold break-words rounded-lg px-3 py-2 ${lastScan.type === 'success' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'}`}>
                  최근 스캔: {lastScan.text}
                </p>
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
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSearch(barcodeInput);
                  }
                }}
                placeholder="스캐너 입력 후 Enter 또는 품목명 입력"
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
                    onClick={() => { setSelectedItem(item); setLastScan({ type: 'success', text: `'${item.name}' 품목을 선택했습니다.` }); }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      selectedItem?.id === item.id
                        ? 'bg-primary text-white border-primary shadow-sm'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {item.name}{item.barcode ? ` (${item.barcode})` : ""}
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
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs font-mono font-bold text-gray-800 dark:text-gray-200 break-all">
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
                      {selectedItem.safe <= 0 ? '안전재고 미설정' : selectedItem.statusLabel}
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white break-words">
                    {selectedItem.name}
                  </h2>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-2xl border border-gray-100 dark:border-gray-700/50 flex items-center gap-3">
                  <Warehouse className="w-6 h-6 text-primary" />
                  <div>
                    <span className="text-[10px] text-textMuted uppercase font-bold block">품목 ID</span>
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                      {selectedItem.id}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={printLabel} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-bold"><BarcodeIcon className="h-4 w-4" />라벨 인쇄</button>
              </div>

              {/* Stock Numbers Display */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 rounded-2xl p-4 min-w-0">
                  <span className="text-xs font-semibold text-textMuted block mb-1">현재 실시간 재고</span>
                  <div className="flex items-baseline gap-1 flex-wrap min-w-0">
                    <span className="text-2xl sm:text-3xl font-black text-primary break-all">
                      {formatQty(selectedItem.current)}
                    </span>
                    <span className="text-sm font-bold text-gray-500">{selectedItem.unit}</span>
                  </div>
                  <span className="text-[11px] text-gray-500 mt-1 block break-words">
                    {formatDiffText(selectedItem.diffText)}
                  </span>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 min-w-0">
                  <span className="text-xs font-semibold text-textMuted block mb-1">적정 안전 재고</span>
                  <div className="flex items-baseline gap-1 flex-wrap min-w-0">
                    <span className="text-2xl sm:text-3xl font-black text-gray-800 dark:text-gray-200 break-all">
                      {formatQty(selectedItem.safe)}
                    </span>
                    <span className="text-sm font-bold text-gray-500">{selectedItem.unit}</span>
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

                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                  <label className="text-xs font-semibold text-textMuted min-w-0">변동 수량
                    <input type="number" inputMode="decimal" min="0" step="any" placeholder="수량 입력" value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-textMain dark:text-white" />
                  </label>
                  <label className="text-xs font-semibold text-textMuted min-w-0">입력 단위
                    <select value={activeUnit?.key || 'base'} onChange={(event) => setAdjustUnit(event.target.value as UnitKey)} className="mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-textMain dark:text-white">
                      {unitOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.key === 'base' ? option.name : `${option.name} (1${option.name} = ${formatQty(option.multiplier)} ${selectedItem.unit})`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {activeUnit && activeUnit.key !== 'base' && amountNumber > 0 && (
                  <p className="text-[11px] text-textMuted">= {formatQty(amountNumber * activeUnit.multiplier)} {selectedItem.unit} 만큼 재고가 변동됩니다.</p>
                )}

                {/* Inbound / Outbound Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => handleStockAdjust('inbound')}
                    className="py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all min-w-0"
                  >
                    <ArrowDownLeft className="w-5 h-5 shrink-0" />
                    <span className="truncate">{amountNumber > 0 ? formatQty(amountNumber) : '수량'} {activeUnit?.name} 입고 처리</span>
                  </button>

                  <button
                    onClick={() => handleStockAdjust('outbound')}
                    className="py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-600/20 active:scale-[0.98] transition-all min-w-0"
                  >
                    <ArrowUpRight className="w-5 h-5 shrink-0" />
                    <span className="truncate">{amountNumber > 0 ? formatQty(amountNumber) : '수량'} {activeUnit?.name} 출고 처리</span>
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
