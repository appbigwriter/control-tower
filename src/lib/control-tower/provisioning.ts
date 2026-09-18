import { createHash } from 'node:crypto'

/**
 * GDB-REM-004..007 — Regras canonicas de provisionamento do Control Tower.
 * Modulo puro (sem rede, sem IO): toda regra aqui e testavel offline e e a
 * fonte unica usada pelas rotas de projects/actions e espelhada na migration
 * 012_gdb_rem_004_007_integrity.sql (RPC/trigger). Qualquer mudanca aqui
 * exige sincronizar a migration.
 */

// ---------------------------------------------------------------------------
// GDB-REM-004 — correspondencia canônica business_type -> template_key
// ---------------------------------------------------------------------------

export const BUSINESS_TYPES = ['blog', 'store', 'saas', 'custom'] as const
export const TEMPLATE_KEYS = ['blog_standard', 'store_standard', 'saas_standard', 'custom_base'] as const

export type BusinessType = (typeof BUSINESS_TYPES)[number]
export type TemplateKey = (typeof TEMPLATE_KEYS)[number]

/** Mapa canonico: blog->blog_standard, store->store_standard, saas->saas_standard, custom->custom_base. */
export const TEMPLATE_FOR_BUSINESS_TYPE: Record<BusinessType, TemplateKey> = {
  blog: 'blog_standard',
  store: 'store_standard',
  saas: 'saas_standard',
  custom: 'custom_base',
}

export type TemplatePairValidation =
  | { ok: true; businessType: BusinessType; templateKey: TemplateKey }
  | { ok: false; code: 'GDB_INVALID_BUSINESS_TYPE' | 'GDB_TEMPLATE_MISMATCH'; error: string }

/** Valida o PAR (business_type, template_key). Retorna 422-code quando invalido. */
export function validateBusinessTypeTemplatePair(
  businessType: unknown,
  templateKey: unknown,
): TemplatePairValidation {
  if (!BUSINESS_TYPES.includes(businessType as BusinessType)) {
    return {
      ok: false,
      code: 'GDB_INVALID_BUSINESS_TYPE',
      error: `business_type invalido: ${String(businessType)}. Valores aceitos: ${BUSINESS_TYPES.join(', ')}`,
    }
  }

  const expected = TEMPLATE_FOR_BUSINESS_TYPE[businessType as BusinessType]

  if (templateKey !== expected) {
    return {
      ok: false,
      code: 'GDB_TEMPLATE_MISMATCH',
      error: `template_key invalido para business_type "${String(businessType)}": esperado "${expected}", recebido "${String(templateKey)}"`,
    }
  }

  return { ok: true, businessType: businessType as BusinessType, templateKey: expected }
}

// ---------------------------------------------------------------------------
// Readback estrutural — tabelas esperadas por business_type (GDB-REM-005)
// ---------------------------------------------------------------------------

/** Tabelas core que DEVEN existir apos provisionar/rebuild (espelha expected_tables_for_type na migration). */
export const EXPECTED_TABLES_BY_TYPE: Record<BusinessType, readonly string[]> = {
  blog: [
    'articles', 'categories', 'authors', 'tags', 'article_tags', 'media_assets',
    'redirects', 'settings', 'site_config',
  ],
  store: [
    'products', 'categories', 'product_images', 'variants', 'customers',
    'orders', 'order_items', 'inventory_movements', 'settings',
  ],
  saas: [
    'organizations', 'workspaces', 'workspace_members', 'plans', 'subscriptions',
    'subscription_items', 'billing_accounts', 'invoices', 'usage_events',
    'feature_flags', 'api_keys', 'notifications', 'settings',
  ],
  custom: [
    'entities', 'entity_relations', 'records', 'files', 'settings', 'audit_logs', 'events',
  ],
}

export type SchemaReadback = {
  schema_exists: boolean
  expected_tables: string[]
  missing_tables: string[]
  verified_at?: string
}

/**
 * Avalia um readback retornado pela RPC verify_project_schema.
 * Sucesso exige schema existente E nenhuma tabela esperada ausente.
 */
export function evaluateReadback(readback: unknown): { ok: boolean; missing: string[]; schemaExists: boolean } {
  if (!readback || typeof readback !== 'object') {
    return { ok: false, missing: [], schemaExists: false }
  }

  const rb = readback as Partial<SchemaReadback>
  const missing = Array.isArray(rb.missing_tables) ? rb.missing_tables.filter((t): t is string => typeof t === 'string') : []
  const schemaExists = rb.schema_exists === true

  return { ok: schemaExists && missing.length === 0, missing, schemaExists }
}

// ---------------------------------------------------------------------------
// GDB-REM-006 — idempotencia: chave e fingerprint
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_OPERATIONS = ['provision_project', 'rebuild_schema'] as const
export type IdempotencyOperation = (typeof IDEMPOTENCY_OPERATIONS)[number]

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export type IdempotencyKeyValidation =
  | { ok: true; key: string }
  | { ok: false; error: string }

/** Aceita header Idempotency-Key ou correlation_id com formato estrito. */
export function parseIdempotencyKey(raw: string | null | undefined): IdempotencyKeyValidation {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: false, error: 'Idempotency-Key ausente' }
  }

  const key = String(raw).trim()

  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      error: 'Idempotency-Key invalido: 8-128 caracteres, apenas letras, numeros, ponto, underline, hifen e dois-pontos',
    }
  }

  return { ok: true, key }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** Fingerprint deterministico (sha256) do request; independe da ordem das chaves. */
export function computeRequestFingerprint(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

export function provisionFingerprint(input: {
  name: string
  slug: string
  business_type: BusinessType
  template_key: TemplateKey
  domain: string | null
  language: string
  organization_slug: string
}): string {
  return computeRequestFingerprint({
    operation: 'provision_project',
    name: input.name,
    slug: input.slug,
    business_type: input.business_type,
    template_key: input.template_key,
    domain: input.domain ?? null,
    language: input.language,
    organization_slug: input.organization_slug,
  })
}

export function rebuildFingerprint(input: {
  slug: string
  schema_name: string
  business_type: BusinessType
}): string {
  return computeRequestFingerprint({
    operation: 'rebuild_schema',
    slug: input.slug,
    schema_name: input.schema_name,
    business_type: input.business_type,
  })
}

// ---------------------------------------------------------------------------
// Sanitizacao de erros — nada de secret/connection string em resposta/log
// ---------------------------------------------------------------------------

const MAX_ERROR_LENGTH = 500

const REDACTIONS: readonly [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[redacted-connection-string]'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer [redacted]'],
  [/eyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]'],
  [/\b(service_role|anon)[=_:\s]+[^\s'"]+/gi, '$1=[redacted]'],
  [/\b(password|secret|token|api[_-]?key)[=_:\s]+[^\s'"]+/gi, '$1=[redacted]'],
]

/** Sanitiza mensagem de erro: redige padroes sensiveis, colapsa whitespace, trunca em 500 chars. */
export function sanitizeError(message: unknown): string {
  let text = message instanceof Error ? message.message : String(message ?? 'erro desconhecido')

  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement)
  }

  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()

  if (text.length > MAX_ERROR_LENGTH) {
    text = `${text.slice(0, MAX_ERROR_LENGTH)}…[truncado]`
  }

  return text
}

// ---------------------------------------------------------------------------
// GDB-REM-005/007 — classificacao de falha RPC -> proximo estado do job
// ---------------------------------------------------------------------------

export type FailureClassification = 'retrying' | 'blocked' | 'failed'

const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57014', // query_canceled (timeout)
  '08000', '08001', '08003', '08004', '08006', // connection exceptions
])

const BLOCKED_PG_CODES = new Set([
  '55P03', // lock_not_available
  '55006', // object_in_use
])

const RETRYABLE_MESSAGE_PATTERN = /timeout|timed out|connection|network|econnreset|fetch failed|temporarily unavailable/i

/**
 * Classifica uma falha de RPC em retrying | blocked | failed.
 * Readback incompleto -> blocked (estado parcial, nunca active/success).
 */
export function classifyRpcFailure(input: { code?: string | null; message?: string | null }): FailureClassification {
  const message = input.message ?? ''

  if (message.startsWith('GDB_SCHEMA_READBACK_INCOMPLETE')) return 'blocked'
  if (input.code && BLOCKED_PG_CODES.has(input.code)) return 'blocked'

  if (input.code && RETRYABLE_PG_CODES.has(input.code)) return 'retrying'
  if (RETRYABLE_MESSAGE_PATTERN.test(message)) return 'retrying'

  return 'failed'
}

// ---------------------------------------------------------------------------
// GDB-REM-007 — retry policy
// ---------------------------------------------------------------------------

export const MAX_JOB_ATTEMPTS = 5
const RETRY_BASE_DELAY_MS = 5_000
const RETRY_MAX_DELAY_MS = 10 * 60_000

/** Backoff exponencial: 5s, 10s, 20s... teto de 10min. Deterministico dado `from`. */
export function computeNextRetryAt(attemptCount: number, from: Date = new Date()): string {
  const safeAttempts = Math.max(1, Math.floor(attemptCount))
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (safeAttempts - 1), RETRY_MAX_DELAY_MS)
  return new Date(from.getTime() + delay).toISOString()
}

export function defaultBlockedNextCheckAt(from: Date = new Date()): string {
  return new Date(from.getTime() + 10 * 60_000).toISOString()
}

// ---------------------------------------------------------------------------
// GDB-REM-007 — maquina de estados canônica (project e job)
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  'pending', 'active', 'archived', 'failed', 'blocked', 'retrying', 'waiting_external',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const JOB_STATUSES = [
  'pending', 'running', 'success', 'failed', 'blocked', 'retrying', 'waiting_external',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** 'error' e legado e normaliza para 'failed' (aliases aceitos em leitura, nunca gravados). */
export function normalizeLegacyStatus(status: string): ProjectStatus | JobStatus {
  return status === 'error' ? 'failed' : (status as ProjectStatus | JobStatus)
}

export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  pending: ['active', 'archived', 'failed', 'blocked', 'waiting_external', 'retrying'],
  active: ['archived', 'failed', 'blocked', 'waiting_external', 'retrying'],
  archived: ['active'],
  blocked: ['pending', 'retrying', 'failed', 'active'],
  failed: ['pending', 'retrying', 'active'],
  waiting_external: ['retrying', 'blocked', 'active', 'failed'],
  retrying: ['active', 'failed', 'blocked', 'waiting_external', 'retrying'],
}

export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['running', 'blocked', 'failed'],
  running: ['success', 'failed', 'retrying', 'blocked', 'waiting_external'],
  retrying: ['running', 'failed', 'blocked'],
  waiting_external: ['running', 'blocked', 'failed'],
  blocked: ['running', 'pending', 'failed'],
  failed: ['retrying'],
  success: [], // terminal: novo trabalho exige novo job
}

export class InvalidTransitionError extends Error {
  readonly code = 'GDB_INVALID_TRANSITION'
  readonly entityType: 'project' | 'job'
  readonly from: string
  readonly to: string

  constructor(entityType: 'project' | 'job', from: string, to: string) {
    super(`Transicao invalida para ${entityType}: "${from}" -> "${to}" nao permitida`)
    this.name = 'InvalidTransitionError'
    this.entityType = entityType
    this.from = from
    this.to = to
  }
}

export function canTransition(
  entityType: 'project' | 'job',
  from: string,
  to: string,
): boolean {
  const table = entityType === 'project' ? PROJECT_TRANSITIONS : JOB_TRANSITIONS
  const normalizedFrom = normalizeLegacyStatus(from)
  const normalizedTo = normalizeLegacyStatus(to)

  if (normalizedFrom === normalizedTo) return true // no-op
  const allowed = (table as Record<string, readonly string[]>)[normalizedFrom]
  return Array.isArray(allowed) && allowed.includes(normalizedTo)
}

/** Lanca InvalidTransitionError (code GDB_INVALID_TRANSITION) em transicao proibida. */
export function assertTransition(entityType: 'project' | 'job', from: string, to: string): void {
  if (!canTransition(entityType, from, to)) {
    throw new InvalidTransitionError(entityType, from, to)
  }
}

/** Metadados obrigatorios de um blocker (owner, nextCheck, criterio de fechamento). */
export type BlockerMetadata = {
  blocked_owner: string
  next_check_at: string
  closure_criterion: string
  blocked_reason: string
}

export function buildBlockerMetadata(reason: string, from: Date = new Date()): BlockerMetadata {
  return {
    blocked_owner: 'control-tower-ops',
    next_check_at: defaultBlockedNextCheckAt(from),
    closure_criterion: 'readback do schema retorna schema_exists=true e missing_tables=vazio',
    blocked_reason: sanitizeError(reason),
  }
}

// ---------------------------------------------------------------------------
// Tipagem estrutural do cliente Supabase (injetavel para testes offline)
// ---------------------------------------------------------------------------

export type SupabaseError = { message: string; code?: string; details?: unknown; hint?: unknown }

export type SupabaseResult<T = unknown> = { data: T | null; error: SupabaseError | null }

export type SupabaseTable = any

export interface SupabaseLike {
  from(table: string): any
  rpc(functionName: string, args?: Record<string, unknown>): PromiseLike<any>
}

export type HttpResult = { status: number; body: Record<string, unknown> }

/** Extrai code GDB_* do inicio de uma mensagem de erro (padrao da migration 012). */
export function extractGdbCode(message: string): string | null {
  const match = /^([A-Z][A-Z0-9_]{3,}):/.exec(message.trim())
  return match ? match[1] : null
}

/** Mapeia codes GDB_* (errcode da migration 012) para status HTTP canonico. */
export function mapGdbCodeToHttpStatus(code: string | null | undefined): number {
  switch (code) {
    case 'GDB_TEMPLATE_MISMATCH':
    case 'GDB_INVALID_BUSINESS_TYPE':
    case 'GDB_TEMPLATE_INACTIVE_OR_MISSING':
      return 422
    case 'GDB_IDEMPOTENCY_KEY_CONFLICT':
    case 'GDB_SLUG_CONFLICT':
    case 'GDB_SLUG_CONFLICT_RECONCILE':
    case 'GDB_INVALID_TRANSITION':
      return 409
    case 'GDB_INVALID_IDEMPOTENCY_KEY':
      return 400
    case 'GDB_PROJECT_NOT_FOUND':
      return 404
    default:
      return 500
  }
}

/** Status HTTP para resultado de job que NAO terminou em success. */
export function jobFailureHttpStatus(jobStatus: string): number {
  if (jobStatus === 'retrying' || jobStatus === 'blocked' || jobStatus === 'waiting_external') return 503
  return 500
}

/** Chave automatica deterministica quando o caller nao envia Idempotency-Key. */
export function autoIdempotencyKey(fingerprint: string): string {
  return `auto:${fingerprint.slice(0, 40)}`
}
