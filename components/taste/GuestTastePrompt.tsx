import React from 'react';
import Link from 'next/link';

export function GuestTastePrompt() {
  return (
    <div
      data-testid="guest-taste-prompt"
      className="rounded-2xl border border-zinc-200 bg-white p-8 text-center backdrop-blur sm:p-12"
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-500/30">
        <span className="text-2xl">🎵</span>
      </div>

      <h2 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
        Curate Your Live Music Taste
      </h2>

      <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500 sm:text-base">
        Your music taste profile directly prioritizes which concerts and
        festivals appear at the top of your Discover feed. Tell Encore which
        artists are worth traveling for, which you want to catch nearby, and
        which you want to discover.
      </p>

      {/* Breakdown of the 4 manual tiers */}
      <div className="mx-auto mt-8 grid max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-amber-700">★</span>
            <span className="text-sm font-semibold text-zinc-900">
              Favorite
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Must-see performers worth prioritizing and paying more to see live.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-rose-600">♥</span>
            <span className="text-sm font-semibold text-zinc-900">Like</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Artists you enjoy seeing live when nearby and reasonably priced.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-cyan-600">✦</span>
            <span className="text-sm font-semibold text-zinc-900">
              Interested
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Emerging or unfamiliar acts you want to explore and discover.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">⊘</span>
            <span className="text-sm font-semibold text-zinc-900">Dislike</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Artists you are not interested in seeing live.
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link
          href="/login?redirectTo=/profile/taste"
          data-testid="guest-signin-btn"
          className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white"
        >
          Sign In to Build Taste Profile
        </Link>
        <Link
          href="/discover"
          className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          Browse Upcoming Discover Events →
        </Link>
      </div>
    </div>
  );
}
