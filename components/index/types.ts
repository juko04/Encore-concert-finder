import type {
  CanonicalEventSummary,
  BillingPosition,
  EventStatus,
  EventKind,
  StartTimePrecision,
} from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';

export type IndexInventoryStatus =
  'available' | 'low_inventory' | 'sold_out' | 'cancelled' | 'unknown';

export type IndexMode = 'all' | 'this_weekend' | 'free' | 'recommended';

export type IndexSortBy =
  | 'date_asc'
  | 'date_desc'
  | 'price_asc'
  | 'price_desc'
  | 'match_desc'
  | 'title_asc';

export interface IndexFactorDetail {
  score: number;
  explanation: string;
}

export interface IndexPersonalScore {
  score: number; // 0-100
  isPersonalized: boolean;
  isFavorite?: boolean;
  isDisliked?: boolean;
  isExploratory?: boolean;
  matchReason?: string;
  factors?: {
    artist?: IndexFactorDetail;
    distance?: IndexFactorDetail;
    price?: IndexFactorDetail;
    timing?: IndexFactorDetail;
  };
}

export interface IndexArtistItem {
  id?: string;
  name: string;
  billingPosition: BillingPosition | 'headliner' | 'support' | string;
  spotifyArtistId?: string | null;
  imageUrl?: string | null;
}

export interface IndexTrackPreview {
  title: string;
  duration: string;
  previewUrl?: string;
}

export interface IndexEventItem {
  id: string;
  title: string;
  headlinerName: string;
  artists: IndexArtistItem[];
  venueName: string;
  venueId?: string | null;
  city?: string | null;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  localStartDate: string; // YYYY-MM-DD
  startsAt?: string | null;
  doorTime?: string | null;
  timezone?: string;
  startTimePrecision?: StartTimePrecision;
  status: EventStatus;
  eventKind?: EventKind;
  inventoryStatus: IndexInventoryStatus;
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  ticketUrl?: string | null;
  presaleDate?: string | null;
  genre?: string | null;
  subgenres?: string[];
  ageRestriction?: string | null;
  imageUrl?: string | null;
  venueImageUrl?: string | null;
  ticketRemainingPercent?: number | null;
  posterColor: string;
  posterSecondaryColor: string;
  spotifyPreviewTrack?: IndexTrackPreview | null;
  whyItSuitsYou?: string[];
  considerations?: string[];
  vibeTags?: string[];
  description?: string | null;
  personalScore?: IndexPersonalScore;
  sourceName?: string;

  // Direct scoring convenience fields
  score?: number; // 0 - 100
  scoreExplanation?: string;
  isFavorite?: boolean;
  isDisliked?: boolean;
  isSuppressed?: boolean;
  suppressionReason?: string;
  matchedArtistName?: string;
  isExploratory?: boolean;
  factors?: {
    artist: { score: number; weight?: number; explanation: string };
    distance: { score: number; weight?: number; explanation: string };
    price: { score: number; weight?: number; explanation: string };
    timing: { score: number; weight?: number; explanation: string };
  };
}

export interface IndexFilterState {
  query?: string;
  mode?: IndexMode;
  dateRange?: string; // 'all' | 'today' | 'this_weekend' | 'next_7_days' | 'this_month' | custom YYYY-MM-DD
  maxPrice?: number | null;
  includeFreeOnly?: boolean;
  city?: string;
  venue?: string;
  genre?: string;
  ageRestriction?: string;
  inventoryStatus?: IndexInventoryStatus | 'all';
  sortBy?: IndexSortBy;
  includeSuppressed?: boolean;
}

const PALETTES = [
  { primary: '#4f46e5', secondary: '#7c3aed' }, // indigo -> violet
  { primary: '#059669', secondary: '#0d9488' }, // emerald -> teal
  { primary: '#e11d48', secondary: '#f43f5e' }, // rose -> pink
  { primary: '#d97706', secondary: '#b45309' }, // amber -> bronze
  { primary: '#2563eb', secondary: '#0284c7' }, // blue -> sky
  { primary: '#7c2d12', secondary: '#ea580c' }, // warm terracotta -> orange
  { primary: '#4338ca', secondary: '#6366f1' }, // midnight indigo
  { primary: '#18181b', secondary: '#3f3f46' }, // zinc slate
];

function getDeterministicPalette(key: string): {
  primary: string;
  secondary: string;
} {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTES.length;
  return PALETTES[index];
}

/**
 * Type guard to check if an object is a ScoredEvent
 */
export function isScoredEvent(
  item: CanonicalEventSummary | ScoredEvent | IndexEventItem,
): item is ScoredEvent {
  return (
    typeof item === 'object' &&
    item !== null &&
    'event' in item &&
    'score' in item &&
    'factors' in item
  );
}

/**
 * Type guard to check if an object is already an IndexEventItem
 */
export function isIndexEventItem(
  item: CanonicalEventSummary | ScoredEvent | IndexEventItem,
): item is IndexEventItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'headlinerName' in item &&
    'inventoryStatus' in item &&
    'posterColor' in item
  );
}

/**
 * Normalizes inventory status from various formats
 */
export function resolveInventoryStatus(
  explicitStatus?: string | null,
  eventStatus?: EventStatus,
): IndexInventoryStatus {
  if (eventStatus === 'cancelled') return 'cancelled';

  if (!explicitStatus) {
    return 'unknown';
  }

  const normalized = explicitStatus.toLowerCase().trim();
  if (normalized === 'sold_out') return 'sold_out';
  if (normalized === 'low_inventory') return 'low_inventory';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'unknown') return 'unknown';
  if (normalized === 'available' || normalized === 'presale')
    return 'available';

  return 'unknown';
}

/**
 * Adapts either a CanonicalEventSummary or a ScoredEvent (or prototype object)
 * into a presentation-ready IndexEventItem.
 */
export function toIndexEventItem(
  input: CanonicalEventSummary | ScoredEvent | IndexEventItem,
): IndexEventItem {
  if (isIndexEventItem(input)) {
    return input;
  }

  if (isScoredEvent(input)) {
    const canonical = input.event;
    const palette = getDeterministicPalette(canonical.id || canonical.title);
    const headliner =
      canonical.artists?.find((a) => a.billingPosition === 'headliner') ||
      canonical.artists?.[0];

    const inputAny = input as unknown as Record<string, unknown>;
    const canonicalAny = canonical as unknown as Record<string, unknown>;

    const inventoryStatus = resolveInventoryStatus(
      (inputAny.inventoryStatus as string) ||
        (canonicalAny.inventoryStatus as string) ||
        (canonicalAny.ticketStatus as string),
      canonical.status,
    );

    const personalScore: IndexPersonalScore = {
      score: input.score,
      isPersonalized: true,
      isFavorite: input.matchedArtist?.isFavorite ?? false,
      isDisliked:
        input.isSuppressed || (input.matchedArtist?.isDisliked ?? false),
      isExploratory: input.isExploratory ?? false,
      matchReason: input.explanation,
      factors: {
        artist: {
          score: input.factors.artist.score,
          explanation: input.factors.artist.explanation,
        },
        distance: {
          score: input.factors.distance.score,
          explanation: input.factors.distance.explanation,
        },
        price: {
          score: input.factors.price.score,
          explanation: input.factors.price.explanation,
        },
        timing: {
          score: input.factors.timing.score,
          explanation: input.factors.timing.explanation,
        },
      },
    };

    return {
      id: canonical.id,
      title: canonical.title,
      headlinerName: headliner?.name || canonical.title,
      artists: (canonical.artists || []).map((a) => ({
        id: a.id,
        name: a.name,
        billingPosition: a.billingPosition,
        spotifyArtistId: a.spotifyArtistId,
        imageUrl: (a as { imageUrl?: string | null }).imageUrl ?? null,
      })),
      venueName: canonical.venueName,
      venueId: canonical.venueId,
      city: canonical.city,
      region: canonical.region,
      lat: canonical.lat,
      lng: canonical.lng,
      localStartDate: canonical.localStartDate,
      startsAt: canonical.startsAt,
      doorTime: (canonicalAny.doorTime as string) || null,
      timezone: canonical.timezone,
      startTimePrecision: canonical.startTimePrecision,
      status: canonical.status,
      eventKind: canonical.eventKind,
      inventoryStatus,
      minPrice: canonical.minPrice,
      maxPrice: canonical.maxPrice,
      currency: canonical.currency,
      ticketUrl: canonical.ticketUrl,
      presaleDate: (canonicalAny.presaleDate as string) || null,
      genre:
        (canonicalAny.genre as string) ||
        (canonical.eventKind ? String(canonical.eventKind) : 'Live Music'),
      subgenres: Array.isArray(canonicalAny.subgenres)
        ? (canonicalAny.subgenres as string[])
        : undefined,
      ageRestriction: (canonicalAny.ageRestriction as string) || 'All Ages',
      imageUrl:
        (canonicalAny.imageUrl as string) ||
        (headliner as { imageUrl?: string | null })?.imageUrl ||
        null,
      venueImageUrl:
        ((canonical.venue as { imageUrl?: string | null } | null)
          ?.imageUrl as string) || null,
      ticketRemainingPercent:
        typeof canonicalAny.ticketRemainingPercent === 'number'
          ? canonicalAny.ticketRemainingPercent
          : null,
      posterColor: (canonicalAny.posterColor as string) || palette.primary,
      posterSecondaryColor:
        (canonicalAny.posterSecondaryColor as string) || palette.secondary,
      spotifyPreviewTrack:
        (canonicalAny.spotifyPreviewTrack as IndexTrackPreview) || null,
      whyItSuitsYou: Array.isArray(canonicalAny.whyItSuitsYou)
        ? (canonicalAny.whyItSuitsYou as string[])
        : undefined,
      considerations: Array.isArray(canonicalAny.considerations)
        ? (canonicalAny.considerations as string[])
        : undefined,
      vibeTags: Array.isArray(canonicalAny.vibeTags)
        ? (canonicalAny.vibeTags as string[])
        : undefined,
      description: (canonicalAny.description as string) || null,
      personalScore,
      sourceName: canonical.sourceName,
      score: input.score,
      scoreExplanation: input.explanation,
      isFavorite: input.matchedArtist?.isFavorite ?? false,
      isDisliked:
        input.isSuppressed || (input.matchedArtist?.isDisliked ?? false),
      isSuppressed: input.isSuppressed,
      suppressionReason: input.suppressionReason,
      matchedArtistName: input.matchedArtist?.name,
      isExploratory: input.isExploratory,
      factors: {
        artist: {
          score: input.factors.artist.score,
          weight: input.factors.artist.weight,
          explanation: input.factors.artist.explanation,
        },
        distance: {
          score: input.factors.distance.score,
          weight: input.factors.distance.weight,
          explanation: input.factors.distance.explanation,
        },
        price: {
          score: input.factors.price.score,
          weight: input.factors.price.weight,
          explanation: input.factors.price.explanation,
        },
        timing: {
          score: input.factors.timing.score,
          weight: input.factors.timing.weight,
          explanation: input.factors.timing.explanation,
        },
      },
    };
  }

  // Pure CanonicalEventSummary (or enriched canonical)
  const canonical = input;
  const palette = getDeterministicPalette(canonical.id || canonical.title);
  const headliner =
    canonical.artists?.find((a) => a.billingPosition === 'headliner') ||
    canonical.artists?.[0];

  const canonicalAny = canonical as unknown as Record<string, unknown>;

  const inventoryStatus = resolveInventoryStatus(
    (canonicalAny.inventoryStatus as string) ||
      (canonicalAny.ticketStatus as string),
    canonical.status,
  );

  let personalScore: IndexPersonalScore | undefined;
  if (canonicalAny.samplePersonalScore) {
    const sps = canonicalAny.samplePersonalScore as {
      authenticatedScore?: number;
      guestScore?: number;
      affinityType?: string;
      matchReason?: string;
    };
    personalScore = {
      score: sps.authenticatedScore ?? sps.guestScore ?? 50,
      isPersonalized: sps.authenticatedScore !== undefined,
      isFavorite: sps.affinityType === 'favorite',
      isDisliked: sps.affinityType === 'disliked',
      isExploratory: sps.affinityType === 'exploratory',
      matchReason: sps.matchReason,
    };
  }

  return {
    id: canonical.id,
    title: canonical.title,
    headlinerName: headliner?.name || canonical.title,
    artists: (canonical.artists || []).map((a) => ({
      id: a.id,
      name: a.name,
      billingPosition: a.billingPosition,
      spotifyArtistId: a.spotifyArtistId,
      imageUrl: (a as { imageUrl?: string | null }).imageUrl ?? null,
    })),
    venueName: canonical.venueName,
    venueId: canonical.venueId,
    city: canonical.city,
    region: canonical.region,
    lat: canonical.lat,
    lng: canonical.lng,
    localStartDate: canonical.localStartDate,
    startsAt: canonical.startsAt,
    doorTime: (canonicalAny.doorTime as string) || null,
    timezone: canonical.timezone,
    startTimePrecision: canonical.startTimePrecision,
    status: canonical.status,
    eventKind: canonical.eventKind,
    inventoryStatus,
    minPrice: canonical.minPrice,
    maxPrice: canonical.maxPrice,
    currency: canonical.currency,
    ticketUrl: canonical.ticketUrl,
    presaleDate: (canonicalAny.presaleDate as string) || null,
    genre:
      (canonicalAny.genre as string) ||
      (canonical.eventKind ? String(canonical.eventKind) : 'Live Music'),
    subgenres: Array.isArray(canonicalAny.subgenres)
      ? (canonicalAny.subgenres as string[])
      : undefined,
    ageRestriction: (canonicalAny.ageRestriction as string) || 'All Ages',
    imageUrl:
      (canonicalAny.imageUrl as string) ||
      (headliner as { imageUrl?: string | null })?.imageUrl ||
      null,
    venueImageUrl:
      ((canonical.venue as { imageUrl?: string | null } | null)
        ?.imageUrl as string) || null,
    ticketRemainingPercent:
      typeof canonicalAny.ticketRemainingPercent === 'number'
        ? canonicalAny.ticketRemainingPercent
        : null,
    posterColor: (canonicalAny.posterColor as string) || palette.primary,
    posterSecondaryColor:
      (canonicalAny.posterSecondaryColor as string) || palette.secondary,
    spotifyPreviewTrack:
      (canonicalAny.spotifyPreviewTrack as IndexTrackPreview) || null,
    whyItSuitsYou: Array.isArray(canonicalAny.whyItSuitsYou)
      ? (canonicalAny.whyItSuitsYou as string[])
      : undefined,
    considerations: Array.isArray(canonicalAny.considerations)
      ? (canonicalAny.considerations as string[])
      : undefined,
    vibeTags: Array.isArray(canonicalAny.vibeTags)
      ? (canonicalAny.vibeTags as string[])
      : undefined,
    description: (canonicalAny.description as string) || null,
    personalScore,
    sourceName: canonical.sourceName,
    score: personalScore?.score,
    scoreExplanation: personalScore?.matchReason,
    isFavorite: personalScore?.isFavorite,
    isDisliked: personalScore?.isDisliked,
    isExploratory: personalScore?.isExploratory,
  };
}
