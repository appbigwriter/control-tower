'use client'

import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'

type BusinessType = 'blog' | 'store' | 'saas' | 'custom'
type TemplateKey = 'blog_standard' | 'store_standard' | 'saas_standard' | 'custom_base'

const templateByType: Record<BusinessType, TemplateKey> = {
  blog: 'blog_standard',
  store: 'store_standard',
  saas: 'saas_standard',
  custom: 'custom_base',
}

export function ProjectProvisionForm() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [businessType, setBusinessType] = useState<BusinessType>('blog')
  const [templateKey, setTemplateKey] = useState<TemplateKey>('blog_standard')
  const [domain, setDomain] = useState('')
  const [language, setLanguage] = useState<'pt' | 'en' | 'es'>('pt')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const schemaPreview = useMemo(() => {
    const prefix = businessType === 'blog' ? 'blog' : businessType === 'store' ? 'store' : businessType === 'saas' ? 'saas' : 'custom'
    return slug ? `${prefix}_${slug}` : `${prefix}_slug`
  }, [businessType, slug])

  const handleBusinessTypeChange = (nextType: BusinessType) => {
    setBusinessType(nextType)
    setTemplateKey(templateByType[nextType])
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('loading')
    setMessage(null)

    try {
      const response = await fetch('/api/control-tower/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          slug,
          business_type: businessType,
          template_key: templateKey,
          domain: domain || null,
          language,
        }),
      })

      const payload = (await response.json()) as { message?: string; error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Falha ao provisionar projeto')
      }

      setStatus('success')
      setMessage(payload.message ?? 'Projeto provisionado com sucesso.')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Erro ao provisionar projeto.')
    }
  }

  return (
    <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
      <label className="grid gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">Nome</span>
        <input
          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-cyan-300/40"
          placeholder="Ex: GestaoDB Blog"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>

      <label className="grid gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">Slug</span>
        <input
          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-cyan-300/40"
          placeholder="gestaodb-blog"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          required
        />
      </label>

      <label className="grid gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">Tipo</span>
        <select
          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
          value={businessType}
          onChange={(event) => handleBusinessTypeChange(event.target.value as BusinessType)}
        >
          <option value="blog">Blog</option>
          <option value="store">Store</option>
          <option value="saas">SaaS</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      <label className="grid gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">
          Template
        </span>
        <select
          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
          value={templateKey}
          onChange={(event) => setTemplateKey(event.target.value as TemplateKey)}
        >
          <option value="blog_standard">blog_standard</option>
          <option value="store_standard">store_standard</option>
          <option value="saas_standard">saas_standard</option>
          <option value="custom_base">custom_base</option>
        </select>
      </label>

      <label className="grid gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">Domínio</span>
        <input
          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-cyan-300/40"
          placeholder="exemplo.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
        />
      </label>

      <label className="grid gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-neutral-400">Idioma</span>
        <select
          className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
          value={language}
          onChange={(event) => setLanguage(event.target.value as 'pt' | 'en' | 'es')}
        >
          <option value="pt">pt</option>
          <option value="en">en</option>
          <option value="es">es</option>
        </select>
      </label>

      <div className="md:col-span-2 rounded-2xl border border-cyan-300/10 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100">
        Preview do schema: <span className="font-mono">{schemaPreview}</span>
      </div>

      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'loading' ? 'Provisionando...' : 'Provisionar projeto'}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          onClick={() => {
            setName('')
            setSlug('')
            setBusinessType('blog')
            setTemplateKey('blog_standard')
            setDomain('')
            setLanguage('pt')
            setStatus('idle')
            setMessage(null)
          }}
        >
          Limpar
        </button>
      </div>

      {message ? (
        <p
          className={`md:col-span-2 rounded-2xl border px-4 py-3 text-sm ${
            status === 'success'
              ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-400/20 bg-rose-500/10 text-rose-200'
          }`}
        >
          {message}
        </p>
      ) : null}
    </form>
  )
}
