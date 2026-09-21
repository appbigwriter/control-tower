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
  deriveHostingTarget,
  validateHostingProject,
  type HttpResult,
  type HostingTarget,
  type HostingProjectName,
  type SupabaseLike,
} from '@/lib/control-tower/provisioning'

export type CreateProjectInput = {
  name: string
  slug: string
  business_type: string
  template_key: string
  domain: string
  repository_url: string
  hosting_target: HostingTarget
  hosting_project_name: HostingProjectName
  language: string
  organization_slug: string
}

function runtimeMetadata(input: CreateProjectInput) {
  const target = deriveHostingTarget(input.hosting_target, input.name, input.hosting_project_name)
  return {
    repository_url: input.repository_url,
    hosting_target: target.target,
    hosting_project_name: target.projectName,
    service_name: target.serviceName,
  }
}

async function persistRuntimeMetadata(supabase: SupabaseLike, projectId: string, input: CreateProjectInput) {
  const metadata = runtimeMetadata(input)
  const { data, error } = await supabase
    .from('projects')
    .update(metadata)
    .eq('id', projectId)
    .select('id, repository_url, hosting_target, hosting_project_name, service_name')
    .single()
  if (error || !data) return { ok: false as const, error: error?.message ?? 'runtime metadata readback missing' }
  return { ok: true as const, data }
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
  if (typeof raw.domain !== 'string' || raw.domain.trim().length === 0) {
    return { ok: false, error: 'Payload invalido: domain e obrigatorio' }
  }
  if (typeof raw.repository_url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(raw.repository_url.trim())) {
    return { ok: false, error: 'Payload invalido: repository_url deve ser uma URL http(s) obrigatoria' }
  }
  if (raw.hosting_target !== 'vps1' && raw.hosting_target !== 'vps2') {
    return { ok: false, error: 'Payload invalido: hosting_target deve ser vps1 ou vps2' }
  }
  if (raw.hosting_project_name !== 'sistemas' && raw.hosting_project_name !== 'blogs' && raw.hosting_project_name !== 'projetos') {
    return { ok: false, error: 'Payload invalido: hosting_project_name deve ser sistemas, blogs ou projetos' }
  }
  if (!validateHostingProject(raw.hosting_project_name, raw.hosting_target)) {
    return { ok: false, error: 'Payload invalido: hosting_project_name nao corresponde ao hosting_target' }
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
      domain: raw.domain.trim(),
      repository_url: raw.repository_url.trim(),
      hosting_target: raw.hosting_target,
      hosting_project_name: raw.hosting_project_name,
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
    repository_url: input.repository_url,
    hosting_target: input.hosting_target,
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
    const isMissingV2 =
      error.message?.includes('provision_project_v2') ||
      error.message?.includes('Could not find the function') ||
      error.code === 'PGRST202' ||
      error.code === '42883'

    // Fallback gracioso para provision_project legado (7 parâmetros) se a migration 012 ainda não foi aplicada
    if (isMissingV2) {
      const legacyRpc = await supabase.rpc('provision_project', {
        p_name: input.name,
        p_slug: input.slug,
        p_business_type: pair.businessType,
        p_template_key: pair.templateKey,
        p_domain: input.domain ?? null,
        p_language: input.language,
        p_organization_id: organization?.id ?? null,
      })

      if (legacyRpc.error) {
        const msg = sanitizeError(legacyRpc.error.message)
        return { status: 500, body: { error: msg, code: extractGdbCode(msg) } }
      }

      const projectId = typeof legacyRpc.data === 'string' ? legacyRpc.data : (legacyRpc.data as any)?.id ?? legacyRpc.data
      const schemaPrefix = pair.businessType === 'blog' ? 'blog' : pair.businessType === 'store' ? 'store' : pair.businessType === 'saas' ? 'saas' : 'custom'
      const schemaName = `${schemaPrefix}_${input.slug}`

      const runtime = await persistRuntimeMetadata(supabase, String(projectId), input)
      if (!runtime.ok) return { status: 500, body: { error: sanitizeError(`Falha ao registrar target de runtime: ${runtime.error}`), code: 'GDB_RUNTIME_TARGET_READBACK_FAILED' } }

      return {
        status: 201,
        body: {
          message: 'Projeto provisionado com sucesso',
          project_id: projectId,
          project_status: 'active',
          job_status: 'success',
          idempotency: 'created',
          schema_name: schemaName,
        },
      }
    }

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

  const runtime = await persistRuntimeMetadata(supabase, result.project_id as string, input)
  if (!runtime.ok) return { status: 500, body: { error: sanitizeError(`Falha ao registrar target de runtime: ${runtime.error}`), code: 'GDB_RUNTIME_TARGET_READBACK_FAILED' } }

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
  repository_url: string
  hosting_target: HostingTarget
}): string {
  const fingerprint = provisionFingerprint({
    name: input.name,
    slug: input.slug,
    business_type: input.business_type as 'blog' | 'store' | 'saas' | 'custom',
    template_key: input.template_key as 'blog_standard' | 'store_standard' | 'saas_standard' | 'custom_base',
    domain: input.domain ?? null,
    language: input.language,
    organization_slug: input.organization_slug,
    repository_url: input.repository_url,
    hosting_target: input.hosting_target,
  })
  return autoIdempotencyKey(fingerprint)
}
