"use client";

import { useCallback, useEffect, useState } from 'react';
import ExcelJS from 'exceljs';
import { Check, Download, FileSpreadsheet, RefreshCw, Upload, X } from 'lucide-react';
import { normalizeApiNumbers } from '../lib/normalizeApiNumbers';

type InventoryChoice = { id: string; name: string; unit: string; packageUnit: string | null };
type ImportBatch = { id: string; sourceName: string; submittedEmail: string; rowCount: number; status: string; createdAt: string; reviewNote: string };
type LedgerRow = { id: string; itemName: string; movementType: string; quantityDelta: number; balanceAfter: number; reason: string; source: string; operator: string | null; occurredAt: string };
type Props = { warehouseId?: string; role?: string };

const rustApi = '/api/inventory';

export default function InventoryDataTools({ warehouseId = 'wh_wjmals', role = '' }: Props) {
  const [items, setItems] = useState<InventoryChoice[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const canReview = role === '관리자' || role === '서버 관리자';

  const refresh = useCallback(async () => {
    const warehouse = encodeURIComponent(warehouseId);
    const [itemResponse, batchResponse, ledgerResponse] = await Promise.all([
      fetch(`/api/inventory?warehouseId=${warehouse}`),
      fetch(`${rustApi}/imports?warehouseId=${warehouse}`),
      fetch(`${rustApi}/ledger?warehouseId=${warehouse}&days=12`),
    ]);
    const [itemData, batchData, ledgerData] = await Promise.all([itemResponse.json(), batchResponse.json(), ledgerResponse.json()]);
    if (Array.isArray(itemData)) setItems(normalizeApiNumbers(itemData));
    if (Array.isArray(batchData)) setBatches(batchData);
    if (Array.isArray(ledgerData)) setLedger(normalizeApiNumbers(ledgerData));
  }, [warehouseId]);

  useEffect(() => { void refresh().catch(() => setNotice('재고 장부를 불러오지 못했습니다.')); }, [refresh]);

  const downloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Transactions');
    sheet.addRow(['occurredAt', 'itemName', 'movementType', 'quantity', 'unit', 'note', 'reference']);
    sheet.addRow(['2026-01-15T09:00:00Z', items[0]?.name || '품목명', 'inbound', 2.5, items[0]?.unit || '톤', '기존 거래 복원', '전표-001']);
    sheet.getColumn(1).width = 26;
    sheet.columns.slice(1).forEach((column) => { column.width = 22; });
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'wms-historical-transactions.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
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
      const headerRow = sheet.getRow(1);
      const headers = headerRow.values as Array<ExcelJS.CellValue>;
      const keys = headers.slice(1).map((value) => String(value ?? '').trim().toLowerCase());
      const find = (record: Record<string, ExcelJS.CellValue>, ...names: string[]) => {
        for (const name of names) if (record[name] !== undefined) return record[name];
        return undefined;
      };
      const rows: Array<Record<string, ExcelJS.CellValue>> = [];
      sheet.eachRow((row, index) => {
        if (index === 1) return;
        const record: Record<string, ExcelJS.CellValue> = {};
        keys.forEach((key, column) => { if (key) record[key] = row.getCell(column + 1).value; });
        if (Object.values(record).some((value) => value !== null && value !== undefined && String(value).trim() !== '')) rows.push(record);
      });
      if (!rows.length || rows.length > 5000) throw new Error('거래 데이터는 1~5,000행이어야 합니다.');
      const payloadRows = rows.map((record, index) => {
        const id = String(find(record, 'inventoryitemid', 'inventory_item_id', '품목id') ?? '').trim();
        const name = String(find(record, 'itemname', 'item', '품목명') ?? '').trim();
        const item = items.find((choice) => choice.id.toLowerCase() === id.toLowerCase() || choice.name.toLowerCase() === (name || id).toLowerCase());
        if (!item) throw new Error(`${index + 2}행: 품목 ID 또는 품목명을 현재 창고에서 찾을 수 없습니다.`);
        const rawType = String(find(record, 'movementtype', 'movement_type', 'type', '유형') ?? '').trim().toLowerCase();
        const movementType = rawType === '입고' ? 'inbound' : rawType === '출고' ? 'outbound' : rawType === '조정' ? 'adjustment' : rawType;
        if (!['inbound', 'outbound', 'adjustment'].includes(movementType)) throw new Error(`${index + 2}행: movementType은 inbound, outbound, adjustment 중 하나여야 합니다.`);
        const rawQuantity = String(find(record, 'quantity', '수량', 'quantitydelta') ?? '').replaceAll(',', '').trim();
        const quantity = Number(rawQuantity);
        if (!Number.isFinite(quantity) || quantity === 0 || (movementType !== 'adjustment' && quantity < 0)) throw new Error(`${index + 2}행: 수량은 0이 아닌 숫자여야 합니다.`);
        const note = String(find(record, 'note', 'reason', '사유') ?? '').trim();
        if (!note) throw new Error(`${index + 2}행: 거래 사유가 필요합니다.`);
        return {
          inventoryItemId: item.id,
          occurredAt: parseDate(find(record, 'occurredat', 'occurred_at', 'date', '거래일시') as ExcelJS.CellValue),
          movementType,
          quantity,
          quantityUnit: String(find(record, 'unit', 'quantityunit', '단위') ?? item.unit).trim(),
          note,
          reference: String(find(record, 'reference', 'document', '참조') ?? '').trim(),
        };
      });
      const response = await fetch(`${rustApi}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, sourceName: file.name, rows: payloadRows }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '과거 거래를 제출하지 못했습니다.');
      setFile(null);
      setNotice(`${result.rows}건을 승인 대기 상태로 등록했습니다. 현재 잔량은 변경되지 않았습니다.`);
      await refresh();
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '검토 결과를 저장하지 못했습니다.');
      setNotice(`${approve ? '승인' : '반려'} 처리했습니다. 현재 잔량은 그대로 유지됩니다.`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '검토를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5 border-y border-gray-200 dark:border-gray-800 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-primary">Inventory records</p>
          <h2 className="text-xl font-bold text-textMain dark:text-white">과거 거래 가져오기와 감사 장부</h2>
        </div>
        <button onClick={() => void refresh()} title="새로고침" className="p-2 text-textMuted hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><RefreshCw size={16} /></button>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void downloadTemplate()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold"><Download size={14} />엑셀 양식</button>
            <label className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-semibold cursor-pointer">
              <FileSpreadsheet size={14} /> <span className="truncate">{file?.name || '거래 엑셀 선택'}</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </label>
            <button disabled={!file || busy} onClick={() => void importWorkbook()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Upload size={14} />{busy ? '처리 중' : '승인 요청'}</button>
          </div>
          <p className="text-xs leading-relaxed text-textMuted">품목명 또는 UUID, 거래 시각(ISO 권장), 유형, 수량, 단위, 사유를 입력합니다. 승인 전에는 잔량이 바뀌지 않습니다.</p>
          {notice && <p role="status" className="text-xs text-primary">{notice}</p>}
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            <h3 className="text-sm font-bold">가져오기 검토 {batches.filter((batch) => batch.status === 'PENDING').length}</h3>
            {batches.length === 0 ? <p className="text-xs text-textMuted">가져온 배치가 없습니다.</p> : batches.map((batch) => (
              <article key={batch.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 py-2 text-xs">
                <div><strong>{batch.sourceName}</strong><span className="ml-2 text-textMuted">{batch.rowCount}건 · {batch.status} · {batch.submittedEmail}</span></div>
                {batch.status === 'PENDING' && canReview && <div className="flex gap-1"><button disabled={busy} onClick={() => void reviewBatch(batch, true)} title="승인" className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded"><Check size={15} /></button><button disabled={busy} onClick={() => void reviewBatch(batch, false)} title="반려" className="p-1.5 text-red-700 hover:bg-red-50 rounded"><X size={15} /></button></div>}
                {batch.reviewNote && <p className="basis-full text-textMuted">검토 메모: {batch.reviewNote}</p>}
              </article>
            ))}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden">
          <h3 className="mb-2 text-sm font-bold">최근 장부 · 담당자 / 출처 / 사유</h3>
          <div className="max-h-[420px] overflow-auto border border-gray-200 dark:border-gray-800 rounded-lg">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-textMuted"><tr><th className="p-2">일시</th><th className="p-2">품목</th><th className="p-2">유형</th><th className="p-2">증감</th><th className="p-2">잔량</th><th className="p-2">담당자</th><th className="p-2">출처 / 사유</th></tr></thead>
              <tbody>{ledger.map((row) => <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800"><td className="p-2 whitespace-nowrap">{new Date(row.occurredAt).toLocaleString('ko-KR')}</td><td className="p-2">{row.itemName}</td><td className="p-2">{row.movementType}</td><td className="p-2 font-mono">{row.quantityDelta.toLocaleString()}</td><td className="p-2 font-mono">{row.balanceAfter.toLocaleString()}</td><td className="p-2">{row.operator || '시스템'}</td><td className="p-2"><span className="font-semibold">{row.source}</span><span className="block max-w-[260px] truncate text-textMuted">{row.reason}</span></td></tr>)}</tbody>
            </table>
            {ledger.length === 0 && <p className="p-5 text-center text-xs text-textMuted">장부 기록이 없습니다.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
