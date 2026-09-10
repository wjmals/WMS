"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Camera, Play, Square, Settings, AlertTriangle, CheckCircle, Package, 
  ArrowLeft, Zap, Clock, Wifi, WifiOff, RefreshCw, Eye, ShieldCheck, Sparkles 
} from 'lucide-react';
import { useRouter } from 'next/navigation';

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
  itemName: string;
  estimatedQuantity: number;
  unit: string;
  status: 'shortage' | 'safe' | 'overstock';
  statusLabel: string;
  confidence: number;
  recommendation: string;
  reason: string;
};

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraMode, setCameraMode] = useState<'webcam' | 'ip'>('webcam');
  const [ipUrl, setIpUrl] = useState('');
  const [itemName, setItemName] = useState('');
  const [intervalSec, setIntervalSec] = useState(30);
  const [showSettings, setShowSettings] = useState(true);
  const [latestResult, setLatestResult] = useState<AnalysisResult | null>(null);
  const [logs, setLogs] = useState<AnalysisLog[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [totalAnalyzed, setTotalAnalyzed] = useState(0);
  const [shortageCount, setShortageCount] = useState(0);

  // 이력 불러오기
  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor');
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 카메라 시작
  const startWebcam = useCallback(async () => {
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
    } catch {
      alert('카메라 권한을 허용해주세요.');
    }
  }, []);

  // 카메라 중지
  const stopWebcam = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setCameraReady(false);
  }, [stream]);

  // 프레임 캡처 + AI 분석
  const captureAndAnalyze = useCallback(async () => {
    if (analyzing) return;
    let imageData: string | null = null;

    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    imageData = canvas.toDataURL('image/jpeg', 0.75);

    if (!imageData) return;

    setAnalyzing(true);
    try {
      const res = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageData,
          itemName,
          cameraUrl: cameraMode === 'ip' ? ipUrl : 'webcam',
        }),
      });
      if (!res.ok) throw new Error('분석 실패');
      const result = await res.json();
      setLatestResult(result);
      setTotalAnalyzed((p) => p + 1);
      if (result.status === 'shortage') setShortageCount((p) => p + 1);
      await fetchLogs();
    } catch (err) {
      console.error('분석 오류:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, cameraMode, itemName, ipUrl, fetchLogs]);

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
  }, [isMonitoring, intervalSec]);

  // 모니터링 시작
  const startMonitoring = useCallback(async () => {
    await startWebcam();
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
          <h1 className="text-3xl font-extrabold tracking-tight text-textMain dark:text-white">
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
          <h3 className="text-3xl font-black text-textMain dark:text-white mt-1">{totalAnalyzed} 회</h3>
          <p className="text-xs text-textMuted mt-1">Groq Vision Llama-4 엔진 적용</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm">
          <span className="text-xs font-bold text-red-500 uppercase">재고 부족 감지 알림</span>
          <h3 className="text-3xl font-black text-red-600 mt-1">{shortageCount} 건</h3>
          <p className="text-xs text-red-500 font-semibold mt-1">감지 시 재고 데이터 자동 갱신</p>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl shadow-sm">
          <span className="text-xs font-bold text-primary uppercase">분석 주기 타이머</span>
          <h3 className="text-3xl font-black text-primary mt-1">
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
                        {latestResult.statusLabel}
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

          {/* 실시간 분석 이력 카드 (MySQL monitor_logs) */}
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

    </div>
  );
}
