'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function EditProjectButton({
  slug,
  name,
  domain,
  repositoryUrl,
  hostingTarget,
}: {
  slug: string
  name: string
  domain: string | null
  repositoryUrl: string | null
  hostingTarget: 'vps1' | 'vps2' | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [draftName, setDraftName] = useState(name)
  const [draftDomain, setDraftDomain] = useState(domain ?? '')
  const [draftRepositoryUrl, setDraftRepositoryUrl] = useState(repositoryUrl ?? '')
  const [draftHostingTarget, setDraftHostingTarget] = useState<'vps1' | 'vps2'>(hostingTarget ?? 'vps1')

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/control-tower/projects/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draftName,
          domain: draftDomain,
          repository_url: draftRepositoryUrl,
          hosting_target: draftHostingTarget,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Falha ao atualizar projeto')
      setEditing(false)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao atualizar projeto')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"
      >
        Editar
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 sm:p-8">
      <div className="flex min-h-full items-start justify-center py-4 sm:py-8">
        <div className="w-full max-w-2xl rounded-3xl border border-cyan-300/20 bg-slate-950 p-5 shadow-2xl shadow-black/50 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">Editar projeto</p>
              <h2 className="mt-1 text-xl font-semibold text-white">{name}</h2>
              <p className="mt-1 font-mono text-xs text-neutral-400">{slug}</p>
            </div>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-60">
              Fechar
            </button>
          </div>
          <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-xs text-neutral-400">
              Nome
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" required />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-neutral-400">
              Domínio
              <input value={draftDomain} onChange={(event) => setDraftDomain(event.target.value)} className="w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" required />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-neutral-400 sm:col-span-2">
              Repository URL
              <input type="url" value={draftRepositoryUrl} onChange={(event) => setDraftRepositoryUrl(event.target.value)} className="w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" required />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-neutral-400">
              Target VPS
              <select value={draftHostingTarget} onChange={(event) => setDraftHostingTarget(event.target.value as 'vps1' | 'vps2')} className="w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" required>
                <option value="vps1">VPS1 — projetos</option>
                <option value="vps2">VPS2 — sistemas</option>
              </select>
            </label>
          </div>
          {message ? <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs text-rose-300">{message}</p> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-full border border-white/10 px-4 py-2 text-xs text-neutral-200 disabled:opacity-60">
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={saving} className="rounded-full bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60">
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
