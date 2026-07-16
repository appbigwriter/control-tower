'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams?.get('next') ?? '/control-tower'
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      setError(payload?.error ?? 'Falha no login')
      setLoading(false)
      return
    }

    router.push(nextPath)
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#05070b_0%,#0b1017_100%)] px-4 text-neutral-100">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">GestaoDB</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Acesso administrativo</h1>
        <p className="mt-2 text-sm text-neutral-300">
          Informe o segredo administrativo definido em `CONTROL_TOWER_ADMIN_SECRET`.
        </p>
        <label className="mt-6 block">
          <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">Segredo</span>
          <input
            type="password"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-cyan-300/40"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        {error ? <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
