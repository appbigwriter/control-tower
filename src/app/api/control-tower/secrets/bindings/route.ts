import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateToken, hasRequiredScope } from '@/lib/auth/control-tower'
import { getSecretsProvider } from '@/lib/secrets/adapter'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

export async function POST(req: NextRequest) {
  try {
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!hasRequiredScope(principal, 'secrets:bindings:write') && principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Escopo secrets:bindings:write necessário' }, { status: 403 })
    }

    const body = await req.json()
    const { namespace_id, bindings } = body

    if (!namespace_id || !bindings || !Array.isArray(bindings) || bindings.length === 0) {
      return NextResponse.json({ error: 'Campos obrigatórios: namespace_id, bindings (array)' }, { status: 400 })
    }

    // 1. Obter informações do namespace
    const { data: ns, error: nsError } = await supabase
      .from('secret_namespaces')
      .select('id, namespace, provider')
      .eq('id', namespace_id)
      .single()

    if (nsError || !ns) {
      return NextResponse.json({ error: 'Namespace não encontrado' }, { status: 404 })
    }

    // 2. Gravar apenas as referências no banco (Zero Secret Leaks)
    const recordsToUpsert = bindings.map(b => ({
      namespace_id,
      secret_name: b.secret_name,
      reference_path: b.reference_path || `${ns.namespace}${b.secret_name}`,
      provider: b.provider || ns.provider || 'easypanel',
      environment: b.environment || 'production',
      status: 'active',
      created_by: principal.name,
      updated_at: new Date().toISOString()
    }))

    const { data: savedBindings, error: bindError } = await supabase
      .from('secret_bindings')
      .upsert(recordsToUpsert, { onConflict: 'namespace_id,secret_name,environment' })
      .select('id, namespace_id, secret_name, reference_path, provider, environment, status, created_at, updated_at')

    if (bindError) {
      console.error('Erro ao salvar secret bindings:', bindError)
      return NextResponse.json({ error: 'Falha ao registrar bindings no banco de dados' }, { status: 500 })
    }

    // 3. Se houver valores para injeção imediata no runtime do provedor, despachar via Adapter em memória
    const secretsToInject = bindings
      .filter(b => b.secret_value)
      .map(b => ({
        key_name: b.secret_name,
        secret_value: b.secret_value,
        reference_path: b.reference_path
      }))

    if (secretsToInject.length > 0) {
      try {
        const providerInstance = getSecretsProvider(ns.provider)
        await providerInstance.injectSecrets(ns.namespace, secretsToInject)
      } catch (provErr: any) {
        console.error('Falha na injeção via adapter:', provErr)
        return NextResponse.json({
          message: 'Bindings registrados no catálogo, porém ocorreu aviso na injeção do provider',
          warning: provErr.message,
          bindings: savedBindings
        }, { status: 207 })
      }
    }

    return NextResponse.json({
      message: 'Bindings de secrets registrados e vinculados com sucesso',
      bindings: savedBindings
    }, { status: 201 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const namespaceId = searchParams.get('namespace_id')

    if (!namespaceId) {
      return NextResponse.json({ error: 'namespace_id é obrigatório' }, { status: 400 })
    }

    const { data: bindings, error } = await supabase
      .from('secret_bindings')
      .select('id, namespace_id, secret_name, reference_path, provider, environment, status, created_by, created_at, updated_at')
      .eq('namespace_id', namespaceId)
      .order('secret_name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Falha ao buscar bindings' }, { status: 500 })
    }

    return NextResponse.json({ bindings }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
