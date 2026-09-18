import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, generateIdentityJwt, hasRequiredScope } from '@/lib/auth/control-tower'
import { validateScopeGrant } from '@/lib/auth/service-identity-policy'

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
      expires_in = '365d'
    } = body

    if (!name || !namespace) {
      return NextResponse.json({ error: 'Campos obrigatórios: name, namespace' }, { status: 400 })
    }

    if (typeof name !== 'string' || typeof namespace !== 'string') {
      return NextResponse.json({ error: 'name e namespace devem ser strings' }, { status: 400 })
    }

    // GDB-REM-001: server-side scope catalog + privilege containment.
    // Wildcard and non-catalogued scopes are rejected for non-admin grantors;
    // a non-admin grantor can only grant scopes it already holds; identity
    // type 'admin' is reserved for admin grantors.
    const grant = validateScopeGrant({
      requestedScopes: scopes,
      grantorType: principal.type,
      grantorScopes: principal.scopes,
      targetIdentityType: identity_type
    })

    if (!grant.ok) {
      return NextResponse.json({ error: `Forbidden: ${grant.reason}` }, { status: 403 })
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

    // GDB-REM-001: `created_by` is ALWAYS derived from the authenticated
    // principal on the server side. A client-supplied value is ignored.
    const actorRef = principal.identityId
      ? `${principal.name}#${principal.identityId}`
      : `${principal.name}`

    const newIdentityData = {
      name,
      namespace,
      identity_type,
      scopes: grant.scopes,
      status: 'active',
      issuer: 'control-tower',
      audience: 'fbr-agency',
      key_id: 'ct-key-v1',
      created_by: actorRef,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data: identity, error } = await supabase
      .from('service_identities')
      .insert(newIdentityData)
      .select()
      .single()

    if (error || !identity) {
      console.error('Erro ao criar identity:', error?.message)
      return NextResponse.json({ error: 'Falha ao registrar Service Identity no banco de dados' }, { status: 500 })
    }

    // Audit trail (sanitized — no token, no scopes payload beyond names).
    await supabase.from('audit_logs').insert({
      action: 'identity.created',
      resource_type: 'service_identity',
      resource_id: identity.id,
      metadata: {
        actor: actorRef,
        identity_name: identity.name,
        identity_type: identity.identity_type,
        granted_scopes: grant.scopes
      }
    })

    // generateIdentityJwt validates expires_in (duration string within
    // [60s, 365d]) and fails closed on invalid values.
    let token: string
    try {
      token = await generateIdentityJwt(identity, expires_in)
    } catch (jwtError) {
      // Identity row exists but no over-privileged/over-long token is issued.
      const message = jwtError instanceof Error ? jwtError.message : 'expires_in inválido'
      return NextResponse.json({ error: message, identity_id: identity.id }, { status: 422 })
    }

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
        expires_at: identity.expires_at,
        created_by: identity.created_by,
        created_at: identity.created_at
      },
      token
    }, { status: 201 })

  } catch (error: any) {
    console.error('API Error /identities:', error?.message)
    return NextResponse.json({ error: 'Erro interno ao processar a requisição' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!hasRequiredScope(principal, 'identities:read') && principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Escopo identities:read necessário' }, { status: 403 })
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
    return NextResponse.json({ error: 'Erro interno ao listar identities' }, { status: 500 })
  }
}
