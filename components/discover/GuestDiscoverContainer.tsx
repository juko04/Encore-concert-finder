'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PublicDiscoverResult } from '@/lib/recommendation/service';
import { EventCard } from '@/components/catalog/EventCard';

export interface GuestDiscoverContainerProps {
  initialData: PublicDiscoverResult;
  showScoringInspector?: boolean;
}

export function GuestDiscoverContainer({
  initialData,
  showScoringInspector = false,
}: GuestDiscoverContainerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  // Extract unique cities from events
  const availableCities = useMemo(() => {
    const citySet = new Set<string>();
    for (const evt of initialData.events) {
      if (evt.city?.trim()) citySet.add(evt.city.trim());
    }
    return Array.from(citySet).sort();
  }, [initialData.events]);

  // Client-side filtering
  const filteredEvents = useMemo(() => {
    return initialData.events.filter((evt) => {
      if (
        selectedCity &&
        evt.city?.toLowerCase() !== selectedCity.toLowerCase()
      ) {
        return false;
      }
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTitle = evt.title.toLowerCase().includes(q);
        const matchesVenue = evt.venueName?.toLowerCase().includes(q) ?? false;
        const matchesArtist =
          evt.artists?.some((a) => a.name.toLowerCase().includes(q)) ?? false;
        if (!matchesTitle && !matchesVenue && !matchesArtist) {
          return false;
        }
      }
      return true;
    });
  }, [initialData.events, selectedCity, searchQuery]);

  return (
    <div className="space-y-8">
      {/* Header */}
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
            Explore upcoming concerts and events across verified venues and
            sources.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {showScoringInspector && (
            <Link
              href="/discover/scoring-preview"
              data-testid="discover-scoring-preview-link"
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition-colors hover:border-indigo-500 hover:text-white"
            >
              <span>🎯</span> Scoring Inspector
            </Link>
          )}
          <Link
            href="/login"
            data-testid="guest-sign-in-link"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* "Make These Recommendations Yours" Callout Banner */}
      <section
        data-testid="guest-personalization-banner"
        className="rounded-2xl border border-indigo-800/60 bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-zinc-900/80 p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-white">
              ✨ Make These Recommendations Yours
            </h2>
            <p className="mt-1 text-xs text-zinc-300 sm:text-sm">
              You are browsing public upcoming concerts. Sign in to Encore to
              rate your favorite artists, connect your Spotify listening
              history, and get personalized match scores based on your taste,
              travel radius, and ticket budget.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              Sign In to Personalize
            </Link>
          </div>
        </div>
      </section>

      {/* Filters: Search & City Filter */}
      <section
        data-testid="guest-filters"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <input
              type="text"
              data-testid="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by artist name, venue, or title..."
              className="focus:outline-hidden w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <select
              data-testid="city-filter"
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="focus:outline-hidden w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500"
            >
              <option value="">All Cities</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Empty State */}
      {initialData.isEmptyCatalog ? (
        <div
          data-testid="empty-catalog-banner"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            No upcoming events found
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Events will appear here as source adapters ingest upcoming shows
            into the catalog.
          </p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div
          data-testid="empty-filtered-banner"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            No events match your search criteria
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Try clearing the search query or selecting All Cities.
          </p>
          {(searchQuery || selectedCity) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCity('');
              }}
              className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 hover:text-white"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div
          data-testid="guest-events-grid"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
