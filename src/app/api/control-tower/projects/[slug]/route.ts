import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

type Params = { params: Promise<{ slug: string }> }

export async function DELETE(
  _req: NextRequest,
  { params }: Params,
) {
  try {
    const { slug } = await params
    const supabase = createServiceRoleClient()

    // Obter dados do projeto
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('id, name, slug, schema_name')
      .eq('slug', slug)
      .maybeSingle()

    if (fetchError || !project) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    // Dropar o schema isolado do projeto caso exista
    if (project.schema_name && project.schema_name !== 'public') {
      const { error: rpcError } = await supabase.rpc('execute_project_schema_sql', {
        p_schema_name: 'public',
        p_sql: `DROP SCHEMA IF EXISTS "${project.schema_name}" CASCADE`,
      })

      if (rpcError) {
        console.error('Erro ao remover schema do projeto:', rpcError)
        return NextResponse.json(
          { error: `Erro ao remover schema do banco (${project.schema_name}): ${rpcError.message}` },
          { status: 500 },
        )
      }
    }

    // Registrar no audit_logs antes ou depois da exclusão
    await supabase.from('audit_logs').insert({
      action: 'project.deleted',
      resource_type: 'project',
      resource_id: project.id,
      metadata: {
        slug: project.slug,
        schema_name: project.schema_name,
        name: project.name,
      },
    })

    // Excluir o registro do projeto
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', project.id)

    if (deleteError) {
      console.error('Erro ao excluir projeto da tabela projects:', deleteError)
      return NextResponse.json(
        { error: `Erro ao remover registro do projeto: ${deleteError.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ message: 'Projeto e banco de dados excluídos com sucesso' })
  } catch (error) {
    console.error('Erro na rota DELETE do projeto:', error)
    const message = error instanceof Error ? error.message : 'Erro interno ao processar a exclusão'
    return NextResponse.json(
      { error: message },
      { status: 500 },
    )
  }
}

