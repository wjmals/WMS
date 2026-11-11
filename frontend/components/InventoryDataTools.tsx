"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { AlertTriangle, Check, Download, Eye, FileSpreadsheet, Pencil, RefreshCw, Save, Sparkles, Upload, X } from 'lucide-react';
import { normalizeApiNumbers } from '../lib/normalizeApiNumbers';
import { formatQty } from '../lib/formatQuantity';

type InventoryChoice = { id: string; name: string; barcode?: string | null; current: number; unit: string; packageUnit: string | null; packageSize?: number; palletUnit?: string | null; palletSize?: number; safe: number; statusLabel?: string };
type ImportBatch = { id: string; sourceName: string; submittedEmail: string; rowCount: number; status: string; createdAt: string; reviewNote: string };
type LedgerRow = { id: string; itemName: string; movementType: string; quantityDelta: number; balanceAfter: number; reason: string; source: string; operator: string | null; occurredAt: string };
type Props = { warehouseId?: string; role?: string; inventoryRevision?: number; onChanged?: () => void };
type PreviewRow = { itemName: string; occurredAt: string; movementType: string; quantityDelta: number; note: string; reference: string };
type PreviewData = { newItems: Array<{ name: string; barcode: string | null; unit: string; current: number; safe: number }>; rows: PreviewRow[] };
type SheetRow = Record<string, ExcelJS.CellValue>;

const rustApi = '/api/inventory';
const SYSTEM_OPERATOR = '시스템';
const MOVEMENT_LABELS: Record<string, string> = { initial: '기초재고', inbound: '입고', outbound: '출고', adjustment: '조정', vision_estimate: '비전추정' };
const SOURCE_OPTIONS: Array<[string, string]> = [
  ['', '전체 출처'], ['barcode', '바코드 화면'], ['manual', '직접 입력'], ['historical_import', '과거 거래 가져오기'],
  ['groq_vision_approved', '비전 추정 승인'], ['archive', '품목 삭제'], ['safety_stock', '안전재고'],
];
const TYPE_ALIASES: Record<string, string> = {
  입고: 'inbound', 출고: 'outbound', 조정: 'adjustment', 실사: 'adjustment', 재고조정: 'adjustment',
  기초재고: 'initial', 기초: 'initial', 초기재고: 'initial', 초기: 'initial',
  비전추정: 'vision_estimate', 비전: 'vision_estimate',
};

const normalizeKey = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/^'+/, '').toLocaleLowerCase().replace(/[\s_\-./()[\]]+/g, '');
const sourceLabel = (source: string) => {
  const base = source.split(':')[0];
  return SOURCE_OPTIONS.find(([value]) => value && value === base)?.[1] || source;
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object' || value instanceof Date) return String(value);
  const cell = value as { text?: unknown; richText?: Array<{ text?: string }>; result?: unknown };
  if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text || '').join('');
  if (typeof cell.text === 'string') return cell.text;
  if (cell.result !== undefined) return cellText(cell.result as ExcelJS.CellValue);
  return '';
}

async function saveWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function styleHeader(row: ExcelJS.Row, color = 'FF1E3A8A') {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
}

export default function InventoryDataTools({ warehouseId = 'wh_wjmals', role = '', inventoryRevision = 0, onChanged }: Props) {
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [items, setItems] = useState<InventoryChoice[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [inventoryLoadError, setInventoryLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [knownOperators, setKnownOperators] = useState<string[]>([]);
  const [filterItem, setFilterItem] = useState('');
  const [filterOperator, setFilterOperator] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterType, setFilterType] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const [bulkFailures, setBulkFailures] = useState<Array<{ name: string; error: string }>>([]);
  const loadedWarehouseIdRef = useRef<string | null>(null);
  const [editingSafeItem, setEditingSafeItem] = useState<string | null>(null);
  const [safeDraft, setSafeDraft] = useState('');
  const canReview = role === '관리자' || role === '서버 관리자';
  const pendingBatches = batches.filter((batch) => batch.status === 'PENDING');
  const unsetItems = items.filter((item) => item.safe <= 0);

  const ledgerUrl = useCallback((limit: number) => {
    const params = new URLSearchParams({ warehouseId, limit: String(limit) });
    if (filterItem.trim()) params.set('item', filterItem.trim());
    if (filterOperator.trim()) params.set('operator', filterOperator.trim());
    if (filterSource) params.set('source', filterSource);
    if (filterType) params.set('movementType', filterType);
    return `${rustApi}/ledger?${params.toString()}`;
  }, [warehouseId, filterItem, filterOperator, filterSource, filterType]);

  const loadLedger = useCallback(async () => {
    const response = await fetch(ledgerUrl(filterItem.trim() ? 20000 : 2000));
    const data = await response.json();
    if (!Array.isArray(data)) return;
    const rows: LedgerRow[] = normalizeApiNumbers(data);
    setLedger(rows);
    setKnownOperators((current) => Array.from(new Set([...current, ...rows.map((row) => row.operator || SYSTEM_OPERATOR)])).sort());
  }, [ledgerUrl]);

  const refresh = useCallback(async () => {
    const warehouse = encodeURIComponent(warehouseId);
    if (loadedWarehouseIdRef.current !== warehouseId) {
      setInventoryLoaded(false);
      setItems([]);
    }
    setRefreshing(true);
    try {
      const [itemResponse, batchResponse] = await Promise.all([
        fetch(`/api/inventory?warehouseId=${warehouse}`),
        fetch(`${rustApi}/imports?warehouseId=${warehouse}`),
      ]);
      if (!itemResponse.ok) throw new Error('현재 창고 품목 목록을 불러오지 못했습니다. 로그인과 창고 권한을 확인하세요.');
      const [itemData, batchData] = await Promise.all([itemResponse.json(), batchResponse.json()]);
      if (!Array.isArray(itemData)) throw new Error('현재 창고 품목 목록 응답이 올바르지 않습니다.');
      setItems(normalizeApiNumbers(itemData));
      loadedWarehouseIdRef.current = warehouseId;
      setInventoryLoadError('');
      if (Array.isArray(batchData)) setBatches(batchData);
      await loadLedger();
    } catch (error) {
      setInventoryLoadError(error instanceof Error ? error.message : '현재 창고 품목 목록을 불러오지 못했습니다.');
      throw error;
    } finally {
      setInventoryLoaded(true);
      setRefreshing(false);
    }
  }, [warehouseId, loadLedger]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const togglePreview = async (batch: ImportBatch) => {
    if (previewBatchId === batch.id) {
      setPreviewBatchId(null);
      setPreview(null);
      return;
    }
    setPreviewBatchId(batch.id);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const response = await fetch(`${rustApi}/imports/rows?batchId=${encodeURIComponent(batch.id)}`);
      const text = await response.text();
      let data: (PreviewData & { error?: string }) | null = null;
      try { data = JSON.parse(text); } catch { /* 서버가 문자열 오류를 보낸 경우 */ }
      if (!response.ok || !data) throw new Error(data?.error || text.trim() || '가져오기 내용을 불러오지 못했습니다.');
      setPreview(normalizeApiNumbers(data));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '가져오기 내용을 불러오지 못했습니다.');
      setPreviewBatchId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadPreview = async (batch: ImportBatch) => {
    if (!preview) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('가져오기 내용');
    sheet.columns = [
      { header: '거래일시', width: 20 }, { header: '품목명', width: 28 }, { header: '유형', width: 12 },
      { header: '수량(기본 단위)', width: 16 }, { header: '사유', width: 36 }, { header: '참조번호', width: 16 },
    ];
    styleHeader(sheet.getRow(1));
    preview.rows.forEach((row) => {
      const added = sheet.addRow([new Date(row.occurredAt), row.itemName, MOVEMENT_LABELS[row.movementType] || row.movementType, row.quantityDelta, row.note, row.reference]);
      added.getCell(1).numFmt = 'yyyy-mm-dd hh:mm';
      added.getCell(4).numFmt = '#,##0.##;[Red]-#,##0.##';
    });
    await saveWorkbook(workbook, `${batch.sourceName.replace(/\.xlsx$/i, '')}-검토본.xlsx`);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setNotice('재고 장부를 불러오지 못했습니다.'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [refresh, inventoryRevision]);

  const downloadTemplate = async () => {
    if (!inventoryLoaded || inventoryLoadError) {
      setNotice(inventoryLoadError || '현재 창고의 품목을 불러온 뒤 양식을 다운로드할 수 있습니다.');
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('거래입력', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: '거래일시', key: 'date', width: 20 },
      { header: '품목명', key: 'name', width: 28 },
      { header: '바코드', key: 'barcode', width: 20 },
      { header: '유형', key: 'type', width: 12 },
      { header: '수량', key: 'quantity', width: 12 },
      { header: '단위', key: 'unit', width: 10 },
      { header: '사유', key: 'note', width: 32 },
      { header: '참조번호', key: 'reference', width: 16 },
    ];
    styleHeader(sheet.getRow(1));
    for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
      sheet.getCell(`A${rowNumber}`).numFmt = 'yyyy-mm-dd hh:mm';
      sheet.getCell(`D${rowNumber}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"기초재고,입고,출고,조정,비전추정"'], showErrorMessage: true, errorTitle: '유형 오류', error: '목록에서 선택하세요.' };
      sheet.getCell(`E${rowNumber}`).numFmt = '#,##0.##';
    }

    const itemSheet = workbook.addWorksheet('품목목록');
    itemSheet.columns = [
      { header: '품목명', width: 28 }, { header: '바코드', width: 20 }, { header: '기본 단위', width: 10 },
      { header: '박스 단위', width: 10 }, { header: '박스당 수량', width: 12 }, { header: '파렛트 단위', width: 12 }, { header: '파렛트당 수량', width: 14 }, { header: '현재 재고', width: 12 },
    ];
    styleHeader(itemSheet.getRow(1), 'FF047857');
    items.forEach((item) => itemSheet.addRow([item.name, item.barcode || '', item.unit, item.packageUnit || '', item.packageUnit ? item.packageSize : '', item.palletUnit || '', item.palletUnit ? item.palletSize : '', item.current]));
    itemSheet.views = [{ state: 'frozen', ySplit: 1 }];

    const guide = workbook.addWorksheet('작성방법');
    guide.getColumn(1).width = 16;
    guide.getColumn(2).width = 80;
    const guideRows: Array<[string, string]> = [
      ['시트 구성', '[거래입력] 시트에 한 줄에 거래 1건을 입력합니다. [품목목록]·[작성방법]은 참고용이며 업로드되지 않습니다.'],
      ['거래일시', '2026-01-15 또는 2026-01-15 09:00 형식. 오늘 이후 날짜는 불가.'],
      ['품목명', '[품목목록]의 이름과 같게 입력합니다. 신규 품목은 자동 등록되며 기초재고가 없으면 0부터 계산합니다.'],
      ['유형', '기초재고 / 입고 / 출고 / 조정 / 비전추정 중 선택. 입고·출고는 양수로 입력, 조정·비전추정은 증가(+)/감소(-) 부호를 그대로 입력합니다.'],
      ['수량', '0은 입력하지 마세요(자동 제외). 소수는 둘째 자리까지 권장합니다.'],
      ['단위', '비우면 품목의 기본 단위(ea)로 처리합니다. 박스/파렛트 단위를 쓰면 등록된 환산값으로 ea로 계산됩니다.'],
      ['사유', '필수. 예: 정기 입고, 주문 출고, 실사 보정.'],
      ['승인', '업로드한 내용은 창고 관리자가 승인한 뒤에야 재고와 장부에 반영됩니다.'],
      ['예시', '2026-01-15 09:00 | 고등어 | | 입고 | 3 | 박스 | 정기 입고 | 전표-001'],
    ];
    guideRows.forEach((row, index) => {
      const added = guide.addRow(row);
      added.getCell(1).font = { bold: true };
      added.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      if (index === 0) added.height = 32;
    });
    await saveWorkbook(workbook, 'wms-거래입력-양식.xlsx');
  };

  const downloadLedger = async () => {
    setBusy(true);
    try {
      const response = await fetch(ledgerUrl(20000));
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error(data?.error || '장부를 불러오지 못했습니다.');
      const rows: LedgerRow[] = normalizeApiNumbers(data);
      if (rows.length === 0) {
        setNotice('내보낼 장부 기록이 없습니다.');
        return;
      }
      const unitByName = new Map(items.map((item) => [normalizeKey(item.name), item.unit]));
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('재고변동기록', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = [
        { header: '거래일시', key: 'date', width: 20 },
        { header: '품목명', key: 'name', width: 28 },
        { header: '유형', key: 'type', width: 12 },
        { header: '수량', key: 'delta', width: 12 },
        { header: '단위', key: 'unit', width: 10 },
        { header: '변동 후 재고', key: 'balance', width: 14 },
        { header: '담당자', key: 'operator', width: 28 },
        { header: '출처', key: 'source', width: 20 },
        { header: '사유', key: 'reason', width: 48 },
      ];
      styleHeader(sheet.getRow(1));
      rows.forEach((row) => {
        const added = sheet.addRow({
          date: new Date(row.occurredAt),
          name: row.itemName,
          type: MOVEMENT_LABELS[row.movementType] || row.movementType,
          delta: row.quantityDelta,
          unit: unitByName.get(normalizeKey(row.itemName)) || '',
          balance: row.balanceAfter,
          operator: row.operator || SYSTEM_OPERATOR,
          source: sourceLabel(row.source),
          reason: row.reason,
        });
        added.getCell('date').numFmt = 'yyyy-mm-dd hh:mm';
        added.getCell('delta').numFmt = '#,##0.##;[Red]-#,##0.##';
        added.getCell('balance').numFmt = '#,##0.##';
        added.getCell('reason').alignment = { wrapText: true, vertical: 'top' };
      });
      sheet.autoFilter = { from: 'A1', to: 'I1' };
      await saveWorkbook(workbook, `wms-재고변동기록-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setNotice(`재고 변동 기록 ${rows.length.toLocaleString()}건을 엑셀로 저장했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '엑셀 파일을 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const parseDate = (value: ExcelJS.CellValue): string => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString();
    const date = new Date(String(value ?? '').trim());
    if (Number.isNaN(date.getTime())) throw new Error(`거래일시를 해석할 수 없습니다: ${String(value ?? '')}`);
    return date.toISOString();
  };

  const importWorkbook = async () => {
    if (!file) return;
    setBusy(true);
    setNotice('');
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('엑셀 첫 시트를 찾을 수 없습니다.');
      const headerValues = sheet.getRow(1).values as ExcelJS.CellValue[];
      const headers = headerValues.slice(1).map((value) => normalizeKey(cellText(value)));
      const records: SheetRow[] = [];
      const rowNumbers: number[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const record: SheetRow = {};
        headers.forEach((header, columnIndex) => {
          if (header) record[header] = row.getCell(columnIndex + 1).value;
        });
        if (Object.values(record).some((value) => value !== null && value !== undefined && String(value).trim() !== "")) {
          records.push(record);
          rowNumbers.push(rowNumber);
        }
      });
      if (records.length === 0 || records.length > 5000) throw new Error('거래 데이터는 1~5,000행이어야 합니다.');
      const find = (record: SheetRow, ...aliases: string[]) => {
        for (const alias of aliases) {
          const key = normalizeKey(alias);
          if (record[key] !== undefined) return record[key];
        }
        return undefined;
      };
      const itemUnits = new Map<string, { unit: string; conversions: Map<string, number> }>();
      const itemSheet = workbook.getWorksheet('품목목록');
      if (itemSheet) {
        const itemHeaders = (itemSheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((value) => normalizeKey(cellText(value)));
        itemSheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const record: SheetRow = {};
          itemHeaders.forEach((header, columnIndex) => { if (header) record[header] = row.getCell(columnIndex + 1).value; });
          const name = cellText(find(record, '품목명', 'itemName', 'name')).trim();
          const unit = cellText(find(record, '기본 단위', 'baseUnit', 'unit')).trim();
          if (!name || !unit) return;
          const conversions = new Map<string, number>();
          for (const [unitValue, sizeValue] of [
            [find(record, '박스 단위', 'packageUnit'), find(record, '박스당 수량', 'packageSize')],
            [find(record, '파렛트 단위', 'palletUnit'), find(record, '파렛트당 수량', 'palletSize')],
          ]) {
            const convertedUnit = cellText(unitValue).trim();
            const size = Number(cellText(sizeValue).replaceAll(',', '').trim());
            if (convertedUnit && Number.isFinite(size) && size > 0) conversions.set(normalizeKey(convertedUnit), size);
          }
          itemUnits.set(normalizeKey(name), { unit, conversions });
        });
      }
      const parseEntry = (record: SheetRow, index: number) => {
        const id = cellText(find(record, 'inventoryItemId', 'inventory_item_id', 'inventoryId', 'itemId', 'id', '품목 ID', '품목코드', '상품코드'));
        const name = cellText(find(record, 'itemName', 'productName', 'name', 'item', '품목명', '상품명', '품목'));
        const barcode = cellText(find(record, 'barcode', 'sku', 'productCode', '바코드', '상품바코드'));
        const rawType = cellText(find(record, 'movementType', 'movement_type', 'type', '유형', '변동유형')).trim().toLowerCase().replace(/[\s-]+/g, '_');
        const movementType = TYPE_ALIASES[rawType.replace(/_/g, '')] || rawType;
        const rawQuantity = cellText(find(record, 'quantity', '수량', 'quantityDelta', '변동수량', '증감')).replaceAll(',', '').trim();
        const quantity = Number(rawQuantity);
        if (!rawQuantity || !Number.isFinite(quantity)) {
          throw new Error(`${rowNumbers[index]}행: 수량은 유효한 숫자여야 합니다.`);
        }
        return { id, name, barcode, movementType, quantity, record, index };
      };
      const entries = records.map(parseEntry);
      const findExistingItem = (entry: (typeof entries)[number]) => items.find((choice) =>
        (entry.id && normalizeKey(choice.id) === normalizeKey(entry.id))
        || (entry.name && normalizeKey(choice.name) === normalizeKey(entry.name))
        || (entry.barcode && choice.barcode && normalizeKey(choice.barcode) === normalizeKey(entry.barcode))
      );
      const seedItems = new Map<string, { name: string; current: number; safe: number; unit: string; barcode?: string }>();
      for (const entry of entries) {
        if (entry.movementType !== 'initial' || findExistingItem(entry)) continue;
        if (!entry.name) throw new Error(`${rowNumbers[entry.index]}행: 기초재고 행에는 신규 품목명이 필요합니다.`);
        if (entry.quantity < 0) throw new Error(`${rowNumbers[entry.index]}행: 기초재고 수량은 음수일 수 없습니다.`);
        const key = normalizeKey(entry.name);
        if (seedItems.has(key)) throw new Error(`${rowNumbers[entry.index]}행: '${entry.name}'의 기초재고 행이 중복되었습니다.`);
        const unitInfo = itemUnits.get(key);
        const unit = unitInfo?.unit || cellText(find(entry.record, 'quantityUnit', 'unit', '단위')).trim() || 'ea';
        const enteredUnit = cellText(find(entry.record, 'quantityUnit', 'unit', '단위')).trim() || unit;
        const multiplier = normalizeKey(enteredUnit) === normalizeKey(unit) ? 1 : unitInfo?.conversions.get(normalizeKey(enteredUnit));
        if (!multiplier) throw new Error(`${rowNumbers[entry.index]}행: '${entry.name}'의 단위 '${enteredUnit}'를 '${unit}'로 환산할 수 없습니다. 품목목록의 환산 수량을 확인하세요.`);
        seedItems.set(key, { name: entry.name.trim(), current: entry.quantity * multiplier, safe: 0, unit, barcode: entry.barcode || undefined });
      }

      for (const entry of entries) {
        if (entry.movementType === 'initial' || entry.quantity === 0 || findExistingItem(entry)) continue;
        if (!entry.name) throw new Error(`${rowNumbers[entry.index]}행: 신규 품목명이 필요합니다.`);
        const key = normalizeKey(entry.name);
        if (seedItems.has(key)) continue;
        const unit = itemUnits.get(key)?.unit || cellText(find(entry.record, 'quantityUnit', 'unit', '단위')).trim() || 'ea';
        seedItems.set(key, { name: entry.name.trim(), current: 0, safe: 0, unit, barcode: entry.barcode || undefined });
      }

      const payloadRows: Array<Record<string, unknown>> = [];
      let skippedZeroRows = 0;
      let visionRows = 0;
      for (const entry of entries) {
        if (entry.movementType === 'initial') continue;
        if (!['inbound', 'outbound', 'adjustment', 'vision_estimate'].includes(entry.movementType)) {
          throw new Error(`${rowNumbers[entry.index]}행: 유형은 기초재고, 입고, 출고, 조정, 비전추정 중 하나여야 합니다.`);
        }
        if (entry.quantity === 0) {
          skippedZeroRows += 1;
          continue;
        }
        if (entry.movementType === 'inbound' || entry.movementType === 'outbound') {
          entry.quantity = Math.abs(entry.quantity);
        }
        const existing = findExistingItem(entry);
        const seed = entry.name ? seedItems.get(normalizeKey(entry.name)) : undefined;
        if (!existing && !seed) {
          throw new Error(`${rowNumbers[entry.index]}행: '${entry.name || entry.id || entry.barcode || '(품목 정보 없음)'}' 품목이 현재 창고에 없습니다. 신규 품목은 기초재고 행이 필요합니다.`);
        }
        const note = cellText(find(entry.record, 'note', 'reason', '사유', '변동사유')).trim();
        if (!note) throw new Error(`${rowNumbers[entry.index]}행: 거래 사유가 필요합니다.`);
        const occurredAt = find(entry.record, 'occurredAt', 'occurred_at', 'date', '거래일시', '일자');
        let parsedDate: string;
        try {
          parsedDate = parseDate(occurredAt as ExcelJS.CellValue);
        } catch {
          throw new Error(`${rowNumbers[entry.index]}행: 거래일시를 읽을 수 없습니다.`);
        }
        let quantityUnit = cellText(find(entry.record, 'quantityUnit', 'unit', '단위')).trim() || existing?.unit || seed?.unit || 'ea';
        const baseUnit = existing?.unit || seed?.unit;
        const unitInfo = itemUnits.get(normalizeKey(existing?.name || entry.name));
        if (baseUnit && normalizeKey(quantityUnit) === normalizeKey(baseUnit)) {
          quantityUnit = baseUnit;
        } else if (existing?.packageUnit && normalizeKey(quantityUnit) === normalizeKey(existing.packageUnit)) {
          quantityUnit = existing.packageUnit;
        } else if (existing?.palletUnit && normalizeKey(quantityUnit) === normalizeKey(existing.palletUnit)) {
          quantityUnit = existing.palletUnit;
        } else if (baseUnit && unitInfo && normalizeKey(unitInfo.unit) === normalizeKey(baseUnit)) {
          const multiplier = unitInfo.conversions.get(normalizeKey(quantityUnit));
          if (multiplier) {
            entry.quantity *= multiplier;
            quantityUnit = baseUnit;
          }
        }
        if (seed) {
          if (normalizeKey(quantityUnit) !== normalizeKey(seed.unit)) throw new Error(`${rowNumbers[entry.index]}행: '${seed.name}'의 단위 '${quantityUnit}'를 '${seed.unit}'로 환산할 수 없습니다. 품목목록의 환산 수량을 확인하세요.`);
          quantityUnit = seed.unit;
          const delta = entry.movementType === 'outbound' ? -Math.abs(entry.quantity) : entry.quantity;
          seed.current += delta;
          if (seed.current < 0) throw new Error(`${rowNumbers[entry.index]}행: '${seed.name}'의 기초재고와 거래 이력을 계산하면 현재 재고가 음수가 됩니다.`);
        }
        if (entry.movementType === 'vision_estimate') visionRows += 1;
        payloadRows.push({
          sourceRow: rowNumbers[entry.index],
          ...(existing ? { inventoryItemId: existing.id } : { itemName: entry.name }),
          occurredAt: parsedDate,
          movementType: entry.movementType,
          quantity: entry.quantity,
          quantityUnit,
          note,
          reference: cellText(find(entry.record, 'reference', 'document', '참조', '참조번호', '전표번호')).trim(),
        });
      }
      const importPayload = { warehouseId, sourceName: file.name, newItems: Array.from(seedItems.values()), rows: payloadRows };
      const submitImport = (allowDuplicates = false) => fetch(`${rustApi}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...importPayload, allowDuplicates }),
      });
      const readImportResponse = async (response: Response): Promise<{ error?: string; rows?: number; createdItems?: number }> => {
        const responseText = await response.text();
        try {
          return JSON.parse(responseText);
        } catch {
          return { error: responseText.trim() || `서버 응답을 읽지 못했습니다 (${response.status}).` };
        }
      };
      let response = await submitImport();
      let result = await readImportResponse(response);
      const duplicatePrefix = 'DUPLICATE_MOVEMENTS:';
      if (response.status === 409 && result.error?.startsWith(duplicatePrefix)) {
        const duplicates = JSON.parse(result.error.slice(duplicatePrefix.length)) as Array<{ sourceRow: number; itemName: string; occurredAt: string; movementType: string; quantity: string | number }>;
        const summary = duplicates.slice(0, 12).map((duplicate) =>
          `${duplicate.sourceRow}행 · ${duplicate.itemName} · ${new Date(duplicate.occurredAt).toLocaleString('ko-KR')} · ${MOVEMENT_LABELS[duplicate.movementType] || duplicate.movementType} ${formatQty(duplicate.quantity)}`
        ).join('\n');
        const remaining = duplicates.length > 12 ? `\n외 ${duplicates.length - 12}건` : '';
        if (!window.confirm(`이미 등록되었거나 승인 대기 중인 동일 거래 ${duplicates.length}건을 찾았습니다.\n\n${summary}${remaining}\n\n그래도 중복 등록할까요?`)) {
          throw new Error('중복 거래는 등록하지 않았습니다.');
        }
        response = await submitImport(true);
        result = await readImportResponse(response);
      }
      if (!response.ok) throw new Error(result.error || `과거 거래를 제출하지 못했습니다 (${response.status}).`);
      setFile(null);
      await refresh();
      const parts = [];
      if (result.createdItems) parts.push(`신규 품목 ${result.createdItems}개 (안전재고 0)`);
      if (result.rows) parts.push(`거래 ${result.rows}건${visionRows ? ` (비전추정 ${visionRows}건 포함)` : ''}`);
      parts.push('승인 대기로 등록했습니다. 창고 관리자가 승인하면 재고와 장부에 반영됩니다.');
      if (skippedZeroRows) parts.push(`수량 0인 거래 ${skippedZeroRows}건은 변화가 없어 제외했습니다.`);
      setNotice(parts.join(' '));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '엑셀 파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const reviewBatch = async (batch: ImportBatch, approve: boolean) => {
    const note = window.prompt(approve ? '승인 사유를 입력하세요.' : '반려 사유를 입력하세요.', approve ? '기초 거래 확인 완료' : '원본 증빙 재확인 필요');
    if (!note?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${rustApi}/imports/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: batch.id, approve, note }),
      });
      const text = await response.text();
      let result: { error?: string } = {};
      try { result = JSON.parse(text); } catch { result = { error: text.trim() }; }
      if (!response.ok) throw new Error(result.error || '검토 결과를 저장하지 못했습니다.');
      setNotice(approve ? '승인했습니다. 가져온 품목과 거래가 장부에 반영되었습니다. 현재 잔량은 그대로 유지됩니다.' : '반려했습니다. 신규 품목과 거래는 반영되지 않습니다.');
      setPreviewBatchId(null);
      setPreview(null);
      await refresh();
      onChanged?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '검토를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const saveSafeStock = async (item: InventoryChoice) => {
    const safe = Number(safeDraft);
    if (!safeDraft.trim() || !Number.isFinite(safe) || safe <= 0) {
      setNotice('안전재고는 0보다 큰 숫자여야 합니다.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          warehouseId,
          safe,
          safetyStockMode: 'manual',
          movementType: 'adjustment',
          note: '안전재고 기준 설정',
          source: 'manual',
        }),
      });
      const responseText = await response.text();
      let result: InventoryChoice & { error?: string };
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(responseText.trim() || `안전재고 저장 응답을 읽지 못했습니다 (${response.status}).`);
      }
      if (!response.ok) throw new Error(result.error || '안전재고를 저장하지 못했습니다.');
      setEditingSafeItem(null);
      setSafeDraft('');
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...normalizeApiNumbers(result), safe } : entry));
      setNotice(`'${item.name}' 안전재고를 ${formatQty(safe)} ${item.unit}로 저장했습니다.`);
      onChanged?.();
      try {
        await refresh();
      } catch {
        setNotice(`'${item.name}' 안전재고는 저장됐지만 목록 새로고침에 실패했습니다. 새로고침 버튼으로 확인하세요.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '안전재고를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const setAllAutomaticSafetyStock = async () => {
    if (!items.length || busy) return;
    if (!window.confirm(`현재 창고의 ${items.length}개 품목을 자동 안전재고로 전환할까요?\n기존 수동 안전재고도 변경되며, 출고 이력이 부족한 품목은 변경되지 않습니다.`)) return;
    setBusy(true);
    setNotice('');
    setBulkFailures([]);
    setBulkProgress({ completed: 0, total: items.length });
    const failures: Array<{ name: string; error: string }> = [];
    let updated = 0;
    let zeroRecommendations = 0;
    for (const [index, item] of items.entries()) {
      try {
        const response = await fetch(`${rustApi}/safety-stock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, warehouseId, mode: 'auto' }),
        });
        const text = await response.text();
        let result: InventoryChoice & { error?: string };
        try { result = JSON.parse(text); } catch { throw new Error(text.trim() || `서버 응답 오류 (${response.status})`); }
        if (!response.ok) throw new Error(result.error || `자동 계산 실패 (${response.status})`);
        const normalized = normalizeApiNumbers(result);
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...normalized } : entry));
        updated += 1;
        if (normalized.safe <= 0) zeroRecommendations += 1;
      } catch (error) {
        failures.push({ name: item.name, error: error instanceof Error ? error.message : '자동 계산에 실패했습니다.' });
      }
      setBulkProgress({ completed: index + 1, total: items.length });
    }
    setBulkFailures(failures);
    setNotice(`자동 안전재고 전환 ${updated}개 완료${failures.length ? `, ${failures.length}개 실패` : ''}.${zeroRecommendations ? ` 계산값이 0인 ${zeroRecommendations}개 품목은 미설정 목록에 남습니다.` : ''}`);
    if (updated) onChanged?.();
    try {
      await refresh();
    } catch {
      setNotice(`자동 안전재고 전환 ${updated}개 완료, ${failures.length}개 실패. 목록을 다시 불러오지 못했습니다.`);
    } finally {
      setBulkProgress(null);
      setBusy(false);
    }
  };

  const hasLedgerFilter = !!(filterItem || filterOperator || filterSource || filterType);

  // 품목 검색 시 품목·날짜별 입고/출고/조정 합계와 그날 마지막 잔량
  const dailySummary = (() => {
    if (!filterItem.trim()) return [];
    const groups = new Map<string, { date: string; item: string; inbound: number; outbound: number; adjust: number; balance: number }>();
    for (const row of ledger) {
      const date = new Date(row.occurredAt).toLocaleDateString('sv-SE');
      const key = `${date}|${row.itemName}`;
      const entry = groups.get(key) || { date, item: row.itemName, inbound: 0, outbound: 0, adjust: 0, balance: row.balanceAfter };
      if (row.movementType === 'inbound') entry.inbound += row.quantityDelta;
      else if (row.movementType === 'outbound') entry.outbound += -row.quantityDelta;
      else if (row.movementType !== 'initial') entry.adjust += row.quantityDelta;
      groups.set(key, entry);
    }
    return Array.from(groups.values());
  })();

  return (
    <section className="space-y-5 border-y border-gray-200 dark:border-gray-800 py-6 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-primary">Inventory records</p>
          <h2 className="text-xl font-bold text-textMain dark:text-white">과거 거래 가져오기와 감사 장부</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy || !inventoryLoaded || !!inventoryLoadError || items.length === 0} onClick={() => void setAllAutomaticSafetyStock()} className="inline-flex items-center gap-2 rounded border border-primary px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50"><Sparkles size={14} />{bulkProgress ? `자동 계산 ${bulkProgress.completed}/${bulkProgress.total}` : '전체 자동 계산'}</button>
          <button onClick={() => void refresh().catch(() => setNotice('재고 장부를 새로고침하지 못했습니다.'))} title="새로고침" className="p-2 text-textMuted hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void downloadTemplate()} disabled={!inventoryLoaded || !!inventoryLoadError} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"><Download size={14} />엑셀 양식</button>
            <label className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold cursor-pointer">
              <FileSpreadsheet size={14} /> <span className="truncate">{file?.name || '거래 엑셀 선택'}</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </label>
            <button disabled={!file || busy || !inventoryLoaded || !!inventoryLoadError} onClick={() => void importWorkbook()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Upload size={14} />{busy ? '처리 중' : '승인 요청'}</button>
          </div>
          {inventoryLoadError ? <p role="alert" className="text-xs text-red-600">{inventoryLoadError}</p> : !inventoryLoaded ? <p role="status" className="text-xs text-textMuted">현재 창고 품목을 불러오는 중입니다.</p> : items.length === 0 ? <p role="status" className="text-xs text-amber-700">현재 창고에 등록된 품목이 없습니다. 엑셀의 신규 품목은 승인 후 등록됩니다.</p> : null}
          {unsetItems.length > 0 && (
            <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="flex items-center gap-2 font-bold"><AlertTriangle size={15} />안전재고 미설정 품목 {unsetItems.length}개</p>
              <p>안전재고가 0인 품목은 부족/과다 상태 판정이 정확하지 않습니다. 아래에서 기준값을 설정하면 목록에서 사라집니다.</p>
              <ul className="space-y-2">
                {unsetItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-2 dark:border-amber-900">
                    <span className="min-w-0 break-words">{item.name} · 안전재고 {formatQty(item.safe)} {item.unit}</span>
                    {editingSafeItem === item.id ? (
                      <div className="flex items-center gap-1">
                        <input aria-label={`${item.name} 안전재고`} type="number" min="0" step="any" value={safeDraft} onChange={(event) => setSafeDraft(event.target.value)} className="w-28 rounded border border-amber-400 bg-white px-2 py-1 text-gray-900" />
                        <button disabled={busy} onClick={() => void saveSafeStock(item)} title="안전재고 저장" className="p-1.5 text-emerald-800 hover:bg-emerald-100 rounded disabled:opacity-50"><Save size={15} /></button>
                        <button disabled={busy} onClick={() => { setEditingSafeItem(null); setSafeDraft(''); }} title="취소" className="p-1.5 hover:bg-amber-100 rounded"><X size={15} /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingSafeItem(item.id); setSafeDraft(''); }} className="inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-1 font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50"><Pencil size={13} />설정</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs leading-relaxed text-textMuted">엑셀 양식(거래입력 시트)에 입고·출고·조정·비전추정 거래를 적어 올리면 승인 대기로 등록되고, 신규 품목은 유형을 &quot;기초재고&quot;로 한 줄 추가합니다. 신규 품목과 거래 모두 창고 관리자 승인 후에 재고에 반영됩니다.</p>
          {notice && <p role="status" className="flex items-start justify-between gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-primary break-words"><span className="min-w-0">{notice}</span><button onClick={() => setNotice('')} title="닫기" className="shrink-0 opacity-60 hover:opacity-100"><X size={13} /></button></p>}
          {bulkFailures.length > 0 && <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"><p className="font-bold">자동 계산 실패 {bulkFailures.length}개</p><ul className="mt-2 space-y-1">{bulkFailures.map((failure, index) => <li key={`${failure.name}-${index}`} className="break-words">{failure.name}: {failure.error}</li>)}</ul></div>}
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            <h3 className="text-sm font-bold">가져오기 검토 {pendingBatches.length}</h3>
            {pendingBatches.length === 0 ? <p className="text-xs text-textMuted">검토 대기 중인 가져오기가 없습니다.</p> : pendingBatches.map((batch) => (
              <article key={batch.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 py-2 text-xs">
                <div className="min-w-0 break-words"><strong>{batch.sourceName}</strong><span className="ml-2 text-textMuted">{batch.rowCount}건 · 승인 대기 · {batch.submittedEmail}</span></div>
                <div className="flex items-center gap-1">
                  <button onClick={() => void togglePreview(batch)} className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-700 px-2 py-1 font-semibold"><Eye size={13} />{previewBatchId === batch.id ? '내용 닫기' : '내용 확인'}</button>
                  {canReview && <><button disabled={busy} onClick={() => void reviewBatch(batch, true)} title="승인" className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded"><Check size={15} /></button><button disabled={busy} onClick={() => void reviewBatch(batch, false)} title="반려" className="p-1.5 text-red-700 hover:bg-red-50 rounded"><X size={15} /></button></>}
                </div>
                {!canReview && <span className="basis-full text-textMuted">관리자 승인 필요</span>}
                {batch.reviewNote && <p className="basis-full text-textMuted">검토 메모: {batch.reviewNote}</p>}
                {previewBatchId === batch.id && (
                  <div className="basis-full space-y-2 rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                    {previewLoading || !preview ? <p className="text-textMuted">불러오는 중...</p> : (() => {
                      const dates = preview.rows.map((row) => new Date(row.occurredAt).getTime());
                      const range = dates.length ? `${new Date(Math.min(...dates)).toLocaleDateString('ko-KR')} ~ ${new Date(Math.max(...dates)).toLocaleDateString('ko-KR')}` : '-';
                      const perItem = new Map<string, { inbound: number; outbound: number; adjust: number; count: number }>();
                      preview.rows.forEach((row) => {
                        const entry = perItem.get(row.itemName) || { inbound: 0, outbound: 0, adjust: 0, count: 0 };
                        entry.count += 1;
                        if (row.movementType === 'inbound') entry.inbound += row.quantityDelta;
                        else if (row.movementType === 'outbound') entry.outbound += -row.quantityDelta;
                        else entry.adjust += row.quantityDelta;
                        perItem.set(row.itemName, entry);
                      });
                      return (
                        <>
                          <p className="text-textMuted">거래 {preview.rows.length.toLocaleString()}건 · 기간 {range} · 신규 품목 {preview.newItems.length}개</p>
                          {preview.newItems.length > 0 && <p className="break-words"><strong>신규 품목:</strong> {preview.newItems.map((item) => `${item.name}(현재 ${formatQty(item.current)} ${item.unit})`).join(', ')}</p>}
                          <div className="max-h-40 overflow-auto">
                            <table className="w-full text-left"><thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-textMuted"><tr><th className="p-1">품목</th><th className="p-1">건수</th><th className="p-1">입고 합계</th><th className="p-1">출고 합계</th><th className="p-1">조정 합계</th></tr></thead>
                              <tbody>{Array.from(perItem.entries()).map(([name, entry]) => <tr key={name} className="border-t border-gray-100 dark:border-gray-800"><td className="p-1">{name}</td><td className="p-1">{entry.count}</td><td className="p-1 font-mono">{formatQty(entry.inbound)}</td><td className="p-1 font-mono">{formatQty(entry.outbound)}</td><td className="p-1 font-mono">{formatQty(entry.adjust)}</td></tr>)}</tbody></table>
                          </div>
                          <div className="max-h-56 overflow-auto">
                            <table className="w-full min-w-[520px] text-left"><thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-textMuted"><tr><th className="p-1">일시</th><th className="p-1">품목</th><th className="p-1">유형</th><th className="p-1">수량</th><th className="p-1">사유</th></tr></thead>
                              <tbody>{preview.rows.slice(0, 500).map((row, index) => <tr key={index} className="border-t border-gray-100 dark:border-gray-800"><td className="p-1 whitespace-nowrap">{new Date(row.occurredAt).toLocaleDateString('ko-KR')}</td><td className="p-1">{row.itemName}</td><td className="p-1">{MOVEMENT_LABELS[row.movementType] || row.movementType}</td><td className={`p-1 font-mono ${row.quantityDelta < 0 ? 'text-red-600' : ''}`}>{formatQty(row.quantityDelta)}</td><td className="p-1">{row.note}</td></tr>)}</tbody></table>
                          </div>
                          {preview.rows.length > 500 && <p className="text-textMuted">화면에는 앞 500건만 표시합니다. 전체는 엑셀로 확인하세요.</p>}
                          <button onClick={() => void downloadPreview(batch)} className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-700 px-2 py-1 font-semibold"><Download size={13} />전체 내용 엑셀로 보기</button>
                        </>
                      );
                    })()}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold">재고 변동 장부 · 담당자 / 출처 / 사유</h3>
            <button onClick={() => void downloadLedger()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"><Download size={14} />{hasLedgerFilter ? '필터 결과 엑셀 저장' : '전체 기록 엑셀 저장'}</button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
            <input value={filterItem} onChange={(event) => setFilterItem(event.target.value)} list="ledger-items" placeholder="품목 검색/선택" aria-label="품목 검색" className="min-w-0 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2" />
            <datalist id="ledger-items">{items.map((item) => <option key={item.id} value={item.name} />)}</datalist>
            <div className="min-w-0">
              <input value={filterOperator} onChange={(event) => setFilterOperator(event.target.value)} list="ledger-operators" placeholder="담당자 검색/선택" aria-label="담당자 검색 또는 선택" className="w-full min-w-0 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2" />
              <datalist id="ledger-operators">{knownOperators.map((operator) => <option key={operator} value={operator} />)}</datalist>
            </div>
            <select value={filterSource} onChange={(event) => setFilterSource(event.target.value)} aria-label="출처" className="min-w-0 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2">
              {SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={filterType} onChange={(event) => setFilterType(event.target.value)} aria-label="유형" className="min-w-0 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2">
              <option value="">전체 유형</option>
              {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-textMuted">{hasLedgerFilter ? '필터 적용 중 · ' : ''}최근 {ledger.length.toLocaleString()}건 표시 (엑셀 저장은 최대 20,000건){hasLedgerFilter && <button onClick={() => { setFilterItem(''); setFilterOperator(''); setFilterSource(''); setFilterType(''); }} className="ml-2 underline">필터 초기화</button>}</p>
          {dailySummary.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <p className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-1 text-[11px] font-bold">날짜별 입·출고 요약 (반영된 엑셀 가져오기 포함)</p>
              <table className="w-full min-w-[480px] text-left text-xs"><thead className="text-textMuted"><tr><th className="p-2">날짜</th><th className="p-2">품목</th><th className="p-2">입고</th><th className="p-2">출고</th><th className="p-2">조정</th><th className="p-2">당일 마지막 재고</th></tr></thead>
                <tbody>{dailySummary.map((entry) => <tr key={`${entry.date}|${entry.item}`} className="border-t border-gray-100 dark:border-gray-800"><td className="p-2 whitespace-nowrap">{entry.date}</td><td className="p-2">{entry.item}</td><td className="p-2 font-mono text-emerald-700">{entry.inbound ? `+${formatQty(entry.inbound)}` : '-'}</td><td className="p-2 font-mono text-red-600">{entry.outbound ? `-${formatQty(entry.outbound)}` : '-'}</td><td className="p-2 font-mono">{entry.adjust ? formatQty(entry.adjust) : '-'}</td><td className="p-2 font-mono">{formatQty(entry.balance)}</td></tr>)}</tbody></table>
            </div>
          )}
          <div className="max-h-[420px] overflow-auto border border-gray-200 dark:border-gray-800 rounded-lg">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-textMuted"><tr><th className="p-2">일시</th><th className="p-2">품목</th><th className="p-2">유형</th><th className="p-2">증감</th><th className="p-2">잔량</th><th className="p-2">담당자</th><th className="p-2">출처 / 사유</th></tr></thead>
              <tbody>{ledger.slice(0, 1000).map((row) => <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800"><td className="p-2 whitespace-nowrap">{new Date(row.occurredAt).toLocaleString('ko-KR')}</td><td className="p-2">{row.itemName}</td><td className="p-2">{MOVEMENT_LABELS[row.movementType] || row.movementType}</td><td className={`p-2 font-mono ${row.quantityDelta < 0 ? 'text-red-600' : ''}`}>{formatQty(row.quantityDelta)}</td><td className="p-2 font-mono">{formatQty(row.balanceAfter)}</td><td className="p-2">{row.operator || SYSTEM_OPERATOR}</td><td className="p-2"><span className="font-semibold">{sourceLabel(row.source)}</span><span className="block max-w-[260px] truncate text-textMuted" title={row.reason}>{row.reason}</span></td></tr>)}</tbody>
            </table>
            {ledger.length === 0 && <p className="p-5 text-center text-xs text-textMuted">장부 기록이 없습니다.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
