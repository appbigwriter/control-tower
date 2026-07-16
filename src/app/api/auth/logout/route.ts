import { NextResponse } from 'next/server'

import { CONTROL_TOWER_COOKIE } from '@/lib/auth/control-tower'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(CONTROL_TOWER_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
