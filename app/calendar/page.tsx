import React from 'react';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { loadArtistAffinityResolver } from '@/lib/recommendation/artist-affinity-server';
import { annotateEventsWithArtistAffinity } from '@/lib/recommendation/artist-affinity';
import { Header } from '@/components/index/Header';
import { CalendarClient } from '@/components/calendar/CalendarClient';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const user = await getAuthenticatedUser();
  const supabase = await createClient();
  const catalogRepo = new SupabaseCatalogRepository(supabase);

  let events: CanonicalEventSummary[] = [];
  try {
    events = await catalogRepo.listEvents({
      limit: 300,
      sortBy: 'date_asc',
      excludePastShowtimes: true,
    });
    if (user && events.length > 0) {
      events = annotateEventsWithArtistAffinity(
        events,
        await loadArtistAffinityResolver(user.id, supabase, catalogRepo),
      );
    }
  } catch (err) {
    console.error(
      '[CalendarPage] Error loading upcoming concerts for calendar:',
      err,
    );
    events = [];
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <CalendarClient
          initialEvents={events}
          isAuthenticated={Boolean(user)}
        />
      </main>
    </div>
  );
}
