import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { Header } from '@/components/index/Header';
import { SavedWatchlistClient } from '@/components/index/SavedWatchlistClient';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

export const dynamic = 'force-dynamic';

export default async function SavedPage() {
  const user = await getAuthenticatedUser();
  const supabase = await createClient();
  const catalogRepo = new SupabaseCatalogRepository(supabase);

  let events: CanonicalEventSummary[] = [];
  try {
    events = await catalogRepo.listEvents({ limit: 300 });
  } catch (err) {
    console.error('[SavedPage] Error loading catalog events:', err);
    events = [];
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <SavedWatchlistClient events={events} />
      </main>
    </div>
  );
}
