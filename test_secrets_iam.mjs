import { createClient } from '@supabase/supabase-js'

const baseUrl = process.env.CONTROL_TOWER_BASE_URL || 'http://localhost:3000'
const adminSecret = process.env.CONTROL_TOWER_ADMIN_SECRET
if (!adminSecret) {
  throw new Error('CONTROL_TOWER_ADMIN_SECRET must be injected by the runtime')
}
const runId = Date.now().toString(36)
const testIdentityName = `fbr-agency-flux-e2e-${runId}`
const testNamespace = `fbr/e2e/${runId}/`

async function runTests() {
  console.log('=====================================================')
  console.log('🧪 INICIANDO BATERIA DE TESTES E2E: SECRETS E IAM')
  console.log(`🎯 TARGET BASE URL: ${baseUrl}`)
  console.log('=====================================================\n')

  // 1. Health Check
  console.log('1️⃣ Testando Health Check...')
  const healthRes = await fetch(`${baseUrl}/api/control-tower/health`)
  const healthData = await healthRes.json()
  console.log(`Status HTTP: ${healthRes.status}, Body:`, healthData)
  if (healthRes.status !== 200 || healthData.status !== 'healthy' || healthData.database !== 'connected') {
    throw new Error('Health check falhou: esperado HTTP 200, healthy e database connected')
  }

  // 2. O teste usa recursos temporários e não remove recursos oficiais
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // 3. Criar uma Service Identity temporária para validação
  console.log(`\n2️⃣ Criando Service Identity temporária: ${testIdentityName}...`)
  const createRes = await fetch(`${baseUrl}/api/control-tower/identities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminSecret}`
    },
    body: JSON.stringify({
      name: testIdentityName,
      namespace: testNamespace,
      identity_type: 'service',
      scopes: [
        'projects:read',
        'projects:provision',
        'projects:sql:execute',
        'secrets:namespaces:create',
        'secrets:bindings:write',
        'health:read'
      ],
      created_by: 'control-tower-bootstrap'
    })
  })
  const createData = await createRes.json()
  console.log(`Status HTTP /identities: ${createRes.status} (Esperado: 201)`)
  if (createRes.status !== 201 || !createData.token) {
    throw new Error('Falha ao criar Service Identity: esperado HTTP 201')
  }

  const fluxJwtToken = createData.token
  const fluxIdentityId = createData.identity.id

  // 4. Testar Autenticação com o JWT da Identity nos endpoints do Control Tower
  console.log('\n3️⃣ Testando acesso autenticado com o JWT do fbr-agency-flux-service...')
  const projectsRes = await fetch(`${baseUrl}/api/control-tower/projects`, {
    headers: {
      'Authorization': `Bearer ${fluxJwtToken}`
    }
  })
  const projectsData = await projectsRes.json()
  console.log(`Status HTTP /projects: ${projectsRes.status} (Esperado: 200), Total projetos: ${projectsData.projects?.length ?? 0}`)
  if (projectsRes.status !== 200) throw new Error('Acesso autenticado com JWT falhou: esperado HTTP 200')

  // 5. Criar Secret Namespace com o JWT do Flux
  console.log('\n4️⃣ Criando Secret Namespace com o JWT do fbr-agency-flux-service...')
  const nsRes = await fetch(`${baseUrl}/api/control-tower/secrets/namespaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${fluxJwtToken}`
    },
    body: JSON.stringify({
      namespace: testNamespace,
      provider: 'easypanel'
    })
  })
  const nsData = await nsRes.json()
  console.log(`Status HTTP /secrets/namespaces: ${nsRes.status} (Esperado: 201)`, nsData)
  if (nsRes.status !== 201) throw new Error('Falha ao criar namespace: esperado HTTP 201')
  const namespaceId = nsData.namespace.id

  // 6. Testar Zero Secret Leaks: Envio de secret_value por agente DEVE ser rejeitado com HTTP 400
  console.log('\n5️⃣ Validando Política Zero Secret Leaks (rejeição de secret_value em chamadas de agente)...')
  const leakTestRes = await fetch(`${baseUrl}/api/control-tower/secrets/bindings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${fluxJwtToken}`
    },
    body: JSON.stringify({
      namespace_id: namespaceId,
      bindings: [{ secret_name: 'TEST_LEAK', secret_value: 'raw_leak_attempt' }]
    })
  })
  console.log(`Status rejeição de secret_value direto: ${leakTestRes.status} (Esperado: 400)`)
  if (leakTestRes.status !== 400) throw new Error('FALHA DE SEGURANÇA: secret_value em texto aberto não foi rejeitado!')

  // 7. Criar Secret Bindings estritamente por referência (Zero Leaks)
  console.log('\n6️⃣ Registrando Secret Bindings estritamente por referência...')
  const bindRes = await fetch(`${baseUrl}/api/control-tower/secrets/bindings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${fluxJwtToken}`
    },
    body: JSON.stringify({
      namespace_id: namespaceId,
      bindings: [
        {
          secret_name: 'CONTROL_TOWER_AGENT_API_KEY',
          reference_path: `${testNamespace}CONTROL_TOWER_AGENT_API_KEY`,
          provider: 'easypanel',
          environment: 'production'
        },
        {
          secret_name: 'CONTROL_TOWER_BASE_URL',
          reference_path: `${testNamespace}CONTROL_TOWER_BASE_URL`,
          provider: 'easypanel',
          environment: 'production'
        }
      ]
    })
  })
  const bindData = await bindRes.json()
  console.log(`Status HTTP /secrets/bindings: ${bindRes.status} (Esperado: 201)`, bindData)
  if (bindRes.status !== 201) throw new Error('Falha ao registrar bindings: esperado HTTP 201')

  // 8. Testar Ciclo de Vida: segunda identidade temporária e revogação
  const tempIdentityName = `test-temp-agent-${runId}`
  console.log(`\n7️⃣ Testando Ciclo de Vida: ${tempIdentityName}...`)
  const tempRes = await fetch(`${baseUrl}/api/control-tower/identities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminSecret}`
    },
    body: JSON.stringify({
      name: tempIdentityName,
      namespace: `fbr/e2e/temp/${runId}/`,
      identity_type: 'agent',
      scopes: ['projects:read']
    })
  })
  const tempData = await tempRes.json()
  const tempToken = tempData.token
  const tempId = tempData.identity.id

  // Revogar identidade
  const revokeRes = await fetch(`${baseUrl}/api/control-tower/identities/${tempId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminSecret}`
    },
    body: JSON.stringify({ status: 'revoked' })
  })
  console.log(`Status revogação: ${revokeRes.status} (Esperado: 200)`)

  // Validar que token é REJEITADO imediatamente após revogação
  const testAfterRevoke = await fetch(`${baseUrl}/api/control-tower/projects`, {
    headers: { 'Authorization': `Bearer ${tempToken}` }
  })
  console.log(`Status após revogação: ${testAfterRevoke.status} (Esperado: 401)`)
  if (testAfterRevoke.status !== 401) throw new Error('FALHA DE SEGURANÇA: Token revogado não foi bloqueado com HTTP 401!')

  // Limpeza somente dos recursos temporários desta execução
  await supabase.from('service_identities').delete().eq('id', tempId)
  await supabase.from('service_identities').delete().eq('id', fluxIdentityId)
  await supabase.from('secret_namespaces').delete().eq('id', namespaceId)

  console.log('\n=====================================================')
  console.log('🎉 HOMOLOGAÇÃO COMPLETA: TODOS OS CRITÉRIOS ATENDIDOS!')
  console.log('=====================================================')
}

runTests().catch(err => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err)
  if (err.cause) {
    console.error('🔍 Causa detalhada (err.cause):', err.cause)
  }
  process.exit(1)
})
