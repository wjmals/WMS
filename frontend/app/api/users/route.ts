import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Rust 백엔드 URL - 환경변수로 설정 (없으면 localhost:8080)
const RUST_API = process.env.RUST_API_URL || 'http://localhost:8080';

async function proxyToRust(req: NextRequest, method: string, url: URL): Promise<NextResponse> {
  const targetUrl = `${RUST_API}${url.pathname}${url.search}`;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };

  if (method !== 'GET' && method !== 'DELETE') {
    try {
      init.body = await req.text();
    } catch {
      // no body
    }
  }

  const res = await fetch(targetUrl, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text || '서버 오류' };
  }

  return NextResponse.json(body, { status: res.status });
}

export async function GET(req: NextRequest) {
  try {
    return await proxyToRust(req, 'GET', new URL(req.url));
  } catch (err) {
    console.error('[proxy] GET /api/users error:', err);
    return NextResponse.json({ error: '백엔드 서버에 연결할 수 없습니다.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await proxyToRust(req, 'POST', new URL(req.url));
  } catch (err) {
    console.error('[proxy] POST /api/users error:', err);
    return NextResponse.json({ error: '백엔드 서버에 연결할 수 없습니다.' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return await proxyToRust(req, 'DELETE', new URL(req.url));
  } catch (err) {
    console.error('[proxy] DELETE /api/users error:', err);
    return NextResponse.json({ error: '백엔드 서버에 연결할 수 없습니다.' }, { status: 503 });
  }
}
