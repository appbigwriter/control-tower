import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { buildArtifact, type ArtifactType } from '@/lib/control-tower/project-configuration'

export const dynamic = 'force-dynamic'

const artifactTypes: ArtifactType[] = ['public_variables', 'namespace', 'validation_domain']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    const body = await req.json() as { type?: ArtifactType }
    const type = body.type
    if (!type || !artifactTypes.includes(type)) {
      return NextResponse.json({ error: 'Tipo de configuração inválido.' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, business_type, schema_name, domain')
      .eq('slug', slug)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })
    }

    const artifact = buildArtifact(project, type)
    const { data: saved, error: saveError } = await supabase
      .from('project_configuration_artifacts')
      .upsert({
        project_id: project.id,
        artifact_type: type,
        payload: { value: artifact.value, filename: artifact.filename },
        created_by: 'admin-panel',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,artifact_type' })
      .select('id, project_id, artifact_type, payload, created_at, updated_at')
      .single()

    if (saveError) {
      console.error('Falha ao salvar artefato de configuração:', saveError)
      return NextResponse.json({ error: 'Falha ao salvar configuração no banco.' }, { status: 500 })
    }

    return NextResponse.json({ artifact: { ...artifact, saved } }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao gerar configuração.' }, { status: 400 })
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createServiceRoleClient()
  const { data: project, error: projectError } = await supabase.from('projects').select('id').eq('slug', slug).single()
  if (projectError || !project) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })

  const { data, error } = await supabase
    .from('project_configuration_artifacts')
    .select('id, project_id, artifact_type, payload, created_at, updated_at')
    .eq('project_id', project.id)
    .order('artifact_type', { ascending: true })
  if (error) return NextResponse.json({ error: 'Falha ao consultar configurações.' }, { status: 500 })
  return NextResponse.json({ artifacts: data ?? [] }, { status: 200 })
}
