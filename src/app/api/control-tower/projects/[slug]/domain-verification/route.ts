import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, hasRequiredScope, isAdminSessionActive } from '@/lib/auth/control-tower'
import {
  verifyDomain,
  canTransitionDomainState,
  createRealDomainVerificationAdapter,
  type DomainVerificationState,
} from '@/lib/control-tower/readback'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

interface VerificationRow {
  project_id: string
  domain: string
  state: DomainVerificationState
  attempts: number
  last_error: string | null
  next_check_at: string | null
  health_readback_id: string | null
  evidence: Record<string, unknown>
}

const VALID_MANUAL_STATES: DomainVerificationState[] = [
  'domain_generated',
  'awaiting_dns',
  'dns_manual_confirmed',
  'dns_verified',
  'dns_failed',
]

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)
    const isAdminSession = !principal ? await isAdminSessionActive() : false
    if (!principal && !isAdminSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const actor = principal
      ? (principal.identityId ? `${principal.name}#${principal.identityId}` : principal.name)
      : 'admin-session'
    if (principal && !hasRequiredScope(principal, 'health:read') && !hasRequiredScope(principal, 'projects:provision') && principal.type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Escopo health:read necessário' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      transition?: DomainVerificationState
      force?: boolean
    }

    const supabase = createServiceRoleClient()
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, slug, domain, schema_name')
      .eq('slug', slug)
      .maybeSingle()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }
    if (!project.domain) {
      return NextResponse.json({ error: 'Projeto não possui domínio para verificar.' }, { status: 422 })
    }

    // Current state (or seeded from domain_generated).
    const { data: existing } = await supabase
      .from('project_domain_verification')
      .select('*')
      .eq('project_id', project.id)
      .maybeSingle()

    const currentState: DomainVerificationState = (existing as VerificationRow | null)?.state ?? 'domain_generated'
    const attempts = (existing as VerificationRow | null)?.attempts ?? 0

    // Manual transition path (e.g. awaiting_dns → dns_manual_confirmed).
    if (body.transition) {
      if (!VALID_MANUAL_STATES.includes(body.transition)) {
        return NextResponse.json({ error: 'Estado de transição inválido.' }, { status: 400 })
      }
      if (!body.force && !canTransitionDomainState(currentState, body.transition)) {
        return NextResponse.json(
          { error: `Transição inválida: ${currentState} → ${body.transition}` },
          { status: 422 }
        )
      }

      const { error: upsertError } = await supabase
        .from('project_domain_verification')
        .upsert({
          project_id: project.id,
          domain: project.domain,
          state: body.transition,
          next_check_at: body.transition === 'dns_manual_confirmed' ? new Date().toISOString() : null,
        })

      if (upsertError) {
        return NextResponse.json({ error: `Falha ao persistir transição: ${upsertError.message}` }, { status: 500 })
      }

      // GDB-REM-013 aceíte 2: manual confirmation WITHOUT technical verification stays blocked.
      const technicallyVerified = body.transition === 'dns_verified'
      await supabase.from('audit_logs').insert({
        project_id: project.id,
        action: 'domain.verification_transition',
        resource_type: 'project_domain_verification',
        resource_id: project.id,
        metadata: { from: currentState, to: body.transition, actor, verified: technicallyVerified },
      })

      return NextResponse.json({
        state: body.transition,
        provision_allowed: technicallyVerified,
        message: technicallyVerified
          ? 'Domínio verificado tecnicamente; provisionamento/publicação liberados.'
          : 'Transição registrada. Sem verificação técnica, o provisionamento permanece bloqueado.',
      })
    }

    // Technical verification path (from dns_manual_confirmed or retry from dns_failed).
    if (currentState !== 'dns_manual_confirmed' && currentState !== 'dns_failed' && currentState !== 'awaiting_dns') {
      return NextResponse.json(
        {
          error:
            `Estado atual ${currentState} não permite verificação técnica automática. ` +
            'Fluxo: domain_generated → awaiting_dns → dns_manual_confirmed → (técnica) dns_verified.',
        },
        { status: 422 },
      )
    }

    const outcome = await verifyDomain({
      domain: project.domain,
      attempts,
      adapter: createRealDomainVerificationAdapter(),
    })

    const { error: persistError } = await supabase
      .from('project_domain_verification')
      .upsert({
        project_id: project.id,
        domain: project.domain,
        state: outcome.state,
        attempts: outcome.attempts,
        last_error: outcome.error,
        next_check_at: outcome.nextCheckAt,
        health_readback_id: outcome.healthReadbackId || null,
        evidence: outcome.evidence as Record<string, unknown>,
      })

    if (persistError) {
      return NextResponse.json({ error: `Falha ao persistir verificação: ${persistError.message}` }, { status: 500 })
    }

    await supabase.from('audit_logs').insert({
      project_id: project.id,
      action: outcome.state === 'dns_verified' ? 'domain.dns_verified' : 'domain.verification_failed',
      resource_type: 'project_domain_verification',
      resource_id: project.id,
      metadata: {
        state: outcome.state,
        attempts: outcome.attempts,
        error: outcome.error,
        health_readback_id: outcome.healthReadbackId || null,
        actor,
      },
    })

    return NextResponse.json({
      state: outcome.state,
      attempts: outcome.attempts,
      next_check_at: outcome.nextCheckAt,
      health_readback_id: outcome.healthReadbackId || null,
      provision_allowed: outcome.state === 'dns_verified',
      error: outcome.error,
      evidence: outcome.evidence,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params
    const rawToken = req.headers.get('authorization') ?? req.headers.get('x-api-key')
    const principal = await authenticateToken(rawToken)
    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceRoleClient()
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    const { data: verification, error } = await supabase
      .from('project_domain_verification')
      .select('project_id, domain, state, attempts, last_error, next_check_at, health_readback_id, evidence, created_at, updated_at')
      .eq('project_id', project.id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: `Falha no readback: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({
      verification: verification ?? null,
      provision_allowed: (verification as VerificationRow | null)?.state === 'dns_verified',
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
