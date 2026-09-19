import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, hasRequiredScope, isAdminSessionActive, type AuthenticatedPrincipal } from '@/lib/auth/control-tower'
import { buildArtifact, type ArtifactType } from '@/lib/control-tower/project-configuration'

export const dynamic = 'force-dynamic'

const artifactTypes: ArtifactType[] = ['public_variables', 'namespace', 'validation_domain']

async function authorize(req: NextRequest, scope: string) {
  if (await isAdminSessionActive()) {
    return { type: 'admin', name: 'control-tower-session', scopes: ['*'] } satisfies AuthenticatedPrincipal
  }
  const principal = await authenticateToken(req.headers.get('authorization') ?? req.headers.get('x-api-key'))
  if (!principal) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasRequiredScope(principal, scope)) return NextResponse.json({ error: `Scope ${scope} required` }, { status: 403 })
  return principal
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const denied = await authorize(req, 'projects:provision')
    if (denied instanceof NextResponse) return denied
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
        created_by: 'authenticated-control-tower',
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
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await authorize(req, 'projects:read')
  if (denied instanceof NextResponse) return denied
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
