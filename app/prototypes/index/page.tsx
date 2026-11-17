'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrototypeStore } from '@/lib/prototypes/store';
import { EventCard } from '@/components/prototypes/index/EventCard';
import {
  SearchIcon,
  SparklesIcon,
  CalendarIcon,
  TicketIcon,
  ArrowRightIcon,
  CompassIcon,
} from '@/components/prototypes/index/icons';

export default function EncoreIndexHomePage() {
  const router = useRouter();
  const {
    events,
    savedEventIds,
    alertEventIds,
    viewMode,
    toggleSaveEvent,
    toggleAlertEvent,
  } = usePrototypeStore();

  const [searchQuery, setSearchQuery] = useState('');

  const isAuth = viewMode === 'authenticated';

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(
        `/prototypes/index/search?q=${encodeURIComponent(searchQuery.trim())}`,
      );
    } else {
      router.push('/prototypes/index/search');
    }
  };

  // Quick Curated Collections derived from prototype fixtures:
  // 1. This Weekend: Nov 13 - 15 (Alcapones, Silver Lake Dreamers, Civic Center Beats, Japanese Breakfast)
  const weekendEvents = events.filter((e) =>
    ['proto-ev-101', 'proto-ev-104', 'proto-ev-105', 'proto-ev-109'].includes(
      e.id,
    ),
  );

  // 2. Under $30: Silver Lake ($18), Alcapones ($15), Civic Center ($0), Cervantes (TBA)
  const affordableEvents = events.filter((e) =>
    e.minPrice !== null && e.minPrice !== undefined ? e.minPrice <= 30 : true,
  );

  // 3. Recommended / Curated:
  // In authenticated mode, sort by authenticatedScore and filter out suppressed unless user wants to inspect them.
  const recommendedEvents = isAuth
    ? [...events]
        .filter((e) => e.samplePersonalScore.affinityType !== 'disliked')
        .sort(
          (a, b) =>
            b.samplePersonalScore.authenticatedScore -
            a.samplePersonalScore.authenticatedScore,
        )
        .slice(0, 4)
    : [...events]
        .sort(
          (a, b) =>
            b.samplePersonalScore.guestScore - a.samplePersonalScore.guestScore,
        )
        .slice(0, 4);

  // 4. Presales & High Demand:
  const presaleEvents = events.filter((e) =>
    ['proto-ev-103', 'proto-ev-102', 'proto-ev-108'].includes(e.id),
  );

  // 5. Something Offbeat / Different:
  const offbeatEvents = events.filter((e) =>
    ['proto-ev-106', 'proto-ev-107'].includes(e.id),
  );

  return (
    <div className="space-y-12 pb-12">
      {/* 1. Hero Search & Exploration Entry Point */}
      <section className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.03)] sm:p-10 lg:p-12">
        {/* Subtle decorative gradient background wash */}
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(236,72,153,0.05) 70%, transparent 100%)',
          }}
        />

        <div className="relative max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
            <span className="flex h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <span>Denver & Boulder Live Music Index</span>
            <span className="text-zinc-300">|</span>
            <span className="font-mono text-zinc-500">
              {events.length} Curated Shows
            </span>
          </div>

          <h1 className="text-3xl font-bold leading-[1.12] tracking-tight text-zinc-900 sm:text-4xl lg:text-5xl">
            Discover live music <br className="hidden sm:inline" />
            <span className="font-normal text-zinc-500">
              worth leaving home for.
            </span>
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
            An editorial search engine ranking concerts by acoustic fit, ticket
            value, and personal taste — with full price transparency and honest
            venue considerations.
          </p>

          {/* Interactive Hero Search Form */}
          <form
            onSubmit={handleSearchSubmit}
            className="mt-8 flex max-w-2xl flex-col gap-2 sm:flex-row"
          >
            <div className="relative flex-1">
              <SearchIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search artists, venues (e.g. The Cure, Bluebird, Shoegaze, Red Rocks)..."
                className="shadow-xs w-full rounded-xl border border-zinc-300 bg-white py-3.5 pl-11 pr-4 text-sm text-zinc-900 placeholder-zinc-400 transition-all focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 sm:text-base"
              />
            </div>
            <button
              type="submit"
              className="shadow-xs inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 py-3.5 text-sm font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
            >
              <span>Explore</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>

          {/* Instant Discovery Quick Chips */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-xs uppercase tracking-wider text-zinc-400">
              Quick collections:
            </span>
            {[
              {
                label: '⚡ This Weekend',
                href: '/prototypes/index/search?date=this_weekend',
              },
              {
                label: '💸 Under $30',
                href: '/prototypes/index/search?price=under_30',
              },
              {
                label: '📍 Denver Proper',
                href: '/prototypes/index/search?city=Denver',
              },
              {
                label: '🎟 Presales & Drops',
                href: '/prototypes/index/search?status=presale',
              },
              {
                label: '✨ Free ($0) Shows',
                href: '/prototypes/index/search?price=free',
              },
              {
                label: '🔥 High Match',
                href: '/prototypes/index/search?sort=match',
              },
            ].map((chip) => (
              <Link
                key={chip.label}
                href={chip.href}
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-all duration-150 ease-out hover:border-zinc-300 hover:bg-white hover:text-zinc-900 active:scale-[0.97]"
              >
                {chip.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Mode Switcher Explanation Banner */}
      <section className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white">
            {isAuth ? (
              <SparklesIcon className="h-4 w-4" />
            ) : (
              <CompassIcon className="h-4 w-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <span>
                {isAuth
                  ? 'Personalized Member Experience Active'
                  : 'Neutral Guest Mode Active'}
              </span>
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 font-mono text-[10px] text-zinc-700">
                {isAuth ? 'Taste Scoring ON' : 'Neutral Rank'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {isAuth
                ? 'Scores match your explicit favorites (The Cure, Japanese Breakfast) and suppress disliked headliners (Invariant 11).'
                : 'Showing unvarnished live calendar. Switch to Member mode in the top right to preview personalized scoring.'}
            </p>
          </div>
        </div>

        <Link
          href="/prototypes/index/preferences"
          className="shadow-2xs inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
        >
          <span>Manage Taste Profile</span>
          <ArrowRightIcon className="h-3.5 w-3.5 text-zinc-400" />
        </Link>
      </section>

      {/* 2. Collection 1: This Weekend in Colorado */}
      <section className="space-y-4">
        <div className="flex items-end justify-between border-b border-zinc-200/80 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-indigo-600" />
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">
                This Weekend in Colorado
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Spontaneous, immediate shows happening Friday through Sunday.
            </p>
          </div>

          <Link
            href="/prototypes/index/search?date=this_weekend"
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"
          >
            <span>View All ({weekendEvents.length})</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {weekendEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={savedEventIds.includes(event.id)}
              hasAlert={alertEventIds.includes(event.id)}
              viewMode={viewMode}
              onToggleSave={toggleSaveEvent}
              onToggleAlert={toggleAlertEvent}
            />
          ))}
        </div>
      </section>

      {/* Collection: Under $30 & Intimate Rooms */}
      <section className="space-y-4">
        <div className="flex items-end justify-between border-b border-zinc-200/80 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <TicketIcon className="h-4 w-4 text-emerald-600" />
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">
                Under $30 & Intimate Rooms
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Low-barrier shows with affordable door charges and unpretentious
              neighborhood rooms.
            </p>
          </div>

          <Link
            href="/prototypes/index/search?price=under_30"
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"
          >
            <span>View All Under $30 ({affordableEvents.length})</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {affordableEvents.slice(0, 4).map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={savedEventIds.includes(event.id)}
              hasAlert={alertEventIds.includes(event.id)}
              viewMode={viewMode}
              onToggleSave={toggleSaveEvent}
              onToggleAlert={toggleAlertEvent}
            />
          ))}
        </div>
      </section>

      {/* 3. Collection 2: Personalized Matches (Member) or Editorial High-Ranked (Guest) */}
      <section className="space-y-4">
        <div className="flex items-end justify-between border-b border-zinc-200/80 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-amber-600" />
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">
                {isAuth
                  ? 'Ranked For Your Taste Profile'
                  : 'Curator’s High-Rank Selection'}
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {isAuth
                ? 'Shows scored by artist affinity, venue acoustics, and price tolerance.'
                : 'Top-rated concerts selected for acoustic quality and tour prestige.'}
            </p>
          </div>

          <Link
            href="/prototypes/index/search?sort=match"
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"
          >
            <span>Full Ranked Index</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {recommendedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={savedEventIds.includes(event.id)}
              hasAlert={alertEventIds.includes(event.id)}
              viewMode={viewMode}
              onToggleSave={toggleSaveEvent}
              onToggleAlert={toggleAlertEvent}
            />
          ))}
        </div>
      </section>

      {/* 4. Collection 3: Upcoming Presales & High-Demand Watchlist */}
      <section className="space-y-4">
        <div className="flex items-end justify-between border-b border-zinc-200/80 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <TicketIcon className="h-4 w-4 text-violet-600" />
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">
                Upcoming Presales & Ticket Drops
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Set alerts before general public onsale or watch sold-out shows
              for production drops.
            </p>
          </div>

          <Link
            href="/prototypes/index/search?status=presale"
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"
          >
            <span>View All Alerts</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {presaleEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={savedEventIds.includes(event.id)}
              hasAlert={alertEventIds.includes(event.id)}
              viewMode={viewMode}
              onToggleSave={toggleSaveEvent}
              onToggleAlert={toggleAlertEvent}
            />
          ))}
        </div>
      </section>

      {/* 5. Collection 4: Something Different / Multi-Day & Jams */}
      <section className="space-y-4">
        <div className="flex items-end justify-between border-b border-zinc-200/80 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <CompassIcon className="h-4 w-4 text-emerald-600" />
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">
                Something Different
              </h2>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Festivals worth traveling for, unscripted collaborative jams, and
              outdoor park showcases.
            </p>
          </div>

          <Link
            href="/prototypes/index/search"
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"
          >
            <span>Explore All</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {offbeatEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={savedEventIds.includes(event.id)}
              hasAlert={alertEventIds.includes(event.id)}
              viewMode={viewMode}
              onToggleSave={toggleSaveEvent}
              onToggleAlert={toggleAlertEvent}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
