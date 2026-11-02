export function formatQty(value: number | string | null | undefined): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

// 이전 버전이 저장한 6자리 소수 문구도 2자리로 줄여 보여준다.
export function formatDiffText(text: string): string {
  return text.replace(/(\d+)\.(\d+)/g, (_, whole: string, fraction: string) => {
    const trimmed = fraction.slice(0, 2).replace(/0+$/, '');
    return trimmed ? `${whole}.${trimmed}` : whole;
  });
}
