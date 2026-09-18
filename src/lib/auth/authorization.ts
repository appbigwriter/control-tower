import { NextRequest, NextResponse } from 'next/server'
import { authenticateToken, hasRequiredScope, type AuthenticatedPrincipal } from './control-tower'
import { buildNamespace } from '@/lib/control-tower/project-configuration'

/**
 * GDB-REM-002 + GDB-REM-002/009 authorization core.
 *
 * Regras:
 * - Autenticacao (middleware ou token) NUNCA substitui autorizacao de negocio.
 *   Toda rota protegida exige principal + scope + tenant aqui.
 * - Sessao de navegador (cookie) nao bypassa autorizacao de escopo/tenant:
 *   sem token de principal, `requireScope` devolve 401.
 * - Tenant: admin/plataforma (fbr/services/*) operam qualquer projeto (limitados
 *   por scope); identities ligadas a projeto (fbr/<segmento>/<uuid>) so operam o
 *   proprio projeto; principals sem namespace reconhecido nao operam nada.
 * - Namespace e sempre derivado do projeto (business_type + id); cliente nao
 *   escolhe namespace divergente (GDB-NEW-07).
 * - actor/created_by e sempre derivado do principal autenticado, nunca do body.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SupabaseLike = { from: (table: string) => any }

export type AuthzFailure = { ok: false; response: NextResponse }
export type AuthzSuccess<T> = { ok: true; value: T }
export type AuthzResult<T> = AuthzSuccess<T> | AuthzFailure

export const KNOWN_SECRET_PROVIDERS = ['easypanel', 'vault', 'local'] as const
export type KnownSecretProvider = (typeof KNOWN_SECRET_PROVIDERS)[number]

/** Namespaces globais explicitamente catalogados: apenas servicos de plataforma. */
export const GLOBAL_SERVICE_NAMESPACE_PATTERN = /^fbr\/services\/[a-z0-9][a-z0-9-]{0,62}\/?$/
const PROJECT_NAMESPACE_PATTERN = /^fbr\/(blogs|store|saas|custom)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type PrincipalTenantClass =
  | { kind: 'admin' }
  | { kind: 'platform_service'; namespace: string }
  | { kind: 'project_bound'; projectId: string; namespace: string }
  | { kind: 'unscoped'; namespace?: string }

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim())
}

export function isValidSecretProvider(provider: string): boolean {
  return (KNOWN_SECRET_PROVIDERS as readonly string[]).includes(provider)
}

export function classifyPrincipalTenant(principal: AuthenticatedPrincipal): PrincipalTenantClass {
  if (principal.type === 'admin') return { kind: 'admin' }

  const ns = principal.namespace?.trim() ?? ''
  if (GLOBAL_SERVICE_NAMESPACE_PATTERN.test(ns)) {
    return { kind: 'platform_service', namespace: ns }
  }

  const match = PROJECT_NAMESPACE_PATTERN.exec(ns)
  if (match && UUID_PATTERN.test(match[2])) {
    return { kind: 'project_bound', projectId: match[2].toLowerCase(), namespace: ns }
  }

  return { kind: 'unscoped', namespace: ns || undefined }
}

export function extractRawToken(req: NextRequest): string | null {
  return req.headers.get('authorization') ?? req.headers.get('x-api-key') ?? null
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized: principal autenticado com token proprio e obrigatorio para autorizacao de negocio' },
    { status: 401 },
  )
}

function forbidden(scope: string): NextResponse {
  return NextResponse.json({ error: `Forbidden: escopo ${scope} necessario` }, { status: 403 })
}

function notFound(message = 'Recurso nao encontrado'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 })
}

/** Exige principal autenticado (token, nao sessao) + scope especifico. */
export async function requireScope(
  req: NextRequest,
  scope: string,
): Promise<AuthzResult<AuthenticatedPrincipal>> {
  const principal = await authenticateToken(extractRawToken(req))
  if (!principal) return { ok: false, response: unauthorized() }
  if (!hasRequiredScope(principal, scope)) return { ok: false, response: forbidden(scope) }
  return { ok: true, value: principal }
}

/** Exige principal autenticado + qualquer um dos scopes informados. */
export async function requireAnyScope(
  req: NextRequest,
  scopes: string[],
): Promise<AuthzResult<AuthenticatedPrincipal>> {
  const principal = await authenticateToken(extractRawToken(req))
  if (!principal) return { ok: false, response: unauthorized() }
  if (!scopes.some((scope) => hasRequiredScope(principal, scope))) {
    return { ok: false, response: forbidden(scopes.join(' ou ')) }
  }
  return { ok: true, value: principal }
}

export interface ProjectTenantRecord {
  id: string
  slug: string
  name: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  organization_id: string | null
  schema_name: string
  status: string
}

export async function loadProjectTenant(
  supabase: SupabaseLike,
  projectId: string,
): Promise<ProjectTenantRecord | null> {
  if (!isUuid(projectId)) return null
  const { data, error } = await supabase
    .from('projects')
    .select('id, slug, name, business_type, organization_id, schema_name, status')
    .eq('id', projectId)
    .maybeSingle()
  if (error || !data) return null
  return data as ProjectTenantRecord
}

/** Namespace canonico: derivado exclusivamente do projeto (GDB-REM-009). */
export function deriveProjectNamespace(
  project: Pick<ProjectTenantRecord, 'id' | 'business_type' | 'schema_name'>,
): string {
  return buildNamespace({
    id: project.id,
    business_type: project.business_type,
    schema_name: project.schema_name ?? '',
    domain: null,
  })
}

/**
 * Decisao de tenant sobre um projeto.
 * - admin / plataforma: liberados (scope ja verificado antes).
 * - project_bound: somente o proprio projeto E com organizacao vinculada
 *   (organization nula enfraquece isolamento de tenant - ver auditoria).
 * - unscoped: negado.
 * Cross-tenant devolve 404 para nao vazar existencia do recurso.
 */
function tenantDecision(
  tenantClass: PrincipalTenantClass,
  project: ProjectTenantRecord,
): NextResponse | null {
  switch (tenantClass.kind) {
    case 'admin':
    case 'platform_service':
      return null
    case 'project_bound':
      if (tenantClass.projectId !== project.id.toLowerCase()) {
        return notFound()
      }
      if (!project.organization_id) {
        return NextResponse.json(
          { error: 'Forbidden: projeto sem organizacao vinculada; acesso restrito a administradores' },
          { status: 403 },
        )
      }
      return null
    default:
      return NextResponse.json(
        { error: 'Forbidden: principal sem tenant atribuido' },
        { status: 403 },
      )
  }
}

/** Autorizacao de acesso a um projeto para um principal ja autenticado. */
export async function authorizeProjectAccess(
  principal: AuthenticatedPrincipal,
  supabase: SupabaseLike,
  projectId: string,
): Promise<AuthzResult<{ project: ProjectTenantRecord; tenantClass: PrincipalTenantClass }>> {
  const tenantClass = classifyPrincipalTenant(principal)

  const project = await loadProjectTenant(supabase, projectId)
  if (!project) return { ok: false, response: notFound('Projeto nao encontrado') }

  const denied = tenantDecision(tenantClass, project)
  if (denied) return { ok: false, response: denied }

  return { ok: true, value: { project, tenantClass } }
}

export interface SecretNamespaceRecord {
  id: string
  project_id: string | null
  namespace: string
  provider: string
  status: string
}

export async function loadSecretNamespace(
  supabase: SupabaseLike,
  namespaceId: string,
): Promise<SecretNamespaceRecord | null> {
  const { data, error } = await supabase
    .from('secret_namespaces')
    .select('id, project_id, namespace, provider, status')
    .eq('id', namespaceId)
    .maybeSingle()
  if (error || !data) return null
  return data as SecretNamespaceRecord
}

/**
 * Autorizacao sobre um secret namespace validando a cadeia
 * namespace -> project -> organization (GDB-REM-009).
 *
 * - Namespace de projeto: exige projeto existente + tenant do principal.
 * - Namespace global (project_id null): somente admin/plataforma; escrita por
 *   project_bound e negada, leitura devolve 404 (sem vazamento).
 * - Cadeia quebrada (namespace aponta para projeto inexistente): 422 para admin
 *   (problema de integridade visivel), 404 para os demais.
 */
export async function authorizeNamespaceAccess(
  principal: AuthenticatedPrincipal,
  supabase: SupabaseLike,
  namespaceId: string,
  opts: { write: boolean },
): Promise<AuthzResult<{ namespace: SecretNamespaceRecord; project: ProjectTenantRecord | null; tenantClass: PrincipalTenantClass }>> {
  const tenantClass = classifyPrincipalTenant(principal)

  const namespace = await loadSecretNamespace(supabase, namespaceId)
  if (!namespace) return { ok: false, response: notFound('Namespace nao encontrado') }

  if (namespace.project_id) {
    const project = await loadProjectTenant(supabase, namespace.project_id)
    if (!project) {
      if (tenantClass.kind === 'admin') {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Namespace aponta para projeto inexistente (cadeia namespace->projeto quebrada)' },
            { status: 422 },
          ),
        }
      }
      return { ok: false, response: notFound('Namespace nao encontrado') }
    }

    const denied = tenantDecision(tenantClass, project)
    if (denied) return { ok: false, response: denied }

    return { ok: true, value: { namespace, project, tenantClass } }
  }

  // Namespace global (sem projeto)
  if (tenantClass.kind === 'admin' || tenantClass.kind === 'platform_service') {
    return { ok: true, value: { namespace, project: null, tenantClass } }
  }
  if (tenantClass.kind === 'project_bound') {
    if (opts.write) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Forbidden: escrita em namespace global restrita a administradores e servicos de plataforma' },
          { status: 403 },
        ),
      }
    }
    return { ok: false, response: notFound('Namespace nao encontrado') }
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'Forbidden: principal sem tenant atribuido' },
      { status: 403 },
    ),
  }
}
