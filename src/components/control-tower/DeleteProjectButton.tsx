'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DeleteProjectButton({
  slug,
  projectName,
}: {
  slug: string
  projectName: string
}) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/control-tower/projects/${slug}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Erro ao excluir banco')
      }

      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Erro ao excluir banco')
      setIsDeleting(false)
      setShowConfirm(false)
    }
  }

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-rose-300">Tem certeza?</span>
        <button
          disabled={isDeleting}
          onClick={handleDelete}
          className="rounded px-2 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition"
        >
          {isDeleting ? 'Excluindo...' : 'Sim, excluir'}
        </button>
        <button
          disabled={isDeleting}
          onClick={() => setShowConfirm(false)}
          className="rounded px-2 py-1 text-xs font-semibold text-neutral-300 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 transition"
        >
          Cancelar
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      title="Excluir banco provisionado"
      className="text-rose-400 hover:text-rose-300 transition"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-5 w-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
        />
      </svg>
    </button>
  )
}
