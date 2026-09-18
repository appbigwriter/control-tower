import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { authenticateToken, isAdminSessionActive } from '@/lib/auth/control-tower'
import {
  loadProjectBySlug,
  deleteProject,
  deleteConfirmationValid,
  type ActionsClient,
} from '@/lib/control-tower/actions'

type Params = { params: Promise<{ slug: string }> }

export async function DELETE(
  req: NextRequest,
  { params }: Params,
) {
  try {
    const { slug } = await params

    // Destructive action (GDB-REM-011 aceíte 4): bearer principal OR admin session.
    const principal = await authenticateToken(req.headers.get('authorization'))
    let actor: string
    if (principal) {
      actor = principal.identityId ? `${principal.name}#${principal.identityId}` : principal.name
    } else if (await isAdminSessionActive()) {
      actor = 'admin-session'
    } else {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Explicit confirmation: { confirm: true, slug: "<slug>" } in the body.
    const body = await req.json().catch(() => ({}))
    if (!deleteConfirmationValid(body, slug)) {
      return NextResponse.json(
        {
          error:
            'Confirmação explícita obrigatória: envie { "confirm": true, "slug": "<slug>" }. ' +
            'Delete destrutivo exige receipt e gate.',
        },
        { status: 400 },
      )
    }

    const client = createServiceRoleClient() as unknown as ActionsClient
    const project = await loadProjectBySlug(client, slug)
    if (!project) {
      return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 })
    }

    const result = await deleteProject(client, project, actor)
    return NextResponse.json(
      result.ok
        ? { message: result.message, receipt: result.sagaReceipt, readback: result.readback }
        : { error: result.message, receipt: result.sagaReceipt, readback: result.readback, blocked: result.blocked },
      { status: result.httpStatus },
    )
  } catch (error) {
    console.error('Erro na rota DELETE do projeto:', error)
    const message = error instanceof Error ? error.message : 'Erro interno ao processar a exclusão'
    return NextResponse.json(
      { error: message },
      { status: 500 },
    )
  }
}
