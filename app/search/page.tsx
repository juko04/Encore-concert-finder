import React from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHomeLocation } from '@/lib/location/server';
import { listEventsNearHome } from '@/lib/location/near-search';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import type { UserProfile } from '@/lib/domain/profile';
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
    near?: string;
  }>;
}

const PAGE_SIZE = 50;

function shortcutHref(
  params: Record<string, string | undefined>,
  changes: Record<string, string | null>,
): string {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v !== '') next[k] = v;
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const qs = new URLSearchParams(next).toString();
  return qs ? `/search?${qs}` : '/search';
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
    limit: PAGE_SIZE,
    offset: 0,
  };

  // Saved preferences power two shortcut chips (signed-in users only).
  let profile: UserProfile | null = null;
  let home: Awaited<ReturnType<typeof getHomeLocation>> = null;
  if (user) {
    try {
      profile = await new SupabaseProfileRepository().getProfile(user.id);
    } catch (err) {
      console.error('[SearchPage] profile load failed:', err);
    }
    home = await getHomeLocation(user.id);
  }
  const radiusMiles = profile?.defaultRadiusMiles ?? 25;
  const budget = profile?.maxNormalTicketPrice ?? null;
  const nearActive = resolvedParams.near === '1' && Boolean(home);
  const budgetActive =
    budget !== null && maxPrice === budget && !includeUnknownPrice;

  let events: CanonicalEventSummary[] = [];
  let totalCount = 0;
  try {
    if (nearActive && home) {
      // Radius is measured from the home city's coordinate to the venue (or city centroid).
      // The catalog has no geo query, so the whole catalog is walked server-side in batches
      // (no first-N cap); shows whose location is unknown are excluded rather than guessed.
      const near = await listEventsNearHome(
        catalogRepo,
        filters,
        home,
        radiusMiles,
        { limit: PAGE_SIZE, offset: 0 },
      );
      events = near.events;
      totalCount = near.totalCount;
    } else {
      const [fetchedEvents, count] = await Promise.all([
        catalogRepo.listEvents(filters),
        typeof catalogRepo.countEvents === 'function'
          ? catalogRepo.countEvents(filters)
          : Promise.resolve(0),
      ]);
      events = fetchedEvents;
      totalCount = Math.max(count, events.length);
    }
  } catch (err) {
    console.error('[SearchPage] Error querying catalog events:', err);
    events = [];
    totalCount = 0;
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {user && (
          <div
            data-testid="preference-shortcuts"
            className="mb-4 flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="font-semibold text-zinc-500">My preferences:</span>
            {home ? (
              <Link
                href={shortcutHref(resolvedParams, {
                  near: nearActive ? null : '1',
                })}
                data-testid="shortcut-near"
                aria-pressed={nearActive}
                className={`rounded-full border px-3 py-1 font-semibold transition ${
                  nearActive
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                }`}
              >
                Within {radiusMiles} mi of {home.label}
              </Link>
            ) : (
              <Link
                href="/preferences"
                data-testid="shortcut-set-home"
                className="rounded-full border border-dashed border-zinc-300 px-3 py-1 font-semibold text-zinc-600 hover:border-zinc-400"
              >
                Set a home city to filter by distance
              </Link>
            )}
            {budget !== null ? (
              <Link
                href={shortcutHref(
                  resolvedParams,
                  budgetActive
                    ? { maxPrice: null, includeUnknownPrice: null }
                    : {
                        maxPrice: String(budget),
                        // Strict: only shows with a listed price within budget. Shows with no
                        // listed price are not claimed to be affordable.
                        includeUnknownPrice: 'false',
                      },
                )}
                data-testid="shortcut-budget"
                aria-pressed={budgetActive}
                title="Only shows with a listed starting price at or under your typical budget"
                className={`rounded-full border px-3 py-1 font-semibold transition ${
                  budgetActive
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                }`}
              >
                Listed price up to ${budget}
              </Link>
            ) : (
              <Link
                href="/preferences"
                data-testid="shortcut-set-budget"
                className="rounded-full border border-dashed border-zinc-300 px-3 py-1 font-semibold text-zinc-600 hover:border-zinc-400"
              >
                Set a ticket budget
              </Link>
            )}
            {nearActive && (
              <span className="text-zinc-400">
                Distances are approximate (city to city).
              </span>
            )}
          </div>
        )}
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
