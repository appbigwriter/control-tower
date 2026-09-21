import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, isAdminSessionActive } from '@/lib/auth/control-tower'
import { deriveHostingTarget, type HostingTarget } from '@/lib/control-tower/provisioning'
import {
  loadProjectBySlug,
  deleteProject,
  deleteConfirmationValid,
  type ActionsClient,
} from '@/lib/control-tower/actions'

type Params = { params: Promise<{ slug: string }> }

export async function PATCH(
  req: NextRequest,
  { params }: Params,
) {
  try {
    const { slug } = await params
    const principal = await authenticateToken(req.headers.get('authorization'))
    if (!principal && !(await isAdminSessionActive())) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const domain = typeof body.domain === 'string' ? body.domain.trim() : ''
    const repositoryUrl = typeof body.repository_url === 'string' ? body.repository_url.trim() : ''
    const hostingTarget = body.hosting_target

    if (!name) return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })
    if (!domain) return NextResponse.json({ error: 'domain é obrigatório' }, { status: 400 })
    if (!/^https?:\/\/[^\s]+$/i.test(repositoryUrl)) {
      return NextResponse.json({ error: 'repository_url deve ser uma URL http(s)' }, { status: 400 })
    }
    if (hostingTarget !== 'vps1' && hostingTarget !== 'vps2') {
      return NextResponse.json({ error: 'hosting_target deve ser vps1 ou vps2' }, { status: 400 })
    }

    const client = createServiceRoleClient() as any
    const project = await loadProjectBySlug(client, slug)
    if (!project) return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })

    const target = deriveHostingTarget(hostingTarget as HostingTarget, name)
    const metadata = {
      name,
      domain,
      repository_url: repositoryUrl,
      repository_path: '/09-codigo',
      hosting_target: target.target,
      hosting_project_name: target.projectName,
      service_name: target.serviceName,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await client
      .from('projects')
      .update(metadata)
      .eq('id', project.id)
      .select('id, name, slug, domain, repository_url, repository_path, hosting_target, hosting_project_name, service_name, updated_at')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Readback do projeto ausente' }, { status: 500 })
    }

    await client.from('audit_logs').insert({
      project_id: project.id,
      action: 'project.updated',
      resource_type: 'project',
      resource_id: project.id,
      metadata: {
        actor: principal?.name ?? 'admin-session',
        fields: ['name', 'domain', 'repository_url', 'repository_path', 'hosting_target', 'hosting_project_name', 'service_name'],
      },
    })

    return NextResponse.json({ message: 'Projeto atualizado com readback confirmado', project: data }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno ao atualizar projeto'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: Params,
) {
  try {
    const { slug } = await params

    // Destructive action (GDB-REM-011 aceíte 4): bearer principal OR admin session.
    const principal = await authenticateToken(req.headers.get('authorization'))
    let actor: string
    if (principal) {
      actor = principal.identityId ? `${principal.name}#${principal.identityId}` : principal.name
    } else if (await isAdminSessionActive()) {
      actor = 'admin-session'
    } else {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Explicit confirmation: { confirm: true, slug: "<slug>" } in the body.
    const body = await req.json().catch(() => ({}))
    if (!deleteConfirmationValid(body, slug)) {
      return NextResponse.json(
        {
          error:
            'Confirmação explícita obrigatória: envie { "confirm": true, "slug": "<slug>" }. ' +
            'Delete destrutivo exige receipt e gate.',
        },
        { status: 400 },
      )
    }

    const client = createServiceRoleClient() as unknown as ActionsClient
    const project = await loadProjectBySlug(client, slug)
    if (!project) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    const result = await deleteProject(client, project, actor)
    const failureMessage = result.ok
      ? result.message
      : `${result.message}${result.sagaReceipt.error ? ` Detalhe: ${result.sagaReceipt.error}` : ''}`
    return NextResponse.json(
      result.ok
        ? { message: result.message, receipt: result.sagaReceipt, readback: result.readback }
        : { error: failureMessage, receipt: result.sagaReceipt, readback: result.readback, blocked: result.blocked },
      { status: result.httpStatus },
    )
  } catch (error) {
    console.error('Erro na rota DELETE do projeto:', error)
    const message = error instanceof Error ? error.message : 'Erro interno ao processar a exclusão'
    return NextResponse.json(
      { error: message },
      { status: 500 },
    )
  }
}
