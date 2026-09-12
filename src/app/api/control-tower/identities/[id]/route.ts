import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken } from '@/lib/auth/control-tower'

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

    if (scopes && Array.isArray(scopes)) {
      updateData.scopes = scopes
    }

    const supabase = createServiceRoleClient()
    const { data: updatedIdentity, error } = await supabase
      .from('service_identities')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error || !updatedIdentity) {
      return NextResponse.json({ error: 'Falha ao atualizar Service Identity' }, { status: 500 })
    }

    return NextResponse.json({
      message: `Service Identity atualizada para status '${updatedIdentity.status}'`,
      identity: updatedIdentity
    }, { status: 200 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
