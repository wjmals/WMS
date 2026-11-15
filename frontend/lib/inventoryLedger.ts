import { normalizeApiNumbers } from './normalizeApiNumbers';

export type InventoryLedgerRow = {
  id: string;
  inventoryItemId: string;
  itemName: string;
  unit: string;
  movementType: string;
  quantityDelta: number;
  balanceAfter: number;
  reason: string;
  source: string;
  operator: string | null;
  occurredAt: string;
};

export async function fetchInventoryLedger(
  parameters: URLSearchParams,
  options: { signal?: AbortSignal; onProgress?: (count: number) => void } = {},
): Promise<InventoryLedgerRow[]> {
  const pageSize = 2000;
  const params = new URLSearchParams(parameters);
  params.set('limit', String(pageSize));
  const rows: InventoryLedgerRow[] = [];
  let previousCursor = '';
  while (true) {
    const response = await fetch(`/api/inventory/ledger?${params.toString()}`, { signal: options.signal });
    const text = await response.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error(text.trim() || '장부 응답을 읽지 못했습니다.'); }
    if (!response.ok || !Array.isArray(data)) {
      const error = data && typeof data === 'object' && 'error' in data ? String(data.error) : '장부를 불러오지 못했습니다.';
      throw new Error(error);
    }
    const page = normalizeApiNumbers(data) as InventoryLedgerRow[];
    rows.push(...page);
    options.onProgress?.(rows.length);
    if (page.length < pageSize) return rows;
    const last = page[page.length - 1];
    const cursor = `${last.occurredAt}|${last.id}`;
    if (!last.occurredAt || !last.id || cursor === previousCursor) throw new Error('장부 페이지를 이어서 불러오지 못했습니다.');
    previousCursor = cursor;
    params.set('before', last.occurredAt);
    params.set('beforeId', last.id);
  }
}