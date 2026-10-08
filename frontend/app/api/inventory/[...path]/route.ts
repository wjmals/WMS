import { NextRequest, NextResponse } from 'next/server';
import { getRustApiUrl } from '../../../../lib/rustApi';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const source = new URL(request.url);
  const target = `${getRustApiUrl()}/api/inventory/${path.map(encodeURIComponent).join('/')}${source.search}`;
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('Authorization', authorization);
  if (request.method !== 'GET' && request.method !== 'DELETE') headers.set('Content-Type', 'application/json');
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.text(),
    cache: 'no-store',
  });
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: text || '서버 오류' }; }
  return NextResponse.json(body, { status: response.status });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try { return await proxy(request, context); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try { return await proxy(request, context); }
  catch { return NextResponse.json({ error: '백엔드 서버 연결 실패' }, { status: 503 }); }
}
