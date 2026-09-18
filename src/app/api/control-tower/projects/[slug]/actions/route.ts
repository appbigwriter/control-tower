import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { projectActionsHandler } from '@/lib/control-tower/projects-actions'
import { sanitizeError } from '@/lib/control-tower/provisioning'

type Params = { params: Promise<{ slug: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params

  try {
    const body = await req.json().catch(() => ({}))

    const headerKey = req.headers.get('idempotency-key')
    const correlationId = req.headers.get('x-correlation-id')
    const effectiveKey = headerKey ?? correlationId ?? `auto:action:${slug}:${new Date().toISOString()}`

    const supabase = createServiceRoleClient()
    const result = await projectActionsHandler(supabase, slug, body, effectiveKey)

    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    console.error(`[POST /api/control-tower/projects/${slug}/actions]`, sanitizeError(message))
    return NextResponse.json({ error: sanitizeError(message) }, { status: 500 })
  }
}
