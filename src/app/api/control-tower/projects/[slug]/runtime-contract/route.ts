import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, hasRequiredScope } from '@/lib/auth/control-tower'
import {
  buildRuntimeContract,
  renderRuntimeDeveloperDocument,
  type RuntimeEnvironment,
  type RuntimeContractProject,
} from '@/lib/control-tower/project-configuration'

export const dynamic = 'force-dynamic'
const environments: RuntimeEnvironment[] = ['development', 'staging', 'production']

async function authorize(req: NextRequest, scope: string) {
  const principal = await authenticateToken(req.headers.get('authorization'))
  if (!principal) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasRequiredScope(principal, scope)) return NextResponse.json({ error: `Scope ${scope} required` }, { status: 403 })
  return principal
}

async function loadProject(slug: string): Promise<RuntimeContractProject | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, slug, business_type, schema_name, domain, template_key, template_version, language, status')
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return data as RuntimeContractProject
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await authorize(req, 'projects:provision')
  if (denied instanceof NextResponse) return denied
  try {
    const { slug } = await params
    const body = await req.json().catch(() => ({})) as { environment?: RuntimeEnvironment }
    const environment = body.environment ?? 'development'
    if (!environments.includes(environment)) return NextResponse.json({ error: 'Environment must be development, staging or production.' }, { status: 400 })
    const project = await loadProject(slug)
    if (!project) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })
    const contract = buildRuntimeContract(project, environment)
    const document = renderRuntimeDeveloperDocument(contract)
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('project_runtime_contracts')
      .upsert({
        project_id: project.id,
        environment,
        contract_version: contract.contractVersion,
        status: contract.status,
        namespace: contract.namespace,
        service_name: contract.serviceName,
        inventory: contract.inventory,
        document_markdown: document,
        generated_by: 'control-tower',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,environment,contract_version' })
      .select('id, project_id, environment, contract_version, status, namespace, service_name, inventory, document_markdown, created_at, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: 'Falha ao registrar runtime contract no banco.' }, { status: 500 })
    return NextResponse.json({ contract: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao gerar runtime contract.' }, { status: 400 })
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await authorize(req, 'projects:read')
  if (denied instanceof NextResponse) return denied
  const { slug } = await params
  const environment = new URL(req.url).searchParams.get('environment') ?? 'development'
  if (!environments.includes(environment as RuntimeEnvironment)) return NextResponse.json({ error: 'Invalid environment.' }, { status: 400 })
  const project = await loadProject(slug)
  if (!project) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('project_runtime_contracts')
    .select('id, project_id, environment, contract_version, status, namespace, service_name, inventory, document_markdown, created_at, updated_at')
    .eq('project_id', project.id)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Falha ao consultar runtime contract.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Runtime contract ainda não foi gerado.' }, { status: 404 })
  return NextResponse.json({ contract: data }, { status: 200 })
}
