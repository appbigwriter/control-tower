import test from 'node:test'
import assert from 'node:assert/strict'
import './alias-loader.mjs'

// Import AFTER the alias loader registers its hooks.
const { POST: namespacesPOST } = await import('../src/app/api/control-tower/secrets/namespaces/route.ts')

test('namespaces POST sem credencial responde 401', async () => {
  const req = new Request('http://localhost/api/control-tower/secrets/namespaces', {
    method: 'POST',
    body: JSON.stringify({ project_id: 'x', namespace: 'fbr/blogs/x' }),
  })
  const res = await namespacesPOST(req)
  assert.equal(res.status, 401)
})
