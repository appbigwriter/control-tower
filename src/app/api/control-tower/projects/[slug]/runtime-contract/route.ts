import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, hasRequiredScope, isAdminSessionActive, type AuthenticatedPrincipal } from '@/lib/auth/control-tower'
import { EasypanelSecretsProvider, easypanelTargetEnv, parseServiceEnv, readbackHasService, type EasypanelTarget } from '@/lib/secrets/adapter'
import {
  buildRuntimeContract,
  renderRuntimeDeveloperDocument,
  type RuntimeEnvironment,
  type RuntimeContractProject,
} from '@/lib/control-tower/project-configuration'

export const dynamic = 'force-dynamic'
const environments: RuntimeEnvironment[] = ['development', 'staging', 'production']

async function authorize(req: NextRequest, scope: string) {
  if (await isAdminSessionActive()) {
    return { type: 'admin', name: 'control-tower-session', scopes: ['*'] } satisfies AuthenticatedPrincipal
  }
  const principal = await authenticateToken(req.headers.get('authorization') ?? req.headers.get('x-api-key'))
  if (!principal) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!hasRequiredScope(principal, scope)) return NextResponse.json({ error: `Scope ${scope} required` }, { status: 403 })
  return principal
}

async function loadProject(slug: string): Promise<RuntimeContractProject | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, slug, business_type, schema_name, domain, template_key, template_version, language, status, hosting_target, hosting_project_name, service_name')
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  const { data: namespace } = await supabase
    .from('secret_namespaces')
    .select('namespace')
    .eq('project_id', data.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return { ...data, secret_namespace: namespace?.namespace ?? undefined } as RuntimeContractProject
}

const SUPABASE_RUNTIME_SOURCE: Record<EasypanelTarget, { projectName: string; serviceName: string }> = {
  vps1: { projectName: 'supabase', serviceName: 'supabase-gestaodb' },
  vps2: { projectName: 'supabase', serviceName: 'supabase-gestaodb' },
}

async function resolveRuntimeEnvironment(
  contract: ReturnType<typeof buildRuntimeContract>,
  target: EasypanelTarget,
  provider: EasypanelSecretsProvider,
): Promise<Record<string, string>> {
  const source = SUPABASE_RUNTIME_SOURCE[target]
  let sourceReadback: unknown
  try {
    sourceReadback = await provider.inspectAppService(source.projectName, source.serviceName)
  } catch (error) {
    throw new Error(`runtime_secret_source_readback_failed:${source.projectName}/${source.serviceName}:${error instanceof Error ? error.message : 'inspect_failed'}`)
  }
  const sourceEnv = parseServiceEnv(sourceReadback)
  const aliases: Record<string, string[]> = {
    SUPABASE_ANON_KEY: ['ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'],
    SUPABASE_SERVICE_ROLE_KEY: ['SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'],
  }
  const resolved: Record<string, string> = {}
  for (const variable of contract.inventory) {
    const candidates = [variable.name, ...(aliases[variable.name] ?? [])]
    const value = variable.value ?? candidates.map((name) => sourceEnv[name] || process.env[name]).find(Boolean)
    if (value === undefined || value === '') {
      if (variable.required) throw new Error(`runtime_variable_missing:${variable.name}:source=${source.projectName}/${source.serviceName}`)
      continue
    }
    resolved[variable.name] = value
  }
  return resolved
}

async function injectRuntimeEnvironment(
  project: RuntimeContractProject,
  contract: ReturnType<typeof buildRuntimeContract>,
): Promise<{ target: string; projectName: string; serviceName: string; status: string; sourceService: string }> {
  const target = project.hosting_target
  if (target !== 'vps1' && target !== 'vps2') throw new Error('hosting_target_required_for_runtime_injection')
  const envNames = easypanelTargetEnv(target)
  const projectName = project.hosting_project_name?.trim() || process.env[envNames.projectName]?.trim()
  if (!projectName) throw new Error(`easypanel_project_name_missing:${target}`)
  const provider = new EasypanelSecretsProvider(target)
  let services: unknown
  try {
    services = await provider.listProjectsAndServices()
    if (!readbackHasService(services, projectName, contract.serviceName)) {
      await provider.createAppService(projectName, contract.serviceName)
      services = await provider.listProjectsAndServices()
      if (!readbackHasService(services, projectName, contract.serviceName)) {
        throw new Error(`runtime_target_service_readback_missing:${projectName}/${contract.serviceName}`)
      }
    }
  } catch (error) {
    throw new Error(`runtime_target_service_unavailable:${projectName}/${contract.serviceName}:${error instanceof Error ? error.message : 'service_check_failed'}`)
  }
  const values = await resolveRuntimeEnvironment(contract, target, provider)
  try {
    await provider.updateEnv(projectName, contract.serviceName, values)
    await provider.deploy(projectName, contract.serviceName)
  } catch (error) {
    throw new Error(`runtime_target_mutation_failed:${projectName}/${contract.serviceName}:${error instanceof Error ? error.message : 'mutation_failed'}`)
  }
  const readback = await provider.inspectAppService(projectName, contract.serviceName)
  const status = typeof (readback as { status?: unknown })?.status === 'string' ? (readback as { status: string }).status : 'NOT_VERIFIED'
  if (status !== 'running' && status !== 'deploying') throw new Error(`runtime_deploy_readback_not_healthy:${status}`)
  return { target, projectName, serviceName: contract.serviceName, status, sourceService: `${SUPABASE_RUNTIME_SOURCE[target].projectName}/${SUPABASE_RUNTIME_SOURCE[target].serviceName}` }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await authorize(req, 'projects:provision')
  if (denied instanceof NextResponse) return denied
  try {
    const { slug } = await params
    const body = await req.json().catch(() => ({})) as { environment?: RuntimeEnvironment; inject?: boolean }
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
        env_filename: contract.envFilename,
        env_document: contract.envDocument,
        document_markdown: document,
        generated_by: 'control-tower',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,environment,contract_version' })
      .select('id, project_id, environment, contract_version, status, namespace, service_name, inventory, env_filename, env_document, document_markdown, created_at, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: 'Falha ao registrar runtime contract no banco.' }, { status: 500 })
    if (body.inject) {
      const readback = await injectRuntimeEnvironment(project, contract)
      const { data: delivered, error: deliveryError } = await supabase
        .from('project_runtime_contracts')
        .update({ status: 'delivered', updated_at: new Date().toISOString() })
        .eq('id', data.id)
        .select('id, project_id, environment, contract_version, status, env_filename, env_document, created_at, updated_at')
        .single()
      if (deliveryError || !delivered) return NextResponse.json({ error: 'Injeção concluída sem readback persistido do contrato.' }, { status: 502 })
      return NextResponse.json({ contract: delivered, delivery: readback }, { status: 200 })
    }
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
    .select('id, project_id, environment, contract_version, status, namespace, service_name, inventory, env_filename, env_document, document_markdown, created_at, updated_at')
    .eq('project_id', project.id)
    .eq('environment', environment)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Falha ao consultar runtime contract.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Runtime contract ainda não foi gerado.' }, { status: 404 })
  return NextResponse.json({ contract: data }, { status: 200 })
}
