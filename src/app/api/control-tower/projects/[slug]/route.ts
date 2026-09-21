import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, isAdminSessionActive } from '@/lib/auth/control-tower'
import { deriveHostingTarget, validateHostingProject, type HostingProjectName, type HostingTarget } from '@/lib/control-tower/provisioning'
import { validateBusinessTypeTemplatePair } from '@/lib/control-tower/provisioning'
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
    const nextSlug = typeof body.slug === 'string' ? body.slug.trim() : slug
    const domain = typeof body.domain === 'string' ? body.domain.trim() : ''
    const repositoryUrl = typeof body.repository_url === 'string' ? body.repository_url.trim() : ''
    const repositoryPath = typeof body.repository_path === 'string' && body.repository_path.trim() ? body.repository_path.trim() : '/09-codigo'
    const hostingTarget = body.hosting_target
    const hostingProjectName = body.hosting_project_name
    const businessType = typeof body.business_type === 'string' ? body.business_type : ''
    const templateKey = typeof body.template_key === 'string' ? body.template_key : ''
    const schemaName = typeof body.schema_name === 'string' ? body.schema_name.trim() : ''
    const language = typeof body.language === 'string' ? body.language : 'pt'

    if (!name) return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 })
    if (!/^[a-z0-9_]+$/.test(nextSlug)) return NextResponse.json({ error: 'slug deve conter apenas letras minúsculas, números e underscore' }, { status: 400 })
    if (!domain) return NextResponse.json({ error: 'domain é obrigatório' }, { status: 400 })
    if (!/^https?:\/\/[^\s]+$/i.test(repositoryUrl)) return NextResponse.json({ error: 'repository_url deve ser uma URL http(s)' }, { status: 400 })
    if (!/^[_a-z][_a-z0-9]*$/.test(schemaName)) return NextResponse.json({ error: 'schema_name inválido' }, { status: 400 })
    if (hostingTarget !== 'vps1' && hostingTarget !== 'vps2') return NextResponse.json({ error: 'hosting_target deve ser vps1 ou vps2' }, { status: 400 })
    if (!validateHostingProject(hostingProjectName, hostingTarget)) return NextResponse.json({ error: 'hosting_project_name não corresponde ao hosting_target' }, { status: 400 })
    const pair = validateBusinessTypeTemplatePair(businessType, templateKey)
    if (!pair.ok) return NextResponse.json({ error: pair.error, code: pair.code }, { status: 422 })
    if (!['pt', 'en', 'es'].includes(language)) return NextResponse.json({ error: 'language inválido' }, { status: 400 })

    const client = createServiceRoleClient() as any
    const project = await loadProjectBySlug(client, slug)
    if (!project) return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })

    if (nextSlug !== slug) {
      const { data: conflict } = await client.from('projects').select('id').eq('slug', nextSlug).maybeSingle()
      if (conflict && conflict.id !== project.id) return NextResponse.json({ error: 'slug já utilizado por outro projeto' }, { status: 409 })
    }
    const target = deriveHostingTarget(hostingTarget as HostingTarget, name, hostingProjectName as HostingProjectName)
    const serviceName = typeof body.service_name === 'string' ? body.service_name.trim() : target.serviceName
    if (!/^[a-z0-9][a-z0-9-]*$/.test(serviceName)) return NextResponse.json({ error: 'service_name inválido' }, { status: 400 })
    const metadata = {
      name, slug: nextSlug, domain, repository_url: repositoryUrl, repository_path: repositoryPath,
      business_type: pair.businessType, template_key: pair.templateKey, schema_name: schemaName,
      language, hosting_target: target.target, hosting_project_name: target.projectName,
      service_name: serviceName, updated_at: new Date().toISOString(),
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
