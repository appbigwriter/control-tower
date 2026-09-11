import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateToken, hasRequiredScope } from '@/lib/auth/control-tower'

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

    if (!hasRequiredScope(principal, 'secrets:namespaces:create') && principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Escopo secrets:namespaces:create necessário' }, { status: 403 })
    }

    const body = await req.json()
    const { project_id, namespace, provider = 'easypanel' } = body

    if (!namespace) {
      return NextResponse.json({ error: 'Campo obrigatório: namespace' }, { status: 400 })
    }

    // Upsert or insert secret namespace
    const { data, error } = await supabase
      .from('secret_namespaces')
      .upsert({
        project_id: project_id || null,
        namespace,
        provider,
        status: 'active',
        created_by: principal.name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'namespace' })
      .select()
      .single()

    if (error) {
      console.error('Error creating secret namespace:', error)
      return NextResponse.json({ error: 'Falha ao registrar secret namespace' }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Secret namespace registrado com sucesso',
      namespace: data
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
    const projectId = searchParams.get('project_id')

    let query = supabase
      .from('secret_namespaces')
      .select('id, project_id, namespace, provider, status, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (projectId) {
      query = query.eq('project_id', projectId)
    }

    const { data: namespaces, error } = await query

    if (error) {
      return NextResponse.json({ error: 'Falha ao buscar namespaces' }, { status: 500 })
    }

    return NextResponse.json({ namespaces }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
