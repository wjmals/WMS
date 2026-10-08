const decimalFields = new Set([
  'current',
  'safe',
  'packageSize',
  'capacity',
  'currentStockSum',
  'emptyRatio',
  'inbound',
  'outbound',
  'adjustments',
  'estimatedQuantity',
  'estimated_quantity',
  'quantityDelta',
  'balanceAfter',
  'forecastOutflow7d',
  'mapePct',
  'accuracyPct',
]);

export function normalizeApiNumbers<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeApiNumbers(entry)) as T;
  }
  if (value === null || typeof value !== 'object') return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (decimalFields.has(key) && (typeof entry === 'string' || typeof entry === 'number')) {
      const parsed = Number(entry);
      normalized[key] = Number.isFinite(parsed) ? parsed : entry;
    } else {
      normalized[key] = normalizeApiNumbers(entry);
    }
  }
  return normalized as T;
}
