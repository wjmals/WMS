import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RUST_API = process.env.RUST_API_URL || 'http://localhost:8080';

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
  try { return await proxy(req, 'GET'); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  try { return await proxy(req, 'POST'); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}

export async function PATCH(req: NextRequest) {
  try { return await proxy(req, 'PATCH'); }
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
