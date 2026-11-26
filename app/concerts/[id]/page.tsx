import React from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadArtistAffinityResolver } from '@/lib/recommendation/artist-affinity-server';
import {
  annotateEventWithArtistAffinity,
  annotateEventsWithArtistAffinity,
} from '@/lib/recommendation/artist-affinity';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { scoreEventForUser } from '@/lib/recommendation/service';
import { resolveVenueLink } from '@/lib/events/venue-link';
import { isValidSpotifyArtistId } from '@/lib/spotify/embed';
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

  // Verified Spotify id for the headliner (catalog external ids only; never guessed from names),
  // used for the short "Listen" embed on the event page.
  const headlinerArtist =
    eventDetail.artists.find((a) => a.billingPosition === 'headliner') ??
    eventDetail.artists[0];
  let headlinerSpotifyId: string | null = null;
  if (
    headlinerArtist &&
    typeof catalogRepo.findArtistExternalIds === 'function'
  ) {
    try {
      const ids = await catalogRepo.findArtistExternalIds(headlinerArtist.id);
      headlinerSpotifyId =
        ids.find(
          (e) =>
            e.provider === 'spotify' && isValidSpotifyArtistId(e.externalId),
        )?.externalId ?? null;
    } catch {
      headlinerSpotifyId = null;
    }
  }

  const summary: CanonicalEventSummary = {
    id: eventDetail.id,
    title: eventDetail.name,
    venueName: eventDetail.venue?.name || 'Venue TBA',
    venueId: eventDetail.venueId,
    city: eventDetail.venue?.city || eventDetail.city || undefined,
    region: eventDetail.venue?.region || eventDetail.region || undefined,
    // Venue coordinates first (same resolution as the list cards), then the event row.
    lat:
      eventDetail.venue?.lat != null
        ? eventDetail.venue.lat
        : eventDetail.lat != null
          ? Number(eventDetail.lat)
          : null,
    lng:
      eventDetail.venue?.lng != null
        ? eventDetail.venue.lng
        : eventDetail.lng != null
          ? Number(eventDetail.lng)
          : null,
    localStartDate: eventDetail.localStartDate,
    festivalGroupEndDate: eventDetail.festivalGroupEndDate ?? null,
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
      spotifyArtistId:
        a.spotifyArtistId ??
        (headlinerArtist && a.id === headlinerArtist.id
          ? headlinerSpotifyId
          : null),
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
          lat: eventDetail.venue.lat ?? null,
          lng: eventDetail.venue.lng ?? null,
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
  const home = await getHomeLocation(user?.id).catch(() => null);
  let displayEvent: CanonicalEventSummary | ScoredEvent = summary;
  let affinityResolver: Awaited<
    ReturnType<typeof loadArtistAffinityResolver>
  > | null = null;

  if (user) {
    try {
      // Same scoring inputs as the home page / Discover: saved preferences, Spotify listening
      // (artists + genre taste), saved weights and the chosen home city.
      const scored = await scoreEventForUser({
        userId: user.id,
        event: summary,
        client: supabase,
        locationOverride: home ? { lat: home.lat, lng: home.lng } : undefined,
      });
      if (scored) {
        displayEvent = scored;
      }
      affinityResolver = await loadArtistAffinityResolver(
        user.id,
        supabase,
        catalogRepo,
      );
      displayEvent = annotateEventWithArtistAffinity(
        displayEvent,
        affinityResolver,
      );
    } catch (err) {
      console.error(
        '[ConcertDetailPage] Failed to score event against user profile:',
        err,
      );
    }
  }

  let festivalDays: Array<{
    id: string;
    name: string;
    localStartDate: string;
  }> = [];
  try {
    festivalDays = await catalogRepo.listFestivalDays(eventDetail.id);
  } catch {
    festivalDays = [];
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
      if (affinityResolver) {
        relatedEvents = annotateEventsWithArtistAffinity(
          relatedEvents,
          affinityResolver,
        );
      }
    } catch {
      // Ignore related events fetch errors
    }
  }

  const venueLink = resolveVenueLink({
    venueName: eventDetail.venue?.name,
    city: eventDetail.venue?.city ?? eventDetail.city,
    region: eventDetail.venue?.region ?? eventDetail.region,
    venueWebsite: eventDetail.venue?.website,
    sourceUrls: eventDetail.sources.map((s) => s.sourceUrl),
  });

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900">
      <Header isAuthenticated={Boolean(user)} userEmail={user?.email} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <ConcertDetailClient
          event={displayEvent}
          relatedEvents={relatedEvents}
          festivalDays={festivalDays}
          homeLocation={home ? { lat: home.lat, lng: home.lng } : null}
          venueLink={venueLink}
        />
      </main>
    </div>
  );
}
