import React from 'react';
import type { Metadata } from 'next';
import { Container } from '@/components/foundation/Container';
import { EventCard } from '@/components/catalog/EventCard';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

export const metadata: Metadata = {
  title: 'Discover Concerts | Encore',
  description: 'Explore verified canonical live music events and concerts.',
};

export const dynamic = 'force-dynamic';

async function fetchEvents(): Promise<CanonicalEventSummary[]> {
  try {
    const repo = new SupabaseCatalogRepository();
    return await repo.listEvents({ limit: 50 });
  } catch (error) {
    // If database is offline or unreachable during dev/build, return empty list gracefully
    console.warn(
      'Catalog repository unreachable, returning empty catalog:',
      error,
    );
    return [];
  }
}

export default async function DiscoverPage() {
  const events = await fetchEvents();

  return (
    <main className="min-h-screen py-12">
      <Container>
        <header className="mb-8 border-b border-slate-800 pb-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 sm:text-4xl">
                Discover Live Music
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Verified canonical concerts and festivals. Objective catalog
                data with complete source attribution.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-300">
              {events.length} {events.length === 1 ? 'event' : 'events'} in
              catalog
            </div>
          </div>
        </header>

        {events.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
            <h2 className="text-lg font-semibold text-slate-200">
              No events found in catalog
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
              Canonical events appear here once imported and resolved through
              the ingestion pipeline.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
