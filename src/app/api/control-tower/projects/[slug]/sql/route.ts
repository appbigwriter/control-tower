import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  authenticateToken,
  hasRequiredScope,
  isAdminSessionActive
} from '@/lib/auth/control-tower'
import {
  buildSqlAuditMetadata,
  deriveSchemaName,
  isGovernanceSchema,
  isValidSchemaName
} from '@/lib/auth/service-identity-policy'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

const SQL_SCOPE = 'ct:sql:execute'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized: Autenticação necessária' }, { status: 401 })
}

function forbidden(reason: string) {
  return NextResponse.json({ error: `Forbidden: ${reason}` }, { status: 403 })
}

async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const body = (await req.json().catch(() => ({}))) as { sql?: string }
  const sql = body.sql?.trim()

  // GDB-REM-002/003: the route performs its own authentication and
  // authorization — the middleware gate is never a substitute for business
  // authorization. Either an API principal with ct:sql:execute or an active
  // admin browser session (dashboard SQL editor) is accepted.
  const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
  const principal = rawToken ? await authenticateToken(rawToken) : null

  const sqlLength = typeof body.sql === 'string' ? body.sql.length : 0
  const sqlHash = sql ? await sha256Prefix(sql) : undefined
  const supabase = createServiceRoleClient()

  const writeAudit = async (action: string, metadata: Record<string, unknown>) => {
    // Best-effort sanitized audit trail; failures must not mask the
    // authorization decision but are logged server-side.
    try {
      await supabase.from('audit_logs').insert({
        action,
        resource_type: 'project_sql',
        resource_id: slug,
        metadata
      })
    } catch (auditError) {
      console.error('audit insert failed:', auditError instanceof Error ? auditError.message : auditError)
    }
  }

  let actor: string
  if (principal) {
    if (!hasRequiredScope(principal, SQL_SCOPE)) {
      await writeAudit(
        'project.sql.denied',
        buildSqlAuditMetadata({
          actor: principal.name,
          projectSlug: slug,
          reason: `scope ${SQL_SCOPE} necessário`,
          sqlLength,
          sqlSha256Prefix: sqlHash
        })
      )
      return forbidden(`scope ${SQL_SCOPE} necessário`)
    }
    actor = principal.identityId ? `${principal.name}#${principal.identityId}` : principal.name
  } else if (await isAdminSessionActive()) {
    actor = 'admin-session'
  } else {
    return unauthorized()
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, name, slug, business_type, schema_name')
    .eq('slug', slug)
    .maybeSingle()

  if (error || !project) {
    return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
  }

  if (project.business_type !== 'custom') {
    return NextResponse.json(
      { error: 'Editor SQL disponível apenas para projetos custom' },
      { status: 400 },
    )
  }

  if (!sql) {
    return NextResponse.json({ error: 'SQL vazio' }, { status: 400 })
  }

  // GDB-REM-003 — schema governance:
  //  1. the RPC target schema must be the exact schema registered for this
  //     project in the catalog;
  //  2. the catalogued schema must match the canonical derivation
  //     `<business_type>_<slug>` so a tampered catalog row cannot redirect
  //     execution to another project's schema;
  //  3. governance/platform schemas (public, auth, storage, pg_*, ...) are
  //     always rejected, in the route AND in the RPC (defense in depth).
  const expectedSchema = deriveSchemaName(project.business_type, project.slug)
  if (
    !isValidSchemaName(project.schema_name) ||
    !expectedSchema ||
    project.schema_name !== expectedSchema
  ) {
    await writeAudit(
      'project.sql.denied',
      buildSqlAuditMetadata({
        actor,
        projectSlug: slug,
        schemaName: project.schema_name,
        reason: 'schema do catálogo divergente da derivação canônica do projeto',
        sqlLength,
        sqlSha256Prefix: sqlHash
      })
    )
    return NextResponse.json(
      { error: 'Schema do projeto não corresponde à derivação canônica; execução bloqueada' },
      { status: 422 },
    )
  }

  if (isGovernanceSchema(project.schema_name)) {
    await writeAudit(
      'project.sql.denied',
      buildSqlAuditMetadata({
        actor,
        projectSlug: slug,
        schemaName: project.schema_name,
        reason: 'schema de governança não pode ser alvo do editor SQL',
        sqlLength,
        sqlSha256Prefix: sqlHash
      })
    )
    return forbidden('schema de governança não pode ser alterado pelo editor SQL')
  }

  const { data, error: execError } = await supabase.rpc('execute_project_schema_sql', {
    p_schema_name: project.schema_name,
    p_sql: sql,
    p_actor: actor,
    p_project_slug: project.slug,
  })

  if (execError) {
    // RPC denials (governance schema, forbidden statement, unknown schema)
    // arrive as errors; log them sanitized — never echo the raw SQL.
    const sanitized = execError.message?.split('\n')[0]?.slice(0, 300) ?? 'erro na execução'
    await writeAudit(
      'project.sql.denied',
      buildSqlAuditMetadata({
        actor,
        projectSlug: slug,
        schemaName: project.schema_name,
        reason: sanitized,
        sqlLength,
        sqlSha256Prefix: sqlHash
      })
    )
    return NextResponse.json({ error: sanitized }, { status: 500 })
  }

  await writeAudit(
    'project.sql.executed',
    buildSqlAuditMetadata({
      actor,
      projectSlug: slug,
      schemaName: project.schema_name,
      sqlLength,
      sqlSha256Prefix: sqlHash
    })
  )

  return NextResponse.json({
    message: 'SQL executado com sucesso',
    result: data,
    schema_name: project.schema_name,
  })
}
