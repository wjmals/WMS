import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const token = request.cookies.get('wms_session')?.value;
  if (!token || !request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/api/:path*'],
};