import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { Header } from '@/components/index/Header';
import { SearchClient } from '@/components/index/SearchClient';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams?: Promise<{
    q?: string;
    venue?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const user = await getAuthenticatedUser();
  const supabase = await createClient();
  const catalogRepo = new SupabaseCatalogRepository(supabase);

  let events: CanonicalEventSummary[] = [];
  try {
    events = await catalogRepo.listEvents({
      searchQuery: resolvedParams.q || undefined,
      limit: 300,
    });
  } catch (err) {
    console.error('[SearchPage] Error querying catalog events:', err);
    events = [];
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <SearchClient events={events} initialQuery={resolvedParams.q || ''} />
      </main>
    </div>
  );
}
