import { NextRequest, NextResponse } from 'next/server';
import { getRustApiUrl } from '../../../../lib/rustApi';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ action: string }> };
const allowedActions = new Set(['analyze', 'estimate', 'estimates', 'review']);

async function proxy(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  if (!allowedActions.has(action)) {
    return NextResponse.json({ error: '지원하지 않는 비전 API입니다.' }, { status: 404 });
  }
  const source = new URL(request.url);
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('Authorization', authorization);
  if (request.method !== 'GET') headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getRustApiUrl()}/api/vision/${action}${source.search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.text(),
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
