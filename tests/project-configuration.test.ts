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
  buildServiceName,
  runtimeEnvFilename,
  assertRuntimeProjectIdentity,
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
  const contractProject = { ...project, authority_owner_id: '22222222-2222-4222-8222-222222222222', business_type: 'custom' as const, schema_name: 'custom_authorityengine', name: 'Authority Engine', slug: 'authorityengine', template_key: 'custom_base', template_version: '1.0.0', language: 'pt', status: 'active' }
  const inventory = buildRuntimeInventory(contractProject, 'development')
  assert.ok(inventory.some((item) => item.name === 'DATABASE_URL' && item.required && item.reference_path?.startsWith('secret-manager:')))
  assert.ok(inventory.some((item) => item.name === 'AUTHORITY_PROJECT_ID' && item.value === project.id && item.required))
  assert.ok(inventory.some((item) => item.name === 'AUTHORITY_OWNER_ID' && item.required && item.source === 'derived' && item.value === '22222222-2222-4222-8222-222222222222'))
  assert.ok(inventory.some((item) => item.name === 'AUTHORITY_ADMIN_TOKEN' && item.required && item.reference_path?.startsWith('secret-manager:')))
  assert.ok(inventory.some((item) => item.name === 'CONTROL_TOWER_SCHEMA_NAME' && item.value === 'custom_authorityengine'))
  assert.ok(inventory.every((item) => item.value !== undefined || item.reference_path !== undefined))
  assert.ok(inventory.every((item) => !('secret_value' in item)))
})

test('env document is explicit, complete and named by slug', () => {
  const contractProject = { ...project, authority_owner_id: '22222222-2222-4222-8222-222222222222', business_type: 'custom' as const, name: 'Authority Engine', slug: 'authorityengine', schema_name: 'custom_authorityengine', template_key: 'custom_base', template_version: '1.0.0', language: 'pt', status: 'active' }
  const contract = buildRuntimeContract(contractProject, 'production')
  assert.equal(runtimeEnvFilename('authorityengine', 'production'), 'env.authorityengine')
  assert.equal(contract.envFilename, 'env.authorityengine')
  assert.match(contract.envDocument, /^NODE_ENV=production/m)
  assert.match(contract.envDocument, /^AUTHORITY_PROJECT_ID=11111111-1111-4111-8111-111111111111/m)
  assert.match(contract.envDocument, /^AUTHORITY_OWNER_ID=22222222-2222-4222-8222-222222222222/m)
  assert.match(contract.envDocument, /^DATABASE_URL=<secret-manager:/m)
  assert.match(contract.envDocument, /^AUTHORITY_ADMIN_TOKEN=<secret-manager:/m)
  assert.match(contract.envDocument, /^PORT=3400/m)
  assert.ok(contract.envDocument.split('\n').filter(Boolean).length >= 15)
})

test('Authority falha fechado quando slug, schema ou business_type divergem', () => {
  assert.doesNotThrow(() => assertRuntimeProjectIdentity({ slug: 'authorityengine', schema_name: 'custom_authorityengine', business_type: 'custom' }))
  assert.throws(() => assertRuntimeProjectIdentity({ slug: 'authorityengine', schema_name: 'custom_fbr_blogs', business_type: 'custom' }), /authority_project_identity_mismatch/)
  assert.throws(() => assertRuntimeProjectIdentity({ slug: 'fbr_blogs', schema_name: 'custom_authorityengine', business_type: 'blog' }), /authority_schema_identity_mismatch/)
})

test('serviceName deriva do primeiro nome do projeto', () => {
  assert.equal(buildServiceName({ name: 'Authority Engine' }), 'authority')
  assert.equal(buildServiceName({ name: 'FBR Ads' }), 'fbr')
})

test('runtime contract e Developer Document são sanitizados e versionados', () => {
  const contract = buildRuntimeContract({ ...project, business_type: 'custom' as const, schema_name: 'custom_authorityengine', name: 'Authority Engine', slug: 'authorityengine', template_key: 'custom_base', template_version: '1.0.0', language: 'pt', status: 'active' }, 'production')
  const document = renderRuntimeDeveloperDocument(contract)
  assert.equal(contract.contractVersion, '1.0.0')
  assert.equal(contract.environment, 'production')
  assert.match(document, /DATABASE_URL/)
  assert.match(document, /secret-manager:/)
  assert.doesNotMatch(document, /secret_value|service-role-value|local-e2e-admin/)
})
