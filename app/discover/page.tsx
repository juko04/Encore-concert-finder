import React from 'react';
import Link from 'next/link';
import { EventCard } from '@/components/catalog/EventCard';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

export const revalidate = 60;

export default async function DiscoverPage() {
  let events: CanonicalEventSummary[] = [];

  try {
    const catalogRepo = new SupabaseCatalogRepository();
    events = await catalogRepo.listEvents({ limit: 50 });
  } catch {
    // If Supabase is unavailable (e.g. during offline build), events list remains empty
    events = [];
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
        </header>

        {events.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-12 text-center">
            <h2 className="text-lg font-semibold text-zinc-200">
              No upcoming events found
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Events will appear here as source adapters ingest upcoming shows.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
