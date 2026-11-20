import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import type {
  EventListFilters,
  EventSortOption,
} from '@/lib/repositories/interfaces';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || undefined;
    const venueId = searchParams.get('venueId')?.trim() || undefined;
    const city = searchParams.get('city')?.trim() || undefined;
    const startDate = searchParams.get('startDate')?.trim() || undefined;
    const endDate = searchParams.get('endDate')?.trim() || undefined;
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
    const freeOnlyParam = searchParams.get('freeOnly');
    const freeOnly = freeOnlyParam === 'true' || freeOnlyParam === '1';

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

    const supabase = await createClient();
    const catalogRepo = new SupabaseCatalogRepository(supabase);

    const repoSortBy: EventSortOption | undefined =
      sort === 'price_asc' || sort === 'score_desc' || sort === 'date_asc'
        ? sort
        : 'date_asc';

    const filters: EventListFilters = {
      searchQuery: q,
      venueId,
      city,
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
      sortBy: repoSortBy,
      limit,
      offset,
    };

    const [rawEvents, countResult] = await Promise.all([
      catalogRepo.listEvents(filters),
      typeof catalogRepo.countEvents === 'function'
        ? catalogRepo.countEvents(filters)
        : Promise.resolve(0),
    ]);

    let events = [...rawEvents];

    // Client price safety filter (also ensures mocks without DB filtering adhere to bounds)
    if (minPrice !== undefined && !Number.isNaN(minPrice)) {
      events = events.filter(
        (e) =>
          e.minPrice !== null &&
          e.minPrice !== undefined &&
          e.minPrice >= minPrice,
      );
    }

    if (maxPrice !== undefined && !Number.isNaN(maxPrice)) {
      events = events.filter(
        (e) =>
          e.minPrice !== null &&
          e.minPrice !== undefined &&
          e.minPrice <= maxPrice,
      );
    }

    if (freeOnly) {
      events = events.filter(
        (e) => e.eventKind === 'free_event' || e.minPrice === 0,
      );
    }

    const totalCount = Math.max(countResult, offset + events.length);

    // Client-requested sorts not handled at repository level
    if (sort === 'date_desc') {
      events.sort(
        (a, b) =>
          b.localStartDate.localeCompare(a.localStartDate) ||
          b.id.localeCompare(a.id),
      );
    } else if (sort === 'price_desc') {
      events.sort((a, b) => {
        const aPrice = a.maxPrice ?? a.minPrice ?? -Infinity;
        const bPrice = b.maxPrice ?? b.minPrice ?? -Infinity;
        return (
          bPrice - aPrice || a.localStartDate.localeCompare(b.localStartDate)
        );
      });
    } else if (sort === 'title_asc') {
      events.sort((a, b) => a.title.localeCompare(b.title));
    }

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
