import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'

type Params = { params: Promise<{ slug: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const body = (await req.json().catch(() => ({}))) as { sql?: string }
  const sql = body.sql?.trim()

  const supabase = createServiceRoleClient()

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

  const { data, error: execError } = await supabase.rpc('execute_project_schema_sql', {
    p_schema_name: project.schema_name,
    p_sql: sql,
  })

  if (execError) {
    return NextResponse.json({ error: execError.message }, { status: 500 })
  }

  return NextResponse.json({
    message: 'SQL executado com sucesso',
    result: data,
    schema_name: project.schema_name,
  })
}
