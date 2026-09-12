import { createClient } from '@supabase/supabase-js'

const baseUrl = 'http://localhost:3000'
const adminSecret = process.env.CONTROL_TOWER_ADMIN_SECRET
if (!adminSecret) {
  throw new Error('CONTROL_TOWER_ADMIN_SECRET must be injected by the runtime')
}

async function runTests() {
  console.log('=====================================================')
  console.log('🧪 INICIANDO BATERIA DE TESTES E2E: SECRETS E IAM')
  console.log('=====================================================\n')

  // 1. Health Check
  console.log('1️⃣ Testando Health Check...')
  const healthRes = await fetch(`${baseUrl}/api/control-tower/health`)
  const healthData = await healthRes.json()
  console.log(`Status HTTP: ${healthRes.status}, Body:`, healthData)
  if (healthRes.status !== 200) throw new Error('Health check falhou')

  // 2. Limpar identities de teste anteriores no banco
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  await supabase.from('service_identities').delete().in('name', ['fbr-agency-flux-service', 'test-temp-agent'])
  await supabase.from('secret_namespaces').delete().eq('namespace', 'fbr/services/agency-flux/')

  // 3. Criar a Service Identity oficial: fbr-agency-flux-service
  console.log('\n2️⃣ Criando Service Identity: fbr-agency-flux-service...')
  const createRes = await fetch(`${baseUrl}/api/control-tower/identities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminSecret}`
    },
    body: JSON.stringify({
      name: 'fbr-agency-flux-service',
      namespace: 'fbr/services/agency-flux/',
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
  console.log(`Status HTTP: ${createRes.status}`)
  console.log('Identity criada:', createData.identity)
  console.log('Token JWT emitido (truncado):', createData.token ? createData.token.slice(0, 25) + '...' : 'NONE')

  if (createRes.status !== 201 || !createData.token) {
    throw new Error('Falha ao criar Service Identity')
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
  console.log(`Status HTTP /projects: ${projectsRes.status}, Total projetos: ${projectsData.projects?.length ?? 0}`)
  if (projectsRes.status !== 200) throw new Error('Acesso autenticado com JWT falhou')

  // 5. Criar Secret Namespace com o JWT do Flux
  console.log('\n4️⃣ Criando Secret Namespace com o JWT do fbr-agency-flux-service...')
  const nsRes = await fetch(`${baseUrl}/api/control-tower/secrets/namespaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${fluxJwtToken}`
    },
    body: JSON.stringify({
      namespace: 'fbr/services/agency-flux/',
      provider: 'easypanel'
    })
  })
  const nsData = await nsRes.json()
  console.log(`Status HTTP /secrets/namespaces: ${nsRes.status}`, nsData)
  if (nsRes.status !== 201 && nsRes.status !== 200) throw new Error('Falha ao criar namespace')
  const namespaceId = nsData.namespace.id

  // 6. Criar Secret Bindings por referência
  console.log('\n5️⃣ Registrando Secret Bindings por referência (Zero Leaks)...')
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
          reference_path: 'fbr/services/agency-flux/CONTROL_TOWER_AGENT_API_KEY',
          secret_value: 'e2e-test-only-synthetic-value',
          provider: 'easypanel',
          environment: 'production'
        },
        {
          secret_name: 'CONTROL_TOWER_BASE_URL',
          reference_path: 'fbr/services/agency-flux/CONTROL_TOWER_BASE_URL',
          secret_value: 'https://supabase-control-tower-api.fbr.news',
          provider: 'easypanel',
          environment: 'production'
        }
      ]
    })
  })
  const bindData = await bindRes.json()
  console.log(`Status HTTP /secrets/bindings: ${bindRes.status}`, bindData)
  if (bindRes.status !== 201 && bindRes.status !== 200) throw new Error('Falha ao registrar bindings')

  // 7. Testar Ciclo de Vida: Revogação e Bloqueio Imediato
  console.log('\n6️⃣ Testando Ciclo de Vida: Criação de Identidade Temporária e Revogação...')
  const tempRes = await fetch(`${baseUrl}/api/control-tower/identities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminSecret}`
    },
    body: JSON.stringify({
      name: 'test-temp-agent',
      namespace: 'fbr/agents/temp/',
      identity_type: 'agent',
      scopes: ['projects:read']
    })
  })
  const tempData = await tempRes.json()
  const tempToken = tempData.token
  const tempId = tempData.identity.id
  console.log(`Identidade temporária criada: ${tempId}`)

  // Validar que token funciona antes de revogar
  const testBeforeRevoke = await fetch(`${baseUrl}/api/control-tower/projects`, {
    headers: { 'Authorization': `Bearer ${tempToken}` }
  })
  console.log(`Status antes de revogar: ${testBeforeRevoke.status} (Esperado: 200)`)
  if (testBeforeRevoke.status !== 200) throw new Error('Falha na validação pré-revogação')

  // Revogar identidade
  console.log('Revogando identidade...')
  const revokeRes = await fetch(`${baseUrl}/api/control-tower/identities/${tempId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminSecret}`
    },
    body: JSON.stringify({ status: 'revoked' })
  })
  console.log(`Status revogação: ${revokeRes.status}`)

  // Validar que token é REJEITADO imediatamente após revogação
  const testAfterRevoke = await fetch(`${baseUrl}/api/control-tower/projects`, {
    headers: { 'Authorization': `Bearer ${tempToken}` }
  })
  console.log(`Status após revogação: ${testAfterRevoke.status} (Esperado: 401)`)
  if (testAfterRevoke.status !== 401) throw new Error('FALHA DE SEGURANÇA: Token revogado não foi bloqueado!')

  // Limpeza
  await supabase.from('service_identities').delete().eq('id', tempId)

  console.log('\n=====================================================')
  console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!')
  console.log('=====================================================')
}

runTests().catch(err => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES:', err)
  process.exit(1)
})
