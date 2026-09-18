import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { createProjectHandler, deriveKeyForUiCall, parseCreateProjectBody } from '@/lib/control-tower/projects-create'
import { sanitizeError } from '@/lib/control-tower/provisioning'

export async function GET() {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, slug, business_type, template_key, schema_name, domain, status, template_version, created_at')
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: sanitizeError(error.message) }, { status: 500 })
    }

    return NextResponse.json({ projects: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return NextResponse.json({ error: sanitizeError(message) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)

    // UI humana nao envia Idempotency-Key: deriva chave deterministica do payload
    // (retry do mesmo form devolve o mesmo projeto; payload diferente = nova chave).
    const headerKey = req.headers.get('idempotency-key')
    const correlationId = req.headers.get('x-correlation-id')
    const explicitKey = headerKey ?? correlationId

    const effectiveKey = explicitKey ?? (() => {
      const parsed = parseCreateProjectBody(body)
      return parsed.ok ? deriveKeyForUiCall(parsed.input) : null
    })()

    const supabase = createServiceRoleClient()
    const result = await createProjectHandler(supabase, body, effectiveKey)

    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    console.error('[POST /api/control-tower/projects] Internal Exception:', sanitizeError(message))
    return NextResponse.json({ error: sanitizeError(message) }, { status: 500 })
  }
}
