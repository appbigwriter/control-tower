import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildArtifact,
  buildNamespace,
  buildPublicVariables,
  buildValidationDomain,
} from '../src/lib/control-tower/project-configuration.ts'

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  business_type: 'blog' as const,
  schema_name: 'blog_example',
  domain: 'example.com',
}

test('gera variáveis públicas com contexto do projeto e secrets vazios', () => {
  const variables = buildPublicVariables(project)
  assert.equal(variables.NODE_ENV, 'production')
  assert.equal(variables.CONTROL_TOWER_PROJECT_ID, project.id)
  assert.equal(variables.CONTROL_TOWER_SCHEMA_NAME, project.schema_name)
  assert.equal(variables.SUPABASE_SERVICE_ROLE_KEY, '')
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
