import { NextRequest, NextResponse } from 'next/server'

import { CONTROL_TOWER_COOKIE, createSessionToken, isValidSessionToken } from '@/lib/auth/control-tower'

export async function POST(req: NextRequest) {
  try {
    const { secret } = (await req.json()) as { secret?: string }
    if (!secret || secret !== process.env.CONTROL_TOWER_ADMIN_SECRET) {
      return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set(CONTROL_TOWER_COOKIE, createSessionToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    })
    return response
  } catch {
    return NextResponse.json({ error: 'Falha no login' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = req.cookies.get(CONTROL_TOWER_COOKIE)?.value
  return NextResponse.json({ authenticated: isValidSessionToken(session) })
}
