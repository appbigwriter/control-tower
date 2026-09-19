import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildArtifact,
  buildNamespace,
  buildPublicVariables,
  buildValidationDomain,
  renderRuntimeDeveloperDocument,
  buildRuntimeContract,
  buildRuntimeInventory,
} from '../src/lib/control-tower/project-configuration.ts'

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  business_type: 'blog' as const,
  schema_name: 'blog_example',
  domain: 'example.com',
}

test('gera variáveis de runtime completas com referências seguras', () => {
  const variables = buildPublicVariables(project)
  assert.equal(variables.NODE_ENV, 'development')
  assert.equal(variables.CONTROL_TOWER_PROJECT_ID, project.id)
  assert.equal(variables.CONTROL_TOWER_SCHEMA_NAME, project.schema_name)
  assert.match(variables.DATABASE_URL, /^<secret-manager:/)
  assert.match(variables.SUPABASE_SERVICE_ROLE_KEY, /^<secret-manager:/)
  assert.equal(variables.AUTHORITY_PROJECT_ID, project.id)
  assert.match(variables.AUTHORITY_OWNER_ID, /^<secret-manager:/)
})

test('gera namespace com plural para blog e id do projeto', () => {
  assert.equal(buildNamespace(project), `fbr/blogs/${project.id}`)
})

test('gera health URL HTTPS e normaliza protocolo e barra', () => {
  assert.equal(buildValidationDomain({ ...project, domain: 'https://example.com/' }), 'https://example.com/health')
})

test('recusa domínio de validação sem domínio', () => {
  assert.throws(() => buildValidationDomain({ ...project, domain: null }), /precisa ter um domínio/)
})

test('monta artefatos baixáveis para os três tipos', () => {
  assert.equal(buildArtifact(project, 'namespace').filename, `${project.id}-namespace.txt`)
  assert.equal(buildArtifact(project, 'validation_domain').value, 'https://example.com/health')
  assert.equal(buildArtifact(project, 'public_variables').filename, `${project.id}.env`)
})

test('runtime contract gera inventário completo por ambiente sem valores secretos', () => {
  const contractProject = { ...project, name: 'Authority Engine', slug: 'authorityengine', template_key: 'custom_base', template_version: '1.0.0', language: 'pt', status: 'active' }
  const inventory = buildRuntimeInventory(contractProject, 'development')
  assert.ok(inventory.some((item) => item.name === 'DATABASE_URL' && item.required && item.reference_path?.startsWith('secret-manager:')))
  assert.ok(inventory.some((item) => item.name === 'CONTROL_TOWER_SCHEMA_NAME' && item.value === project.schema_name))
  assert.ok(inventory.every((item) => item.value !== undefined || item.reference_path !== undefined))
  assert.ok(inventory.every((item) => !('secret_value' in item)))
})

test('runtime contract e Developer Document são sanitizados e versionados', () => {
  const contract = buildRuntimeContract({ ...project, name: 'Authority Engine', slug: 'authorityengine', template_key: 'custom_base', template_version: '1.0.0', language: 'pt', status: 'active' }, 'production')
  const document = renderRuntimeDeveloperDocument(contract)
  assert.equal(contract.contractVersion, '1.0.0')
  assert.equal(contract.environment, 'production')
  assert.match(document, /DATABASE_URL/)
  assert.match(document, /secret-manager:/)
  assert.doesNotMatch(document, /secret_value|service-role-value|local-e2e-admin/)
})
