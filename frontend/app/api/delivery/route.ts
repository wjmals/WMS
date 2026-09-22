import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RUST_API = process.env.RUST_API_URL || 'http://localhost:8080';

// 지원 택배사 목록
const CARRIERS: Record<string, { code: string; name: string }> = {
  '01': { code: '01', name: '우체국택배' },
  '04': { code: '04', name: 'CJ대한통운' },
  '05': { code: '05', name: '한진택배' },
  '06': { code: '06', name: '로젠택배' },
  '08': { code: '08', name: '롯데택배' },
  '11': { code: '11', name: '일양로지스' },
  '23': { code: '23', name: '경동택배' },
  '22': { code: '22', name: '대신택배' },
};

// 운송장 번호로 택배사 자동 감지 (Next.js 레이어에서 처리)
async function detectCarrierAuto(invoiceNo: string): Promise<{ code: string; name: string }> {
  const clean = invoiceNo.replace(/[^0-9]/g, '');
  if (clean.length === 13) return CARRIERS['01'];
  if (clean.length === 11) return CARRIERS['06'];
  if (clean.length === 10) return CARRIERS['05'];
  if (clean.length === 12) {
    if (['6', '5', '3'].includes(clean[0])) return CARRIERS['04'];
    if (['2', '4', '0'].includes(clean[0])) return CARRIERS['08'];
    return CARRIERS['04'];
  }
  return CARRIERS['04'];
}

async function proxy(req: NextRequest, method: string): Promise<NextResponse> {
  const url = new URL(req.url);
  const targetUrl = `${RUST_API}${url.pathname}${url.search}`;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET' && method !== 'DELETE') {
    try { init.body = await req.text(); } catch {}
  }
  const res = await fetch(targetUrl, init);
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: text || '서버 오류' }; }
  return NextResponse.json(body, { status: res.status });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const detectInvoice = searchParams.get('detect');
    if (detectInvoice) {
      const detected = await detectCarrierAuto(detectInvoice);
      return NextResponse.json(detected);
    }
    return await proxy(req, 'GET');
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try { return await proxy(req, 'POST'); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}

export async function DELETE(req: NextRequest) {
  try { return await proxy(req, 'DELETE'); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}

export async function PUT(req: NextRequest) {
  try { return await proxy(req, 'PUT'); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}
