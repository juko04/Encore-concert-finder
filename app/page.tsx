import React from 'react';
import Link from 'next/link';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import {
  getDiscoverHomeData,
  type DiscoverHomeData,
} from '@/lib/discover/home-data';
import { getDiscoverDateWindows } from '@/lib/discover/dates';
import { getHomeLocation } from '@/lib/location/server';
import { SupabaseProfileRepository } from '@/lib/repositories/profile-repository';
import { Header } from '@/components/index/Header';
import { DiscoverHero, EventRow, VenueChips } from '@/components/discover-home';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getAuthenticatedUser();

  let data: DiscoverHomeData;
  try {
    const supabase = await createClient();
    const catalogRepo = new SupabaseCatalogRepository(supabase);
    const homeLocation = await getHomeLocation();
    let homeRadiusMiles: number | null = null;
    if (user && homeLocation) {
      try {
        homeRadiusMiles =
          (await new SupabaseProfileRepository().getProfile(user.id))
            ?.defaultRadiusMiles ?? null;
      } catch (err) {
        console.error('[HomePage] profile radius load failed:', err);
      }
    }
    data = await getDiscoverHomeData({
      catalogRepo,
      userId: user?.id,
      homeLocation,
      homeRadiusMiles,
    });
  } catch (err) {
    console.error('[HomePage] Error loading discover data:', err);
    data = {
      totalUpcoming: 0,
      rows: [],
      venueChips: [],
      genreChips: [],
      windows: getDiscoverDateWindows(),
    };
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl space-y-10 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <DiscoverHero
          totalUpcoming={data.totalUpcoming}
          windows={data.windows}
          genreChips={data.genreChips}
        />

        {data.rows.length === 0 && (
          <p
            data-testid="discover-empty"
            className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500"
          >
            No upcoming concerts to show right now. Try{' '}
            <Link
              href="/search"
              className="font-semibold text-zinc-800 underline"
            >
              searching the full catalog
            </Link>
            .
          </p>
        )}

        {data.rows.map((row) => (
          <EventRow key={row.id} {...row} />
        ))}

        <VenueChips chips={data.venueChips} />

        <div className="border-t border-zinc-200/80 pt-6 text-center">
          <Link
            href="/search"
            className="inline-flex rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Browse all concerts →
          </Link>
        </div>
      </main>
    </div>
  );
}
