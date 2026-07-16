import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(4,217,255,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(249,168,37,0.10),_transparent_28%),linear-gradient(180deg,#05070b_0%,#0b1017_55%,#05070b_100%)] px-6 py-10 text-neutral-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col justify-center gap-8">
        <section className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">
            GestaoDB
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
            Control Tower para projetos, schemas e templates.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-300 md:text-base">
            Esta base organiza o catálogo central em `public`, o
            provisionamento de schemas e a operação administrativa dos
            projetos.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/control-tower"
              className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Abrir Control Tower
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
