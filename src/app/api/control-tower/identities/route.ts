import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, generateIdentityJwt, hasRequiredScope } from '@/lib/auth/control-tower'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized: Autenticação necessária' }, { status: 401 })
    }

    if (!hasRequiredScope(principal, 'identities:create') && principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Escopo identities:create necessário' }, { status: 403 })
    }

    const body = await req.json()
    const {
      name,
      namespace,
      identity_type = 'service',
      scopes = [],
      expires_in = '365d',
      created_by = principal.name
    } = body

    if (!name || !namespace) {
      return NextResponse.json({ error: 'Campos obrigatórios: name, namespace' }, { status: 400 })
    }

    if (!['agent', 'service', 'admin'].includes(identity_type)) {
      return NextResponse.json({ error: 'identity_type inválido. Permitidos: agent, service, admin' }, { status: 400 })
    }

    if (identity_type === 'admin' && principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Apenas administradores podem criar identidades do tipo admin' }, { status: 403 })
    }

    const supabase = createServiceRoleClient()

    // Verificar se já existe name ou namespace
    const { data: existing } = await supabase
      .from('service_identities')
      .select('id, name, namespace')
      .or(`name.eq.${name},namespace.eq.${namespace}`)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Já existe uma Service Identity com esse name ou namespace' }, { status: 409 })
    }

    const newIdentityData = {
      name,
      namespace,
      identity_type,
      scopes,
      status: 'active',
      issuer: 'control-tower',
      audience: 'fbr-agency',
      key_id: 'ct-key-v1',
      created_by,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data: identity, error } = await supabase
      .from('service_identities')
      .insert(newIdentityData)
      .select()
      .single()

    if (error || !identity) {
      console.error('Erro ao criar identity:', error)
      return NextResponse.json({ error: 'Falha ao registrar Service Identity no banco de dados' }, { status: 500 })
    }

    const token = await generateIdentityJwt(identity, expires_in)

    return NextResponse.json({
      message: 'Service Identity criada com sucesso',
      identity: {
        id: identity.id,
        name: identity.name,
        namespace: identity.namespace,
        identity_type: identity.identity_type,
        scopes: identity.scopes,
        status: identity.status,
        issuer: identity.issuer,
        audience: identity.audience,
        key_id: identity.key_id,
        created_at: identity.created_at
      },
      token
    }, { status: 201 })

  } catch (error: any) {
    console.error('API Error /identities:', error)
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

    const supabase = createServiceRoleClient()
    const { data: identities, error } = await supabase
      .from('service_identities')
      .select('id, name, namespace, identity_type, scopes, status, issuer, audience, key_id, expires_at, last_used_at, revoked_at, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Falha ao listar identities' }, { status: 500 })
    }

    return NextResponse.json({ identities }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
