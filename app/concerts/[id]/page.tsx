import React from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { scoreEventForUser } from '@/lib/recommendation/service';
import { getHomeLocation } from '@/lib/location/server';
import { ConcertDetailClient } from '@/components/index/ConcertDetailClient';
import { Header } from '@/components/index/Header';
import type {
  CanonicalEventDetail,
  CanonicalEventSummary,
} from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';

export const dynamic = 'force-dynamic';

interface ConcertDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ConcertDetailPage({
  params,
}: ConcertDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const catalogRepo = new SupabaseCatalogRepository(supabase);

  let eventDetail: CanonicalEventDetail | null = null;
  try {
    eventDetail = await catalogRepo.getEventById(id);
  } catch {
    // Invalid UUID syntax or database error; fall through to slug lookup
  }

  if (!eventDetail) {
    try {
      const { data: slugMatch } = await supabase
        .from('events')
        .select('id')
        .eq('normalized_name', id.toLowerCase())
        .maybeSingle();

      if (slugMatch?.id) {
        eventDetail = await catalogRepo.getEventById(slugMatch.id);
      }
    } catch {
      // Ignore fallback lookup errors
    }
  }

  if (!eventDetail) {
    notFound();
  }

  const primaryTicket =
    eventDetail.ticketLinks.find((tl) => tl.inventoryStatus) ||
    eventDetail.ticketLinks[0];
  const inventoryStatus = primaryTicket?.inventoryStatus ?? 'unknown';

  const summary: CanonicalEventSummary = {
    id: eventDetail.id,
    title: eventDetail.name,
    venueName: eventDetail.venue?.name || 'Venue TBA',
    venueId: eventDetail.venueId,
    city: eventDetail.city || eventDetail.venue?.city || undefined,
    region: eventDetail.region || eventDetail.venue?.region || undefined,
    lat: eventDetail.lat ? Number(eventDetail.lat) : null,
    lng: eventDetail.lng ? Number(eventDetail.lng) : null,
    localStartDate: eventDetail.localStartDate,
    startsAt: eventDetail.startsAt,
    timezone: eventDetail.timezone,
    startTimePrecision: eventDetail.startTimePrecision,
    status: eventDetail.status,
    eventKind: eventDetail.eventKind,
    artists: eventDetail.artists.map((a) => ({
      id: a.id,
      name: a.name,
      billingPosition: a.billingPosition,
      imageUrl: a.imageUrl ?? null,
    })),
    imageUrl: eventDetail.imageUrl ?? null,
    venue: eventDetail.venue
      ? {
          id: eventDetail.venue.id,
          name: eventDetail.venue.name,
          normalizedName: eventDetail.venue.normalizedName ?? '',
          city: eventDetail.venue.city,
          region: eventDetail.venue.region ?? null,
          imageUrl: eventDetail.venue.imageUrl ?? null,
        }
      : null,
    ticketUrl:
      eventDetail.primaryTicketUrl ||
      eventDetail.ticketLinks[0]?.url ||
      eventDetail.officialUrl,
    minPrice: primaryTicket?.minPrice ?? null,
    maxPrice: primaryTicket?.maxPrice ?? null,
    currency: primaryTicket?.currency ?? 'USD',
    inventoryStatus,
    sourceName: eventDetail.sources[0]?.sourceId
      ? 'Official Venue Calendar'
      : undefined,
  };

  const user = await getAuthenticatedUser();
  let displayEvent: CanonicalEventSummary | ScoredEvent = summary;

  if (user) {
    try {
      // Same scoring inputs as the home page / Discover: saved preferences, Spotify listening
      // (artists + genre taste), saved weights and the chosen home city.
      const home = await getHomeLocation(user.id);
      const scored = await scoreEventForUser({
        userId: user.id,
        event: summary,
        client: supabase,
        locationOverride: home ? { lat: home.lat, lng: home.lng } : undefined,
      });
      if (scored) {
        displayEvent = scored;
      }
    } catch (err) {
      console.error(
        '[ConcertDetailPage] Failed to score event against user profile:',
        err,
      );
    }
  }

  let relatedEvents: CanonicalEventSummary[] = [];
  if (eventDetail.venueId) {
    try {
      const venueEvents = await catalogRepo.listEvents({
        venueId: eventDetail.venueId,
        limit: 5,
        excludePastShowtimes: true,
        sortBy: 'date_asc',
      });
      relatedEvents = venueEvents
        .filter((e) => e.id !== eventDetail.id)
        .slice(0, 3);
    } catch {
      // Ignore related events fetch errors
    }
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <ConcertDetailClient
          event={displayEvent}
          relatedEvents={relatedEvents}
        />
      </main>
    </div>
  );
}
