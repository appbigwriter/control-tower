/**
 * GDB-REM-004/005/006/007 — handler de acoes de projeto (archive/rebuild).
 * Logica pura com SupabaseLike injetado (testavel offline). A rota Next.js e
 * um adapter fino.
 */

import {
  buildBlockerMetadata,
  computeNextRetryAt,
  evaluateReadback,
  extractGdbCode,
  jobFailureHttpStatus,
  mapGdbCodeToHttpStatus,
  parseIdempotencyKey,
  rebuildFingerprint,
  sanitizeError,
  validateBusinessTypeTemplatePair,
  type HttpResult,
  type SupabaseLike,
} from '@/lib/control-tower/provisioning'
import { rebuildProjectSchema } from '@/lib/control-tower/actions'

export type ProjectRecord = {
  id: string
  name: string
  slug: string
  business_type: string
  template_key: string
  schema_name: string
  domain: string | null
  language: string
  status: string
  template_version: string
}

export async function loadProject(supabase: SupabaseLike, slug: string): Promise<ProjectRecord | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, slug, business_type, template_key, schema_name, domain, language, status, template_version')
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as ProjectRecord
}

type Json = Record<string, unknown>

/** archive com transicao validada (status atual != archived) e audit obrigatorio. */
export async function archiveProject(supabase: SupabaseLike, project: ProjectRecord): Promise<HttpResult> {
  if (project.status === 'archived') {
    return { status: 200, body: { message: 'Projeto ja estava arquivado', idempotent: true } }
  }

  // Transicao validada no banco pelo trigger; aqui apenas envidiamos os dados.
  const { data: updated, error: updateError } = await supabase
    .from('projects')
    .update({ status: 'archived' })
    .eq('id', project.id)
    .select('id, status')
    .single()

  if (updateError) {
    const message = sanitizeError(updateError.message)
    const code = extractGdbCode(message)
    return { status: mapGdbCodeToHttpStatus(code) === 500 ? 500 : mapGdbCodeToHttpStatus(code), body: { error: message, code } }
  }
  if (!updated) {
    return { status: 500, body: { error: 'Falha ao arquivar projeto' } }
  }

  // audit obrigatorio (GDB-REM-011 pre-view): falha aqui deixa estado documentado
  const { error: auditError } = await supabase.from('audit_logs').insert({
    project_id: project.id,
    action: 'project.archived',
    resource_type: 'project',
    resource_id: project.id,
    metadata: { slug: project.slug, previous_status: project.status },
  })

  if (auditError) {
    return {
      status: 500,
      body: {
        error: sanitizeError(`Projeto arquivado mas audit falhou: ${auditError.message}`),
        code: 'GDB_AUDIT_PERSIST_FAILED',
        state: 'archived_sem_audit',
      },
    }
  }

  return { status: 200, body: { message: 'Projeto arquivado com sucesso' } }
}

/**
 * rebuild via RPC rebuild_project_schema_v2 (GDB-REM-005/006/007):
 * - sucesso SOMENTE apos readback estrutural dentro da RPC;
 * - retry reusa o MESMO job (attempt_count, next_retry_at, last_error);
 * - falha classificada em failed/blocked/retrying com blocker metadata.
 */
export async function rebuildProject(
  supabase: SupabaseLike,
  project: ProjectRecord,
  idempotencyKeyHeader: string | null,
): Promise<HttpResult> {
  // GDB-REM-004 (defesa em profundidade): par armazenado deve ser canonico
  const pair = validateBusinessTypeTemplatePair(project.business_type, project.template_key)
  if (!pair.ok) {
    return {
      status: 422,
      body: {
        error: `Projeto catalogado com par business_type/template invalido; rebuild bloqueado. ${pair.error}`,
        code: pair.code,
        hint: 'Corrigir catalogo antes de rebuild',
      },
    }
  }

  const key = parseIdempotencyKey(idempotencyKeyHeader)
  if (!key.ok) {
    return { status: 400, body: { error: key.error, code: 'GDB_INVALID_IDEMPOTENCY_KEY' } }
  }

  const fingerprint = rebuildFingerprint({
    slug: project.slug,
    schema_name: project.schema_name,
    business_type: pair.businessType,
  })

  const { data, error } = await supabase.rpc('rebuild_project_schema_v2', {
    p_project_id: project.id,
    p_schema_name: project.schema_name,
    p_business_type: pair.businessType,
    p_template_key: pair.templateKey,
    p_idempotency_key: key.key,
    p_request_fingerprint: fingerprint,
  })

  if (error) {
    const isMissingV2 =
      error.message?.includes('rebuild_project_schema_v2') ||
      error.message?.includes('Could not find the function') ||
      error.code === 'PGRST202' ||
      error.code === '42883'

    if (isMissingV2) {
      const fallbackResult = await rebuildProjectSchema(supabase as any, project as any, 'control-tower-admin')
      return {
        status: fallbackResult.httpStatus,
        body: {
          message: fallbackResult.message,
          job_status: fallbackResult.ok ? 'success' : 'error',
          project_status: fallbackResult.ok ? 'active' : 'error',
        },
      }
    }

    const message = sanitizeError(error.message)
    const code = extractGdbCode(message) ?? error.code ?? null
    return { status: mapGdbCodeToHttpStatus(code), body: { error: message, code } }
  }

  if (!data || typeof data !== 'object') {
    return { status: 500, body: { error: 'RPC rebuild_project_schema_v2 retornou resposta invalida', code: 'GDB_RPC_INVALID_RESPONSE' } }
  }

  const result = data as {
    ok?: boolean
    status?: string
    job_id?: string
    job_status?: string
    project_status?: string
    readback?: unknown
    error?: string
    next_retry_at?: string | null
  }

  const readbackOk = evaluateReadback(result.readback)

  if (result.ok !== true || result.job_status !== 'success' || !readbackOk.ok) {
    const jobStatus = result.job_status ?? 'failed'
    return {
      status: jobFailureHttpStatus(jobStatus),
      body: {
        error: sanitizeError(result.error ?? 'Rebuild nao concluido com sucesso'),
        code: 'GDB_JOB_NOT_SUCCESS',
        job_id: result.job_id ?? null,
        job_status: jobStatus,
        next_retry_at: result.next_retry_at ?? null,
        ...(jobStatus === 'blocked' ? { blocked: buildBlockerMetadata(result.error ?? 'readback incompleto') } : {}),
      },
    }
  }

  return {
    status: result.status === 'replayed' ? 200 : 200,
    body: {
      message: result.status === 'replayed' ? 'Rebuild ja havia concluido (replay idempotente)' : 'Schema reexecutado com sucesso apos readback',
      job_id: result.job_id,
      job_status: result.job_status,
      project_status: result.project_status ?? 'active',
      idempotency: result.status ?? 'created',
      readback: result.readback,
    },
  }
}

export async function projectActionsHandler(
  supabase: SupabaseLike,
  slug: string,
  body: unknown,
  idempotencyKeyHeader: string | null,
): Promise<HttpResult> {
  const raw = (body && typeof body === 'object' ? body : {}) as { action?: unknown }
  const action = typeof raw.action === 'string' ? raw.action : null

  if (action !== 'archive' && action !== 'rebuild') {
    return { status: 400, body: { error: 'Acao invalida: use "archive" ou "rebuild"' } }
  }

  const project = await loadProject(supabase, slug)
  if (!project) {
    return { status: 404, body: { error: 'Projeto nao encontrado' } }
  }

  if (action === 'archive') return archiveProject(supabase, project)
  return rebuildProject(supabase, project, idempotencyKeyHeader)
}

/** Helper exposto para a UI/roteiro de retry manual computar quando tentar de novo. */
export function nextRetryAdvice(job: { status: string; attempt_count?: number | null; next_retry_at?: string | null }): Json | null {
  if (job.status !== 'retrying') return null
  const attempts = job.attempt_count ?? 1
  return {
    attempt_count: attempts,
    next_retry_at: job.next_retry_at ?? computeNextRetryAt(attempts),
    advice: 'aguardar next_retry_at antes de nova tentativa',
  }
}
