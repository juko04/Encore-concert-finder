import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Encore — Prototype Design Exploration Hub',
  description:
    'Compare two fundamentally different design and exploration philosophies for Encore: Encore Index vs Encore Signal.',
};

export default function PrototypesHubPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500 selection:text-white">
      {/* Background radial gradient */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]" />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            Dual Multi-Agent UI/UX Exploration
          </div>

          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl">
            Encore Design Prototypes
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Two independent AI design and engineering agents were given
            identical product requirements and shared event data to build two
            fundamentally different live-music discovery paradigms.
          </p>
        </div>

        {/* Prototype Cards */}
        <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Prototype 1: Encore Index */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur transition-all duration-300 hover:border-zinc-600 hover:shadow-indigo-500/5">
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 font-mono text-xs font-medium text-zinc-300">
                  Concept 1
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Functional Prototype
                </span>
              </div>

              <h2 className="mt-4 text-2xl font-bold tracking-tight text-white transition-colors group-hover:text-indigo-300">
                Encore Index
              </h2>
              <p className="mt-1 font-mono text-xs uppercase tracking-wider text-indigo-400">
                User-Driven Concert Search Engine
              </p>

              <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                Prioritizes user agency, fast information retrieval, and calm
                exploration. High-density compact concert listings, persistent
                filters, quick facet switching, and understated personalization
                indicators.
              </p>

              <div className="mt-6 space-y-2 border-t border-zinc-800/80 pt-4 text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">
                    Aesthetic:
                  </span>{' '}
                  Minimal, spacious, calm, precise
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">
                    Primary Job:
                  </span>{' '}
                  Find what I want with speed and clarity
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">
                    Key Feature:
                  </span>{' '}
                  Compact listings, persistent search controls
                </div>
              </div>
            </div>

            <div className="mt-8">
              <Link
                href="/prototypes/index"
                className="inline-flex w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 shadow-sm transition-all duration-150 hover:bg-zinc-200 active:scale-[0.98]"
              >
                Launch Encore Index &rarr;
              </Link>
            </div>
          </div>

          {/* Prototype 2: Encore Signal */}
          <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur transition-all duration-300 hover:border-violet-600/50 hover:shadow-violet-500/10">
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-md border border-violet-800/50 bg-violet-950/40 px-2.5 py-1 font-mono text-xs font-medium text-violet-300">
                  Concept 2
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Functional Prototype
                </span>
              </div>

              <h2 className="mt-4 text-2xl font-bold tracking-tight text-white transition-colors group-hover:text-violet-300">
                Encore Signal
              </h2>
              <p className="mt-1 font-mono text-xs uppercase tracking-wider text-violet-400">
                Proactive Music Companion & Scanner
              </p>

              <p className="mt-4 text-sm leading-relaxed text-zinc-300">
                Acts as an intelligent concert curator that spots worthwhile
                opportunities. Features an interactive concert ticker,
                expressive artwork glow halos, deep pros & cons justifications,
                and contextual intent prompts.
              </p>

              <div className="mt-6 space-y-2 border-t border-zinc-800/80 pt-4 text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">
                    Aesthetic:
                  </span>{' '}
                  Atmospheric, music-focused, vibrant
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">
                    Primary Job:
                  </span>{' '}
                  Surprise me with concerts worth going to
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">
                    Key Feature:
                  </span>{' '}
                  Financial-inspired concert ticker & signal streams
                </div>
              </div>
            </div>

            <div className="mt-8">
              <Link
                href="/prototypes/signal"
                className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-violet-500 active:scale-[0.98]"
              >
                Launch Encore Signal &rarr;
              </Link>
            </div>
          </div>
        </div>

        {/* Comparison Overview */}
        <div className="mt-16 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 sm:p-8">
          <h3 className="text-lg font-bold text-white">
            Three Evaluation Scenarios Tested:
          </h3>
          <ul className="mt-4 grid grid-cols-1 gap-4 text-sm text-zinc-400 sm:grid-cols-3">
            <li className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <strong className="mb-1 block text-zinc-200">
                Scenario 1: Practical Discovery
              </strong>
              Find an inexpensive show ($18) this weekend without knowing the
              artist in advance.
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <strong className="mb-1 block text-zinc-200">
                Scenario 2: Personalized Discovery
              </strong>
              Discover an unfamiliar artist (Hania Rani) with high match score,
              clear strengths & honest drawbacks.
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <strong className="mb-1 block text-zinc-200">
                Scenario 3: Planning Ahead
              </strong>
              Find a favorite artist (The Cure) at Red Rocks, check presale
              timing, and activate presale alerts.
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
