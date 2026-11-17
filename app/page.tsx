import Link from 'next/link';
import { Container } from '@/components/foundation/Container';
import { StatusBadge } from '@/components/foundation/StatusBadge';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center py-16">
      <Container className="text-center">
        <div className="mb-6 flex justify-center gap-2">
          <StatusBadge label="Phase 0: Foundations" status="ready" />
          <StatusBadge label="PWA Shell" status="ready" />
        </div>

        <h1
          data-testid="landing-title"
          className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl"
        >
          <span className="block text-slate-100">Encore</span>
          <span className="block bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            Concert Finder
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base text-slate-400 sm:text-lg">
          Personalized live-music discovery ranking concerts, festivals, and
          local events by personalized value.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/discover"
            data-testid="home-discover-btn"
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/20 transition-all duration-150 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-indigo-500 active:scale-[0.98]"
          >
            Discover Live Music &rarr;
          </Link>
          <Link
            href="/profile/taste"
            data-testid="home-taste-btn"
            className="rounded-xl border border-zinc-700 bg-zinc-900/90 px-6 py-3.5 text-sm font-semibold text-zinc-100 shadow-md transition-all duration-150 hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
          >
            Music Taste Profile
          </Link>
        </div>

        <div className="mt-10 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-left shadow-xl backdrop-blur sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            System Foundation Status
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-4">
              <dt className="text-xs font-medium text-slate-400">
                Application Stack
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">
                Next.js 15 App Router · TypeScript · Tailwind
              </dd>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-4">
              <dt className="text-xs font-medium text-slate-400">
                Database &amp; Security
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">
                Supabase PostgreSQL · Profiles RLS
              </dd>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-4">
              <dt className="text-xs font-medium text-slate-400">
                Ingestion Architecture
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">
                Domain Contracts · Source Adapters Interface
              </dd>
            </div>
          </dl>
        </div>
      </Container>
    </main>
  );
}
