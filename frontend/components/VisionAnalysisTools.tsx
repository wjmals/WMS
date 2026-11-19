'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, Check, ImageUp, ScanEye, X } from 'lucide-react';
import { normalizeApiNumbers } from '../lib/normalizeApiNumbers';
import { formatQty } from '../lib/formatQuantity';

type InventoryChoice = { id: string; name: string; unit: string; current: number };
type VisualFeatures = {
  objects: string[];
  colors: string[];
  shapesAndEdges: string[];
  text: string[];
  logos: string[];
  description: string;
  quantityBasis: string;
};
type VisionEstimate = {
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
  visualFeatures: VisualFeatures;
  imageSnapshot?: string | null;
};
type AnalysisResult = Omit<VisionEstimate, 'id' | 'inventoryItemId' | 'submittedEmail' | 'createdAt' | 'imageSnapshot'> & {
  estimateId: string;
  statusLabel: string;
  model: string;
  reviewStatus: string;
};

async function prepareImage(file: File): Promise<string> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지를 준비하지 못했습니다.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function FeatureList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <dt className="font-semibold text-gray-700 dark:text-gray-300">{label}</dt>
      <dd className="mt-1 flex flex-wrap gap-1.5">
        {values.map((value, index) => (
          <span key={`${value}-${index}`} className="rounded-full bg-gray-100 px-2 py-1 text-[11px] dark:bg-gray-800">{value}</span>
        ))}
      </dd>
    </div>
  );
}

export default function VisionAnalysisTools({
  warehouseId,
  role,
  onChanged,
}: {
  warehouseId?: string;
  role?: string;
  onChanged: () => void;
}) {
  const [inventory, setInventory] = useState<InventoryChoice[]>([]);
  const [pending, setPending] = useState<VisionEstimate[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [reviewItemIds, setReviewItemIds] = useState<Record<string, string>>({});
  const [estimateImages, setEstimateImages] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageData, setImageData] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewingId, setReviewingId] = useState('');
  const [error, setError] = useState('');
  const canReview = role === '관리자' || role === '서버 관리자';
  const effectiveWarehouseId = warehouseId || 'wh_wjmals';

  const refreshPending = useCallback(async () => {
    const response = await fetch(`/api/vision/estimates?warehouseId=${encodeURIComponent(effectiveWarehouseId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '비전 검토 대기를 불러오지 못했습니다.');
    setPending(normalizeApiNumbers(Array.isArray(data) ? data : []));
  }, [effectiveWarehouseId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [inventoryResponse] = await Promise.all([
          fetch(`/api/inventory?warehouseId=${encodeURIComponent(effectiveWarehouseId)}`, { cache: 'no-store' }),
          refreshPending(),
        ]);
        if (!inventoryResponse.ok) throw new Error('재고 품목을 불러오지 못했습니다.');
        const items = await inventoryResponse.json();
        if (active) setInventory(normalizeApiNumbers(Array.isArray(items) ? items : []));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : '비전 분석 데이터를 불러오지 못했습니다.');
      }
    };
    void load();
    return () => { active = false; };
  }, [effectiveWarehouseId, refreshPending]);

  const selectedItem = useMemo(
    () => inventory.find((item) => item.id === selectedItemId),
    [inventory, selectedItemId],
  );

  const handleImage = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일을 선택해주세요.');
      return;
    }
    setError('');
    setResult(null);
    try {
      const prepared = await prepareImage(file);
      setImageData(prepared);
      setPreviewUrl(prepared);
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : '이미지를 읽지 못했습니다.');
    }
  };

  const analyze = async () => {
    if (!imageData) {
      setError('카메라로 촬영하거나 분석할 이미지를 선택해주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageData,
          itemName: selectedItem?.name,
          warehouseId: effectiveWarehouseId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '이미지 분석에 실패했습니다.');
      setResult(normalizeApiNumbers(data));
      await refreshPending();
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : '이미지 분석 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const review = async (estimate: VisionEstimate, approve: boolean) => {
    const inventoryItemId = reviewItemIds[estimate.id] || estimate.inventoryItemId || '';
    if (approve && !inventoryItemId) {
      setError('추정 수량을 반영할 재고 품목을 선택해주세요.');
      return;
    }
    setReviewingId(estimate.id);
    setError('');
    try {
      const response = await fetch('/api/vision/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: estimate.id,
          approve,
          inventoryItemId: approve ? inventoryItemId : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '비전 추정 검토를 완료하지 못했습니다.');
      await refreshPending();
      if (approve) onChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '비전 추정 검토 중 오류가 발생했습니다.');
    } finally {
      setReviewingId('');
    }
  };

  const showEstimateImage = async (estimate: VisionEstimate) => {
    if (estimateImages[estimate.id]) return;
    try {
      const params = new URLSearchParams({ id: estimate.id, warehouseId: effectiveWarehouseId });
      const response = await fetch(`/api/vision/estimate?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '분석 사진을 불러오지 못했습니다.');
      if (!data.imageSnapshot) throw new Error('저장된 분석 사진이 없습니다.');
      setEstimateImages((current) => ({ ...current, [estimate.id]: data.imageSnapshot }));
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : '분석 사진을 불러오지 못했습니다.');
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm dark:border-violet-900/60 dark:bg-gray-900">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-100 p-2 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"><ScanEye className="h-5 w-5" /></div>
        <div>
          <h2 className="font-bold text-gray-900 dark:text-white">비전 이미지 분석</h2>
          <p className="mt-1 text-xs leading-relaxed text-textMuted">
            사진에서 물체·색상·형태/모서리·문자·로고를 구조화해 추정합니다. 분석 이미지가 Groq 비전 모델로 전송되며, 추정 수량은 관리자가 승인하기 전까지 재고에 반영되지 않습니다.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          <button onClick={() => setError('')} aria-label="오류 닫기" className="ml-auto"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-800">
              <Camera className="h-4 w-4" />카메라 촬영
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => void handleImage(event.target.files?.[0])} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold dark:border-gray-700">
              <ImageUp className="h-4 w-4" />사진 선택
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => void handleImage(event.target.files?.[0])} />
            </label>
          </div>
          {previewUrl && <img src={previewUrl} alt="비전 분석 대상 미리보기" className="max-h-64 w-full rounded-xl border border-gray-200 object-contain dark:border-gray-700" />}
          <label className="block text-xs font-semibold text-textMuted">
            분석할 품목(선택)
            <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
              <option value="">사진에서 품목 식별</option>
              {inventory.map((item) => <option key={item.id} value={item.id}>{item.name} · 현재 {formatQty(item.current)} {item.unit}</option>)}
            </select>
          </label>
          <button onClick={() => void analyze()} disabled={busy || !imageData} className="w-full rounded-lg bg-violet-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
            {busy ? '사진 분석 중...' : '비전 분석 및 검토 대기 등록'}
          </button>
        </div>

        {result ? (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-xs dark:border-violet-900 dark:bg-violet-950/20">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-[10px] text-textMuted">모델 추정 · 승인 대기</p><h3 className="mt-1 text-base font-bold">{result.itemName}</h3></div>
              <span className="rounded-full bg-violet-200 px-2 py-1 font-bold text-violet-900 dark:bg-violet-900 dark:text-violet-100">신뢰도 {result.confidence}%</span>
            </div>
            <p>추정 수량: <strong>{formatQty(result.estimatedQuantity)} {result.unit}</strong> · {result.statusLabel}</p>
            <p className="text-textMuted">{result.reason}</p>
            <dl className="space-y-2 border-t border-violet-200 pt-3 dark:border-violet-900">
              <FeatureList label="물체·포장" values={result.visualFeatures.objects} />
              <FeatureList label="주요 색상" values={result.visualFeatures.colors} />
              <FeatureList label="형태·모서리" values={result.visualFeatures.shapesAndEdges} />
              <FeatureList label="읽힌 문자" values={result.visualFeatures.text} />
              <FeatureList label="로고·브랜드" values={result.visualFeatures.logos} />
            </dl>
            <p>{result.visualFeatures.description}</p>
            <p className="text-textMuted">수량 근거: {result.visualFeatures.quantityBasis}</p>
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-gray-300 p-5 text-center text-xs text-textMuted dark:border-gray-700">
            사진을 올리면 물체와 시각 특징을 항목별 데이터로 분석합니다.
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">검토 대기 추정치 ({pending.length})</h3>
          <button onClick={() => void refreshPending().catch((refreshError: unknown) => setError(refreshError instanceof Error ? refreshError.message : '검토 목록을 새로고침하지 못했습니다.'))} className="text-xs font-semibold text-violet-700 underline dark:text-violet-300">새로고침</button>
        </div>
        {pending.length === 0 ? <p className="rounded-lg bg-gray-50 p-4 text-center text-xs text-textMuted dark:bg-gray-800/50">검토 대기 중인 추정치가 없습니다.</p> : (
          <div className="space-y-3">
            {pending.map((estimate) => (
              <article key={estimate.id} className="grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-[120px_minmax(0,1fr)] dark:border-gray-700">
                {estimateImages[estimate.id] ? (
                  <img src={estimateImages[estimate.id]} alt={`${estimate.itemName} 분석 이미지`} className="h-28 w-full rounded-lg bg-gray-50 object-contain dark:bg-gray-800" />
                ) : (
                  <button onClick={() => void showEstimateImage(estimate)} className="flex h-28 items-center justify-center gap-1 rounded-lg bg-gray-50 text-xs font-semibold text-violet-700 dark:bg-gray-800 dark:text-violet-300">
                    <ImageUp className="h-4 w-4" />분석 사진 보기
                  </button>
                )}
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{estimate.itemName} · {formatQty(estimate.estimatedQuantity)} {estimate.unit}</strong>
                    <span className="text-[11px] text-textMuted">신뢰도 {estimate.confidence}% · {estimate.submittedEmail}</span>
                  </div>
                  <p className="text-xs text-textMuted">{estimate.reason}</p>
                  <div className="flex flex-wrap gap-1">{estimate.visualFeatures?.objects?.map((value, index) => <span key={`${value}-${index}`} className="rounded-full bg-gray-100 px-2 py-1 text-[10px] dark:bg-gray-800">{value}</span>)}</div>
                  {canReview && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={reviewItemIds[estimate.id] || estimate.inventoryItemId || ''} onChange={(event) => setReviewItemIds((current) => ({ ...current, [estimate.id]: event.target.value }))} className="min-w-48 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-800">
                        <option value="">반영할 품목 선택</option>
                        {inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
                      </select>
                      <button disabled={reviewingId === estimate.id} onClick={() => void review(estimate, true)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />재고 반영</button>
                      <button disabled={reviewingId === estimate.id} onClick={() => void review(estimate, false)} className="inline-flex items-center gap-1 rounded-lg bg-gray-200 px-3 py-2 text-xs font-bold text-gray-800 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-100"><X className="h-3.5 w-3.5" />반려</button>
                    </div>
                  )}
                  {!canReview && <p className="text-[11px] text-amber-700 dark:text-amber-300">창고 관리자 승인 전에는 재고에 반영되지 않습니다.</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
