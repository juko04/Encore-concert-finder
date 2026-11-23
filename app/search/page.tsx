import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { Header } from '@/components/index/Header';
import { SearchClient } from '@/components/index/SearchClient';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type {
  EventListFilters,
  EventSortOption,
} from '@/lib/repositories/interfaces';
import type { IndexSortBy } from '@/components/index/types';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams?: Promise<{
    q?: string;
    venue?: string;
    city?: string;
    startDate?: string;
    endDate?: string;
    sort?: string;
    minPrice?: string;
    maxPrice?: string;
    freeOnly?: string;
    includeUnknownPrice?: string;
  }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const user = await getAuthenticatedUser();
  const supabase = await createClient();
  const catalogRepo = new SupabaseCatalogRepository(supabase);

  const minPrice = resolvedParams.minPrice
    ? Number(resolvedParams.minPrice)
    : undefined;
  const maxPrice = resolvedParams.maxPrice
    ? Number(resolvedParams.maxPrice)
    : undefined;
  const freeOnly =
    resolvedParams.freeOnly === 'true' || resolvedParams.freeOnly === '1';
  const includeUnknownPrice =
    resolvedParams.includeUnknownPrice !== undefined
      ? resolvedParams.includeUnknownPrice === 'true' ||
        resolvedParams.includeUnknownPrice === '1'
      : true;

  const validSorts: EventSortOption[] = [
    'price_asc',
    'price_desc',
    'date_asc',
    'date_desc',
    'title_asc',
    'score_desc',
  ];
  const repoSortBy: EventSortOption =
    resolvedParams.sort &&
    validSorts.includes(resolvedParams.sort as EventSortOption)
      ? (resolvedParams.sort as EventSortOption)
      : 'date_asc';

  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isVenueUuid = resolvedParams.venue
    ? UUID_PATTERN.test(resolvedParams.venue)
    : false;

  const filters: EventListFilters = {
    searchQuery: resolvedParams.q || undefined,
    venueId: isVenueUuid ? resolvedParams.venue : undefined,
    venueName:
      !isVenueUuid && resolvedParams.venue ? resolvedParams.venue : undefined,
    city: resolvedParams.city || undefined,
    fromDate: resolvedParams.startDate || undefined,
    toDate: resolvedParams.endDate || undefined,
    minPrice:
      minPrice !== undefined && !Number.isNaN(minPrice) ? minPrice : undefined,
    maxPrice:
      maxPrice !== undefined && !Number.isNaN(maxPrice) ? maxPrice : undefined,
    freeOnly: freeOnly || undefined,
    includeUnknownPrice,
    sortBy: repoSortBy,
    limit: 50,
    offset: 0,
  };

  let events: CanonicalEventSummary[] = [];
  let totalCount = 0;
  try {
    const [fetchedEvents, count] = await Promise.all([
      catalogRepo.listEvents(filters),
      typeof catalogRepo.countEvents === 'function'
        ? catalogRepo.countEvents(filters)
        : Promise.resolve(0),
    ]);
    events = fetchedEvents;
    totalCount = Math.max(count, events.length);
  } catch (err) {
    console.error('[SearchPage] Error querying catalog events:', err);
    events = [];
    totalCount = 0;
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <SearchClient
          events={events}
          initialEvents={events}
          totalCount={totalCount}
          initialQuery={resolvedParams.q || ''}
          initialSortBy={(resolvedParams.sort as IndexSortBy) || 'date_asc'}
        />
      </main>
    </div>
  );
}
