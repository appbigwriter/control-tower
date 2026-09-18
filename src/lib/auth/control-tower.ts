import { cookies } from 'next/headers'
import { jwtVerify, SignJWT } from 'jose'
import { createClient } from '@supabase/supabase-js'
import {
  parseDurationToSeconds,
  sanitizeScopesForIdentityType,
  hasRequiredScope as policyHasRequiredScope,
  type PrincipalType
} from './service-identity-policy'

export const CONTROL_TOWER_COOKIE = 'ct_admin_session'

export interface ServiceIdentityRecord {
  id: string
  name: string
  namespace: string
  identity_type: 'agent' | 'service' | 'admin'
  scopes: string[]
  status: 'active' | 'suspended' | 'revoked' | 'expired'
  issuer: string
  audience: string
  key_id: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface AuthenticatedPrincipal {
  type: 'admin' | 'service' | 'agent'
  name: string
  namespace?: string
  scopes: string[]
  identityId?: string
}

function getAdminSecret(): string {
  const value = process.env.CONTROL_TOWER_ADMIN_SECRET
  if (!value) {
    throw new Error('CONTROL_TOWER_ADMIN_SECRET is not set')
  }
  return value
}

function getJwtSecret(): string {
  return process.env.CONTROL_TOWER_ADMIN_SECRET || process.env.CONTROL_TOWER_AGENT_API_KEY || 'default-secret-change-me'
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
  try {
    const expected = await createSessionToken()
    return timingSafeEqual(value, expected)
  } catch {
    return false
  }
}

export async function getAdminSession() {
  return (await cookies()).get(CONTROL_TOWER_COOKIE)?.value ?? null
}

export async function isAdminSessionActive() {
  return await isValidSessionToken(await getAdminSession())
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || 'http://supabase-control-tower.fbr.news'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  })
}

export async function authenticateToken(rawToken: string | undefined | null): Promise<AuthenticatedPrincipal | null> {
  if (!rawToken) return null
  const cleanToken = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim()
  if (!cleanToken) return null

  const adminSecret = process.env.CONTROL_TOWER_ADMIN_SECRET
  const agentMasterSecret = process.env.CONTROL_TOWER_AGENT_API_KEY
  const fluxSecret = process.env.CONTROL_TOWER_FLUX_API_KEY

  // 1. Check if token matches static bootstrap/admin secret
  if (adminSecret && timingSafeEqual(cleanToken, adminSecret)) {
    return {
      type: 'admin',
      name: 'system-admin',
      scopes: ['*']
    }
  }

  if (agentMasterSecret && timingSafeEqual(cleanToken, agentMasterSecret)) {
    return {
      type: 'admin',
      name: 'agent-master',
      scopes: ['*']
    }
  }

  if (fluxSecret && timingSafeEqual(cleanToken, fluxSecret)) {
    return {
      type: 'service',
      name: 'fbr-agency-flux-service',
      namespace: 'fbr/services/agency-flux/',
      scopes: sanitizeScopesForIdentityType('service', [
        'projects:read',
        'projects:provision',
        'ct:sql:execute',
        'secrets:namespaces:create',
        'secrets:bindings:write',
        'health:read'
      ])
    }
  }

  // 2. Validate JWT signature and claims
  const jwtSecret = getJwtSecret()
  try {
    const secret = new TextEncoder().encode(jwtSecret)
    const { payload } = await jwtVerify(cleanToken, secret, {
      issuer: 'control-tower',
      audience: 'fbr-agency'
    })

    const identityId = payload.sub as string
    if (!identityId) return null

    // GDB-REM-001: JWT is validated against the database record (zero trust).
    // The scopes carried inside the token claims are NEVER trusted; the
    // authoritative scope list is the one persisted in service_identities,
    // and it is sanitized so a poisoned/legacy row can never grant wildcard
    // or non-catalogued scopes to a non-admin identity.
    const supabase = getSupabaseClient()
    const { data: identity, error } = await supabase
      .from('service_identities')
      .select('*')
      .eq('id', identityId)
      .single()

    if (error || !identity) {
      return null
    }

    // Rule: Revoked, suspended or expired identities can NEVER authenticate
    if (identity.status !== 'active') {
      return null
    }

    if (identity.expires_at && new Date(identity.expires_at).getTime() < Date.now()) {
      return null
    }

    // Update last_used_at asynchronously
    void Promise.resolve(
      supabase
        .from('service_identities')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', identityId)
    ).catch(() => {})

    return {
      type: identity.identity_type as PrincipalType,
      name: identity.name,
      namespace: identity.namespace,
      scopes: sanitizeScopesForIdentityType(identity.identity_type, identity.scopes),
      identityId: identity.id
    }
  } catch (err) {
    return null
  }
}

export async function isValidAgentApiKey(token: string | undefined | null): Promise<boolean> {
  const principal = await authenticateToken(token)
  return principal !== null
}

export async function generateIdentityJwt(
  identity: ServiceIdentityRecord,
  expiresIn = '365d'
): Promise<string> {
  // GDB-REM-001: expiry must be a validated duration string within
  // [60s, 365d]. Anything else fails closed instead of falling back to the
  // 365d default and issuing an over-long-lived token.
  const seconds = parseDurationToSeconds(expiresIn)
  if (seconds === null) {
    throw new Error(
      'expires_in inválido: use uma duração como 30m, 12h, 90d (mínimo 60s, máximo 365d)'
    )
  }

  // Defense in depth: a non-admin identity never has wildcard or
  // non-catalogued scopes embedded in the issued JWT.
  const scopes = sanitizeScopesForIdentityType(identity.identity_type, identity.scopes)

  const secret = new TextEncoder().encode(getJwtSecret())
  return await new SignJWT({
    sub: identity.id,
    name: identity.name,
    namespace: identity.namespace,
    identity_type: identity.identity_type,
    scopes
  })
    .setProtectedHeader({ alg: 'HS256', kid: identity.key_id || 'ct-key-v1' })
    .setIssuer(identity.issuer || 'control-tower')
    .setAudience(identity.audience || 'fbr-agency')
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(secret)
}

export function hasRequiredScope(principal: AuthenticatedPrincipal, requiredScope: string): boolean {
  return policyHasRequiredScope(principal, requiredScope)
}
