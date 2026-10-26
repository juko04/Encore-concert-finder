'use client';

import React from 'react';
import Link from 'next/link';

export function GuestDiscoverErrorState() {
  return (
    <div className="space-y-8" data-testid="guest-error-state">
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
            Concerts, festivals, and multi-day live music events.
          </p>
        </div>
      </header>

      {/* Actionable Error Card */}
      <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-8 text-center sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-900/40 text-2xl">
          ⚠️
        </div>
        <h2 className="mt-4 text-lg font-semibold text-red-200 sm:text-xl">
          Unable to Load Live Music Catalog
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
          We couldn&apos;t load upcoming events right now. Please check your
          connection or try again shortly.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            data-testid="retry-button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
