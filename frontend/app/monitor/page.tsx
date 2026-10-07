"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Camera, Play, Square, Settings, AlertTriangle, CheckCircle, Package, 
  ArrowLeft, Zap, Clock, Wifi, WifiOff, RefreshCw, Eye, ShieldCheck, Sparkles,
  Plus, Trash2, Upload, X, BookOpen, Download, FileSpreadsheet
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import ExcelJS from 'exceljs';
import { normalizeApiNumbers } from '../../lib/normalizeApiNumbers';

type ReferenceItem = {
  id: string;
  warehouseId: string;
  name: string;
  description: string;
  thumbnail: string;
  createdAt: string;
};

type AnalysisLog = {
  id: number;
  item_name: string;
  status: 'shortage' | 'safe' | 'overstock';
  status_label: string;
  estimated_quantity: number;
  unit: string;
  confidence: number;
  recommendation: string;
  analyzed_at: string;
};

type AnalysisResult = {
  estimateId?: string;
  reviewStatus?: string;
  itemName: string;
  estimatedQuantity: number;
  unit: string;
  status: 'shortage' | 'safe' | 'overstock';
  statusLabel: string;
  confidence: number;
  recommendation: string;
  reason: string;
};

type PendingEstimate = {
  id: string;
  inventoryItemId: string | null;
  itemName: string;
  estimatedQuantity: number;
  unit: string;
  confidence: number;
  recommendation: string;
  reason: string;
  submittedEmail: string;
  createdAt: string;
};

type InventoryChoice = { id: string; name: string; unit: string; packageUnit: string | null };

const statusConfig = {
  shortage: {
    bg: 'bg-red-500',
    light: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800',
    text: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
    icon: AlertTriangle,
    dot: 'bg-red-500'
  },
  safe: {
    bg: 'bg-green-500',
    light: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800',
    text: 'text-green-600',
    badge: 'bg-green-100 text-green-700',
    icon: CheckCircle,
    dot: 'bg-green-500'
  },
  overstock: {
    bg: 'bg-amber-500',
    light: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800',
    text: 'text-amber-600',
    badge: 'bg-amber-100 text-amber-700',
    icon: Package,
    dot: 'bg-amber-500'
  },
};

const INTERVALS = [
  { label: '10초', value: 10 },
  { label: '30초', value: 30 },
  { label: '1분', value: 60 },
  { label: '5분', value: 300 },
];

export default function MonitorPage() {
  const router = useRouter();
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const analysisInFlightRef = useRef(false);

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraMode, setCameraMode] = useState<'webcam' | 'ip'>('webcam');
  const [ipUrl, setIpUrl] = useState('');
  const [itemName, setItemName] = useState('');
  const [intervalSec, setIntervalSec] = useState(30);
  const [showSettings, setShowSettings] = useState(true);
  const [latestResult, setLatestResult] = useState<AnalysisResult | null>(null);
  const [logs, setLogs] = useState<AnalysisLog[]>([]);
  const [pendingEstimates, setPendingEstimates] = useState<PendingEstimate[]>([]);
  const [inventoryChoices, setInventoryChoices] = useState<InventoryChoice[]>([]);
  const [reviewSelections, setReviewSelections] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [totalAnalyzed, setTotalAnalyzed] = useState(0);
  const [shortageCount, setShortageCount] = useState(0);

  // AI 분석용 레퍼런스 이미지 상태
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [showLearnModal, setShowLearnModal] = useState(false);
  const [learnName, setLearnName] = useState('');
  const [learnDesc, setLearnDesc] = useState('');
  const [learnImage, setLearnImage] = useState<string | null>(null);
  const [savingReference, setSavingReference] = useState(false);
  const [importingWorkbook, setImportingWorkbook] = useState(false);
  const [importWorkbook, setImportWorkbook] = useState<File | null>(null);
  const [importImages, setImportImages] = useState<File[]>([]);

  // 이력 불러오기
  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitor?warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`);
      const data = await res.json();
      setLogs(Array.isArray(data) ? normalizeApiNumbers(data) : []);
    } catch {}
  }, [user]);

  const fetchPendingEstimates = useCallback(async () => {
    try {
      const warehouseId = encodeURIComponent(user?.warehouseId || 'wh_wjmals');
      const [estimateResponse, inventoryResponse] = await Promise.all([
        fetch(`/api/vision/estimates?warehouseId=${warehouseId}`),
        fetch(`/api/inventory?warehouseId=${warehouseId}`),
      ]);
      const estimates = await estimateResponse.json();
      const inventory = await inventoryResponse.json();
      if (Array.isArray(estimates)) setPendingEstimates(normalizeApiNumbers(estimates));
      if (Array.isArray(inventory)) setInventoryChoices(normalizeApiNumbers(inventory));
    } catch {}
  }, [user]);

  // 분석용 레퍼런스 이미지 불러오기
  const fetchReferences = useCallback(async () => {
    try {
      const res = await fetch(`/api/vision?warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setReferences(data);
    } catch {}
  }, [user]);

  useEffect(() => {
    fetchLogs();
    fetchReferences();
    fetchPendingEstimates();
  }, [fetchLogs, fetchReferences, fetchPendingEstimates]);

  const reviewEstimate = async (estimate: PendingEstimate, approve: boolean) => {
    const inventoryItemId = reviewSelections[estimate.id] || estimate.inventoryItemId || undefined;
    if (approve && !inventoryItemId) {
      alert('승인할 재고 품목을 먼저 선택해주세요.');
      return;
    }
    const note = window.prompt(approve ? '승인 사유를 입력하세요.' : '반려 사유를 입력하세요.', approve ? '실물 확인 후 승인' : '실사 필요');
    if (!note?.trim()) return;
    const response = await fetch('/api/vision/estimates/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: estimate.id, approve, inventoryItemId, note }),
    });
    const result = await response.json();
    if (!response.ok) {
      alert(result.error || '검토 결과를 저장하지 못했습니다.');
      return;
    }
    await Promise.all([fetchPendingEstimates(), fetchLogs()]);
  };

  // 이미지 파일 선택 처리
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setLearnImage(await compressImage(event.target?.result as string));
      } catch (error) {
        alert(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.');
      }
    };
    reader.readAsDataURL(file);
  };

  const compressImage = async (dataUrl: string): Promise<string> => {
    const image = new Image();
    image.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('이미지 파일을 읽을 수 없습니다.'));
    });
    const scale = Math.min(1, 640 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지를 변환할 수 없습니다.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvas.toDataURL('image/jpeg', 0.65);
    if (compressed.length > 50000) throw new Error('압축 후 이미지가 너무 큽니다. 해상도가 낮은 이미지를 선택해주세요.');
    return compressed;
  };

  const saveWorkbook = async (workbook: ExcelJS.Workbook, filename: string) => {
    const data = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadWorkbookTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('References');
    sheet.addRow(['name', 'description', 'imageFile']);
    sheet.addRow(['냉동 고등어', '은빛 비늘, 10kg 상자', 'mackerel.jpg']);
    await saveWorkbook(workbook, 'wms-reference-template.xlsx');
  };

  const exportReferences = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('References');
    sheet.addRow(['name', 'description', 'createdAt', 'imageDataPart1', 'imageDataPart2']);
    references.forEach((reference) => sheet.addRow([
      reference.name,
      reference.description,
      reference.createdAt,
      reference.thumbnail.slice(0, 30000),
      reference.thumbnail.slice(30000),
    ]));
    await saveWorkbook(workbook, 'wms-reference-data.xlsx');
  };

  const handleWorkbookImport = async () => {
    if (!importWorkbook) return;
    setImportingWorkbook(true);
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await importWorkbook.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('첫 번째 시트를 찾을 수 없습니다.');
      const headerValues = sheet.getRow(1).values;
      if (!Array.isArray(headerValues)) throw new Error('엑셀 헤더를 읽을 수 없습니다.');
      const headers = headerValues.slice(1).map((header) => String(header || '').trim());
      const rows: Record<string, unknown>[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const record: Record<string, unknown> = {};
        headers.forEach((header, index) => { if (header) record[header] = row.getCell(index + 1).text; });
        rows.push(record);
      });
      if (rows.length === 0 || rows.length > 500) throw new Error('엑셀에 1~500개의 데이터 행이 필요합니다.');
      const imagesByName = new Map(importImages.map((file) => [file.name.toLowerCase(), file]));
      const items = await Promise.all(rows.map(async (row, index) => {
        const name = String(row.name || '').trim();
        const description = String(row.description || '').trim();
        const embeddedData = `${String(row.imageDataPart1 || '')}${String(row.imageDataPart2 || '')}`;
        let image = embeddedData;
        if (!image) {
          const imageName = String(row.imageFile || '').trim().toLowerCase();
          const file = imagesByName.get(imageName);
          if (!file) throw new Error(`${index + 2}행 이미지 파일을 찾을 수 없습니다: ${imageName || '(imageFile 누락)'}`);
          image = await compressImage(await fileToDataUrl(file));
        }
        if (!name || !image) throw new Error(`${index + 2}행 name 또는 이미지 데이터가 비어 있습니다.`);
        if (image.length > 50000) throw new Error(`${index + 2}행 이미지 데이터가 50,000자를 초과합니다.`);
        return { name, description, image };
      }));
      if (JSON.stringify({ items }).length > 20 * 1024 * 1024) throw new Error('한 번에 가져올 수 있는 전체 이미지 용량은 20MB입니다. 파일을 나눠 등록해주세요.');
      const response = await fetch('/api/vision/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId: user?.warehouseId, items }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '엑셀 데이터를 등록하지 못했습니다.');
      await fetchReferences();
      setImportWorkbook(null);
      setImportImages([]);
      alert(`${result.imported}개 레퍼런스를 등록했습니다.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '엑셀 파일을 가져오지 못했습니다.');
    } finally {
      setImportingWorkbook(false);
    }
  };

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
    reader.readAsDataURL(file);
  });

  // 현재 카메라 화면 캡처하여 레퍼런스 이미지로 사용
  const handleCaptureForLearn = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    try {
      setLearnImage(await compressImage(canvas.toDataURL('image/jpeg', 0.8)));
    } catch (error) {
      alert(error instanceof Error ? error.message : '이미지 처리에 실패했습니다.');
    }
  };

  // 품목 레퍼런스 이미지 저장
  const handleSaveReference = async () => {
    if (!learnName || !learnImage) {
      alert('품목명과 이미지를 모두 지정해주세요.');
      return;
    }
    const referenceName = learnName;
    setSavingReference(true);
    try {
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: referenceName,
          description: learnDesc,
          image: learnImage,
          warehouseId: user?.warehouseId,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || '레퍼런스 이미지 등록에 실패했습니다.');
      }
      setLearnName('');
      setLearnDesc('');
      setLearnImage(null);
      setShowLearnModal(false);
      await fetchReferences();
      alert(`[${referenceName}] 분석용 레퍼런스 이미지가 등록되었습니다.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '레퍼런스 이미지 등록 중 오류가 발생했습니다.');
    } finally {
      setSavingReference(false);
    }
  };

  // 레퍼런스 이미지 삭제
  const handleDeleteReference = async (id: string, name: string) => {
    if (!confirm(`[${name}] 분석용 레퍼런스를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/vision?id=${id}&warehouseId=${encodeURIComponent(user?.warehouseId || 'wh_wjmals')}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('레퍼런스 이미지 삭제에 실패했습니다.');
      await fetchReferences();
    } catch (e) {
      alert(e instanceof Error ? e.message : '레퍼런스 이미지 삭제에 실패했습니다.');
    }
  };

  // 카메라 시작
  const startWebcam = useCallback(async () => {
    if (cameraMode === 'ip') {
      const streamUrl = ipUrl.trim();
      if (!streamUrl || !videoRef.current) {
        alert('IP 카메라 스트림 주소를 입력해주세요.');
        return false;
      }

      try {
        const video = videoRef.current;
        video.srcObject = null;
        video.src = streamUrl;
        video.load();
        await video.play();
        setCameraReady(true);
        return true;
      } catch {
        setCameraReady(false);
        alert('IP 카메라 스트림을 재생할 수 없습니다. 주소와 브라우저 호환성을 확인해주세요.');
        return false;
      }
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setCameraReady(true);
      return true;
    } catch {
      setCameraReady(false);
      alert('카메라 권한을 허용해주세요.');
      return false;
    }
  }, [cameraMode, ipUrl]);

  // 카메라 중지
  const stopWebcam = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    setCameraReady(false);
  }, [stream]);

  // 프레임 캡처 + AI 분석
  const captureAndAnalyze = useCallback(async () => {
    if (analysisInFlightRef.current) return;

    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg', 0.75);
    if (!imageData) return;

    analysisInFlightRef.current = true;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageData,
          itemName,
          cameraUrl: cameraMode === 'ip' ? ipUrl : 'webcam',
          warehouseId: user?.warehouseId,
        }),
      });
      if (!res.ok) throw new Error('분석 실패');
      const result = normalizeApiNumbers(await res.json());
      setLatestResult(result);
      setTotalAnalyzed((p) => p + 1);
      if (result.status === 'shortage') setShortageCount((p) => p + 1);
      await fetchLogs();
    } catch (err) {
      console.error('분석 오류:', err);
    } finally {
      analysisInFlightRef.current = false;
      setAnalyzing(false);
    }
  }, [cameraMode, itemName, ipUrl, fetchLogs, user?.warehouseId]);

  // 카운트다운
  useEffect(() => {
    if (!isMonitoring) return;
    let remaining = intervalSec;
    setCountdown(remaining);
    const tick = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) remaining = intervalSec;
    }, 1000);
    return () => clearInterval(tick);
  }, [isMonitoring, intervalSec]);

  // 자동 분석 루프
  useEffect(() => {
    if (!isMonitoring) return;
    captureAndAnalyze();
    intervalRef.current = setInterval(captureAndAnalyze, intervalSec * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isMonitoring, intervalSec, captureAndAnalyze]);

  // 모니터링 시작
  const startMonitoring = useCallback(async () => {
    const started = await startWebcam();
    if (!started) return;
    setShowSettings(false);
    setIsMonitoring(true);
  }, [startWebcam]);

  // 모니터링 중지
  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    stopWebcam();
  }, [stopWebcam]);

  const latestStatus = latestResult ? statusConfig[latestResult.status] : null;

  return (
    <div className="flex flex-col gap-8 font-sans pb-16">
      
      {/* 헤더 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-red-500 font-bold text-xs tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            REAL-TIME CCTV / AI SURVEILLANCE
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-textMain dark:text-white">
            실시간 AI 재고 모니터링
          </h1>
          <p className="text-sm text-textMuted mt-1">
            CCTV 및 스마트폰 IP 카메라 연동 • 주기적 실시간 AI 비전 재고 감지 시스템
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isMonitoring ? (
            <div className="flex items-center gap-2 text-xs font-bold text-green-700 bg-green-100 px-3.5 py-2 rounded-xl">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
              실시간 AI 모니터링 동작 중 ({countdown}초 후 차기 분석)
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-semibold text-textMuted bg-gray-100 dark:bg-gray-800 px-3.5 py-2 rounded-xl">
              <span className="w-2 h-2 bg-gray-400 rounded-full" />
              모니터링 대기 중
            </div>
          )}

          <button
            onClick={() => setShowLearnModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Sparkles size={16} />
            분석용 레퍼런스 등록 ({references.length})
          </button>

          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`p-2.5 rounded-xl border text-sm font-semibold transition-all ${
              showSettings ? 'bg-primary text-white border-primary' : 'bg-white border-gray-200 text-textMuted hover:bg-gray-50'
            }`}
            title="카메라 설정"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* 상단 통계 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm">
          <span className="text-xs font-bold text-textMuted uppercase">총 누적 AI 분석 건수</span>
          <h3 className="text-2xl font-bold text-textMain dark:text-white mt-1">{totalAnalyzed} 회</h3>
          <p className="text-xs text-textMuted mt-1">Groq Vision Llama-4 엔진 적용</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm">
          <span className="text-xs font-bold text-red-500 uppercase">재고 부족 감지 알림</span>
          <h3 className="text-2xl font-bold text-red-600 mt-1">{shortageCount} 건</h3>
          <p className="text-xs text-red-500 font-semibold mt-1">감지 시 재고 데이터 자동 갱신</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm">
          <span className="text-xs font-bold text-primary uppercase">분석 주기 타이머</span>
          <h3 className="text-2xl font-bold text-primary mt-1">
            {isMonitoring ? `${countdown} 초` : `${intervalSec} 초`}
          </h3>
          <p className="text-xs text-textMuted mt-1">설정된 주기마다 자동 캡처 분석</p>
        </div>
      </div>

      {/* 본문: 좌측 카메라 화면 + 우측 설정 및 이력 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* 좌측: 카메라 뷰어 (라이트 모드 카드 디자인) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 shadow-sm space-y-4">
            
            <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Camera size={18} className="text-primary" />
                <span className="font-bold text-sm text-textMain dark:text-white">
                  {cameraMode === 'webcam' ? '웹캠 / 휴대폰 카메라 스트림' : 'IP 카메라 / CCTV 실시간 스트림'}
                </span>
              </div>
              <span className="text-xs text-textMuted font-mono">
                {cameraReady ? '● LIVE STREAMING' : '대기'}
              </span>
            </div>

            {/* 비디오 화면 영역 */}
            <div className="relative bg-gray-950 rounded-2xl overflow-hidden aspect-video flex items-center justify-center shadow-inner">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover" 
              />

              {!cameraReady && !isMonitoring && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-100 dark:bg-gray-800 text-center p-6">
                  <div className="w-16 h-16 rounded-2xl bg-white dark:bg-gray-700 shadow-sm flex items-center justify-center text-primary">
                    <Camera size={32} />
                  </div>
                  <div>
                    <h4 className="font-bold text-base text-textMain dark:text-white">모니터링 시작 대기 중</h4>
                    <p className="text-xs text-textMuted mt-1">
                      하단의 [모니터링 시작] 버튼을 누르면 실시간 카메라가 활성화됩니다.
                    </p>
                  </div>
                </div>
              )}

              {/* AI 분석 중 오버레이 */}
              {analyzing && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                  <div className="bg-white dark:bg-gray-900 px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <span className="text-sm font-bold text-textMain dark:text-white">AI 재고 정밀 분석 중...</span>
                  </div>
                </div>
              )}

              {/* 오버레이: 최신 감지 결과 배너 */}
              {latestResult && !analyzing && (
                <div className="absolute bottom-4 left-4 right-4 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-gray-200/80 dark:border-gray-700 rounded-2xl p-4 shadow-lg flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${latestStatus?.dot} animate-ping`} />
                    <div>
                      <span className={`text-xs font-extrabold ${latestStatus?.text}`}>
                        {latestResult.reviewStatus === 'PENDING' ? '관리자 확인 대기' : latestResult.statusLabel}
                      </span>
                      <h4 className="text-sm font-bold text-textMain dark:text-white">
                        {latestResult.itemName} ({latestResult.estimatedQuantity}{latestResult.unit})
                      </h4>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-primary">신뢰도 {latestResult.confidence}%</span>
                    <p className="text-[11px] text-textMuted max-w-[200px] truncate">{latestResult.recommendation}</p>
                  </div>
                </div>
              )}

              {/* 조준선 오버레이 */}
              {isMonitoring && (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-red-500 rounded-tl-lg" />
                  <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-red-500 rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-red-500 rounded-bl-lg" />
                  <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-red-500 rounded-br-lg" />
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {/* 컨트롤 버튼 바 */}
            <div className="flex gap-3 pt-2">
              {!isMonitoring ? (
                <button
                  onClick={startMonitoring}
                  className="flex-1 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white py-3.5 rounded-2xl font-bold text-base shadow-sm flex items-center justify-center gap-2 transition-all"
                >
                  <Play size={20} fill="white" />
                  실시간 모니터링 시작
                </button>
              ) : (
                <>
                  <button
                    onClick={captureAndAnalyze}
                    disabled={analyzing}
                    className="flex-1 bg-primary hover:bg-blue-600 disabled:opacity-50 text-white py-3.5 rounded-2xl font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all"
                  >
                    <Zap size={18} />
                    즉시 AI 분석 실행
                  </button>
                  <button
                    onClick={stopMonitoring}
                    className="px-6 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-textMain dark:text-gray-200 py-3.5 rounded-2xl font-semibold text-sm transition-all flex items-center gap-2"
                  >
                    <Square size={16} fill="currentColor" />
                    중지
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 우측: 카메라 설정 및 실시간 감지 이력 */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          
          {/* 카메라 설정 카드 */}
          {showSettings && (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-sm text-textMain dark:text-white flex items-center gap-2">
                <Settings size={16} className="text-primary" />
                카메라 및 감지 파라미터 설정
              </h3>

              {/* 모드 선택 */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCameraMode('webcam')}
                  className={`py-2 rounded-xl text-xs font-bold transition-all ${
                    cameraMode === 'webcam' 
                      ? 'bg-primary text-white shadow-sm' 
                      : 'bg-gray-100 dark:bg-gray-800 text-textMuted hover:bg-gray-200'
                  }`}
                >
                  📷 카메라 / 웹캠
                </button>
                <button
                  onClick={() => setCameraMode('ip')}
                  className={`py-2 rounded-xl text-xs font-bold transition-all ${
                    cameraMode === 'ip' 
                      ? 'bg-primary text-white shadow-sm' 
                      : 'bg-gray-100 dark:bg-gray-800 text-textMuted hover:bg-gray-200'
                  }`}
                >
                  📡 IP 카메라 / CCTV
                </button>
              </div>

              {cameraMode === 'ip' && (
                <div>
                  <label className="text-xs font-bold text-textMuted uppercase mb-1 block">
                    CCTV / IP 카메라 스트림 주소
                  </label>
                  <input
                    type="text"
                    value={ipUrl}
                    onChange={(e) => setIpUrl(e.target.value)}
                    placeholder="http://192.168.1.10:8080/video"
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="text-[11px] text-textMuted mt-1">
                    스마트폰 앱 (IP Camera Lite / IP Webcam) 또는 CCTV RTSP 주소를 입력하세요.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-textMuted uppercase mb-1 block">
                  중점 관리 품목명 (선택)
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="예: 갈치, 고등어 (미입력 시 자동인식)"
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-textMuted uppercase mb-1 block">
                  AI 자동 캡처 주기
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv.value}
                      onClick={() => setIntervalSec(iv.value)}
                      className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                        intervalSec === iv.value 
                          ? 'bg-primary text-white shadow-sm' 
                          : 'bg-gray-100 dark:bg-gray-800 text-textMuted hover:bg-gray-200'
                      }`}
                    >
                      {iv.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI 분석용 품목 레퍼런스 카드 */}
          <div className="bg-white dark:bg-gray-900 border border-purple-100 dark:border-purple-900/30 rounded-3xl p-5 shadow-sm space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-sm text-textMain dark:text-white flex items-center gap-2">
                <BookOpen size={16} className="text-purple-600" />
                AI 분석 레퍼런스 전체 ({references.length}건)
              </h3>
              <div className="flex gap-2">
                <button onClick={exportReferences} disabled={!references.length} title="엑셀로 내보내기" className="p-2 text-gray-600 disabled:opacity-40 hover:bg-gray-100 rounded-lg"><Download size={16} /></button>
                <button onClick={() => setShowLearnModal(true)} title="레퍼런스 추가 또는 엑셀 가져오기" className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg"><Plus size={16} /></button>
              </div>
            </div>

            {references.length === 0 ? (
              <div className="py-4 text-center text-textMuted text-xs">
                아직 등록된 레퍼런스 이미지가 없습니다.<br />
                사진을 등록하면 다음 분석에서 품목 비교 기준으로 사용됩니다.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {references.map((ref) => (
                  <div key={ref.id} className="relative group bg-gray-50 dark:bg-gray-800 p-2 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col gap-1">
                    {ref.thumbnail && (
                      <img src={ref.thumbnail} alt={ref.name} className="w-full h-20 object-cover rounded-lg" />
                    )}
                    <div className="flex justify-between items-center">
                      <div className="min-w-0">
                        <span className="block text-xs font-bold truncate text-textMain dark:text-white">{ref.name}</span>
                        <span className="block text-[10px] text-textMuted truncate">{ref.description || new Date(ref.createdAt).toLocaleDateString()}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteReference(ref.id, ref.name)}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="레퍼런스 이미지 삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <section className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/50 rounded-3xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <div>
                <h3 className="font-bold text-sm text-textMain dark:text-white">비전 추정 승인 대기</h3>
                <p className="text-[11px] text-textMuted mt-1">승인 전에는 재고 잔량을 변경하지 않습니다.</p>
              </div>
              <button onClick={fetchPendingEstimates} title="대기 목록 새로고침" className="p-1.5 text-textMuted hover:bg-gray-100 rounded-lg"><RefreshCw size={14} /></button>
            </div>
            {pendingEstimates.length === 0 ? (
              <p className="py-5 text-center text-xs text-textMuted">검토할 추정치가 없습니다.</p>
            ) : pendingEstimates.map((estimate) => {
              const canReview = user?.role === '관리자' || user?.role === '서버 관리자';
              const suggestedId = estimate.inventoryItemId || reviewSelections[estimate.id] || '';
              return (
                <article key={estimate.id} className="border-b last:border-b-0 border-gray-100 dark:border-gray-800 pb-3 last:pb-0 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-textMain dark:text-white">{estimate.itemName}</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">추정 {estimate.estimatedQuantity.toLocaleString()} {estimate.unit} · 신뢰도 {estimate.confidence}%</p>
                    </div>
                    <time className="text-[10px] text-textMuted whitespace-nowrap">{new Date(estimate.createdAt).toLocaleString('ko-KR')}</time>
                  </div>
                  <p className="text-[11px] text-textMuted">{estimate.reason}</p>
                  {canReview && (
                    <>
                      <select
                        value={suggestedId}
                        onChange={(event) => setReviewSelections((current) => ({ ...current, [estimate.id]: event.target.value }))}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2 text-xs"
                      >
                        <option value="">연결할 재고 품목 선택</option>
                        {inventoryChoices.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit}{item.packageUnit ? ` / ${item.packageUnit}` : ''})</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => reviewEstimate(estimate, true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">실사 후 승인</button>
                        <button onClick={() => reviewEstimate(estimate, false)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50">반려</button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </section>

          {/* 실시간 분석 이력 카드 (PostgreSQL monitor_logs) */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-5 shadow-sm flex flex-col max-h-[480px]">
            <div className="flex justify-between items-center pb-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-sm text-textMain dark:text-white flex items-center gap-2">
                <Clock size={16} className="text-primary" />
                최근 AI 감지 이력
              </h3>
              <button onClick={fetchLogs} className="p-1 hover:bg-gray-100 rounded-lg text-textMuted">
                <RefreshCw size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1">
              {logs.length === 0 ? (
                <div className="py-12 text-center text-textMuted text-xs">
                  아직 기록된 감지 이력이 없습니다.<br />
                  모니터링을 시작하면 자동으로 기록됩니다.
                </div>
              ) : (
                logs.map((log) => {
                  const cfg = statusConfig[log.status] || statusConfig.safe;
                  const LogIcon = cfg.icon;
                  return (
                    <div 
                      key={log.id} 
                      className={`p-3 rounded-2xl border ${cfg.light} space-y-1 transition-all`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold flex items-center gap-1.5 ${cfg.text}`}>
                          <LogIcon size={14} />
                          {log.status_label}
                        </span>
                        <span className="text-[10px] text-textMuted">
                          {new Date(log.analyzed_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <strong className="text-xs text-textMain dark:text-white">{log.item_name}</strong>
                        <span className="text-xs text-textMuted font-semibold">
                          {log.estimated_quantity.toLocaleString()} {log.unit}
                        </span>
                      </div>
                      <p className="text-[11px] text-textMuted break-keep line-clamp-2">
                        {log.recommendation}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

      </div>

      {/* AI 분석용 품목 레퍼런스 등록 모달 */}
      {showLearnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-5">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center font-bold">
                  <Sparkles size={18} />
                </div>
                <h3 className="font-bold text-lg text-textMain dark:text-white">
                  AI 분석용 품목 레퍼런스 등록
                </h3>
              </div>
              <button
                onClick={() => setShowLearnModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-gray-900">엑셀에서 한 번에 등록</h4>
                    <p className="mt-1 text-[11px] text-gray-600">엑셀의 이미지 파일명과 같은 사진 파일을 함께 선택하세요. 내보낸 파일은 사진 없이 다시 가져올 수 있습니다.</p>
                  </div>
                  <button onClick={downloadWorkbookTemplate} title="엑셀 양식 다운로드" className="shrink-0 p-2 text-emerald-800 hover:bg-emerald-100 rounded-lg"><Download size={16} /></button>
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 cursor-pointer">
                  <FileSpreadsheet size={16} className="text-emerald-700" />
                  <span className="truncate">{importWorkbook?.name || '엑셀 파일 선택 (.xlsx, .xls)'}</span>
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => setImportWorkbook(event.target.files?.[0] || null)} />
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 cursor-pointer">
                  <Upload size={16} className="text-emerald-700" />
                  <span className="truncate">{importImages.length ? `${importImages.length}개 이미지 선택됨` : '엑셀에서 지정한 이미지들 선택'}</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => setImportImages(Array.from(event.target.files || []))} />
                </label>
                <button onClick={handleWorkbookImport} disabled={!importWorkbook || importingWorkbook} className="w-full py-2.5 rounded-lg bg-emerald-700 text-white font-bold disabled:opacity-50">
                  {importingWorkbook ? '검증 및 저장 중...' : '엑셀 데이터 일괄 등록'}
                </button>
              </section>

              <div>
                <label className="font-bold text-textMain dark:text-gray-200 block mb-1">
                  품목 라벨명 (예: 갈치, 고등어, 우럭) *
                </label>
                <input
                  type="text"
                  placeholder="예: 제주 은갈치"
                  value={learnName}
                  onChange={(e) => setLearnName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
              </div>

              <div>
                <label className="font-bold text-textMain dark:text-gray-200 block mb-1">
                  품목 특징 및 설명 (선택)
                </label>
                <input
                  type="text"
                  placeholder="예: 은색 비늘 반짝임, 박스 포장 형태"
                  value={learnDesc}
                  onChange={(e) => setLearnDesc(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
              </div>

              <div>
                <label className="font-bold text-textMain dark:text-gray-200 block mb-1">
                  분석 기준 레퍼런스 이미지 등록 *
                </label>
                <div className="flex gap-2 mb-2">
                  <label className="flex-1 cursor-pointer bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-bold py-2.5 px-4 rounded-xl text-center flex items-center justify-center gap-2 border border-purple-200 dark:border-purple-800 transition-all">
                    <Upload size={16} />
                    사진 파일 업로드
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageFileChange}
                      className="hidden"
                    />
                  </label>
                  {isMonitoring && (
                    <button
                      onClick={handleCaptureForLearn}
                      className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-textMain dark:text-gray-200 font-semibold py-2.5 px-4 rounded-xl flex items-center gap-1.5"
                    >
                      <Camera size={16} />
                      현재 화면 캡처
                    </button>
                  )}
                </div>

                {learnImage ? (
                  <div className="relative rounded-2xl overflow-hidden aspect-video border border-purple-300">
                    <img src={learnImage} alt="분석 기준 이미지" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setLearnImage(null)}
                      className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full hover:bg-black"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-6 text-center text-textMuted">
                    사진을 업로드하거나 현재 카메라 화면을 캡처하여 다음 AI 분석의 비교 기준으로 등록하세요.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setShowLearnModal(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSaveReference}
                disabled={savingReference || !learnName || !learnImage}
                className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                <Sparkles size={14} />
                {savingReference ? '레퍼런스 저장 중...' : '분석 기준 이미지 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
