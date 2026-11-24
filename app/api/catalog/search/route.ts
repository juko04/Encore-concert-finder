import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@/lib/supabase/server';
import { getPublicEnv } from '@/lib/env/public';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { deriveLocalDateFromInstant } from '@/lib/domain/value-objects';
import {
  isIsoDate,
  isValidTimeZone,
  resolveCatalogFromDate,
} from '@/lib/discover/dates';
import type {
  EventListFilters,
  EventSortOption,
} from '@/lib/repositories/interfaces';

export const dynamic = 'force-dynamic';

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || undefined;

    const venueId = searchParams.get('venueId')?.trim() || undefined;
    const venueParam =
      searchParams.get('venue')?.trim() ||
      searchParams.get('venueName')?.trim() ||
      undefined;
    const venueName = venueParam || undefined;

    const city = searchParams.get('city')?.trim() || undefined;
    const genre = searchParams.get('genre')?.trim() || undefined;

    // Local calendar date derived in validated target timezone (never naive UTC split)
    const timezone = searchParams.get('timezone')?.trim() || 'America/Denver';
    if (!isValidTimeZone(timezone)) {
      return badRequest('Invalid timezone');
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const todayLocalDate = deriveLocalDateFromInstant(nowIso, timezone);
    const twelveMonthsFuture = new Date(now.getTime() + 365 * 86400000);
    const twelveMonthsLocalDate = deriveLocalDateFromInstant(
      twelveMonthsFuture.toISOString(),
      timezone,
    );

    const startDateParam = searchParams.get('startDate')?.trim();
    const endDateParam = searchParams.get('endDate')?.trim();

    if (startDateParam && !isIsoDate(startDateParam)) {
      return badRequest('startDate must be a valid YYYY-MM-DD date');
    }
    if (endDateParam && !isIsoDate(endDateParam)) {
      return badRequest('endDate must be a valid YYYY-MM-DD date');
    }

    // Upcoming results never include shows that already started (e.g. the
    // "Tonight" chip passes startDate=today). includePast=true is the only opt-out.
    const includePastParam = searchParams.get('includePast');
    const includePast = includePastParam === 'true' || includePastParam === '1';
    const { fromDate: startDate, excludePastShowtimes } =
      resolveCatalogFromDate({
        startDate: startDateParam || undefined,
        today: todayLocalDate,
        includePast,
      });
    const endDate = endDateParam || twelveMonthsLocalDate;

    const minPriceParam = searchParams.get('minPrice');
    const maxPriceParam = searchParams.get('maxPrice');
    const minPrice =
      minPriceParam !== null && minPriceParam !== ''
        ? Number(minPriceParam)
        : undefined;
    const maxPrice =
      maxPriceParam !== null && maxPriceParam !== ''
        ? Number(maxPriceParam)
        : undefined;
    if (
      (minPrice !== undefined && !Number.isFinite(minPrice)) ||
      (maxPrice !== undefined && !Number.isFinite(maxPrice))
    ) {
      return badRequest('minPrice and maxPrice must be numbers');
    }
    const freeOnlyParam = searchParams.get('freeOnly');
    const freeOnly = freeOnlyParam === 'true' || freeOnlyParam === '1';
    const includeUnknownPriceParam = searchParams.get('includeUnknownPrice');
    const includeUnknownPrice =
      includeUnknownPriceParam !== null
        ? includeUnknownPriceParam === 'true' ||
          includeUnknownPriceParam === '1'
        : true;

    const sort = searchParams.get('sort') || 'date_asc';
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? Number(limitParam) : 50;
    const limit = Math.min(Math.max(parsedLimit || 50, 1), 100);

    const pageParam = searchParams.get('page');
    const parsedPage = pageParam ? Number(pageParam) : 1;
    const page = Math.max(parsedPage || 1, 1);

    const offsetParam = searchParams.get('offset');
    const offset =
      offsetParam !== null && offsetParam !== ''
        ? Math.max(Number(offsetParam) || 0, 0)
        : (page - 1) * limit;

    let supabase;
    try {
      supabase = await createClient();
    } catch {
      const env = getPublicEnv();
      supabase = createServerClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        {
          cookies: {
            getAll: () => [],
            setAll: () => {},
          },
        },
      );
    }
    const catalogRepo = new SupabaseCatalogRepository(supabase);

    const validSorts: EventSortOption[] = [
      'price_asc',
      'price_desc',
      'date_asc',
      'date_desc',
      'title_asc',
      'score_desc',
    ];
    const repoSortBy: EventSortOption =
      sort && validSorts.includes(sort as EventSortOption)
        ? (sort as EventSortOption)
        : 'date_asc';

    const filters: EventListFilters = {
      searchQuery: q,
      venueId,
      venueName,
      city,
      genre,
      fromDate: startDate,
      toDate: endDate,
      minPrice:
        minPrice !== undefined && !Number.isNaN(minPrice)
          ? minPrice
          : undefined,
      maxPrice:
        maxPrice !== undefined && !Number.isNaN(maxPrice)
          ? maxPrice
          : undefined,
      freeOnly: freeOnly || undefined,
      includeUnknownPrice,
      sortBy: repoSortBy,
      limit,
      offset,
      excludePastShowtimes,
      referenceNowIso: nowIso,
    };

    const [events, countResult] = await Promise.all([
      catalogRepo.listEvents(filters),
      typeof catalogRepo.countEvents === 'function'
        ? catalogRepo.countEvents(filters)
        : Promise.resolve(0),
    ]);

    const totalCount = countResult;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const hasMore = offset + events.length < totalCount;
    const currentPage = Math.floor(offset / limit) + 1;

    const pagination = {
      page: currentPage,
      limit,
      totalCount,
      totalPages,
      hasMore,
    };

    const headers = {
      'X-Total-Count': String(totalCount),
      'X-Page': String(currentPage),
      'X-Limit': String(limit),
      'X-Total-Pages': String(totalPages),
      'X-Has-More': String(hasMore),
    };

    if (searchParams.get('format') === 'array') {
      return NextResponse.json(events, { headers });
    }

    return NextResponse.json(
      {
        events,
        pagination,
      },
      { headers },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown catalog search error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
