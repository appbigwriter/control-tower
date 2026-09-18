'use client'

import { useState } from 'react'

type ArtifactType = 'public_variables' | 'namespace' | 'validation_domain'

type Props = {
  slug: string
}

const buttons: Array<{ type: ArtifactType; label: string; pending: string; className: string }> = [
  {
    type: 'public_variables',
    label: 'Gerar Variáveis Públicas',
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
    : Object.entries(value as Record<string, string>).map(([key, entry]) => `${key}=${entry}`).join('\\n')
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

export function ProjectConfigurationButtons({ slug }: Props) {
  const [loading, setLoading] = useState<ArtifactType | null>(null)
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

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-neutral-400">Configuração</p>
      <div className="flex flex-wrap gap-2">
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
