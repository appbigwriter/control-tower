export type ProjectConfigurationProject = {
  id: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  schema_name: string
  domain: string | null
}

export type ArtifactType = 'public_variables' | 'namespace' | 'validation_domain'

export function buildPublicVariables(project: ProjectConfigurationProject) {
  return {
    PORT: '',
    NODE_ENV: 'production',
    APP_ENV: 'production',
    CONTROL_TOWER_BASE_URL: 'control-tower.fbr.news',
    CONTROL_TOWER_PROJECT_ID: project.id,
    CONTROL_TOWER_SCHEMA_NAME: project.schema_name,
    SUPABASE_URL: 'supabase-control-tower-api.fbr.news',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  }
}

export function buildNamespace(project: ProjectConfigurationProject) {
  const segment = project.business_type === 'blog' ? 'blogs' : project.business_type
  return `fbr/${segment}/${project.id}`
}

export function buildValidationDomain(project: ProjectConfigurationProject) {
  if (!project.domain?.trim()) {
    throw new Error('O projeto precisa ter um domínio para gerar a URL de validação.')
  }

  const host = project.domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return `https://${host}/health`
}

export function buildArtifact(project: ProjectConfigurationProject, type: ArtifactType) {
  if (type === 'public_variables') {
    return { type, value: buildPublicVariables(project), filename: `${project.id}.env` }
  }

  if (type === 'namespace') {
    return { type, value: buildNamespace(project), filename: `${project.id}-namespace.txt` }
  }

  return { type, value: buildValidationDomain(project), filename: `${project.id}-validation-domain.txt` }
}
