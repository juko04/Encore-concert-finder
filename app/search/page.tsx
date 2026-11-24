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
import {
  getDiscoverDateWindows,
  isIsoDate,
  resolveCatalogFromDate,
} from '@/lib/discover/dates';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams?: Promise<{
    q?: string;
    venue?: string;
    venueId?: string;
    city?: string;
    genre?: string;
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
  // Homepage chips use ?venue=<name>; the venue picker uses ?venueId=<uuid>.
  const venueParam = resolvedParams.venueId || resolvedParams.venue;
  const isVenueUuid = venueParam ? UUID_PATTERN.test(venueParam) : false;

  // Upcoming only: never show shows that already started, even when the URL
  // carries startDate=today (the "Tonight" chip). Malformed dates are ignored.
  const today = getDiscoverDateWindows().today;
  const urlStartDate =
    resolvedParams.startDate && isIsoDate(resolvedParams.startDate)
      ? resolvedParams.startDate
      : undefined;
  const urlEndDate =
    resolvedParams.endDate && isIsoDate(resolvedParams.endDate)
      ? resolvedParams.endDate
      : undefined;
  const { fromDate, excludePastShowtimes } = resolveCatalogFromDate({
    startDate: urlStartDate,
    today,
  });

  const filters: EventListFilters = {
    searchQuery: resolvedParams.q || undefined,
    venueId: isVenueUuid ? venueParam : undefined,
    venueName: !isVenueUuid && venueParam ? venueParam : undefined,
    city: resolvedParams.city || undefined,
    genre: resolvedParams.genre || undefined,
    fromDate,
    toDate: urlEndDate,
    excludePastShowtimes,
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
        {/* Remount when the URL filters change so client-side navigation
            (header links, "See all", back/forward) re-hydrates every control. */}
        <SearchClient
          key={JSON.stringify(resolvedParams)}
          events={events}
          initialEvents={events}
          totalCount={totalCount}
          initialQuery={resolvedParams.q || ''}
          initialSortBy={(resolvedParams.sort as IndexSortBy) || 'date_asc'}
          title="Search concerts"
          subtitle="Search every upcoming show by artist, opener, venue, or city, then filter by date and price."
          initialVenue={venueParam || undefined}
          initialCity={resolvedParams.city || undefined}
          initialGenre={resolvedParams.genre || undefined}
          initialStartDate={urlStartDate}
          initialEndDate={urlEndDate}
          initialFreeOnly={freeOnly}
          initialMaxPrice={
            maxPrice !== undefined && Number.isFinite(maxPrice)
              ? maxPrice
              : undefined
          }
          initialIncludeUnknownPrice={includeUnknownPrice}
        />
      </main>
    </div>
  );
}
