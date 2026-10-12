import type {
  CandidateArtist,
  CandidateArtistExternalId,
  EventCandidate,
  EventKind,
  StartTimePrecision,
} from '@/lib/domain/event-candidate';
import type { SourceProvenance } from '@/lib/domain/source';
import { normalizeUrl } from '@/lib/domain/value-objects';
import type { TicketmasterEvent } from './types';

export interface TicketmasterParseContext {
  sourceId: string;
  rawIngestId: string;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
}

/**
 * Extracts Spotify artist ID from a Spotify web or open URL.
 * e.g., "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb" -> "4Z8W4fKeB5YxbusRsdQVPb"
 */
function extractSpotifyArtistId(url: string): string | null {
  const match = url.match(/artist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Maps a single Ticketmaster Discovery API Event into a canonical EventCandidate.
 */
export function parseTicketmasterEvent(
  event: TicketmasterEvent,
  context: TicketmasterParseContext,
): EventCandidate {
  // 1. Provenance
  const provenance: SourceProvenance = {
    sourceId: context.sourceId,
    sourceType: 'ticketing',
    acquisitionMethod: 'api',
    sourceUrl: context.sourceUrl,
    sourceEventId: event.id,
    rawIngestId: context.rawIngestId,
    fetchedAt: context.fetchedAt,
    contentHash: context.contentHash,
    parserVersion: context.parserVersion,
    confidence: 0.95,
  };

  // 2. Artists & Billing
  const rawAttractions = event._embedded?.attractions || [];
  const artists: CandidateArtist[] = [];
  const artistNames: string[] = [];

  if (rawAttractions.length > 0) {
    rawAttractions.forEach((attr, index) => {
      artistNames.push(attr.name);

      const externalIds: CandidateArtistExternalId[] = [
        {
          provider: 'ticketmaster',
          externalId: attr.id,
          providerUrl: attr.url || null,
        },
      ];

      // Extract Spotify link if present
      const spotifyLinks = attr.externalLinks?.spotify;
      if (spotifyLinks && spotifyLinks.length > 0 && spotifyLinks[0].url) {
        const spotifyUrl = spotifyLinks[0].url;
        const spotifyId = extractSpotifyArtistId(spotifyUrl);
        if (spotifyId) {
          externalIds.push({
            provider: 'spotify',
            externalId: spotifyId,
            providerUrl: spotifyUrl,
          });
        }
      }

      artists.push({
        name: attr.name,
        billingPosition: index === 0 ? 'headliner' : 'support',
        sortOrder: index,
        externalIds,
      });
    });
  } else {
    // If no attractions are embedded, use the event title as headliner
    artistNames.push(event.name);
    artists.push({
      name: event.name,
      billingPosition: 'headliner',
      sortOrder: 0,
      externalIds: [],
    });
  }

  // 3. Venue Extraction
  const primaryVenue = event._embedded?.venues?.[0];
  const venueName = primaryVenue?.name || 'Unknown Venue';
  const city = primaryVenue?.city?.name?.trim() || undefined;
  const state =
    primaryVenue?.state?.stateCode ||
    primaryVenue?.state?.name?.trim() ||
    undefined;
  const country =
    primaryVenue?.country?.countryCode ||
    primaryVenue?.country?.name?.trim() ||
    undefined;

  // 4. Temporal & Timezone Handling
  const localStartDate = event.dates.start.localDate;
  const localEndDate = event.dates.end?.localDate || localStartDate;
  const timezone =
    event.dates.timezone || primaryVenue?.timezone || 'America/Denver';

  const isTimeUncertain =
    event.dates.start.timeTBA ||
    event.dates.start.noSpecificTime ||
    !event.dates.start.localTime ||
    !event.dates.start.dateTime;

  const startTimePrecision: StartTimePrecision = isTimeUncertain
    ? 'date_only'
    : 'instant';

  const startsAt =
    startTimePrecision === 'instant' ? event.dates.start.dateTime : undefined;

  const endsAt =
    startTimePrecision === 'instant' ? event.dates.end?.dateTime : undefined;

  // 5. Status Mapping
  const rawStatus = event.dates.status?.code?.toLowerCase();
  let status: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' =
    'scheduled';
  if (rawStatus === 'canceled' || rawStatus === 'cancelled') {
    status = 'cancelled';
  } else if (rawStatus === 'postponed') {
    status = 'postponed';
  } else if (rawStatus === 'rescheduled') {
    status = 'rescheduled';
  }

  // 6. Price Extraction
  const priceRange = event.priceRanges?.[0];
  const price = priceRange
    ? {
        min: priceRange.min,
        max: priceRange.max,
        currency: priceRange.currency || 'USD',
      }
    : undefined;

  // 7. Event Kind & Festival Detection
  const isMultiDay = Boolean(
    event.dates.end?.localDate && event.dates.end.localDate !== localStartDate,
  );

  const hasFestivalClassification = event.classifications?.some(
    (c) =>
      c.genre?.name?.toLowerCase().includes('festival') ||
      c.subGenre?.name?.toLowerCase().includes('festival'),
  );

  const isFestival =
    isMultiDay ||
    Boolean(hasFestivalClassification) ||
    event.name.toLowerCase().includes('festival');

  const eventKind: EventKind = isFestival
    ? isMultiDay
      ? 'multi_day_festival'
      : 'festival'
    : 'concert';

  // 8. Normalized Ticket URL
  let ticketUrl: string | undefined = undefined;
  if (event.url) {
    try {
      ticketUrl = normalizeUrl(event.url);
    } catch {
      ticketUrl = event.url;
    }
  }

  return {
    id: crypto.randomUUID(),
    rawIngestId: context.rawIngestId,
    sourceId: context.sourceId,
    sourceEventId: event.id,
    sourceType: 'ticketing',
    provenance,
    title: event.name,
    artistNames,
    artists,
    venueName,
    city,
    state,
    country,
    timezone,
    localStartDate,
    localEndDate,
    startsAt,
    endsAt,
    startTimePrecision,
    ticketUrl,
    price,
    isFestival,
    eventKind,
    confidence: 0.95,
    verificationStatus: 'unverified',
    rawPayload: {
      id: event.id,
      name: event.name,
      url: event.url,
      dates: event.dates,
      status,
      providerStatus: event.dates.status?.code,
    },
  };
}
