import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RUST_API = process.env.RUST_API_URL || 'http://localhost:8080';

async function proxy(req: NextRequest, method: string): Promise<NextResponse> {
  const url = new URL(req.url);
  const targetUrl = `${RUST_API}${url.pathname}${url.search}`;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET') {
    try { init.body = await req.text(); } catch {}
  }
  const res = await fetch(targetUrl, init);
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: text || '서버 오류' }; }
  return NextResponse.json(body, { status: res.status });
}

// GET: 최근 분석 이력 조회 → Rust 백엔드로 프록시
export async function GET(req: NextRequest) {
  try { return await proxy(req, 'GET'); }
  catch { return NextResponse.json([], { status: 200 }); }
}

// POST: Rust API가 창고별 레퍼런스와 함께 Groq Vision 분석을 처리
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.image) {
      return NextResponse.json({ error: '이미지가 없습니다.' }, { status: 400 });
    }
    if (!body.warehouseId) {
      return NextResponse.json({ error: 'warehouseId가 필요합니다.' }, { status: 400 });
    }
    return await proxy(
      new NextRequest(req.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      'POST',
    );
  } catch (error: unknown) {
    console.error('Monitor POST 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
