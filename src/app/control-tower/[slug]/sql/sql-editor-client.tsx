'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type ProjectInfo = {
  name: string
  slug: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  schema_name: string
  template_key: string
}

export function SqlEditorClient({
  slug,
  project,
}: {
  slug: string
  project: ProjectInfo | null
}) {
  const router = useRouter()
  const [sql, setSql] = useState(
    `-- Exemplo: criar coluna em um schema custom\nalter table entities add column if not exists notes text;`,
  )
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const runSql = async () => {
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch(`/api/control-tower/projects/${slug}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Falha ao executar SQL')
      }

      setMessage(payload?.message ?? 'SQL executado com sucesso')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao executar SQL')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#05070b_0%,#0b1017_100%)] px-4 py-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
                Control Tower
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Editor SQL</h1>
            </div>
            <div className="flex gap-3">
              <Link
                href={`/control-tower/${slug}`}
                className="text-sm text-cyan-200 hover:text-cyan-100"
              >
                Voltar ao projeto
              </Link>
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10"
              >
                Voltar
              </button>
            </div>
          </div>
          <p className="mt-4 text-sm text-neutral-300">
            Use este editor para ajustes pontuais no schema do projeto. O uso recomendado é para
            <span className="font-semibold text-white"> projetos custom</span>.
          </p>
          {project ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-300">
              <p>
                <span className="text-neutral-400">Projeto:</span> {project.name}
              </p>
              <p>
                <span className="text-neutral-400">Schema:</span> {project.schema_name}
              </p>
              <p>
                <span className="text-neutral-400">Tipo:</span> {project.business_type}
              </p>
              <p>
                <span className="text-neutral-400">Template:</span> {project.template_key}
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">SQL</span>
            <textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              className="min-h-[420px] rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-neutral-500 focus:border-cyan-300/40"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runSql}
              disabled={loading}
              className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Executando...' : 'Executar no schema'}
            </button>
            <Link
              href={`/control-tower/${slug}`}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Cancelar
            </Link>
          </div>

          {message ? (
            <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {message}
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  )
}
