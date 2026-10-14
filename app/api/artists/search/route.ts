import { type NextRequest, NextResponse } from 'next/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawQuery = searchParams.get('q') || '';
  const rawLimit = searchParams.get('limit');

  const query = rawQuery.trim().slice(0, 100);
  if (!query) {
    return NextResponse.json({ artists: [] });
  }

  const limit = rawLimit
    ? Math.min(Math.max(1, parseInt(rawLimit, 10) || 10), 25)
    : 10;

  try {
    const catalogRepo = new SupabaseCatalogRepository();
    const results = await catalogRepo.searchArtists(query, limit);

    // Sanitize response: return strictly public artist identification
    const sanitized = results.map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl ?? null,
    }));

    return NextResponse.json({ artists: sanitized });
  } catch {
    // If database is offline or query fails, return empty list gracefully
    return NextResponse.json({ artists: [] });
  }
}
