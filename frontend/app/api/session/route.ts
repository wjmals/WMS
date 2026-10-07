import { NextResponse } from 'next/server';

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('wms_session', '', { httpOnly: true, sameSite: 'lax', path: '/api', maxAge: 0 });
  return response;
}