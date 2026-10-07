import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(`${process.env.RUST_API_URL || 'http://localhost:8080'}/api/delivery/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('authorization') ? { Authorization: request.headers.get('authorization')! } : {}),
      },
      body: await request.text(),
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { error: text || '서버 오류' }; }
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: '택배사 추적 서비스에 연결할 수 없습니다.' }, { status: 503 });
  }
}