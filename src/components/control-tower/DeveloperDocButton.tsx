'use client'

import { useState } from 'react'

type DeveloperDocButtonProps = {
  slug: string
  label?: string
}

export function DeveloperDocButton({
  slug,
  label = 'Gerar documentação para dev',
}: DeveloperDocButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/control-tower/projects/${slug}/developer-doc`)
      if (!response.ok) {
        throw new Error('Falha ao gerar documentação')
      }

      const markdown = await response.text()
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${slug}-dev-doc.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? 'Gerando...' : label}
    </button>
  )
}
