'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function ProjectActions({ slug }: { slug: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState<null | 'archive' | 'rebuild'>(null)

  const runAction = async (action: 'archive' | 'rebuild') => {
    setLoading(action)
    const response = await fetch(`/api/control-tower/projects/${slug}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setLoading(null)
    if (response.ok) {
      router.refresh()
    }
  }

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => runAction('rebuild')}
        disabled={loading !== null}
        className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
      >
        {loading === 'rebuild' ? 'Reexecutando...' : 'Reexecutar'}
      </button>
      <button
        type="button"
        onClick={() => runAction('archive')}
        disabled={loading !== null}
        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {loading === 'archive' ? 'Arquivando...' : 'Arquivar'}
      </button>
    </div>
  )
}
