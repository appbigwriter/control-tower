import { randomBytes, randomUUID } from 'node:crypto'
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
    .select('id, name, slug, business_type, schema_name, domain, template_key, template_version, language, status, hosting_target, hosting_project_name, service_name, authority_owner_id')
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

async function ensureAuthorityOwnerId(project: RuntimeContractProject): Promise<RuntimeContractProject> {
  if (project.slug !== 'authorityengine' || project.authority_owner_id) return project
  const supabase = createServiceRoleClient()
  const generated = randomUUID()
  const { error } = await supabase
    .from('projects')
    .update({ authority_owner_id: generated, updated_at: new Date().toISOString() })
    .eq('id', project.id)
    .is('authority_owner_id', null)
  if (error) throw new Error(`authority_owner_id_persist_failed:${error.message}`)
  const refreshed = await loadProject(project.slug)
  if (!refreshed?.authority_owner_id) throw new Error('authority_owner_id_readback_missing')
  return refreshed
}

const SUPABASE_RUNTIME_PROJECT = 'supabase'
const SUPABASE_SERVICE_CANDIDATES = ['supabase-gestaodb', 'base', 'db', 'postgres', 'supabase-db'] as const

type ServiceRef = { projectName: string; serviceName: string }

function serviceRefsInCatalog(readback: unknown): ServiceRef[] {
  if (Array.isArray(readback)) return readback.flatMap(serviceRefsInCatalog)
  if (!readback || typeof readback !== 'object') return []
  const record = readback as Record<string, unknown>
  const projectName = typeof record.name === 'string' ? record.name : typeof record.projectName === 'string' ? record.projectName : undefined
  const services = Array.isArray(record.services) ? record.services : []
  const own = projectName ? services.flatMap((service) => {
    if (!service || typeof service !== 'object') return []
    const serviceRecord = service as Record<string, unknown>
    const serviceName = serviceRecord.name ?? serviceRecord.serviceName
    return typeof serviceName === 'string' ? [{ projectName, serviceName }] : []
  }) : []
  return [...own, ...Object.values(record).flatMap((value) => serviceRefsInCatalog(value))]
}

async function readSupabaseRuntimeEnv(provider: EasypanelSecretsProvider): Promise<{ projectName: string; serviceName: string; env: Record<string, string> }> {
  const catalog = await provider.listProjectsAndServices()
  const discovered = serviceRefsInCatalog(catalog)
  const preferred = discovered.filter(({ projectName, serviceName }) =>
    projectName === SUPABASE_RUNTIME_PROJECT || /supabase|gestaodb|database|postgres|^db$|^base$/i.test(`${projectName}/${serviceName}`),
  )
  const defaults = SUPABASE_SERVICE_CANDIDATES.flatMap((serviceName) => [
    { projectName: SUPABASE_RUNTIME_PROJECT, serviceName },
  ])
  const candidates = [...new Map([...preferred, ...defaults].map((item) => [`${item.projectName}/${item.serviceName}`, item])).values()]
  for (const candidate of candidates) {
    try {
      const readback = await provider.inspectComposeService?.(candidate.projectName, candidate.serviceName)
      if (!readback) continue
      const env = parseServiceEnv(readback)
      if (env.DATABASE_URL || env.POSTGRES_HOST || env.SUPABASE_URL) return { ...candidate, env }
    } catch {
      // Candidate does not exist or is not inspectable; continue without exposing values.
    }
  }
  throw new Error(`runtime_secret_source_service_not_found:candidates=${candidates.map((item) => `${item.projectName}/${item.serviceName}`).join(',')}`)
}

async function resolveRuntimeEnvironment(
  contract: ReturnType<typeof buildRuntimeContract>,
  target: EasypanelTarget,
  provider: EasypanelSecretsProvider,
  destination: { projectName: string; serviceName: string },
): Promise<Record<string, string>> {
  const source = await readSupabaseRuntimeEnv(provider)
  const sourceEnv = source.env
  const destinationReadback = await provider.inspectAppService(destination.projectName, destination.serviceName)
  const destinationEnv = parseServiceEnv(destinationReadback)
  const aliases: Record<string, string[]> = {
    SUPABASE_ANON_KEY: ['ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'],
    SUPABASE_SERVICE_ROLE_KEY: ['SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'],
  }
  const resolved: Record<string, string> = {}
  const authorityTokenNames = new Set([
    'AUTHORITY_ADMIN_TOKEN',
    'AUTHORITY_OPERATOR_TOKEN',
    'AUTHORITY_REVIEWER_TOKEN',
    'AUTHORITY_PUBLISHER_TOKEN',
    'AUTHORITY_VIEWER_TOKEN',
  ])
  for (const variable of contract.inventory) {
    const candidates = variable.source === 'provider'
      ? [variable.name, ...(aliases[variable.name] ?? [])]
      : [variable.name]
    const value = variable.value ?? (variable.source === 'provider'
      ? candidates.map((name) => sourceEnv[name] || process.env[name]).find(Boolean)
      : process.env[variable.name] || destinationEnv[variable.name] || (authorityTokenNames.has(variable.name) ? randomBytes(32).toString('base64url') : undefined))
    if (value === undefined || value === '') {
      if (variable.required) {
        const diagnosticSource = variable.source === 'provider'
          ? `provider=${SUPABASE_RUNTIME_PROJECT}/${source.serviceName}`
          : `secret_manager=${variable.reference_path ?? variable.name}`
        throw new Error(`runtime_variable_missing:${variable.name}:source=${diagnosticSource}`)
      }
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
  const values = await resolveRuntimeEnvironment(contract, target, provider, { projectName, serviceName: contract.serviceName })
  try {
    await provider.updateEnv(projectName, contract.serviceName, values)
    await provider.deploy(projectName, contract.serviceName)
  } catch (error) {
    throw new Error(`runtime_target_mutation_failed:${projectName}/${contract.serviceName}:${error instanceof Error ? error.message : 'mutation_failed'}`)
  }
  const readback = await provider.inspectAppService(projectName, contract.serviceName)
  const status = typeof (readback as { status?: unknown })?.status === 'string' ? (readback as { status: string }).status : 'NOT_VERIFIED'
  if (status !== 'running' && status !== 'deploying') throw new Error(`runtime_deploy_readback_not_healthy:${status}`)
  return { target, projectName, serviceName: contract.serviceName, status, sourceService: `${SUPABASE_RUNTIME_PROJECT}/${(await readSupabaseRuntimeEnv(provider)).serviceName}` }
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
    const loadedProject = await loadProject(slug)
    if (!loadedProject) return NextResponse.json({ error: 'Projeto não encontrado.' }, { status: 404 })
    const project = await ensureAuthorityOwnerId(loadedProject)
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
