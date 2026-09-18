// GDB-REM-011/013: structural readback helpers.
// Every destructive/success transition must be backed by an observed readback,
// never by the absence of an error (supabase-js does not throw on { error }).

export interface ReadbackClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
}

export interface SchemaReadback {
  schema_name: string
  exists: boolean
  checkedAt: string
  error: string | null
}

/**
 * Calls public.project_schema_exists RPC. Returns exists=false ONLY on a
 * definitive negative answer; transport/RPC errors surface as error + exists=false
 * with error set, so callers must distinguish "confirmed absent" from "could not verify".
 */
export async function readbackSchemaExists(
  client: ReadbackClient,
  schemaName: string,
): Promise<SchemaReadback> {
  const checkedAt = new Date().toISOString()
  if (!schemaName || !/^[a-z][a-z0-9_]*$/.test(schemaName)) {
    return { schema_name: schemaName, exists: false, checkedAt, error: 'invalid schema name' }
  }
  try {
    const { data, error } = await client.rpc('project_schema_exists', { p_schema_name: schemaName })
    if (error) {
      return { schema_name: schemaName, exists: false, checkedAt, error: error.message }
    }
    return { schema_name: schemaName, exists: data === true, checkedAt, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'rpc failed'
    return { schema_name: schemaName, exists: false, checkedAt, error: message }
  }
}

/** A delete may only remove the catalog row when removal is CONFIRMED or unverifiable-but-logged. */
export function schemaRemovalConfirmed(readback: SchemaReadback): boolean {
  return readback.exists === false && readback.error === null
}

// ---------------------------------------------------------------------------
// GDB-REM-013: DNS/health technical verification (mockable, no real network in tests)
// ---------------------------------------------------------------------------

export type DomainVerificationState =
  | 'domain_generated'
  | 'awaiting_dns'
  | 'dns_manual_confirmed'
  | 'dns_verified'
  | 'dns_failed'

export const DOMAIN_STATE_TRANSITIONS: Record<DomainVerificationState, DomainVerificationState[]> = {
  domain_generated: ['awaiting_dns'],
  awaiting_dns: ['dns_manual_confirmed', 'dns_failed'],
  dns_manual_confirmed: ['dns_verified', 'dns_failed', 'awaiting_dns'],
  dns_verified: [],
  dns_failed: ['awaiting_dns'],
}

export function canTransitionDomainState(from: DomainVerificationState, to: DomainVerificationState): boolean {
  return DOMAIN_STATE_TRANSITIONS[from]?.includes(to) ?? false
}

export interface DnsLookupResult {
  addresses: string[]
  error: string | null
}

export interface HealthCheckResult {
  ok: boolean
  status: number | null
  error: string | null
}

export interface DomainVerificationAdapter {
  /** Resolves the hostname. Implementations must never throw. */
  lookupDns(host: string): Promise<DnsLookupResult>
  /** Fetches the health URL. Implementations must never throw. */
  checkHealth(url: string): Promise<HealthCheckResult>
}

/** Default adapter: real dns/promises + fetch. Injectable for tests/E2E mocks. */
export function createRealDomainVerificationAdapter(): DomainVerificationAdapter {
  return {
    async lookupDns(host: string): Promise<DnsLookupResult> {
      try {
        const dns = await import('dns/promises')
        const records = await dns.resolve4(host).catch(() => [] as string[])
        const records6 = await dns.resolve6(host).catch(() => [] as string[])
        const addresses = [...records, ...records6]
        return { addresses, error: null }
      } catch (err) {
        return { addresses: [], error: err instanceof Error ? err.message : 'dns lookup failed' }
      }
    },
    async checkHealth(url: string): Promise<HealthCheckResult> {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeout)
        return { ok: response.ok, status: response.status, error: null }
      } catch (err) {
        return { ok: false, status: null, error: err instanceof Error ? err.message : 'health check failed' }
      }
    },
  }
}

export interface DomainVerificationOutcome {
  state: DomainVerificationState
  attempts: number
  evidence: {
    dns?: { addresses: string[]; error: string | null }
    health?: { ok: boolean; status: number | null; error: string | null }
  }
  healthReadbackId: string
  nextCheckAt: string | null
  error: string | null
  checkedAt: string
}

export interface VerifyDomainInput {
  domain: string
  expectedAddresses?: string[]
  healthPath?: string
  attempts: number
  maxAttempts?: number
  retryDelayMs?: number
  adapter?: DomainVerificationAdapter
  /** Monotonic clock for deterministic tests. */
  now?: () => Date
}

function normalizeHost(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function normalizeHealthUrl(domain: string, healthPath: string): string {
  const host = normalizeHost(domain)
  const path = healthPath.startsWith('/') ? healthPath : `/${healthPath}`
  return `https://${host}${path}`
}

/**
 * GDB-REM-013 technical verification: DNS must resolve AND health must answer ok
 * before dns_verified. Manual confirmation without technical proof keeps the
 * project blocked (returns dns_failed or dns_manual_confirmed unchanged upstream).
 * Timeouts/failures schedule a retry via nextCheckAt until attempts are exhausted.
 */
export async function verifyDomain(input: VerifyDomainInput): Promise<DomainVerificationOutcome> {
  const adapter = input.adapter ?? createRealDomainVerificationAdapter()
  const maxAttempts = input.maxAttempts ?? 3
  const retryDelayMs = input.retryDelayMs ?? 60_000
  const now = input.now ?? (() => new Date())
  const healthPath = input.healthPath ?? '/health'
  const checkedAt = now().toISOString()
  const host = normalizeHost(input.domain)

  let attempts = input.attempts
  let lastError: string | null = null

  while (attempts < maxAttempts) {
    attempts += 1
    const dns = await adapter.lookupDns(host)
    if (dns.error || dns.addresses.length === 0) {
      lastError = dns.error ?? 'no DNS records resolved'
      continue
    }
    if (input.expectedAddresses && input.expectedAddresses.length > 0) {
      const matches = input.expectedAddresses.some((expected) => dns.addresses.includes(expected))
      if (!matches) {
        lastError = 'resolved addresses do not match expected targets'
        continue
      }
    }
    const health = await adapter.checkHealth(normalizeHealthUrl(input.domain, healthPath))
    if (!health.ok) {
      lastError = health.error ?? `health endpoint returned ${health.status ?? 'no status'}`
      continue
    }
    // Verified: persist evidence + readback id (G6 hook).
    return {
      state: 'dns_verified',
      attempts,
      evidence: { dns, health },
      healthReadbackId: `hdr-${now().getTime()}-${host.replace(/[^a-z0-9]/g, '-')}`,
      nextCheckAt: null,
      error: null,
      checkedAt,
    }
  }

  // Exhausted: blocked with next check scheduled (retry semantics), terminal only
  // when the caller decides after maxAttempts is reached with attempts >= max.
  const exhausted = attempts >= maxAttempts
  return {
    state: 'dns_failed',
    attempts,
    evidence: {},
    healthReadbackId: '',
    nextCheckAt: exhausted ? new Date(now().getTime() + retryDelayMs * 4).toISOString() : new Date(now().getTime() + retryDelayMs).toISOString(),
    error: lastError,
    checkedAt,
  }
}
