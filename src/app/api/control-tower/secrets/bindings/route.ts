import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, hasRequiredScope } from '@/lib/auth/control-tower'
import { getSecretsProvider } from '@/lib/secrets/adapter'
import {
  registerBindingsWithLifecycle,
  type BindingsClient,
  type NamespaceRow,
} from '@/lib/control-tower/bindings'

export const dynamic = 'force-dynamic'

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

    // Regra Zero Secret Leaks: chamadas de agents/services comuns não podem trafegar secret_value em texto aberto
    const hasSecretValues = bindings.some(b => b.secret_value !== undefined && b.secret_value !== null)
    if (hasSecretValues && principal.type !== 'admin') {
      return NextResponse.json({
        error: 'Zero Secret Leaks: O envio de secret_value em chamadas diretas de agentes não é permitido. Utilize apenas reference_path.'
      }, { status: 400 })
    }

    const client = createServiceRoleClient() as unknown as BindingsClient

    // 1. Obter informações do namespace
    const { data: ns, error: nsError } = await client
      .from('secret_namespaces')
      .select('id, namespace, provider')
      .eq('id', namespace_id)
      .single()

    if (nsError || !ns) {
      return NextResponse.json({ error: 'Namespace não encontrado' }, { status: 404 })
    }

    // 2. GDB-REM-012 lifecycle: pending → provider injection → active (com compensação).
    // Nunca mais binding `active` sem confirmação externa do provider.
    const result = await registerBindingsWithLifecycle(client, {
      namespace: ns as NamespaceRow,
      bindings,
      actor: principal.name,
      isAdmin: principal.type === 'admin',
      getProvider: getSecretsProvider,
    })

    return NextResponse.json(
      result.ok
        ? { message: result.message, bindings: result.bindings, receipt: result.sagaReceipt }
        : { error: result.message, bindings: result.bindings, receipt: result.sagaReceipt },
      { status: result.httpStatus },
    )
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

    const supabase = createServiceRoleClient()
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
