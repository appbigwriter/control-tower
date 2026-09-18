import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken } from '@/lib/auth/control-tower'
import { validateScopeGrant } from '@/lib/auth/service-identity-policy'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const supabase = createServiceRoleClient()
    const { data: identity, error } = await supabase
      .from('service_identities')
      .select('id, name, namespace, identity_type, scopes, status, issuer, audience, key_id, expires_at, last_used_at, revoked_at, created_by, created_at, updated_at')
      .eq('id', id)
      .single()

    if (error || !identity) {
      return NextResponse.json({ error: 'Service Identity não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ identity }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)

    if (!principal || principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Apenas administradores podem alterar o status de uma Service Identity' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { status, scopes } = body

    const supabase = createServiceRoleClient()

    // Fetch current identity so a scope change is validated against the
    // identity's actual type (wildcard stays admin-only, catalog enforced).
    let identityType: 'agent' | 'service' | 'admin' = 'service'
    if (scopes !== undefined) {
      const { data: current } = await supabase
        .from('service_identities')
        .select('identity_type')
        .eq('id', id)
        .maybeSingle()
      if (!current) {
        return NextResponse.json({ error: 'Service Identity não encontrada' }, { status: 404 })
      }
      identityType = current.identity_type
    }

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    }

    if (status) {
      if (!['active', 'suspended', 'revoked'].includes(status)) {
        return NextResponse.json({ error: 'Status inválido. Permitidos: active, suspended, revoked' }, { status: 400 })
      }
      updateData.status = status
      if (status === 'revoked') {
        updateData.revoked_at = new Date().toISOString()
      }
    }

    if (scopes !== undefined) {
      // GDB-REM-001: PATCH goes through the same catalog + containment rules
      // as creation; wildcard on a non-admin identity is rejected here too.
      const grant = validateScopeGrant({
        requestedScopes: scopes,
        grantorType: principal.type,
        grantorScopes: principal.scopes,
        targetIdentityType: identityType
      })
      if (!grant.ok) {
        return NextResponse.json({ error: `Forbidden: ${grant.reason}` }, { status: 403 })
      }
      updateData.scopes = grant.scopes
    }

    const actorRef = principal.identityId
      ? `${principal.name}#${principal.identityId}`
      : `${principal.name}`
    const { data: updatedIdentity, error } = await supabase
      .from('service_identities')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error || !updatedIdentity) {
      return NextResponse.json({ error: 'Falha ao atualizar Service Identity' }, { status: 500 })
    }

    // Audit trail (sanitized — no tokens, no SQL, no secret material).
    await supabase.from('audit_logs').insert({
      action: status === 'revoked' ? 'identity.revoked' : 'identity.updated',
      resource_type: 'service_identity',
      resource_id: id,
      metadata: {
        actor: actorRef,
        status: updatedIdentity.status,
        updated_fields: Object.keys(updateData).filter((key) => key !== 'updated_at')
      }
    })

    return NextResponse.json({
      message: `Service Identity atualizada para status '${updatedIdentity.status}'`,
      identity: updatedIdentity
    }, { status: 200 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
