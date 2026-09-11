import { NextResponse, type NextRequest } from 'next/server'

import {
  CONTROL_TOWER_COOKIE,
  isValidSessionToken,
  isValidAgentApiKey,
} from '@/lib/auth/control-tower'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isProtectedPath =
    pathname.startsWith('/control-tower') || pathname.startsWith('/api/control-tower')

  const isPublicAuthPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/control-tower/health'

  if (!isProtectedPath || isPublicAuthPath) {
    return NextResponse.next()
  }

  // 1. Verificar se a requisição contém um Token de Agente (Bearer ou x-api-key)
  const authHeader = request.headers.get('authorization')
  const apiKeyHeader = request.headers.get('x-api-key')
  const token = authHeader ?? apiKeyHeader
  if (token && await isValidAgentApiKey(token)) {
    return NextResponse.next()
  }

  // 2. Verificar sessão do navegador (cookie de admin)
  const session = request.cookies.get(CONTROL_TOWER_COOKIE)?.value
  if (await isValidSessionToken(session)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized: Token de autenticação ou sessão inválida' },
      { status: 401 },
    )
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/control-tower/:path*', '/api/control-tower/:path*', '/login', '/api/auth/:path*'],
}
