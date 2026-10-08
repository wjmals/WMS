import { NextRequest, NextResponse } from 'next/server';
import { backendUnavailableResponse, getRustApiUrl } from '../../../lib/rustApi';

export const dynamic = 'force-dynamic';

async function proxyToRust(req: NextRequest, method: string, url: URL): Promise<NextResponse> {
  const targetUrl = `${getRustApiUrl()}${url.pathname}${url.search}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authorization = req.headers.get('authorization');
  if (authorization) headers.Authorization = authorization;
  const init: RequestInit = { method, headers };

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

  let sessionToken: string | undefined;
  if (method === 'POST' && res.ok && body && typeof body === 'object' && 'token' in body && typeof body.token === 'string') {
    sessionToken = body.token;
    delete (body as Record<string, unknown>).token;
  }
  const response = NextResponse.json(body, { status: res.status });
  if (sessionToken) {
    response.cookies.set('wms_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api',
      maxAge: 60 * 60 * 12,
    });
  }
  return response;
}

export async function GET(req: NextRequest) {
  try {
    return await proxyToRust(req, 'GET', new URL(req.url));
  } catch (err) {
    console.error('[proxy] GET /api/users error:', err);
    return backendUnavailableResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    return await proxyToRust(req, 'POST', new URL(req.url));
  } catch (err) {
    console.error('[proxy] POST /api/users error:', err);
    return backendUnavailableResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return await proxyToRust(req, 'DELETE', new URL(req.url));
  } catch (err) {
    console.error('[proxy] DELETE /api/users error:', err);
    return backendUnavailableResponse(err);
  }
}
