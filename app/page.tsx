import React from 'react';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
} from '@/lib/recommendation/service';
import { Header } from '@/components/index/Header';
import { SearchClient } from '@/components/index/SearchClient';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getAuthenticatedUser();
  const supabase = await createClient();
  const catalogRepo = new SupabaseCatalogRepository(supabase);

  let events: Array<CanonicalEventSummary | ScoredEvent> = [];
  let totalCount = 0;

  const [facetsRes, countRes] = await Promise.allSettled([
    typeof catalogRepo.getFacets === 'function'
      ? catalogRepo.getFacets()
      : Promise.resolve(undefined),
    typeof catalogRepo.countEvents === 'function'
      ? catalogRepo.countEvents({ excludePastShowtimes: true })
      : Promise.resolve(0),
  ]);

  const initialFacets =
    facetsRes.status === 'fulfilled' ? facetsRes.value : undefined;
  totalCount = countRes.status === 'fulfilled' ? countRes.value : 0;

  if (user) {
    try {
      const personalizedData = await getPersonalizedDiscoverData({
        userId: user.id,
      });
      events = [
        ...personalizedData.recommendations,
        ...personalizedData.exploratory,
      ];
      if (events.length === 0) {
        const publicData = await getPublicDiscoverData({ limit: 50 });
        events = publicData.events;
      }
    } catch (err) {
      console.error(
        '[HomePage] Error loading personalized recommendations:',
        err,
      );
      try {
        const publicData = await getPublicDiscoverData({ limit: 50 });
        events = publicData.events;
      } catch (pubErr) {
        console.error('[HomePage] Error loading public fallback:', pubErr);
        events = await catalogRepo.listEvents({
          limit: 50,
          excludePastShowtimes: true,
          sortBy: 'date_asc',
        });
      }
    }
  } else {
    try {
      const publicData = await getPublicDiscoverData({ limit: 50 });
      events = publicData.events;
    } catch (err) {
      console.error('[HomePage] Error loading public discover data:', err);
      try {
        events = await catalogRepo.listEvents({
          limit: 50,
          excludePastShowtimes: true,
          sortBy: 'date_asc',
        });
      } catch (catErr) {
        console.error('[HomePage] Error loading catalog repo:', catErr);
        events = [];
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <SearchClient
          initialEvents={events}
          totalCount={Math.max(totalCount, events.length)}
          initialFacets={initialFacets}
          title="Discover Live Music"
          subtitle="Curated concerts, transparent pricing, and personalized music discovery in Colorado & beyond."
        />
      </main>
    </div>
  );
}
