import React from 'react';
import Link from 'next/link';
import { SearchIcon } from '@/components/index/icons';
import type { DiscoverChip } from '@/lib/discover/home-data';
import type { DiscoverDateWindows } from '@/lib/discover/dates';

export interface DiscoverHeroProps {
  totalUpcoming: number;
  windows: DiscoverDateWindows;
  genreChips: DiscoverChip[];
  /** Guests see an invitation to sign in for taste-ranked picks. */
  isAuthenticated?: boolean;
}

export function DiscoverHero({
  totalUpcoming,
  windows,
  genreChips,
  isAuthenticated = false,
}: DiscoverHeroProps) {
  const quick: DiscoverChip[] = [
    {
      label: 'Tonight',
      href: `/search?startDate=${windows.today}&endDate=${windows.today}`,
    },
    {
      label: 'This weekend',
      href: `/search?startDate=${windows.weekend.startDate}&endDate=${windows.weekend.endDate}`,
    },
    {
      label: 'Next 7 days',
      href: `/search?startDate=${windows.today}&endDate=${windows.nextWeekEnd}`,
    },
    { label: 'Free', href: '/search?freeOnly=true' },
  ];

  return (
    <section className="space-y-6 border-b border-zinc-200/80 pb-8 pt-2 sm:pb-10">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-5xl">
          Find live music worth showing up for.
        </h1>
        <p className="text-sm text-zinc-500 sm:text-base">
          {totalUpcoming > 0
            ? `${totalUpcoming.toLocaleString('en-US')} upcoming concerts, with ticket links straight to the source.`
            : 'Upcoming concerts, with ticket links straight to the source.'}
        </p>
        {!isAuthenticated && (
          <p data-testid="hero-personalize" className="text-sm text-zinc-600">
            Members get every show ranked by their taste, budget and distance.{' '}
            <Link
              href="/login"
              className="font-semibold text-zinc-900 underline underline-offset-4 hover:text-zinc-700"
            >
              Get your picks →
            </Link>
          </p>
        )}
      </div>

      <form
        action="/search"
        method="get"
        role="search"
        className="flex max-w-2xl items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:border-zinc-400"
      >
        <SearchIcon className="ml-2 h-5 w-5 shrink-0 text-zinc-400" />
        <input
          type="search"
          name="q"
          aria-label="Search concerts"
          placeholder="Search by artist, headliner, venue, city, or genre..."
          className="focus:outline-hidden min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-zinc-900 placeholder-zinc-400"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
        >
          Search
        </button>
      </form>

      {/* One scrollable line on phones, wrapping on wider screens. */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {[...quick, ...genreChips].map((chip) => (
          <Link
            key={`${chip.label}-${chip.href}`}
            href={chip.href}
            className="shrink-0 whitespace-nowrap rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
