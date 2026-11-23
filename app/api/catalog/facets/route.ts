import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@/lib/supabase/server';
import { getPublicEnv } from '@/lib/env/public';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
    const facets = await catalogRepo.getFacets();

    return NextResponse.json(facets, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to load catalog facets: ${message}` },
      { status: 500 },
    );
  }
}
