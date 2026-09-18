/**
 * GDB-REM-001 / GDB-REM-003 — Pure authorization policy for Control Tower.
 *
 * This module MUST stay free of next/jose/supabase imports so it can be unit
 * tested directly with the node test runner (see tests/service-identity-policy.test.ts).
 *
 * It is the single server-side source of truth for:
 *  - the catalog of scopes that can be granted to a Service Identity
 *  - scope-grant validation (privilege containment for non-admin grantors)
 *  - expires_in duration validation for identity issuance
 *  - schema governance rules for the project SQL RPC/editor
 *  - scope checks (wildcard only ever authorizes admin principals)
 *
 * The DB-level mirror of the catalog lives in
 * supabase/migrations/012_service_identity_scope_guard.sql — both must be
 * updated together.
 */

export type PrincipalType = 'admin' | 'service' | 'agent'
export type IdentityType = 'agent' | 'service' | 'admin'

/** Scopes that can be granted to a Service Identity. '*' is NOT catalogued:
 *  it is reserved for admin principals and can only be assigned to an
 *  identity of type 'admin' by an admin grantor. */
export const SERVICE_IDENTITY_SCOPE_CATALOG: readonly string[] = [
  'projects:read',
  'projects:provision',
  'ct:sql:execute',
  'secrets:namespaces:create',
  'secrets:bindings:write',
  'health:read',
  'identities:create',
  'identities:read',
  'identities:update'
]

export const WILDCARD_SCOPE = '*'

/** Governance / platform schemas that must never be targeted by the project
 *  SQL RPC. Project schemas are always `<type>_<slug>` (blog_, store_, saas_,
 *  custom_) so they never collide with these names or prefixes. */
const GOVERNANCE_SCHEMA_EXACT = new Set([
  'public',
  'auth',
  'storage',
  'vault',
  'realtime',
  'extensions',
  'information_schema',
  'pg_catalog',
  'graphql',
  'graphql_public',
  'pgbouncer',
  'net'
])

const GOVERNANCE_SCHEMA_PREFIXES = ['pg_', 'supabase_']

export interface ScopeBearer {
  type: PrincipalType
  scopes: string[]
}

export interface ScopeGrantInput {
  requestedScopes: unknown
  grantorType: PrincipalType
  grantorScopes: string[]
  targetIdentityType: IdentityType
}

export type ScopeGrantResult =
  | { ok: true; scopes: string[] }
  | { ok: false; reason: string }

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Validates a scope grant under privilege-containment rules (GDB-REM-001):
 *
 * - scopes must be an array of strings;
 * - a non-admin grantor can never create an identity of type 'admin';
 * - a non-admin grantor can only grant catalogued scopes it already holds
 *   (subset of catalog ∩ grantor scopes — no wildcard, no escalation);
 * - an admin grantor can grant any catalogued scope, and additionally '*'
 *   but only for an identity of type 'admin'.
 */
export function validateScopeGrant(input: ScopeGrantInput): ScopeGrantResult {
  const { grantorType, grantorScopes, targetIdentityType } = input

  if (!['agent', 'service', 'admin'].includes(targetIdentityType)) {
    return { ok: false, reason: 'identity_type inválido' }
  }

  if (grantorType !== 'admin' && targetIdentityType === 'admin') {
    return {
      ok: false,
      reason: 'apenas administradores podem criar identidades do tipo admin'
    }
  }

  if (input.requestedScopes === undefined || input.requestedScopes === null) {
    return { ok: true, scopes: [] }
  }

  if (!isStringArray(input.requestedScopes)) {
    return { ok: false, reason: 'scopes deve ser um array de strings' }
  }

  const requested = Array.from(new Set(input.requestedScopes.map((scope) => scope.trim()))).filter(
    (scope) => scope.length > 0
  )

  if (requested.includes(WILDCARD_SCOPE)) {
    if (grantorType !== 'admin' || targetIdentityType !== 'admin') {
      return {
        ok: false,
        reason: "escopo curinga '*' só pode ser atribuído por um administrador a uma identity admin"
      }
    }
    return { ok: true, scopes: [WILDCARD_SCOPE] }
  }

  const grantable =
    grantorType === 'admin'
      ? new Set(SERVICE_IDENTITY_SCOPE_CATALOG)
      : new Set(SERVICE_IDENTITY_SCOPE_CATALOG.filter((scope) => grantorScopes.includes(scope)))

  for (const scope of requested) {
    if (!SERVICE_IDENTITY_SCOPE_CATALOG.includes(scope)) {
      return { ok: false, reason: `escopo não catalogado: ${scope}` }
    }
    if (!grantable.has(scope)) {
      return {
        ok: false,
        reason: `escopo não concedível por este principal: ${scope}`
      }
    }
  }

  return { ok: true, scopes: requested }
}

/**
 * Defense in depth for legacy/poisoned rows: a non-admin identity never keeps
 * wildcard or non-catalogued scopes when it authenticates.
 */
export function sanitizeScopesForIdentityType(
  identityType: IdentityType,
  scopes: unknown
): string[] {
  const list = Array.isArray(scopes)
    ? scopes.filter((scope): scope is string => typeof scope === 'string')
    : []
  if (identityType === 'admin') return list
  return list.filter((scope) => SERVICE_IDENTITY_SCOPE_CATALOG.includes(scope))
}

/**
 * Scope check used by routes. A wildcard NEVER authorizes a non-admin
 * principal (GDB-NEW-01 regression guard). Admin principals are authorized
 * for everything by type, mirroring the bootstrap admin secrets.
 */
export function hasRequiredScope(principal: ScopeBearer, requiredScope: string): boolean {
  if (principal.type === 'admin') return true
  if (!Array.isArray(principal.scopes)) return false
  return principal.scopes.includes(requiredScope)
}

const DURATION_PATTERN = /^([1-9][0-9]{0,4})(s|m|h|d|w)$/
const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800
}

export const MIN_EXPIRES_IN_SECONDS = 60
export const MAX_EXPIRES_IN_SECONDS = 365 * 86400 // 365d cap

/**
 * Parses a jose-compatible duration string ('120s', '30m', '12h', '90d',
 * '52w') into seconds, enforcing the [60s, 365d] window. Numbers are rejected
 * on purpose: jose would treat a number as an absolute epoch, not a duration.
 */
export function parseDurationToSeconds(expiresIn: unknown): number | null {
  if (typeof expiresIn !== 'string') return null
  const match = DURATION_PATTERN.exec(expiresIn.trim())
  if (!match) return null
  const seconds = Number(match[1]) * DURATION_MULTIPLIERS[match[2]]
  if (seconds < MIN_EXPIRES_IN_SECONDS || seconds > MAX_EXPIRES_IN_SECONDS) return null
  return seconds
}

const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

export function isValidSchemaName(schemaName: unknown): schemaName is string {
  return typeof schemaName === 'string' && SCHEMA_NAME_PATTERN.test(schemaName)
}

export function isGovernanceSchema(schemaName: string): boolean {
  if (GOVERNANCE_SCHEMA_EXACT.has(schemaName)) return true
  return GOVERNANCE_SCHEMA_PREFIXES.some((prefix) => schemaName.startsWith(prefix))
}

const SCHEMA_PREFIX_BY_BUSINESS_TYPE: Record<string, string> = {
  blog: 'blog',
  store: 'store',
  saas: 'saas',
  custom: 'custom'
}

/**
 * Canonical schema derivation — a project schema must always be
 * `<business_type>_<slug>`. Used to verify the catalogued schema really
 * belongs to the project being targeted by the SQL editor (GDB-REM-003).
 */
export function deriveSchemaName(
  businessType: string,
  slug: string
): string | null {
  const prefix = SCHEMA_PREFIX_BY_BUSINESS_TYPE[businessType]
  if (!prefix) return null
  if (!/^[a-z0-9_]+$/.test(slug)) return null
  const derived = `${prefix}_${slug}`
  return isValidSchemaName(derived) ? derived : null
}

export interface SqlAuditMetadataInput {
  actor: string
  projectSlug?: string
  schemaName?: string
  reason?: string
  sqlLength?: number
  sqlSha256Prefix?: string
  errcode?: string
}

/**
 * Builds sanitized audit metadata for SQL editor events. The raw SQL
 * statement is NEVER included — only length and a truncated sha256 prefix for
 * correlation (GDB-REM-003 acceptance: audit log without sensitive SQL).
 */
export function buildSqlAuditMetadata(input: SqlAuditMetadataInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = { actor: input.actor }
  if (input.projectSlug !== undefined) metadata.project_slug = input.projectSlug
  if (input.schemaName !== undefined) metadata.schema_name = input.schemaName
  if (input.reason !== undefined) metadata.reason = input.reason
  if (typeof input.sqlLength === 'number') metadata.sql_length = input.sqlLength
  if (input.sqlSha256Prefix !== undefined) metadata.sql_sha256_prefix = input.sqlSha256Prefix
  if (input.errcode !== undefined) metadata.errcode = input.errcode
  return metadata
}
