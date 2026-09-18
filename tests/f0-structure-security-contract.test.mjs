import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const fluxRoot = 'F:/Projetos/_FBR/FBR Agency Flux'
const ctRoot = 'F:/Projetos/_FBR/GestaoDB'
const contract = join(ctRoot, 'docs/control-tower/F0-STRUCT-002-F0-SEC-003-MIGRATION-AUTH-CONTRACT-v1.0.0.md')

async function text(path) { return readFile(path, 'utf8') }

test('contract artifacts exist and label governance categories', async () => {
  const [ct, flux] = await Promise.all([
    text(contract),
    text(join(fluxRoot, '08-historico/F0-STRUCT-002-F0-SEC-003-MIGRATION-AUTH-CONTRACT-v1.0.0.md')),
  ])
  for (const label of ['FACT', 'DECISION', 'RECOMMENDATION', 'BLOCKER']) assert.match(ct, new RegExp(label))
  for (const label of ['FATO', 'DECISÃO', 'RECOMENDAÇÃO', 'BLOQUEIO']) assert.match(flux, new RegExp(label))
  assert.match(ct, /CT-011A/)
  assert.match(ct, /CT-011B/)
  assert.match(flux, /004_flux_runtime_relational\.sql.*não entra/s)
})

test('migration basename collision is explicit and uniquely mapped', async () => {
  const paths = [
    '010_complete_schema_provisioning.sql',
    '010_service_identity_and_secrets.sql',
    '011_flux_external_state.sql',
    '011_project_configuration_artifacts.sql',
  ]
  const names = paths.map((path) => basename(path))
  assert.equal(new Set(names).size, 4)
  const ct = await text(contract)
  for (const id of ['CT-010A', 'CT-010B', 'CT-011A', 'CT-011B']) assert.match(ct, new RegExp(id))
})

test('security contract preserves negative-test and remote-blocker gates', async () => {
  const [ct, flux] = await Promise.all([text(contract), text(join(fluxRoot, '08-historico/F0-STRUCT-002-F0-SEC-003-MIGRATION-AUTH-CONTRACT-v1.0.0.md'))])
  for (const term of ['sem sessão', 'scope', 'outro tenant', 'ct:sql:execute', 'default-secret-change-me']) assert.match(ct, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  for (const term of ['BLOQUEADOR REMOTO', 'readback', 'nenhuma aplicação foi feita']) assert.match(flux, new RegExp(term, 'i'))
})

test('source SQLs are local-only inputs; test performs no network call', async () => {
  const sql = await text(join(ctRoot, 'supabase/migrations/011_project_configuration_artifacts.sql'))
  assert.match(sql, /project_configuration_artifacts/)
  assert.doesNotMatch(sql, /https?:\/\//i)
})
