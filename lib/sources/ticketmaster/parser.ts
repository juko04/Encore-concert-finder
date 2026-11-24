import type {
  CandidateArtist,
  CandidateArtistExternalId,
  CandidatePrice,
  EventCandidate,
  EventKind,
  StartTimePrecision,
} from '@/lib/domain/event-candidate';
import type { SourceProvenance } from '@/lib/domain/source';
import { normalizeUrl } from '@/lib/domain/value-objects';
import type { TicketmasterEvent, TicketmasterImage } from './types';
import {
  extractTicketmasterGenres,
  isNonArtistAttraction,
  splitTicketPackageTitle,
} from './listing-filters';

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

const PREFERRED_IMAGE_WIDTH = 1024;
const MIN_PREFERRED_IMAGE_WIDTH = 640;
const MAX_PREFERRED_IMAGE_WIDTH = 1200;

/**
 * Picks one real, https image rendition from a Ticketmaster `images` array.
 *
 * - Ignores entries without a valid https URL.
 * - Ignores `fallback: true` entries (generic placeholders, not real artwork);
 *   when only fallbacks exist the result is null rather than a stand-in.
 * - Prefers 16:9, then a width within 640-1200px, then the width closest to 1024px.
 * - Deterministic: ties break on URL.
 */
export function selectTicketmasterImage(
  images: TicketmasterImage[] | null | undefined,
): string | null {
  if (!Array.isArray(images)) return null;

  const usable: Array<{ url: string; ratio?: string; width: number }> = [];
  for (const image of images) {
    if (!image || image.fallback === true || typeof image.url !== 'string') {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(image.url.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:') continue;
    usable.push({
      url: parsed.toString(),
      ratio: image.ratio,
      width: typeof image.width === 'number' ? image.width : 0,
    });
  }

  if (usable.length === 0) return null;

  const rank = (img: { ratio?: string; width: number }): number[] => [
    img.ratio === '16_9' ? 0 : 1,
    img.width >= MIN_PREFERRED_IMAGE_WIDTH &&
    img.width <= MAX_PREFERRED_IMAGE_WIDTH
      ? 0
      : 1,
    Math.abs(img.width - PREFERRED_IMAGE_WIDTH),
  ];

  usable.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return a.url.localeCompare(b.url);
  });

  return usable[0].url;
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

  const ticketPackage = splitTicketPackageTitle(event.name);
  const eventGenres = extractTicketmasterGenres(event.classifications);

  // 2. Artists & Billing
  // Seat/VIP/parking products and the venue itself are listed as "attractions" but are not
  // performers: never turn them into artists ("Club Level Seating: Ball Arena").
  const listedVenueName = event._embedded?.venues?.[0]?.name?.trim() || '';
  const rawAttractions = (event._embedded?.attractions || []).filter(
    (attr) => !isNonArtistAttraction(attr.name, listedVenueName),
  );
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

      // Image belongs to this attraction only (never matched by name).
      const artistImageUrl = selectTicketmasterImage(attr.images);

      // Genres Ticketmaster assigns to this performer (never guessed when absent).
      const artistGenres = extractTicketmasterGenres(attr.classifications);

      artists.push({
        name: attr.name,
        billingPosition: 'unknown',
        sortOrder: index,
        externalIds,
        ...(artistImageUrl ? { imageUrl: artistImageUrl } : {}),
        ...(artistGenres.length > 0 ? { genres: artistGenres } : {}),
      });
    });
  }
  // If no attractions are embedded, do not substitute event title as a fake artist.
  // artistNames and artists remain empty arrays.

  // 3. Venue Extraction
  const primaryVenue = event._embedded?.venues?.[0];
  const venueName = primaryVenue?.name?.trim() || '';
  const city = primaryVenue?.city?.name?.trim() || undefined;
  const state =
    primaryVenue?.state?.stateCode?.trim() ||
    primaryVenue?.state?.name?.trim() ||
    undefined;
  const country =
    primaryVenue?.country?.countryCode?.trim() ||
    primaryVenue?.country?.name?.trim() ||
    undefined;

  // 3b. Source-supplied images (null when Ticketmaster provides no real image)
  const eventImageUrl = selectTicketmasterImage(event.images);
  const venueImageUrl = selectTicketmasterImage(primaryVenue?.images);

  // 4. Temporal & Timezone Handling
  const localStartDate = event.dates.start.localDate;
  const localEndDate = event.dates.end?.localDate || localStartDate;
  const timezone = event.dates.timezone || primaryVenue?.timezone || undefined;

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

  // 6. Price & Fee Extraction
  // Note: Discovery API v2 priceRanges contains min, max, currency, and type.
  // Fee breakdowns are not provided at Discovery tier; fee status is tracked explicitly.
  const priceRange = event.priceRanges?.[0];
  const isFree =
    priceRange && priceRange.min === 0 && priceRange.max === 0
      ? true
      : undefined;

  // Extract all-inclusive pricing flag if verified in provider payload
  let allInclusivePricing: boolean | undefined = undefined;
  if (typeof event.allInclusivePricing === 'boolean') {
    allInclusivePricing = event.allInclusivePricing;
  } else if (
    typeof event.allInclusivePricing === 'object' &&
    event.allInclusivePricing !== null &&
    typeof event.allInclusivePricing.enabled === 'boolean'
  ) {
    allInclusivePricing = event.allInclusivePricing.enabled;
  } else if (typeof event.ticketing?.allInclusivePricing === 'boolean') {
    allInclusivePricing = event.ticketing.allInclusivePricing;
  } else if (
    typeof event.ticketing?.allInclusivePricing === 'object' &&
    event.ticketing.allInclusivePricing !== null &&
    typeof event.ticketing.allInclusivePricing.enabled === 'boolean'
  ) {
    allInclusivePricing = event.ticketing.allInclusivePricing.enabled;
  }

  const feeStatus: 'all_inclusive' | 'fees_excluded' | 'unknown' =
    allInclusivePricing === true
      ? 'all_inclusive'
      : allInclusivePricing === false
        ? 'fees_excluded'
        : 'unknown';

  const price: CandidatePrice | undefined = priceRange
    ? {
        min: priceRange.min,
        max: priceRange.max,
        currency: priceRange.currency || undefined,
        feeStatus,
        ...(isFree !== undefined ? { isFree } : {}),
      }
    : undefined;

  // Extract ticketing status if present
  let ticketingStatus: string | undefined = undefined;
  if (typeof event.ticketing?.status === 'string') {
    ticketingStatus = event.ticketing.status;
  } else if (
    typeof event.ticketing?.status === 'object' &&
    event.ticketing.status !== null &&
    typeof event.ticketing.status.code === 'string'
  ) {
    ticketingStatus = event.ticketing.status.code;
  }

  // Derive inventory status from dates status and ticketing status
  const statusCode = event.dates.status?.code?.toLowerCase();
  const ticketingCode = ticketingStatus?.toLowerCase();

  let inventoryStatus:
    'available' | 'low_inventory' | 'sold_out' | 'cancelled' | 'unknown' =
    'unknown';

  if (statusCode === 'canceled' || statusCode === 'cancelled') {
    inventoryStatus = 'cancelled';
  } else if (
    statusCode === 'sold_out' ||
    statusCode === 'soldout' ||
    ticketingCode === 'sold_out' ||
    ticketingCode === 'soldout'
  ) {
    inventoryStatus = 'sold_out';
  } else {
    // Note: statusCode === 'onsale' indicates an active onsale window, not proof of remaining inventory
    inventoryStatus = 'unknown';
  }

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

  // 9. Incomplete Observation Evaluation
  const reviewReasons: string[] = [];
  if (!venueName) {
    reviewReasons.push('missing_venue_identity');
  }
  if (!city) {
    reviewReasons.push('missing_venue_locality');
  }
  if (artists.length === 0) {
    reviewReasons.push('missing_artist_identity');
  }
  if (!timezone) {
    reviewReasons.push('missing_or_invalid_timezone');
  }

  const isComplete = reviewReasons.length === 0;

  return {
    id: crypto.randomUUID(),
    rawIngestId: context.rawIngestId,
    sourceId: context.sourceId,
    sourceEventId: event.id,
    sourceType: 'ticketing',
    provenance,
    // "Club Level Seating: Nickelback" is a seat package for the show "Nickelback": the package
    // prefix is never part of the show title (rawPayload.name keeps the original).
    title: ticketPackage.baseTitle || event.name,
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
    inventoryStatus,
    isFestival,
    eventKind,
    confidence: isComplete ? 0.95 : 0.5,
    verificationStatus: 'unverified',
    resolutionStatus: isComplete ? undefined : 'needs_review',
    resolutionProvenance:
      reviewReasons.length > 0 ? { reasons: reviewReasons } : undefined,
    rawPayload: {
      id: event.id,
      name: event.name,
      ...(ticketPackage.isPackage ? { isTicketPackage: true } : {}),
      ...(eventGenres.length > 0 ? { genres: eventGenres } : {}),
      url: event.url,
      dates: event.dates,
      status,
      providerStatus: event.dates.status?.code,
      reviewReasons: reviewReasons.length > 0 ? reviewReasons : undefined,
      allInclusivePricing,
      ticketingStatus,
      ticketing: event.ticketing,
      priceRanges: event.priceRanges,
      feeStatus,
      ...(eventImageUrl || venueImageUrl
        ? {
            images: {
              source: 'ticketmaster',
              eventImageUrl,
              venueImageUrl,
            },
          }
        : {}),
    },
  };
}

/**
 * Overlays freshly parsed source images onto a previously persisted (immutable)
 * candidate, in memory only, so already-ingested events can be backfilled with
 * images on re-processing. Nothing is written back to the stored candidate row.
 * Artist images are matched only by Ticketmaster attraction id, never by name.
 */
export function overlayTicketmasterImages<T extends EventCandidate>(
  existing: T,
  parsed: EventCandidate,
): T {
  const parsedImages = parsed.rawPayload?.images;
  const parsedGenres = parsed.rawPayload?.genres;
  const parsedIsPackage = parsed.rawPayload?.isTicketPackage === true;

  const tmId = (a: CandidateArtist) =>
    a.externalIds?.find((e) => e.provider === 'ticketmaster')?.externalId;
  const imageByAttractionId = new Map<string, string>();
  const genresByAttractionId = new Map<string, string[]>();
  const parsedAttractionIds = new Set<string>();
  for (const a of parsed.artists ?? []) {
    const id = tmId(a);
    if (!id) continue;
    parsedAttractionIds.add(id);
    if (a.imageUrl) imageByAttractionId.set(id, a.imageUrl);
    if (a.genres && a.genres.length > 0) genresByAttractionId.set(id, a.genres);
  }

  // Stored candidates may pre-date listing hygiene: performers that are really seat packages or
  // the venue itself are dropped from the in-memory view (same rule the parser applies).
  const isStale = (a: CandidateArtist) =>
    isNonArtistAttraction(a.name, existing.venueName);
  const hasStaleAttractions = (existing.artists ?? []).some(isStale);

  if (
    !parsedImages &&
    !parsedGenres &&
    !parsedIsPackage &&
    imageByAttractionId.size === 0 &&
    genresByAttractionId.size === 0 &&
    !hasStaleAttractions
  ) {
    return existing;
  }

  const keptArtists = (existing.artists ?? []).filter((a) => !isStale(a));
  const keptNames = new Set(keptArtists.map((a) => a.name));

  return {
    ...existing,
    title: parsedIsPackage ? parsed.title : existing.title,
    artistNames: hasStaleAttractions
      ? existing.artistNames.filter((n) => keptNames.has(n))
      : existing.artistNames,
    rawPayload: {
      ...(existing.rawPayload ?? {}),
      ...(parsedImages ? { images: parsedImages } : {}),
      ...(parsedGenres ? { genres: parsedGenres } : {}),
      ...(parsedIsPackage ? { isTicketPackage: true } : {}),
    },
    artists: keptArtists.map((a) => {
      const id = tmId(a);
      const imageUrl = id ? imageByAttractionId.get(id) : undefined;
      const genres = id ? genresByAttractionId.get(id) : undefined;
      if (!imageUrl && !genres) return a;
      return {
        ...a,
        ...(imageUrl ? { imageUrl } : {}),
        ...(genres ? { genres } : {}),
      };
    }),
  };
}
