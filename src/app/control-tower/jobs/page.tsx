import Link from 'next/link'

import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type JobRow = {
  id: string
  project_id: string | null
  job_type: string
  status: string
  error_message: string | null
  created_at: string
  finished_at: string | null
}

export default async function JobsPage() {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('provisioning_jobs')
    .select('id, project_id, job_type, status, error_message, created_at, finished_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const jobs = (data ?? []) as JobRow[]

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#05070b_0%,#0b1017_100%)] px-4 py-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Control Tower</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Jobs</h1>
          </div>
          <Link href="/control-tower" className="text-sm text-cyan-200 hover:text-cyan-100">
            Voltar
          </Link>
        </div>

        <section className="space-y-3">
          {jobs.map((job) => (
            <article key={job.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-white">{job.job_type}</h2>
                <span className="text-xs uppercase tracking-[0.2em] text-neutral-400">{job.status}</span>
              </div>
              <p className="mt-2 text-sm text-neutral-300">{job.project_id ?? 'sem projeto'}</p>
              <p className="mt-2 text-xs text-neutral-400">{job.created_at}</p>
              {job.error_message ? <p className="mt-2 text-rose-300">{job.error_message}</p> : null}
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
