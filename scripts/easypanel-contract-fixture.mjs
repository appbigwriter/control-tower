import assert from 'node:assert/strict'
import { EasypanelSecretsProvider } from '../src/lib/secrets/adapter.ts'

process.env.EASYPANEL_API_URL = 'http://fixture.invalid/api/'
process.env.EASYPANEL_API_TOKEN = 'fixture-token'
process.env.EASYPANEL_PROJECT_NAME = 'projetos'
const calls = []
let listCount = 0
globalThis.fetch = async (url, init = {}) => {
  const call = { url: String(url), init }
  calls.push(call)
  const pathname = new URL(call.url).pathname
  if (pathname.endsWith('/listProjectsAndServices')) {
    listCount += 1
    return new Response(JSON.stringify(listCount === 1
      ? [{ name: 'projetos', services: [] }]
      : [{ name: 'projetos', services: [{ name: 'fixture-service' }] }]), { status: 200 })
  }
  if (pathname.endsWith('/inspectAppService')) {
    return new Response(JSON.stringify({ serviceName: 'fixture-service', env: 'EXAMPLE_SECRET=fixture-only', status: 'future-state' }), { status: 200 })
  }
  if (pathname.endsWith('/createAppService') || pathname.endsWith('/updateAppEnv') || pathname.endsWith('/deployAppService')) {
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }
  throw new Error(`unexpected fixture endpoint: ${pathname}`)
}

await new EasypanelSecretsProvider().injectSecrets('fbr/fixture-service', [
  { key_name: 'EXAMPLE_SECRET', secret_value: 'fixture-only' },
])

assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
  '/api/listProjectsAndServices',
  '/api/createAppService',
  '/api/listProjectsAndServices',
  '/api/updateAppEnv',
  '/api/inspectAppService',
  '/api/deployAppService',
  '/api/inspectAppService',
])
assert.deepEqual(JSON.parse(calls[3].init.body), {
  projectName: 'projetos', serviceName: 'fixture-service', env: 'EXAMPLE_SECRET=fixture-only'
})
assert.equal(calls.every(({ init }) => init.headers.Authorization === 'Bearer fixture-token'), true)
assert.equal(calls.some(({ url }) => url.includes('fixture-token')), false)
console.log('Easypanel REST contract fixture passed; no VPS request was made')
