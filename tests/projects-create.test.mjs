import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Load the real handler offline, resolving its Next.js aliases in memory.
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  for (const [specifier, url] of Object.entries(replacements)) {
    source = source.replaceAll(`'${specifier}'`, `'${url}'`)
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const hosting = await moduleUrl('../src/lib/control-tower/hosting-targets.ts')
const provisioning = await moduleUrl('../src/lib/control-tower/provisioning.ts', { './hosting-targets': hosting })
const { createProjectHandler } = await import(await moduleUrl('../src/lib/control-tower/projects-create.ts', {
  '@/lib/control-tower/provisioning': provisioning,
}))

const input = {
  name: 'FBR Transcript', slug: 'transcript', business_type: 'custom', template_key: 'custom_base',
  domain: 'transcript.fbr.news', repository_url: 'https://github.com/appbigwriter/transcript.git',
  hosting_target: 'vps2', hosting_project_name: 'sistemas',
}
const projectId = '90019e93-3a72-413d-8729-ca1013c2e2b8'
const complete = { schema_exists: true, missing_tables: [], expected_tables: ['entities'] }

function client({ readback = complete, verifyError = null, result = {} } = {}) {
  const calls = []
  const supabase = {
    from(table) {
      const query = {
        select() { return query }, eq(column, value) { calls.push([table, column, value]); return query },
        update() { calls.push(['update', table]); return query },
        async maybeSingle() {
          return { data: table === 'organizations' ? { id: 'org-id' } : { id: projectId, schema_name: 'custom_transcript', business_type: 'custom' }, error: null }
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.push([name, args])
      if (name === 'verify_project_schema') return { data: readback, error: verifyError }
      assert.equal(name, 'provision_project_v2')
      return { data: { ok: true, status: 'replayed', project_id: projectId, job_id: 'job-id', job_status: 'success', project_status: 'active', ...result }, error: null }
    },
  }
  return { supabase, calls }
}

test('successful replay without readback verifies the stored schema and returns 200', async () => {
  const { supabase, calls } = client()
  const response = await createProjectHandler(supabase, input, 'test:replay')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.readback, complete)
  assert.ok(calls.some(([name, args]) => name === 'verify_project_schema' && args.p_schema_name === 'custom_transcript' && args.p_business_type === 'custom'))
})

test('replay cannot claim success when the schema is incomplete or verification fails', async () => {
  for (const options of [
    { readback: { schema_exists: false, missing_tables: ['entities'] } },
    { readback: null, verifyError: { message: 'verification failed' } },
  ]) {
    const { supabase, calls } = client(options)
    const response = await createProjectHandler(supabase, input, 'test:replay')
    assert.equal(response.status, 500)
    assert.ok(!calls.some(([name]) => name === 'update'))
  }
})

test('fresh successful provisioning uses its readback without an extra verification', async () => {
  const { supabase, calls } = client({ result: { status: 'created', readback: complete } })
  const response = await createProjectHandler(supabase, input, 'test:created')
  assert.equal(response.status, 201)
  assert.ok(!calls.some(([name]) => name === 'verify_project_schema'))
})

test('explicit incomplete readback and failed jobs are never overridden by replay verification', async () => {
  for (const result of [
    { readback: { schema_exists: true, missing_tables: ['entities'] } },
    { ok: false, job_status: 'failed', error: 'schema creation failed' },
  ]) {
    const { supabase, calls } = client({ result })
    const response = await createProjectHandler(supabase, input, 'test:replay')
    assert.equal(response.status, 500)
    assert.ok(!calls.some(([name]) => name === 'verify_project_schema' || name === 'update'))
  }
})
