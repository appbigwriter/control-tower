/**
 * GDB-REM-004/005/006 — handler de criacao de projeto (logica pura).
 * Recebe o cliente Supabase injetado (SupabaseLike) para ser testavel offline.
 * A rota Next.js e apenas um adapter fino.
 */

import {
  autoIdempotencyKey,
  evaluateReadback,
  extractGdbCode,
  jobFailureHttpStatus,
  mapGdbCodeToHttpStatus,
  parseIdempotencyKey,
  provisionFingerprint,
  sanitizeError,
  validateBusinessTypeTemplatePair,
  type HttpResult,
  type SupabaseLike,
} from '@/lib/control-tower/provisioning'

export type CreateProjectInput = {
  name: string
  slug: string
  business_type: string
  template_key: string
  domain?: string | null
  language: string
  organization_slug: string
}

export function parseCreateProjectBody(body: unknown): { ok: true; input: CreateProjectInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Payload invalido: JSON objeto esperado' }

  const raw = body as Record<string, unknown>

  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    return { ok: false, error: 'Payload invalido: name e obrigatorio' }
  }
  if (typeof raw.slug !== 'string' || !/^[a-z0-9_]+$/.test(raw.slug)) {
    return { ok: false, error: 'Payload invalido: slug deve conter apenas letras minusculas, numeros e underscore' }
  }
  if (typeof raw.template_key !== 'string') {
    return { ok: false, error: 'Payload invalido: template_key e obrigatorio' }
  }
  if (raw.domain !== undefined && raw.domain !== null && typeof raw.domain !== 'string') {
    return { ok: false, error: 'Payload invalido: domain deve ser string ou null' }
  }

  const language = raw.language === undefined ? 'pt' : raw.language
  if (typeof language !== 'string' || !['pt', 'en', 'es'].includes(language)) {
    return { ok: false, error: 'Payload invalido: language deve ser pt, en ou es' }
  }

  const organizationSlug = raw.organization_slug === undefined ? 'gestaodb' : raw.organization_slug
  if (typeof organizationSlug !== 'string' || organizationSlug.trim().length === 0) {
    return { ok: false, error: 'Payload invalido: organization_slug deve ser string nao vazia' }
  }

  return {
    ok: true,
    input: {
      name: raw.name.trim(),
      slug: raw.slug,
      business_type: String(raw.business_type ?? ''),
      template_key: raw.template_key,
      domain: typeof raw.domain === 'string' && raw.domain.trim() === '' ? null : (raw.domain as string | null),
      language,
      organization_slug: organizationSlug,
    },
  }
}

/**
 * POST /api/control-tower/projects (core).
 *
 * Garantias:
 * - GDB-REM-004: par business_type/template validado ANTES de qualquer write.
 * - GDB-REM-005: { data, error } da RPC tratado; sem success sem readback.
 * - GDB-REM-006: Idempotency-Key (header) obrigatoria para fluxo automatico;
 *   replay retorna projeto/job original; fingerprint divergente -> 409.
 */
export async function createProjectHandler(
  supabase: SupabaseLike,
  body: unknown,
  idempotencyKeyHeader: string | null,
): Promise<HttpResult> {
  // 1) Parse estrutural
  const parsed = parseCreateProjectBody(body)
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } }
  }
  const input = parsed.input

  // 2) GDB-REM-004: par canonico ANTES de qualquer IO/criacao
  const pair = validateBusinessTypeTemplatePair(input.business_type, input.template_key)
  if (!pair.ok) {
    return { status: 422, body: { error: pair.error, code: pair.code } }
  }

  // 3) GDB-REM-006: idempotencia
  const key = parseIdempotencyKey(idempotencyKeyHeader)
  if (!key.ok) {
    return { status: 400, body: { error: key.error, code: 'GDB_INVALID_IDEMPOTENCY_KEY' } }
  }

  const fingerprint = provisionFingerprint({
    name: input.name,
    slug: input.slug,
    business_type: pair.businessType,
    template_key: pair.templateKey,
    domain: input.domain ?? null,
    language: input.language,
    organization_slug: input.organization_slug,
  })

  // 4) Organizacao
  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', input.organization_slug)
    .maybeSingle()

  if (orgError) {
    return { status: 500, body: { error: sanitizeError(`Erro ao buscar organizacao: ${orgError.message}`) } }
  }

  // 5) RPC v2 (idempotente, com readback)
  const { data, error } = await supabase.rpc('provision_project_v2', {
    p_name: input.name,
    p_slug: input.slug,
    p_business_type: pair.businessType,
    p_template_key: pair.templateKey,
    p_domain: input.domain ?? null,
    p_language: input.language,
    p_organization_id: organization?.id ?? null,
    p_idempotency_key: key.key,
    p_request_fingerprint: fingerprint,
  })

  // GDB-REM-005: tratar explicitamente o retorno { data, error }
  if (error) {
    const message = sanitizeError(error.message)
    const code = extractGdbCode(message) ?? error.code ?? null
    const status = mapGdbCodeToHttpStatus(code)

    // falha de execucao: RPC pode ter persistido job/project em failed/blocked/retrying
    if (data && typeof data === 'object' && 'job_status' in data) {
      const result = data as { job_status?: string; project_id?: string; job_id?: string }
      if (result.job_status && result.job_status !== 'success') {
        return {
          status: jobFailureHttpStatus(result.job_status),
          body: {
            error: message,
            code: code ?? 'GDB_JOB_NOT_SUCCESS',
            job_status: result.job_status,
            project_id: result.project_id ?? null,
            job_id: result.job_id ?? null,
          },
        }
      }
    }

    return { status, body: { error: message, code } }
  }

  if (!data || typeof data !== 'object') {
    return { status: 500, body: { error: 'RPC provision_project_v2 retornou resposta invalida', code: 'GDB_RPC_INVALID_RESPONSE' } }
  }

  const result = data as {
    ok?: boolean
    status?: string
    project_id?: string
    job_id?: string
    job_status?: string
    project_status?: string
    readback?: unknown
    error?: string
  }

  // nunca 200/success sem ok=true E readback validado
  const readbackOk = evaluateReadback(result.readback)
  if (result.ok !== true || !readbackOk.ok || result.job_status !== 'success') {
    return {
      status: result.job_status ? jobFailureHttpStatus(result.job_status) : 500,
      body: {
        error: sanitizeError(result.error ?? 'Provisionamento nao concluido com sucesso'),
        code: 'GDB_JOB_NOT_SUCCESS',
        job_status: result.job_status ?? null,
        project_id: result.project_id ?? null,
        job_id: result.job_id ?? null,
        missing_tables: readbackOk.missing,
      },
    }
  }

  const httpStatus = result.status === 'replayed' || result.status === 'reconciled' ? 200 : 201

  return {
    status: httpStatus,
    body: {
      message:
        result.status === 'replayed'
          ? 'Projeto ja existia (replay idempotente)'
          : result.status === 'reconciled'
            ? 'Projeto existente reconciliado sem duplicacao'
            : 'Projeto provisionado com sucesso',
      project_id: result.project_id,
      job_id: result.job_id,
      project_status: result.project_status ?? 'active',
      job_status: result.job_status,
      idempotency: result.status ?? 'created',
      readback: result.readback,
    },
  }
}

/** Fallback para callers sem chave explicita (UI humana): deriva do fingerprint. */
export function deriveKeyForUiCall(input: {
  name: string
  slug: string
  business_type: string
  template_key: string
  domain?: string | null
  language: string
  organization_slug: string
}): string {
  const fingerprint = provisionFingerprint({
    name: input.name,
    slug: input.slug,
    business_type: input.business_type as 'blog' | 'store' | 'saas' | 'custom',
    template_key: input.template_key as 'blog_standard' | 'store_standard' | 'saas_standard' | 'custom_base',
    domain: input.domain ?? null,
    language: input.language,
    organization_slug: input.organization_slug,
  })
  return autoIdempotencyKey(fingerprint)
}
