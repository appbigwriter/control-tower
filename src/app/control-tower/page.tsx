import Link from 'next/link'

import { BigWriterHandoffButton } from '@/components/control-tower/BigWriterHandoffButton'
import { DeveloperDocButton } from '@/components/control-tower/DeveloperDocButton'
import { FrontendAdsenseHandoffButton } from '@/components/control-tower/FrontendAdsenseHandoffButton'
import { ProjectProvisionForm } from '@/components/control-tower/ProjectProvisionForm'
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
  created_at: string
}

type JobRow = {
  id: string
  project_id: string | null
  job_type: string
  status: string
  error_message: string | null
  created_at: string
}

type AuditRow = {
  id: string
  project_id: string | null
  action: string
  created_at: string
}

type ControlTowerStats = {
  database_size_bytes: number
  projects_total: number
  projects_active: number
  projects_pending: number
  projects_archived: number
  projects_error: number
  blog_projects: number
  store_projects: number
  saas_projects: number
  custom_projects: number
  jobs_total: number
  jobs_running: number
  jobs_success: number
  jobs_error: number
  audit_total: number
}

function businessLabel(type: ProjectRow['business_type']) {
  switch (type) {
    case 'blog':
      return 'Blog'
    case 'store':
      return 'Store'
    case 'saas':
      return 'SaaS'
    default:
      return 'Custom'
  }
}

function statusClass(status: ProjectRow['status']) {
  switch (status) {
    case 'active':
      return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    case 'pending':
      return 'border-amber-400/30 bg-amber-400/10 text-amber-300'
    case 'archived':
      return 'border-slate-400/30 bg-slate-400/10 text-slate-300'
    default:
      return 'border-rose-400/30 bg-rose-400/10 text-rose-300'
  }
}

export default async function ControlTowerPage() {
  let projects: ProjectRow[] = []
  let jobs: JobRow[] = []
  let audits: AuditRow[] = []
  let stats: ControlTowerStats | null = null
  let errorMessage: string | null = null

  try {
    const supabase = createServiceRoleClient()
    const [{ data, error }, jobsResult, auditsResult, statsResult] = await Promise.all([
      supabase
        .from('projects')
        .select(
          'id, name, slug, business_type, template_key, schema_name, domain, status, template_version, created_at',
        )
        .order('created_at', { ascending: true }),
      supabase
        .from('provisioning_jobs')
        .select('id, project_id, job_type, status, error_message, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase
        .from('audit_logs')
        .select('id, project_id, action, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.rpc('get_control_tower_stats'),
    ])

    if (error) {
      errorMessage = error.message
    } else {
      projects = (data ?? []) as ProjectRow[]
    }

    if (jobsResult.error) {
      errorMessage = jobsResult.error.message
    } else {
      jobs = (jobsResult.data ?? []) as JobRow[]
    }

    if (auditsResult.error) {
      errorMessage = auditsResult.error.message
    } else {
      audits = (auditsResult.data ?? []) as AuditRow[]
    }

    if (statsResult.error) {
      errorMessage = statsResult.error.message
    } else {
      stats = (statsResult.data ?? null) as ControlTowerStats | null
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Falha ao carregar projetos.'
  }

  const totals = stats ?? {
    database_size_bytes: 0,
    projects_total: projects.length,
    projects_active: projects.filter((project) => project.status === 'active').length,
    projects_pending: projects.filter((project) => project.status === 'pending').length,
    projects_archived: projects.filter((project) => project.status === 'archived').length,
    projects_error: projects.filter((project) => project.status === 'error').length,
    blog_projects: projects.filter((project) => project.business_type === 'blog').length,
    store_projects: projects.filter((project) => project.business_type === 'store').length,
    saas_projects: projects.filter((project) => project.business_type === 'saas').length,
    custom_projects: projects.filter((project) => project.business_type === 'custom').length,
    jobs_total: jobs.length,
    jobs_running: jobs.filter((job) => job.status === 'running').length,
    jobs_success: jobs.filter((job) => job.status === 'success').length,
    jobs_error: jobs.filter((job) => job.status === 'error').length,
    audit_total: audits.length,
  }

  const sizeMB = totals.database_size_bytes ? (totals.database_size_bytes / 1024 / 1024).toFixed(2) : '0.00'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(4,217,255,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(249,168,37,0.12),_transparent_30%),linear-gradient(180deg,#05070b_0%,#111827_48%,#05070b_100%)] px-4 py-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
                Control Tower
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Central de projetos e schemas
              </h1>
              <p className="mt-3 text-sm leading-6 text-neutral-300 md:text-base">
                Dashboard para operar blogs, stores, SaaS e bases custom com
                catálogo em `public` e isolamento por schema.
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/"
                className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                Início
              </Link>
              <Link
                href="#create-project"
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/15"
              >
                Novo projeto
              </Link>
              <Link
                href="/control-tower/templates"
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Templates
              </Link>
              <Link
                href="/control-tower/jobs"
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Jobs
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-6">
            {[
              ['Projetos', totals.projects_total],
              ['Ativos', totals.projects_active],
              ['Pendentes', totals.projects_pending],
              ['Jobs', totals.jobs_total],
              ['Auditoria', totals.audit_total],
              ['Banco MB', sizeMB],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-400">
                  {label}
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">{value as number | string}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ['Blog', totals.blog_projects],
            ['Store', totals.store_projects],
            ['SaaS', totals.saas_projects],
            ['Custom', totals.custom_projects],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-400">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{value as number}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ['Jobs executando', totals.jobs_running],
            ['Jobs concluídos', totals.jobs_success],
            ['Jobs com erro', totals.jobs_error],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-400">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{value as number}</p>
            </div>
          ))}
        </section>

        <section
          id="create-project"
          className="grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur lg:grid-cols-[1.4fr_1fr]"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
              Provisionamento
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Criar novo projeto
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">
              O formulário chama a rota administrativa e aplica o template
              correspondente ao tipo de negócio.
            </p>

            <ProjectProvisionForm />
          </div>

          <aside className="rounded-3xl border border-white/10 bg-black/20 p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">
              Regras
            </p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-neutral-300">
              <li>`schema_name` é derivado do slug.</li>
              <li>Templates oficiais: blog, store, saas e custom.</li>
              <li>Provisionamento deve ser idempotente.</li>
              <li>Conteúdo do negócio não fica no `public`.</li>
            </ul>
          </aside>
        </section>

        {errorMessage ? (
          <section className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-rose-200">
            {errorMessage}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.07]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-neutral-400">
                    {businessLabel(project.business_type)}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {project.name}
                  </h2>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${statusClass(project.status)}`}
                >
                  {project.status}
                </span>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-neutral-400">Slug</dt>
                  <dd className="mt-1 font-mono text-neutral-200">{project.slug}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Schema</dt>
                  <dd className="mt-1 font-mono text-neutral-200">{project.schema_name}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Template</dt>
                  <dd className="mt-1 text-neutral-200">{project.template_key}</dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Versão</dt>
                  <dd className="mt-1 text-neutral-200">{project.template_version}</dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-white/10 pt-4 text-sm text-neutral-300">
                {project.domain ? (
                  <p className="truncate">Domínio: {project.domain}</p>
                ) : (
                  <p>Sem domínio vinculado.</p>
                )}
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/control-tower/${project.slug}`}
                      className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
                    >
                      Ver detalhes
                    </Link>
                    <DeveloperDocButton slug={project.slug} />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <BigWriterHandoffButton slug={project.slug} />
                    <FrontendAdsenseHandoffButton slug={project.slug} />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
              Jobs recentes
            </p>
            <div className="mt-4 space-y-3">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-300"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{job.job_type}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">
                        {job.status}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-neutral-400">
                      {job.project_id ?? 'sem projeto'}
                    </p>
                    {job.error_message ? (
                      <p className="mt-2 text-rose-300">{job.error_message}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-neutral-400">Nenhum job recente encontrado.</p>
              )}
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/10 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
              Auditoria recente
            </p>
            <div className="mt-4 space-y-3">
              {audits.length > 0 ? (
                audits.map((audit) => (
                  <div
                    key={audit.id}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-neutral-300"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{audit.action}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">
                        log
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-neutral-400">
                      {audit.project_id ?? 'sem projeto'}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-neutral-400">
                  Nenhum evento de auditoria recente.
                </p>
              )}
            </div>
          </article>
        </section>

        {projects.length === 0 && !errorMessage ? (
          <section className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-neutral-300">
            Nenhum projeto encontrado em `public.projects`.
          </section>
        ) : null}
      </div>
    </main>
  )
}
