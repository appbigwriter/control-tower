export type ProjectConfigurationProject = {
  id: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  schema_name: string
  domain: string | null
  secret_namespace?: string
}

export type ArtifactType = 'public_variables' | 'namespace' | 'validation_domain'

export function buildPublicVariables(project: ProjectConfigurationProject) {
  const namespace = `${buildNamespace(project)}/development`
  const ref = (name: string) => `<secret-manager:${namespace}/${name}>`
  return {
    PORT: '3400',
    HOST: '0.0.0.0',
    NODE_ENV: 'development',
    APP_ENV: 'development',
    CONTROL_TOWER_BASE_URL: 'https://control-tower.fbr.news',
    CONTROL_TOWER_PROJECT_ID: project.id,
    CONTROL_TOWER_SCHEMA_NAME: project.schema_name,
    AUTHORITY_PROJECT_ID: project.id,
    AUTHORITY_OWNER_ID: ref('AUTHORITY_OWNER_ID'),
    SUPABASE_URL: ref('SUPABASE_URL'),
    DATABASE_URL: ref('DATABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: ref('SUPABASE_SERVICE_ROLE_KEY'),
    AUTHORITY_ADMIN_TOKEN: ref('AUTHORITY_ADMIN_TOKEN'),
    AUTHORITY_OPERATOR_TOKEN: ref('AUTHORITY_OPERATOR_TOKEN'),
    AUTHORITY_REVIEWER_TOKEN: ref('AUTHORITY_REVIEWER_TOKEN'),
    AUTHORITY_PUBLISHER_TOKEN: ref('AUTHORITY_PUBLISHER_TOKEN'),
    AUTHORITY_VIEWER_TOKEN: ref('AUTHORITY_VIEWER_TOKEN'),
  }
}

export function buildNamespace(project: ProjectConfigurationProject) {
  if (project.secret_namespace?.trim()) return project.secret_namespace.trim().replace(/\/+$/, '')
  const segment = project.business_type === 'blog' ? 'blogs' : project.business_type
  return `fbr/${segment}/${project.id}`
}

export function buildValidationDomain(project: ProjectConfigurationProject) {
  if (!project.domain?.trim()) throw new Error('O projeto precisa ter um domínio para gerar a URL de validação.')
  const host = project.domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return `https://${host}/health`
}

export function buildArtifact(project: ProjectConfigurationProject, type: ArtifactType) {
  if (type === 'public_variables') return { type, value: buildPublicVariables(project), filename: `${project.id}.env` }
  if (type === 'namespace') return { type, value: buildNamespace(project), filename: `${project.id}-namespace.txt` }
  return { type, value: buildValidationDomain(project), filename: `${project.id}-validation-domain.txt` }
}

export type RuntimeEnvironment = 'development' | 'staging' | 'production'
export type RuntimeVariableKind = 'public' | 'runtime_private' | 'optional'
export type RuntimeVariableSource = 'derived' | 'secret_manager' | 'provider' | 'operator_input'

export type RuntimeVariable = {
  name: string
  kind: RuntimeVariableKind
  required: boolean
  source: RuntimeVariableSource
  reference_path?: string
  value?: string
  consumer: 'server' | 'browser' | 'worker'
  validation: string
}

export type RuntimeContractProject = ProjectConfigurationProject & {
  name: string
  slug: string
  template_key: string
  template_version: string
  language: string
  status: string
}

const secretNames = [
  'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AUTHORITY_ADMIN_TOKEN',
  'AUTHORITY_OPERATOR_TOKEN',
  'AUTHORITY_REVIEWER_TOKEN',
  'AUTHORITY_PUBLISHER_TOKEN',
  'AUTHORITY_VIEWER_TOKEN',
] as const

export function buildRuntimeInventory(project: RuntimeContractProject, environment: RuntimeEnvironment): RuntimeVariable[] {
  const namespace = buildNamespace(project)
  const secretNamespace = namespace.startsWith('secret-manager:') ? namespace : `secret-manager:${namespace}`
  const derived: RuntimeVariable[] = [
    { name: 'NODE_ENV', kind: 'public', required: true, source: 'derived', value: environment === 'production' ? 'production' : environment, consumer: 'server', validation: 'one of development|staging|production' },
    { name: 'APP_ENV', kind: 'public', required: true, source: 'derived', value: environment, consumer: 'server', validation: 'matches environment' },
    { name: 'CONTROL_TOWER_PROJECT_ID', kind: 'public', required: true, source: 'derived', value: project.id, consumer: 'server', validation: 'equals catalog project_id' },
    { name: 'CONTROL_TOWER_SCHEMA_NAME', kind: 'public', required: true, source: 'derived', value: project.schema_name, consumer: 'server', validation: 'equals catalog schema_name' },
    { name: 'CONTROL_TOWER_BASE_URL', kind: 'public', required: true, source: 'derived', value: 'https://control-tower.fbr.news', consumer: 'server', validation: 'valid https URL' },
    { name: 'SUPABASE_URL', kind: 'runtime_private', required: true, source: 'provider', reference_path: `${secretNamespace}/SUPABASE_URL`, consumer: 'server', validation: 'valid https URL' },
  ]
  const secrets: RuntimeVariable[] = secretNames.map((name) => ({ name, kind: 'runtime_private', required: name === 'DATABASE_URL' || name === 'SUPABASE_SERVICE_ROLE_KEY', source: 'secret_manager', reference_path: `${secretNamespace}/${name}`, consumer: 'server', validation: 'present in provider and readable by runtime only' }))
  const optional: RuntimeVariable[] = [
    { name: 'PORT', kind: 'optional', required: false, source: 'derived', value: '3400', consumer: 'server', validation: 'integer 1..65535' },
    { name: 'HOST', kind: 'optional', required: false, source: 'derived', value: '0.0.0.0', consumer: 'server', validation: 'valid bind host' },
  ]
  return [...derived, ...secrets, ...optional]
}

export function buildServiceName(project: Pick<RuntimeContractProject, 'name'>): string {
  const firstName = project.name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const serviceName = firstName.replace(/[^a-z0-9-]/g, '')
  if (!serviceName) throw new Error('Nome do projeto não produz serviceName válido.')
  return serviceName
}

export function buildRuntimeContract(project: RuntimeContractProject, environment: RuntimeEnvironment = 'development') {
  const inventory = buildRuntimeInventory(project, environment)
  return {
    contractVersion: '1.0.0',
    project: { id: project.id, name: project.name, slug: project.slug, businessType: project.business_type, templateKey: project.template_key, templateVersion: project.template_version, schemaName: project.schema_name, domain: project.domain, language: project.language, status: project.status },
    environment,
    namespace: buildNamespace(project),
    serviceName: buildServiceName(project),
    inventory,
    states: ['generated', 'registered', 'delivered', 'verified'] as const,
    status: 'generated' as const,
    generatedAt: new Date().toISOString(),
  }
}

export function renderRuntimeDeveloperDocument(contract: ReturnType<typeof buildRuntimeContract>): string {
  const lines = contract.inventory.map((variable) => {
    const value = variable.value ?? (variable.reference_path ? `<${variable.reference_path}>` : '')
    return `| ${variable.name} | ${variable.kind} | ${variable.required ? 'yes' : 'no'} | ${variable.source} | ${value} | ${variable.validation} |`
  }).join('\n')
  return [
    `# Developer Document — ${contract.project.name}`,
    '',
    '## Runtime Contract',
    '',
    `- Contract version: ${contract.contractVersion}`,
    `- Project ID: ${contract.project.id}`,
    `- Slug: ${contract.project.slug}`,
    `- Environment: ${contract.environment}`,
    `- Schema: ${contract.project.schemaName}`,
    `- Domain: ${contract.project.domain ?? 'not configured'}`,
    `- Service: ${contract.serviceName}`,
    `- Secret namespace: ${contract.namespace}`,
    `- Status: ${contract.status}`,
    '',
    '## Variable inventory',
    '',
    '| Name | Kind | Required | Source | Value/reference | Validation |',
    '|---|---|---:|---|---|---|',
    lines,
    '',
    '## Security',
    '',
    'Secret values are intentionally absent. Resolve only references through the authorized Secret Manager/provider. Never commit generated secrets, expose server variables to the browser, or paste values into chat/logs.',
    '',
    '## Required validation',
    '',
    '1. Confirm schema and project ownership.',
    '2. Configure variables in the declared environment.',
    '3. Confirm health and relational persistence.',
    '4. Write a synthetic record and read it back.',
    '5. Restart the runtime and repeat the readback.',
    '6. Record only sanitized status, version and correlation ID.',
  ].join('\n') + '\n'
}
