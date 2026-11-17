'use client';

import React from 'react';
import { usePrototypeStore } from '@/lib/prototypes/store';
import { computeSignalScore } from '@/lib/prototypes/signal-helpers';
import { HeroSignal } from '@/components/prototypes/signal/HeroSignal';
import { QuickScannerBand } from '@/components/prototypes/signal/QuickScannerBand';
import { SignalStream } from '@/components/prototypes/signal/SignalStream';
import { SignalCard } from '@/components/prototypes/signal/SignalCard';

export default function SignalHomePage() {
  const { events, preferences, viewMode } = usePrototypeStore();

  // Find the top hero event (highest computed score)
  const scoredEvents = events.map((ev) => ({
    event: ev,
    computed: computeSignalScore(ev, preferences, viewMode),
  }));

  // Non-suppressed events sorted by score descending
  const activeEvents = scoredEvents
    .filter((se) => !se.computed.isSuppressed)
    .sort((a, b) => b.computed.score - a.computed.score)
    .map((se) => se.event);

  // Suppressed events (disliked / ignored headliners)
  const suppressedEvents = scoredEvents
    .filter((se) => se.computed.isSuppressed)
    .map((se) => se.event);

  const heroEvent = activeEvents[0] || events[0];

  // Stream 1: Strongest Upcoming Matches (score >= 90)
  const strongestMatches = scoredEvents
    .filter(
      (se) =>
        !se.computed.isSuppressed &&
        se.computed.score >= 90 &&
        se.event.id !== heroEvent.id,
    )
    .map((se) => se.event);

  // Stream 2: Worth Seeing This Weekend (Nov 13, 14, 15)
  const weekendEvents = scoredEvents
    .filter(
      (se) =>
        !se.computed.isSuppressed &&
        ['2026-11-13', '2026-11-14', '2026-11-15'].includes(
          se.event.localStartDate,
        ),
    )
    .map((se) => se.event);

  // Stream 3: Favorite Artists On Tour
  const favoriteArtistsShows = scoredEvents
    .filter(
      (se) =>
        !se.computed.isSuppressed && se.computed.affinityType === 'favorite',
    )
    .map((se) => se.event);

  // Stream 4: Worth Traveling For (festivals, destination shows)
  const travelWorthy = scoredEvents
    .filter(
      (se) =>
        !se.computed.isSuppressed &&
        (se.event.eventKind === 'multi_day_festival' ||
          se.event.venueName.includes('Red Rocks') ||
          se.event.city === 'Boulder'),
    )
    .map((se) => se.event);

  // Stream 5: Unfamiliar Discoveries (high match without pre-existing favorite)
  const unfamiliarDiscoveries = scoredEvents
    .filter(
      (se) =>
        !se.computed.isSuppressed &&
        se.computed.affinityType === 'exploratory' &&
        se.computed.score >= 75,
    )
    .map((se) => se.event);

  return (
    <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-6 lg:px-8">
      {/* 1. Page Title & Context Radar Bar */}
      <div className="flex flex-col gap-4 border-b border-zinc-800/80 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-950/40 px-3 py-1 font-mono text-xs text-violet-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
            <span>
              Radar Mode:{' '}
              {viewMode === 'authenticated'
                ? 'Julian’s Taste Profile'
                : 'Guest (Neutral)'}
            </span>
          </div>

          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl md:text-5xl">
            Live Music Signal
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base">
            Intelligent live-music companion monitoring presales, venue
            acoustics, ticket velocity, and personal taste fit across Colorado
            venues.
          </p>
        </div>

        {/* Live Metrics Pill Box */}
        <div className="flex items-center gap-3 self-start rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs md:self-auto">
          <div className="border-r border-zinc-800 pr-3">
            <span className="block text-[10px] text-zinc-500">
              Active Scanners
            </span>
            <span className="font-bold text-white">4 Modes</span>
          </div>
          <div className="border-r border-zinc-800 pr-3">
            <span className="block text-[10px] text-zinc-500">
              Upcoming Concerts
            </span>
            <span className="font-bold text-white">{events.length} Shows</span>
          </div>
          <div>
            <span className="block text-[10px] text-zinc-500">
              High Matches
            </span>
            <span className="font-bold text-emerald-400">3 Above 90%</span>
          </div>
        </div>
      </div>

      {/* 2. Top Hero Signal Opportunity */}
      {heroEvent && <HeroSignal event={heroEvent} />}

      {/* 3. Contextual Quick Scanners */}
      <QuickScannerBand />

      {/* 4. Stream 1: Strongest Upcoming Matches */}
      {strongestMatches.length > 0 && (
        <SignalStream
          title="Your Strongest Upcoming Matches"
          subtitle="Exceptional 90%+ alignment across artist taste, sound atmosphere, and ticket value."
          badge="90%+ Compatibility"
          icon="⚡"
          badgeColorClass="border-violet-500/50 bg-violet-950/60 text-violet-300"
          events={strongestMatches}
          exploreHref="/prototypes/signal/explore?filter=top"
        />
      )}

      {/* 5. Stream 2: Worth Seeing This Weekend */}
      {weekendEvents.length > 0 && (
        <SignalStream
          title="Worth Seeing This Weekend"
          subtitle="Spontaneous, high venue fit options happening Friday through Sunday."
          badge="Nov 13 – 15"
          icon="🌙"
          badgeColorClass="border-blue-500/50 bg-blue-950/60 text-blue-300"
          events={weekendEvents}
          exploreHref="/prototypes/signal/explore?context=weekend"
        />
      )}

      {/* 6. Stream 3: Favorite Artists On Tour */}
      {viewMode === 'authenticated' && favoriteArtistsShows.length > 0 && (
        <SignalStream
          title="Favorite Artists On Tour"
          subtitle="Shows featuring artists you have explicitly marked as all-time favorites."
          badge="Taste Profile Pinned"
          icon="❤️"
          badgeColorClass="border-rose-500/50 bg-rose-950/60 text-rose-300"
          events={favoriteArtistsShows}
          exploreHref="/prototypes/signal/explore?filter=favorites"
        />
      )}

      {/* 7. Stream 4: Worth Traveling For */}
      {travelWorthy.length > 0 && (
        <SignalStream
          title="Concerts & Festivals Worth Traveling For"
          subtitle="Multi-day gatherings, bucket list amphitheaters, and destination performances."
          badge="Destination Signals"
          icon="✈️"
          badgeColorClass="border-pink-500/50 bg-pink-950/60 text-pink-300"
          events={travelWorthy}
          exploreHref="/prototypes/signal/explore?context=travel"
        />
      )}

      {/* 8. Stream 5: Unfamiliar Discoveries */}
      {unfamiliarDiscoveries.length > 0 && (
        <SignalStream
          title="Unfamiliar Discoveries"
          subtitle="Artists outside your immediate listening loops that strongly match your acoustic preferences."
          badge="Curiosity Scanner"
          icon="🔭"
          badgeColorClass="border-amber-500/50 bg-amber-950/60 text-amber-300"
          events={unfamiliarDiscoveries}
          exploreHref="/prototypes/signal/explore?context=inexpensive"
        />
      )}

      {/* 9. Invariant 11 Demonstration: Suppressed Shows */}
      {viewMode === 'authenticated' && suppressedEvents.length > 0 && (
        <section className="rounded-2xl border border-rose-950/60 bg-zinc-950/90 p-5 backdrop-blur">
          <div className="flex items-center justify-between border-b border-rose-950/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="rounded border border-rose-800/60 bg-rose-950/80 px-2 py-0.5 font-mono text-[11px] font-bold text-rose-400">
                INVARIANT 11 VERIFICATION
              </span>
              <h4 className="text-sm font-bold text-zinc-300">
                Suppressed Shows ({suppressedEvents.length})
              </h4>
            </div>
            <span className="text-xs text-zinc-500">
              Disliked headliners are never recommended in personal streams
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {suppressedEvents.map((event) => (
              <SignalCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
