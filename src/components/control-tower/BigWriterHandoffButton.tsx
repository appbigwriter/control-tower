'use client'

import { useState } from 'react'

type BigWriterHandoffButtonProps = {
  slug: string
  label?: string
}

export function BigWriterHandoffButton({
  slug,
  label = 'Gerar handoff BigWriter',
}: BigWriterHandoffButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/control-tower/projects/${slug}/bigwriter-handoff`)
      if (!response.ok) {
        throw new Error('Falha ao gerar handoff')
      }

      const markdown = await response.text()
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${slug}-bigwriter-handoff.md`
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
      className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-4 py-2 text-sm font-medium text-fuchsia-100 transition hover:bg-fuchsia-300/15 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? 'Gerando...' : label}
    </button>
  )
}
