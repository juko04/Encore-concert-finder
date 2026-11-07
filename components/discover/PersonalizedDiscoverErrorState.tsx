'use client';

import React from 'react';
import Link from 'next/link';

export interface PersonalizedDiscoverErrorStateProps {
  showScoringInspector?: boolean;
}

export function PersonalizedDiscoverErrorState({
  showScoringInspector = false,
}: PersonalizedDiscoverErrorStateProps) {
  return (
    <div className="space-y-8" data-testid="authenticated-error-state">
      {/* Top Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            ← Back to Home
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Discover Live Music
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Concerts and festivals ranked for your taste, travel practicality,
            and budget.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {showScoringInspector && (
            <Link
              href="/discover/scoring-preview"
              data-testid="scoring-inspector-link"
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-950/40 px-3.5 py-2 text-xs font-semibold text-purple-200 transition-colors hover:border-purple-400 hover:text-white"
            >
              <span>🔬</span> Scoring Inspector
            </Link>
          )}

          <Link
            href="/profile/taste"
            data-testid="discover-taste-link"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-indigo-500 hover:text-white"
          >
            <span>🎵</span> Music Taste
          </Link>
        </div>
      </header>

      {/* Actionable Error Card */}
      <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-8 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/40 text-2xl">
          ⚠️
        </div>
        <h2 className="mt-4 text-lg font-semibold text-red-200 sm:text-xl">
          Unable to Load Recommendations
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
          We encountered an issue retrieving your personalized concert
          recommendations. Your saved preferences and settings are intact.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            data-testid="retry-button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Try Again
          </button>
          <Link
            href="/profile/taste"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
          >
            Manage Music Taste
          </Link>
        </div>
      </div>
    </div>
  );
}
