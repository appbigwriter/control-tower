// GDB-REM-015: local E2E Authority → Flux → Blogs → Control Tower.
// Mocks explícitos, sem rede, sem publicação real. Falhas de perna bloqueiam publicação.
import test from 'node:test'
import assert from 'node:assert/strict'

import { runLocalE2E } from './e2e/harness-gdb-rem-015.ts'

test('E2E local: fluxo completo com provider saudável publica somente após todas as pernas', async () => {
  const result = await runLocalE2E({ providerFail: false })

  const legs = result.steps.map((s) => `${s.leg}:${s.ok ? 'ok' : 'FAIL'}`)
  console.log('[E2E] legs:', legs.join(' | '))

  assert.ok(result.ok, `pernas falhas: ${result.blockReasons.join('; ')}`)
  assert.ok(!result.publicationBlocked)
  assert.equal(result.steps.length, 10)

  // Readback confirmations per leg
  const byLeg: Record<string, any> = Object.fromEntries(result.steps.map((s) => [s.leg, s.detail]))
  assert.equal(byLeg['flux.approvalEventIdempotent'].replay_same_job, true)
  assert.ok(String(byLeg['blogs.handoffNamespace'].namespace).startsWith('fbr/blogs/'))
  assert.equal(byLeg['controlTower.bindingsLifecycle'].binding_statuses.length, 1)
  assert.ok(String(byLeg['controlTower.bindingsLifecycle'].binding_statuses[0]).endsWith('=active'))
  assert.equal(byLeg['controlTower.domainVerification'].state, 'dns_verified')
  assert.ok(String(byLeg['controlTower.domainVerification'].health_readback_id).startsWith('hdr-'))
  assert.equal(byLeg['controlTower.deleteWithReadback'].catalog_removed, true)
  assert.equal(byLeg['controlTower.deleteWithReadback'].schema_exists_after, false)
})

test('E2E local: provider de secrets falho bloqueia publicação (binding nunca active)', async () => {
  const result = await runLocalE2E({ providerFail: true })

  assert.ok(!result.ok)
  assert.ok(result.publicationBlocked)
  const bindingsLeg = result.steps.find((s) => s.leg === 'controlTower.bindingsLifecycle')
  assert.ok(bindingsLeg)
  assert.equal(bindingsLeg.ok, false)
  const statuses = bindingsLeg.detail.binding_statuses as string[]
  assert.ok(statuses.every((s) => !s.endsWith('=active')), 'nenhum binding pode terminar active')
  assert.ok(result.blockReasons.some((r) => r.includes('bindings')))
})

test('E2E local: falha de audit no archive bloqueia publicação e não arquiva', async () => {
  const result = await runLocalE2E({ breakAuditMidArchive: true })

  assert.ok(!result.ok)
  const archiveLeg = result.steps.find((s) => s.leg === 'controlTower.archiveAuditGuarantee')
  assert.ok(archiveLeg)
  assert.equal(archiveLeg.ok, false)
  assert.equal(archiveLeg.detail.project_status_after, 'active', 'projeto permanece active sem audit')
})
