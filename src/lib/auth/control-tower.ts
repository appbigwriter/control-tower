import { cookies } from 'next/headers'

export const CONTROL_TOWER_COOKIE = 'ct_admin_session'

function getAdminSecret() {
  const value = process.env.CONTROL_TOWER_ADMIN_SECRET
  if (!value) {
    throw new Error('CONTROL_TOWER_ADMIN_SECRET is not set')
  }
  return value
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export async function createSessionToken(): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`control-tower-admin:${getAdminSecret()}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function isValidSessionToken(value: string | undefined | null): Promise<boolean> {
  if (!value) return false
  const expected = await createSessionToken()
  return timingSafeEqual(value, expected)
}

export async function getAdminSession() {
  return (await cookies()).get(CONTROL_TOWER_COOKIE)?.value ?? null
}

export async function isAdminSessionActive() {
  return await isValidSessionToken(await getAdminSession())
}

export function isValidAgentApiKey(token: string | undefined | null): boolean {
  if (!token) return false
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim()
  if (!cleanToken) return false

  const agentSecret = process.env.CONTROL_TOWER_AGENT_API_KEY
  const adminSecret = process.env.CONTROL_TOWER_ADMIN_SECRET

  const secretsToTest = [agentSecret, adminSecret].filter(
    (s): s is string => Boolean(s && s.length > 0),
  )
  if (secretsToTest.length === 0) return false

  for (const expectedSecret of secretsToTest) {
    if (timingSafeEqual(cleanToken, expectedSecret)) {
      return true
    }
  }

  return false
}

