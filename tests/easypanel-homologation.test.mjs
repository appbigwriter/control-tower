import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  deriveProjectAndService,
  buildRequestPayload,
  normalizeBaseUrl,
  run,
} from '../scripts/easypanel-homologation.mjs'

const script = new URL('../scripts/easypanel-homologation.mjs', import.meta.url)


test('homologation script parses as plain ESM JavaScript', () => {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(script)], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const source = readFileSync(script, 'utf8')
  assert.doesNotMatch(source, /\.ts['"]|:\s*(?:string|boolean|number|unknown)\b|\bas\s+Record\b/)
})

test('normalizes URL and builds sanitized REST payloads', () => {
  assert.equal(normalizeBaseUrl(' https://panel.example/api/// '), 'https://panel.example/api')
  assert.deepEqual(deriveProjectAndService('fbr/services/flux-connection-test/'), {
    projectName: 'projetos',
    serviceName: 'flux-connection-test',
  })
  assert.deepEqual(buildRequestPayload('updateAppEnv', 'projetos', 'flux-connection-test', {
    FBR_EASYPANEL_HOMOLOGATION_MARKER: 'fbr-homologation-marker',
  }), {
    projectName: 'projetos',
    serviceName: 'flux-connection-test',
    env: 'FBR_EASYPANEL_HOMOLOGATION_MARKER=fbr-homologation-marker',
  })
})

test('fixture exercises the complete lifecycle without remote access', async () => {
  const calls = []
  let listCount = 0
  const env = {
    EASYPANEL_API_URL: 'https://fixture.invalid/api/',
    EASYPANEL_API_TOKEN: 'fixture-token',
    EASYPANEL_PROJECT_NAME: 'projetos',
    EASYPANEL_HOMOLOGATION_NAMESPACE: 'fbr/services/flux-connection-test/',
  }
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    calls.push({ parsed, init })
    if (parsed.pathname.endsWith('/listProjectsAndServices')) {
      listCount += 1
      const services = listCount === 1 ? [] : listCount === 2 ? [{ name: 'flux-connection-test' }] : []
      return new Response(JSON.stringify([{ name: 'projetos', services }]), { status: 200 })
    }
    if (parsed.pathname.endsWith('/inspectAppService')) {
      return new Response(JSON.stringify({ env: 'FBR_EASYPANEL_HOMOLOGATION_MARKER=fbr-homologation-marker', status: 'unknown' }), { status: 200 })
    }
    if (parsed.pathname.endsWith('/listActions')) return new Response(JSON.stringify({ actions: [{ id: 'fixture-action' }] }), { status: 200 })
    if (parsed.pathname.endsWith('/getAction')) return new Response(JSON.stringify({ id: 'fixture-action', status: 'done' }), { status: 200 })
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }

  await run(env, fetchImpl)
  assert.deepEqual(calls.map(({ parsed }) => parsed.pathname), [
    '/api/listProjectsAndServices', '/api/createAppService', '/api/listProjectsAndServices',
    '/api/updateAppEnv', '/api/inspectAppService', '/api/deployAppService',
    '/api/inspectAppService', '/api/listActions', '/api/getAction',
    '/api/destroyAppService', '/api/listProjectsAndServices',
  ])
  assert.equal(calls.every(({ init }) => init.headers.Authorization === 'Bearer fixture-token'), true)
  assert.equal(calls.some(({ parsed }) => parsed.href.includes('fixture-token')), false)
  assert.equal(JSON.parse(calls[3].init.body).env, 'FBR_EASYPANEL_HOMOLOGATION_MARKER=fbr-homologation-marker')
})
