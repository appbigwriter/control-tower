import { NextResponse, type NextRequest } from 'next/server'

import { CONTROL_TOWER_COOKIE, isValidSessionToken } from '@/lib/auth/control-tower'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isProtectedPath =
    pathname.startsWith('/control-tower') || pathname.startsWith('/api/control-tower')

  const isPublicAuthPath = pathname.startsWith('/login') || pathname.startsWith('/api/auth')

  if (!isProtectedPath || isPublicAuthPath) {
    return NextResponse.next()
  }

  const session = request.cookies.get(CONTROL_TOWER_COOKIE)?.value
  if (isValidSessionToken(session)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/control-tower/:path*', '/api/control-tower/:path*', '/login', '/api/auth/:path*'],
}
