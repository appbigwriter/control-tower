import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const text = async (relative) => readFile(new URL(relative, root), 'utf8')
const fixture = JSON.parse(await text('tests/fixtures/control-tower-acceptance-contract.json'))

 test('fixture is local-only and contains no secret values', () => {
  assert.equal(fixture.scope, 'local-only')
  assert.equal(fixture.remoteMutation, false)
  assert.deepEqual(fixture.secretValues, [])
  assert.doesNotMatch(JSON.stringify(fixture), /secret_value|service_role|Bearer\s+[A-Za-z0-9._-]+/i)
})

test('existing Control Tower routes match the acceptance contract', async () => {
  const projectRoute = await text('src/app/api/control-tower/projects/route.ts')
  const configurationRoute = await text('src/app/api/control-tower/projects/[slug]/configuration/route.ts')
  const configurationUi = await text('src/components/control-tower/ProjectConfigurationButtons.tsx')
  const healthRoute = await text('src/app/api/control-tower/health/route.ts')
  const namespacesRoute = await text('src/app/api/control-tower/secrets/namespaces/route.ts')
  const bindingsRoute = await text('src/app/api/control-tower/secrets/bindings/route.ts')
  const runtimeRoute = await text('src/app/api/control-tower/projects/[slug]/runtime-contract/route.ts')
  const runtimeMigration = await text('supabase/migrations/013_project_runtime_contracts.sql')
  // GDB-REM-012: lifecycle moved to lib; contract assertions cover route + lib.
  const bindingsLib = await text('src/lib/control-tower/bindings.ts')
  const bindingsSurface = bindingsRoute + '\n' + bindingsLib

  assert.match(projectRoute, /createProjectHandler/)
  assert.match(configurationRoute, /project_configuration_artifacts/)
  assert.match(configurationRoute, /onConflict: 'project_id,artifact_type'/)
  assert.match(configurationRoute, /isAdminSessionActive/)
  assert.match(configurationUi, /\/api\/control-tower\/projects\/\$\{slug\}\/configuration/)
  assert.match(healthRoute, /status: 'healthy'/)
  assert.match(namespacesRoute, /onConflict: 'namespace'/)
  assert.match(bindingsSurface, /onConflict: 'namespace_id,secret_name,environment'/)
  assert.match(bindingsSurface, /reference_path/)
  assert.match(runtimeRoute, /project_runtime_contracts/)
  assert.match(runtimeRoute, /buildRuntimeContract/)
  assert.match(runtimeMigration, /unique\(project_id, environment, contract_version\)/)
  assert.match(runtimeMigration, /document_markdown/)
  assert.doesNotMatch(runtimeRoute, /secret_value/)
  assert.doesNotMatch(bindingsSurface, /select\([^)]*secret_value/)
})

test('migrations define schema/artifact/secret idempotency primitives', async () => {
  const schemaMigration = await text('supabase/migrations/010_complete_schema_provisioning.sql')
  const secretsMigration = await text('supabase/migrations/010_service_identity_and_secrets.sql')
  const artifactsMigration = await text('supabase/migrations/011_project_configuration_artifacts.sql')

  assert.match(schemaMigration, /create schema if not exists/)
  assert.match(schemaMigration, /invalid schema name/)
  assert.match(secretsMigration, /unique\(namespace_id, secret_name, environment\)/)
  assert.match(secretsMigration, /namespace text not null unique/)
  assert.match(artifactsMigration, /unique\(project_id, artifact_type\)/)
  assert.match(artifactsMigration, /create table if not exists/)
})

test('public artifact builder never emits secret values', async () => {
  const builder = await text('src/lib/control-tower/project-configuration.ts')
  assert.match(builder, /SUPABASE_ANON_KEY: ''/)
  assert.match(builder, /SUPABASE_SERVICE_ROLE_KEY: ''/)
  assert.match(builder, /\/health/)
})

test('existing Flux E2E fixture stays simulated and external-action safe', async () => {
  const e2e = await text('../FBR Agency Flux/09-codigo/tests/flux-qa-016.e2e.test.ts')
  const harness = await text('../FBR Agency Flux/09-codigo/src/lib/flux-qa-016-harness.ts')
  assert.match(e2e, /simulated_provisioning/)
  assert.match(e2e, /externalActionAuthorized: false/)
  assert.match(harness, /local-control-tower-fake/)
  assert.match(harness, /simulated-provisioning-readback/)
})
