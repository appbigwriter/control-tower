'use client'

import { useRouter } from 'next/navigation'

export function SqlEditorButton({ slug }: { slug: string }) {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => router.push(`/control-tower/${slug}/sql`)}
      className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/15"
    >
      Editor SQL
    </button>
  )
}
