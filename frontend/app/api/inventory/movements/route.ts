import { NextRequest, NextResponse } from 'next/server';
import { getRustApiUrl } from '../../../../lib/rustApi';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${getRustApiUrl()}/api/inventory/movements${new URL(request.url).search}`, {
      headers: { ...(request.headers.get('authorization') ? { Authorization: request.headers.get('authorization')! } : {}) },
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { error: text || '서버 오류' }; }
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: '백엔드 서버에 연결할 수 없습니다.' }, { status: 503 });
  }
}