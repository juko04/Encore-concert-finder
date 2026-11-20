import React from 'react';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
} from '@/lib/recommendation/service';
import { Header } from '@/components/index/Header';
import { IndexFeedContainer } from '@/components/index/IndexFeedContainer';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getAuthenticatedUser();

  let events: Array<CanonicalEventSummary | ScoredEvent> = [];

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
        const publicData = await getPublicDiscoverData({ limit: 100 });
        events = publicData.events;
      }
    } catch (err) {
      console.error(
        '[HomePage] Error loading personalized recommendations:',
        err,
      );
      try {
        const publicData = await getPublicDiscoverData({ limit: 100 });
        events = publicData.events;
      } catch (pubErr) {
        console.error('[HomePage] Error loading public fallback:', pubErr);
        const supabase = await createClient();
        const catalogRepo = new SupabaseCatalogRepository(supabase);
        events = await catalogRepo.listEvents({ limit: 100 });
      }
    }
  } else {
    try {
      const publicData = await getPublicDiscoverData({ limit: 100 });
      events = publicData.events;
    } catch (err) {
      console.error('[HomePage] Error loading public discover data:', err);
      try {
        const supabase = await createClient();
        const catalogRepo = new SupabaseCatalogRepository(supabase);
        events = await catalogRepo.listEvents({ limit: 100 });
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
        <IndexFeedContainer events={events} />
      </main>
    </div>
  );
}
