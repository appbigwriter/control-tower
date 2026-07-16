import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ProjectActions } from '@/components/control-tower/ProjectActions'
import { SqlEditorButton } from '@/components/control-tower/SqlEditorButton'
import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type ProjectRow = {
  id: string
  name: string
  slug: string
  business_type: 'blog' | 'store' | 'saas' | 'custom'
  template_key: string
  schema_name: string
  domain: string | null
  status: 'pending' | 'active' | 'archived' | 'error'
  template_version: string
  language: string
}

type JobRow = {
  id: string
  job_type: string
  status: string
  error_message: string | null
  created_at: string
}

type AuditRow = {
  id: string
  action: string
  created_at: string
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = createServiceRoleClient()

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select(
      'id, name, slug, business_type, template_key, schema_name, domain, status, template_version, language',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (projectError || !project) {
    notFound()
  }

  const [{ data: jobs }, { data: audits }] = await Promise.all([
    supabase
      .from('provisioning_jobs')
      .select('id, job_type, status, error_message, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('audit_logs')
      .select('id, action, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false }),
  ])

  const jobRows = (jobs ?? []) as JobRow[]
  const auditRows = (audits ?? []) as AuditRow[]

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#05070b_0%,#0b1017_50%,#05070b_100%)] px-4 py-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <Link href="/control-tower" className="text-sm text-cyan-200 hover:text-cyan-100">
            Voltar
          </Link>
          <h1 className="mt-4 text-4xl font-semibold text-white">{project.name}</h1>
          <p className="mt-2 text-neutral-300">
            {project.business_type} · {project.status} · {project.template_key}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold text-white">Detalhes</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-neutral-400">Slug</dt>
                <dd className="font-mono text-neutral-200">{project.slug}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Schema</dt>
                <dd className="font-mono text-neutral-200">{project.schema_name}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Idioma</dt>
                <dd className="text-neutral-200">{project.language}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Versão</dt>
                <dd className="text-neutral-200">{project.template_version}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Domínio</dt>
                <dd className="text-neutral-200">{project.domain ?? 'sem domínio'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold text-white">Resumo</h2>
            <p className="mt-4 text-sm leading-6 text-neutral-300">
              Esta página detalha um projeto individual e conecta o catálogo aos
              jobs e à auditoria do provisionamento.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ProjectActions slug={project.slug} />
              {project.business_type === 'custom' ? (
                <SqlEditorButton slug={project.slug} />
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold text-white">Jobs</h2>
            <div className="mt-4 space-y-3">
              {jobRows.length > 0 ? (
                jobRows.map((job) => (
                  <div key={job.id} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-white">{job.job_type}</span>
                      <span className="text-neutral-400">{job.status}</span>
                    </div>
                    {job.error_message ? (
                      <p className="mt-2 text-rose-300">{job.error_message}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-neutral-400">Sem jobs registrados.</p>
              )}
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold text-white">Auditoria</h2>
            <div className="mt-4 space-y-3">
              {auditRows.length > 0 ? (
                auditRows.map((audit) => (
                  <div key={audit.id} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
                    <span className="text-white">{audit.action}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-neutral-400">Sem eventos de auditoria.</p>
              )}
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}
