'use client';

import { useCallback, useEffect, useState } from 'react';

export type BarcodeMode = 'generated' | 'custom';
const STORAGE_KEY = 'wms_barcode_mode';

// 브라우저별 설정. generated: 시스템이 코드를 만들어 줌, custom: 기존 바코드를 직접 등록.
export function useBarcodeMode(): [BarcodeMode, (mode: BarcodeMode) => void] {
  const [mode, setModeState] = useState<BarcodeMode>('generated');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'generated' || stored === 'custom') setModeState(stored);
  }, []);

  const setMode = useCallback((next: BarcodeMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  return [mode, setMode];
}
