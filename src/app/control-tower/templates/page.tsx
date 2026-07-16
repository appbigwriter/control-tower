import Link from 'next/link'

import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type TemplateRow = {
  id: string
  template_key: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  name: string
  version: string
  source_path: string
  is_active: boolean
}

export default async function TemplatesPage() {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('templates')
    .select('id, template_key, business_type, name, version, source_path, is_active')
    .order('template_key', { ascending: true })

  const templates = (data ?? []) as TemplateRow[]

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#05070b_0%,#0b1017_100%)] px-4 py-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Control Tower</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Templates</h1>
          </div>
          <Link href="/control-tower" className="text-sm text-cyan-200 hover:text-cyan-100">
            Voltar
          </Link>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <article key={template.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-neutral-400">{template.business_type}</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{template.name}</h2>
                </div>
                <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">
                  {template.version}
                </span>
              </div>
              <dl className="mt-4 grid gap-2 text-sm">
                <div>
                  <dt className="text-neutral-400">Template key</dt>
                  <dd className="font-mono text-neutral-200">{template.template_key}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Source</dt>
                  <dd className="font-mono text-neutral-200">{template.source_path}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Ativo</dt>
                  <dd className="text-neutral-200">{template.is_active ? 'sim' : 'não'}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
