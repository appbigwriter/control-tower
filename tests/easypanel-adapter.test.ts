import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import {
  EasypanelSecretsProvider,
  normalizeEasypanelApiUrl,
} from '../src/lib/secrets/adapter.ts'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

afterEach(() => {
  process.env = { ...originalEnv }
  globalThis.fetch = originalFetch
})

function setupRuntime() {
  process.env.EASYPANEL_API_URL = 'http://easypanel.internal/api/'
  process.env.EASYPANEL_API_TOKEN = 'token-not-real'
  process.env.EASYPANEL_PROJECT_NAME = 'projetos'
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('normaliza uma URL base para exatamente um /api', () => {
  assert.equal(normalizeEasypanelApiUrl('http://easypanel.internal/'), 'http://easypanel.internal/api')
  assert.equal(normalizeEasypanelApiUrl('http://easypanel.internal/api/'), 'http://easypanel.internal/api')
  assert.equal(normalizeEasypanelApiUrl('http://easypanel.internal/api'), 'http://easypanel.internal/api')
})

test('falha fechado quando o token não existe', async () => {
  process.env.EASYPANEL_API_URL = 'http://easypanel.internal'
  delete process.env.EASYPANEL_API_TOKEN
  await assert.rejects(
    () => new EasypanelSecretsProvider().updateEnv('projetos', 'gestaodb', { A: 'B' }),
    /EASYPANEL_API_TOKEN.*ausente/
  )
})

test('preserva projectName do ambiente e deriva serviceName do namespace', () => {
  setupRuntime()
  assert.deepEqual(new EasypanelSecretsProvider().resolveProjectAndService('fbr/gestaodb'), {
    projectName: 'projetos',
    serviceName: 'gestaodb',
  })
})

test('listProjectsAndServices usa GET autenticado sem query inventada', async () => {
  setupRuntime()
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return response([{ name: 'projetos', services: [{ name: 'gestaodb' }] }])
  }) as typeof fetch

  const result = await new EasypanelSecretsProvider().listProjectsAndServices()

  assert.deepEqual(result, [{ name: 'projetos', services: [{ name: 'gestaodb' }] }])
  assert.equal(calls[0].url, 'http://easypanel.internal/api/listProjectsAndServices')
  assert.equal(new URL(calls[0].url).search, '')
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer token-not-real')
  assert.equal(calls[0].init.method, 'GET')
})

test('inspectAppService envia os query params oficiais e retorna o readback', async () => {
  setupRuntime()
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return response({ serviceName: 'gestaodb', env: 'MARKER=ok', status: 'running' })
  }) as typeof fetch

  const result = await new EasypanelSecretsProvider().inspectAppService('projetos', 'gestaodb')

  assert.deepEqual(result, { serviceName: 'gestaodb', env: 'MARKER=ok', status: 'running' })
  const parsed = new URL(calls[0].url)
  assert.equal(parsed.pathname, '/api/inspectAppService')
  assert.deepEqual(Object.fromEntries(parsed.searchParams), {
    projectName: 'projetos',
    serviceName: 'gestaodb',
  })
  assert.equal(calls[0].init.method, 'GET')
})

test('injectSecrets localiza serviço existente, atualiza env, verifica configuração e faz deploy/readback', async () => {
  setupRuntime()
  const calls: Array<{ url: string; init: RequestInit }> = []
  let listCount = 0
  globalThis.fetch = (async (url, init = {}) => {
    const value = { url: String(url), init }
    calls.push(value)
    const pathname = new URL(value.url).pathname
    if (pathname.endsWith('/listProjectsAndServices')) {
      listCount += 1
      return response(listCount === 1 ? [{ name: 'projetos', services: [] }] : [{ name: 'projetos', services: [{ name: 'gestaodb' }] }])
    }
    if (pathname.endsWith('/createAppService')) return response({ actionId: 'create-1' })
    if (pathname.endsWith('/updateAppEnv')) return response({ actionId: 'env-1' })
    if (pathname.endsWith('/deployAppService')) return response({ actionId: 'deploy-1' })
    if (pathname.endsWith('/inspectAppService')) return response({ serviceName: 'gestaodb', env: 'DATABASE_URL=secret-value', status: 'running' })
    throw new Error(`unexpected ${pathname}`)
  }) as typeof fetch

  await new EasypanelSecretsProvider().injectSecrets('fbr/gestaodb', [
    { key_name: 'DATABASE_URL', secret_value: 'secret-value' },
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
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), {
    projectName: 'projetos',
    serviceName: 'gestaodb',
    env: 'DATABASE_URL=secret-value',
  })
})

test('destroy só é chamado explicitamente e o readback posterior confirma ausência', async () => {
  setupRuntime()
  const calls: string[] = []
  let exists = true
  globalThis.fetch = (async (url, init = {}) => {
    const parsed = new URL(String(url))
    calls.push(parsed.pathname)
    if (parsed.pathname.endsWith('/listProjectsAndServices')) {
      return response([{ name: 'projetos', services: exists ? [{ name: 'gestaodb' }] : [] }])
    }
    if (parsed.pathname.endsWith('/destroyAppService')) {
      exists = false
      return response({ actionId: 'destroy-1' })
    }
    throw new Error(`unexpected ${parsed.pathname} ${init.method}`)
  }) as typeof fetch

  const result = await new EasypanelSecretsProvider().destroy('projetos', 'gestaodb')

  assert.equal(result.exists, false)
  assert.deepEqual(calls, ['/api/destroyAppService', '/api/listProjectsAndServices'])
})

test('status não reconhecido é NOT_VERIFIED e não inventa saúde', async () => {
  setupRuntime()
  globalThis.fetch = (async () => response({ serviceName: 'gestaodb', status: 'future-state' })) as typeof fetch

  const result = await new EasypanelSecretsProvider().getStatus('projetos', 'gestaodb')

  assert.equal(result.status, 'NOT_VERIFIED')
  assert.equal(result.healthy, false)
})
