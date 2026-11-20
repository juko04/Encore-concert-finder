import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || undefined;
    const venueId = searchParams.get('venueId') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
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
    const sort = searchParams.get('sort') || 'date_asc';
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? Number(limitParam) : 100;
    const limit = Math.min(Math.max(parsedLimit || 100, 1), 300);

    const supabase = await createClient();
    const catalogRepo = new SupabaseCatalogRepository(supabase);

    const events = await catalogRepo.listEvents({
      searchQuery: q,
      venueId,
      fromDate: startDate,
      toDate: endDate,
      limit,
    });

    let filtered: CanonicalEventSummary[] = events;

    if (minPrice !== undefined && !Number.isNaN(minPrice)) {
      filtered = filtered.filter(
        (e) =>
          e.minPrice !== null &&
          e.minPrice !== undefined &&
          e.minPrice >= minPrice,
      );
    }

    if (maxPrice !== undefined && !Number.isNaN(maxPrice)) {
      filtered = filtered.filter(
        (e) =>
          e.minPrice !== null &&
          e.minPrice !== undefined &&
          e.minPrice <= maxPrice,
      );
    }

    if (sort === 'date_desc') {
      filtered.sort(
        (a, b) =>
          b.localStartDate.localeCompare(a.localStartDate) ||
          b.id.localeCompare(a.id),
      );
    } else if (sort === 'price_asc') {
      filtered.sort((a, b) => {
        const aPrice = a.minPrice ?? Infinity;
        const bPrice = b.minPrice ?? Infinity;
        return (
          aPrice - bPrice || a.localStartDate.localeCompare(b.localStartDate)
        );
      });
    } else if (sort === 'price_desc') {
      filtered.sort((a, b) => {
        const aPrice = a.maxPrice ?? a.minPrice ?? -Infinity;
        const bPrice = b.maxPrice ?? b.minPrice ?? -Infinity;
        return (
          bPrice - aPrice || a.localStartDate.localeCompare(b.localStartDate)
        );
      });
    } else if (sort === 'title_asc') {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      // date_asc (default)
      filtered.sort(
        (a, b) =>
          a.localStartDate.localeCompare(b.localStartDate) ||
          a.id.localeCompare(b.id),
      );
    }

    return NextResponse.json(filtered);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown catalog search error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
