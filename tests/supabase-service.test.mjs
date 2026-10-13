import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = (await readFile(new URL('../src/lib/supabase/service.ts', import.meta.url), 'utf8'))
  .replace("'@supabase/supabase-js'", JSON.stringify(import.meta.resolve('@supabase/supabase-js')))
const compiled = ts.transpileModule(source, { compilerOptions: { target: 99, module: 99 } }).outputText
const { createServiceRoleClient } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

async function probe(internalUrl, publicFails = false) {
  const originalFetch = globalThis.fetch
  const names = ['INTERNAL_SUPABASE_URL', 'SUPABASE_INTERNAL_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  const requests = []
  try {
    for (const name of names) delete process.env[name]
    if (internalUrl) process.env.INTERNAL_SUPABASE_URL = internalUrl
    process.env.SUPABASE_URL = 'https://supabase-control-tower-api.fbr.news'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-backend-key'
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (publicFails && new URL(request.url).hostname === 'supabase-control-tower-api.fbr.news') {
        throw new TypeError('fetch failed')
      }
      // The HTTP Easypanel endpoint redirects to HTTPS; the redirected request
      // loses Authorization and RLS returns an empty catalog.
      const redirected = request.url.startsWith('http://supabase-supabase-gestaodb.')
      return new Response(JSON.stringify(redirected ? [] : [{ id: 'existing-project' }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    const result = await createServiceRoleClient().from('projects').select('id')
    assert.equal(result.error, null)
    assert.deepEqual(result.data, [{ id: 'existing-project' }])
    assert.equal(requests.at(-1).headers.get('authorization'), 'Bearer test-backend-key')
    return requests
  } finally {
    globalThis.fetch = originalFetch
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}

test('configured Easypanel URL uses HTTPS before sending backend authorization', async () => {
  const requests = await probe('http://supabase-supabase-gestaodb.pojxaz.easypanel.host')
  assert.equal(new URL(requests[0].url).protocol, 'https:')
})

test('network fallback uses HTTPS and retains query and authorization', async () => {
  const requests = await probe(undefined, true)
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[1].url).protocol, 'https:')
  assert.equal(new URL(requests[1].url).searchParams.get('select'), 'id')
})

test('local Docker Kong connections retain HTTP', async () => {
  const requests = await probe('http://kong:8000')
  assert.equal(new URL(requests[0].url).protocol, 'http:')
})
