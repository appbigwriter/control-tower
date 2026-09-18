import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  authorizeProjectAccess,
  classifyPrincipalTenant,
  deriveProjectNamespace,
  extractRawToken,
  GLOBAL_SERVICE_NAMESPACE_PATTERN,
  isUuid,
  isValidSecretProvider,
  requireAnyScope,
  requireScope,
} from '@/lib/auth/authorization'
import type { AuthenticatedPrincipal } from '@/lib/auth/control-tower'

export const dynamic = 'force-dynamic'

function normalizeNamespace(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

async function insertAudit(
  supabase: ReturnType<typeof createServiceRoleClient>,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase.from('audit_logs').insert(payload)
  if (error) {
    console.error('[secrets/namespaces] audit insert failed:', error)
    return false
  }
  return true
}

export async function POST(req: NextRequest) {
  try {
    // GDB-REM-002: principal autenticado (token proprio) + scope especifico.
    // Sessao de navegador (cookie) NAO autoriaza esta rota.
    const authz = await requireScope(req, 'secrets:namespaces:create')
    if (!authz.ok) return authz.response
    const principal = authz.value

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Payload inválido: JSON obrigatório' }, { status: 400 })
    }

    const { project_id: rawProjectId, namespace: clientNamespace, provider = 'easypanel' } = body as {
      project_id?: unknown
      namespace?: unknown
      provider?: unknown
    }

    // GDB-REM-009: provider deve estar catalogado server-side.
    if (typeof provider !== 'string' || !isValidSecretProvider(provider)) {
      return NextResponse.json(
        { error: `Provider inválido. Permitidos: easypanel, vault, local` },
        { status: 422 },
      )
    }

    const supabase = createServiceRoleClient()
    const tenantClass = classifyPrincipalTenant(principal)

    // GDB-REM-009: created_by/actor é SEMPRE derivado do principal autenticado;
    // qualquer valor enviado pelo cliente é ignorado.
    const actor = principal.name

    // ---- Namespace global (project_id ausente): apenas catalogado + admin/plataforma
    if (rawProjectId === null || rawProjectId === undefined || rawProjectId === '') {
      if (tenantClass.kind !== 'admin' && tenantClass.kind !== 'platform_service') {
        return NextResponse.json(
          { error: 'Forbidden: namespace global requer principal admin ou serviço de plataforma' },
          { status: 403 },
        )
      }
      const namespace = typeof clientNamespace === 'string' ? clientNamespace.trim() : ''
      if (!GLOBAL_SERVICE_NAMESPACE_PATTERN.test(namespace)) {
        return NextResponse.json(
          { error: 'Namespace global deve seguir o padrão catalogado fbr/services/<nome>/' },
          { status: 422 },
        )
      }

      const { data: existing } = await supabase
        .from('secret_namespaces')
        .select('id, project_id, namespace')
        .eq('namespace', namespace)
        .maybeSingle()

      if (existing && existing.project_id) {
        return NextResponse.json(
          { error: 'Conflito: namespace já registrado e vinculado a um projeto' },
          { status: 409 },
        )
      }

      const { data, error } = await supabase
        .from('secret_namespaces')
        .upsert(
          {
            project_id: null,
            namespace,
            provider,
            status: 'active',
            created_by: actor,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'namespace' },
        )
        .select()
        .single()

      if (error || !data) {
        console.error('[secrets/namespaces] global upsert error:', error)
        return NextResponse.json({ error: 'Falha ao registrar secret namespace global' }, { status: 500 })
      }

      const audited = await insertAudit(supabase, {
        action: 'secrets.namespace.registered',
        resource_type: 'secret_namespace',
        resource_id: data.id,
        metadata: { namespace, provider, global: true, actor },
      })
      if (!audited) {
        return NextResponse.json({ error: 'Falha ao registrar auditoria do namespace' }, { status: 500 })
      }

      return NextResponse.json({ message: 'Secret namespace global registrado', namespace: data }, { status: 201 })
    }

    // ---- Namespace de projeto: derivação obrigatória + tenant check
    if (typeof rawProjectId !== 'string' || !isUuid(rawProjectId)) {
      return NextResponse.json({ error: 'project_id inválido (uuid obrigatório)' }, { status: 422 })
    }

    const access = await authorizeProjectAccess(principal, supabase, rawProjectId)
    if (!access.ok) return access.response
    const project = access.value.project

    // GDB-REM-009: namespace é derivado do projeto (business_type + id).
    // O cliente não pode escolher namespace divergente.
    const derivedNamespace = deriveProjectNamespace(project)

    if (clientNamespace !== undefined && clientNamespace !== null) {
      if (typeof clientNamespace !== 'string' || normalizeNamespace(clientNamespace) !== derivedNamespace) {
        return NextResponse.json(
          {
            error: `Namespace divergente do projeto. Namespace canônico derivado: ${derivedNamespace}`,
          },
          { status: 422 },
        )
      }
    }

    // Reconciliação: namespace duplicado só é reconciliado para o MESMO projeto.
    const { data: existing } = await supabase
      .from('secret_namespaces')
      .select('id, project_id, namespace')
      .eq('namespace', derivedNamespace)
      .maybeSingle()

    if (existing && existing.project_id && existing.project_id !== project.id) {
      return NextResponse.json(
        { error: 'Conflito: namespace já pertence a outro projeto' },
        { status: 409 },
      )
    }
    if (existing && !existing.project_id) {
      return NextResponse.json(
        { error: 'Conflito: namespace global existente com mesmo nome; revise o catálogo' },
        { status: 409 },
      )
    }

    const { data, error } = await supabase
      .from('secret_namespaces')
      .upsert(
        {
          project_id: project.id,
          namespace: derivedNamespace,
          provider,
          status: 'active',
          created_by: actor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'namespace' },
      )
      .select()
      .single()

    if (error || !data) {
      console.error('[secrets/namespaces] upsert error:', error)
      return NextResponse.json({ error: 'Falha ao registrar secret namespace' }, { status: 500 })
    }

    const audited = await insertAudit(supabase, {
      action: 'secrets.namespace.registered',
      resource_type: 'secret_namespace',
      resource_id: data.id,
      metadata: { namespace: derivedNamespace, provider, project_id: project.id, actor },
    })
    if (!audited) {
      return NextResponse.json({ error: 'Falha ao registrar auditoria do namespace' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Secret namespace registrado com sucesso', namespace: data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    console.error('[secrets/namespaces POST] internal error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const authz = await requireAnyScope(req, [
      'projects:read',
      'secrets:namespaces:create',
      'secrets:bindings:write',
    ])
    if (!authz.ok) return authz.response
    const principal: AuthenticatedPrincipal = authz.value

    const { searchParams } = new URL(req.url)
    const projectIdParam = searchParams.get('project_id')

    const tenantClass = classifyPrincipalTenant(principal)
    if (tenantClass.kind === 'unscoped') {
      return NextResponse.json(
        { error: 'Forbidden: principal sem tenant atribuído' },
        { status: 403 },
      )
    }

    // Tenant scoping: project_bound só enxerga o próprio projeto (cross-tenant
    // devolve 404 para não vazar existência de recursos de outro tenant).
    let targetProjectId: string | null = null
    if (projectIdParam) {
      if (tenantClass.kind === 'project_bound') {
        if (projectIdParam.toLowerCase() !== tenantClass.projectId) {
          return NextResponse.json({ error: 'Namespace não encontrado' }, { status: 404 })
        }
        targetProjectId = tenantClass.projectId
      } else {
        if (!isUuid(projectIdParam)) {
          return NextResponse.json({ error: 'project_id inválido (uuid obrigatório)' }, { status: 422 })
        }
        targetProjectId = projectIdParam
      }
    } else if (tenantClass.kind === 'project_bound') {
      targetProjectId = tenantClass.projectId
    }

    const supabase = createServiceRoleClient()
    let query = supabase
      .from('secret_namespaces')
      .select('id, project_id, namespace, provider, status, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (targetProjectId) {
      query = query.eq('project_id', targetProjectId)
    }

    const { data: namespaces, error } = await query

    if (error) {
      return NextResponse.json({ error: 'Falha ao buscar namespaces' }, { status: 500 })
    }

    return NextResponse.json({ namespaces: namespaces ?? [] }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
