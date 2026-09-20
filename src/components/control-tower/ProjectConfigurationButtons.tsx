'use client'

import { useState } from 'react'

type ArtifactType = 'public_variables' | 'namespace' | 'validation_domain'
type LoadingType = ArtifactType | 'dns_verification'

type Props = {
  slug: string
  domain: string | null
}

const buttons: Array<{ type: ArtifactType; label: string; pending: string; className: string }> = [
  {
    type: 'public_variables',
    label: 'Gerar Variáveis do Runtime',
    pending: 'Gerando variáveis...',
    className: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15',
  },
  {
    type: 'namespace',
    label: 'Gerar Namespace',
    pending: 'Gerando namespace...',
    className: 'border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100 hover:bg-fuchsia-300/15',
  },
  {
    type: 'validation_domain',
    label: 'Gerar Domínio de Validação',
    pending: 'Gerando domínio...',
    className: 'border-amber-300/20 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15',
  },
]

function downloadArtifact(filename: string, value: unknown) {
  const content = typeof value === 'string'
    ? value
    : Object.entries(value as Record<string, string>).map(([key, entry]) => `${key}=${entry}`).join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function ProjectConfigurationButtons({ slug, domain }: Props) {
  const [loading, setLoading] = useState<LoadingType | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const generate = async (type: ArtifactType) => {
    setLoading(type)
    setMessage(null)
    try {
      const response = await fetch(`/api/control-tower/projects/${slug}/configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Falha ao gerar configuração.')
      downloadArtifact(result.artifact.filename, result.artifact.value)
      setMessage('Gerado e salvo no banco.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao gerar configuração.')
    } finally {
      setLoading(null)
    }
  }

  const verifyDns = async () => {
    if (!domain) {
      setMessage('Preencha o domínio do projeto antes de confirmar o DNS.')
      return
    }
    setLoading('dns_verification')
    setMessage(null)
    try {
      const confirmResponse = await fetch(`/api/control-tower/projects/${slug}/domain-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: 'dns_manual_confirmed', force: true }),
      })
      const confirmed = await confirmResponse.json()
      if (!confirmResponse.ok) throw new Error(confirmed.error ?? 'Falha ao registrar confirmação de DNS.')

      const verifyResponse = await fetch(`/api/control-tower/projects/${slug}/domain-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await verifyResponse.json()
      if (!verifyResponse.ok) throw new Error(result.error ?? 'Falha ao verificar DNS e health.')
      if (result.state !== 'dns_verified') {
        throw new Error(result.error ?? `DNS não confirmado tecnicamente: ${result.state}`)
      }
      setMessage(`DNS confirmado e /health verificado. Readback: ${result.health_readback_id ?? 'registrado'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao verificar DNS.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-400">Configuração</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={verifyDns}
          disabled={loading !== null || !domain}
          title={domain ? 'Confirma o DNS e verifica o endpoint /health' : 'Defina o domínio primeiro'}
          className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading === 'dns_verification' ? 'Verificando DNS...' : 'Confirmar DNS e Health'}
        </button>
        {buttons.map((button) => (
          <button
            key={button.type}
            type="button"
            onClick={() => generate(button.type)}
            disabled={loading !== null}
            className={`rounded-full border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${button.className}`}
          >
            {loading === button.type ? button.pending : button.label}
          </button>
        ))}
      </div>
      {message ? <p className="mt-3 text-xs text-neutral-400" role="status">{message}</p> : null}
    </div>
  )
}
