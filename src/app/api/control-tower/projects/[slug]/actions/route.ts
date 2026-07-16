import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'

type Params = { params: Promise<{ slug: string }> }

async function loadProject(slug: string) {
  const supabase = createServiceRoleClient()
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, name, slug, business_type, template_key, schema_name, domain, language, status, template_version')
    .eq('slug', slug)
    .maybeSingle()
  return { supabase, project, error }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  const action = body.action

  const { supabase, project, error } = await loadProject(slug)
  if (error || !project) {
    return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
  }

  if (action === 'archive') {
    const [{ error: projectError }, { error: auditError }] = await Promise.all([
      supabase.from('projects').update({ status: 'archived' }).eq('id', project.id),
      supabase.from('audit_logs').insert({
        project_id: project.id,
        action: 'project.archived',
        resource_type: 'project',
        resource_id: project.id,
        metadata: { slug: project.slug },
      }),
    ])

    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 })
    }

    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Projeto arquivado com sucesso' })
  }

  if (action === 'rebuild') {
    const jobInsert = await supabase.from('provisioning_jobs').insert({
      project_id: project.id,
      job_type: 'rebuild_schema',
      status: 'running',
      input_payload: { schema_name: project.schema_name },
    })

    if (jobInsert.error) {
      return NextResponse.json({ error: jobInsert.error.message }, { status: 500 })
    }

    try {
      if (project.business_type === 'blog') {
        await supabase.rpc('create_blog_schema', { p_schema_name: project.schema_name })
      } else if (project.business_type === 'store') {
        await supabase.rpc('create_store_schema', { p_schema_name: project.schema_name })
      } else if (project.business_type === 'saas') {
        await supabase.rpc('create_saas_schema', { p_schema_name: project.schema_name })
      } else {
        await supabase.rpc('create_custom_schema', { p_schema_name: project.schema_name })
      }

      await Promise.all([
        supabase.from('projects').update({ status: 'active' }).eq('id', project.id),
        supabase
          .from('provisioning_jobs')
          .update({ status: 'success', finished_at: new Date().toISOString(), output_payload: { schema_name: project.schema_name } })
          .eq('project_id', project.id)
          .eq('job_type', 'rebuild_schema'),
        supabase.from('audit_logs').insert({
          project_id: project.id,
          action: 'project.rebuilt',
          resource_type: 'project',
          resource_id: project.id,
          metadata: { slug: project.slug, schema_name: project.schema_name },
        }),
      ])

      return NextResponse.json({ message: 'Schema reexecutado com sucesso' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no rebuild'
      await Promise.all([
        supabase
          .from('provisioning_jobs')
          .update({ status: 'error', error_message: message, finished_at: new Date().toISOString() })
          .eq('project_id', project.id)
          .eq('job_type', 'rebuild_schema'),
        supabase.from('projects').update({ status: 'error' }).eq('id', project.id),
        supabase.from('audit_logs').insert({
          project_id: project.id,
          action: 'project.rebuild_failed',
          resource_type: 'project',
          resource_id: project.id,
          metadata: { error: message },
        }),
      ])
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
}
