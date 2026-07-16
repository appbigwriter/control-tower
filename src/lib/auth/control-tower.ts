import crypto from 'crypto'
import { cookies } from 'next/headers'

export const CONTROL_TOWER_COOKIE = 'ct_admin_session'

function secret() {
  const value = process.env.CONTROL_TOWER_ADMIN_SECRET
  if (!value) {
    throw new Error('CONTROL_TOWER_ADMIN_SECRET is not set')
  }
  return value
}

export function createSessionToken() {
  return crypto
    .createHmac('sha256', secret())
    .update('control-tower-admin')
    .digest('hex')
}

export function isValidSessionToken(value: string | undefined | null) {
  if (!value) return false
  const expected = createSessionToken()
  const actual = Buffer.from(value)
  const trusted = Buffer.from(expected)
  if (actual.length !== trusted.length) return false
  return crypto.timingSafeEqual(actual, trusted)
}

export async function getAdminSession() {
  return (await cookies()).get(CONTROL_TOWER_COOKIE)?.value ?? null
}

export async function isAdminSessionActive() {
  return isValidSessionToken(await getAdminSession())
}
