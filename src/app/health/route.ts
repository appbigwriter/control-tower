import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const timestamp = new Date().toISOString()
  try {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('projects').select('id').limit(1)

    if (error) {
      return NextResponse.json(
        {
          status: 'degraded',
          service: 'control-tower',
          database: 'disconnected',
          error: error.message,
          timestamp,
        },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        status: 'healthy',
        service: 'control-tower',
        database: 'connected',
        timestamp,
      },
      { status: 200 },
    )
  } catch (err: unknown) {
    return NextResponse.json(
      {
        status: 'healthy',
        service: 'control-tower',
        database: 'unverified',
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp,
      },
      { status: 200 },
    )
  }
}
