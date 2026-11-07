import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { UserProfile } from '@/lib/domain/profile';
import type { UserArtistPreference } from '@/lib/domain/user-preference';
import { calculateHaversineDistanceMiles } from '@/lib/recommendation/factors/distance';
import type { DiscoveryMode, ScoringWeights } from '@/lib/recommendation/types';

export interface DiscoveryModeConfig {
  id: DiscoveryMode;
  label: string;
  badge: string;
  tagline: string;
  description: string;
  emptyStateHeading: string;
  emptyStateDescription: string;
}

export const DISCOVERY_MODE_CONFIGS: Record<
  DiscoveryMode,
  DiscoveryModeConfig
> = {
  all: {
    id: 'all',
    label: 'All Shows',
    badge: '🌟',
    tagline: 'Personalized live music recommendations',
    description:
      'Concerts and festivals ranked for your taste, travel practicality, and budget.',
    emptyStateHeading:
      'No eligible recommendations with your current preferences',
    emptyStateDescription:
      'We found upcoming events in the catalog, but none currently match your active taste or eligibility thresholds. Try adjusting your travel radius, typical budget, or music taste preferences.',
  },
  this_weekend: {
    id: 'this_weekend',
    label: 'This Weekend',
    badge: '📅',
    tagline: 'Concerts happening soon near you',
    description:
      'Upcoming concerts happening this weekend, emphasizing convenient timing, proximity, and spontaneous affordability.',
    emptyStateHeading: 'No concerts scheduled for this weekend',
    emptyStateDescription:
      'There are no upcoming concerts scheduled in your area this weekend. Try exploring All Shows or check back as weekend dates are added.',
  },
  cheap_and_nearby: {
    id: 'cheap_and_nearby',
    label: 'Cheap & Nearby',
    badge: '🎟️',
    tagline: 'Inexpensive concerts and local club discoveries',
    description:
      'Focus on affordable tickets, clubs, small venues, and emerging artists you might love nearby.',
    emptyStateHeading: 'No inexpensive shows nearby',
    emptyStateDescription:
      'No upcoming concerts match your typical budget and distance radius. Try expanding your travel radius or adjusting your ticket budget.',
  },
  worth_planning_for: {
    id: 'worth_planning_for',
    label: 'Worth Planning For',
    badge: '⭐',
    tagline: 'Major concerts & favorite artists worth the trip',
    description:
      'Future concerts and tour dates featuring your favorite artists, worth additional money, travel, or advance planning.',
    emptyStateHeading: 'No major upcoming shows to plan for',
    emptyStateDescription:
      'No future tour dates found for your favorite artists. Add more artists you love in Music Taste to discover concerts worth traveling for.',
  },
};

export const DISCOVERY_MODES: DiscoveryModeConfig[] = Object.values(
  DISCOVERY_MODE_CONFIGS,
);

export function isValidDiscoveryMode(mode: unknown): mode is DiscoveryMode {
  return (
    typeof mode === 'string' &&
    (mode === 'all' ||
      mode === 'this_weekend' ||
      mode === 'cheap_and_nearby' ||
      mode === 'worth_planning_for')
  );
}

export function normalizeDiscoveryMode(mode?: unknown): DiscoveryMode {
  if (isValidDiscoveryMode(mode)) return mode;
  return 'all';
}

/**
 * Calculates the calendar date window for "This Weekend" given a reference date or instant.
 *
 * Friday, Saturday, and Sunday constitute the weekend.
 * If today is Mon-Thu, the window is the upcoming Friday through Sunday.
 * If today is Friday, today through Sunday.
 * If today is Saturday, today through Sunday.
 * If today is Sunday, today (Sunday).
 */
export function calculateWeekendWindow(
  referenceDate?: string,
  referenceInstant?: Date | string,
): { startDate: string; endDate: string } {
  let now: Date;
  if (referenceInstant) {
    now =
      typeof referenceInstant === 'string'
        ? new Date(referenceInstant)
        : referenceInstant;
  } else if (referenceDate) {
    const parts = referenceDate.split('-').map(Number);
    now = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  } else {
    now = new Date();
  }

  // Day of week: 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const day = now.getUTCDay();

  let daysUntilStart: number;
  let daysUntilEnd: number;

  if (day === 0) {
    // Sunday: window is today
    daysUntilStart = 0;
    daysUntilEnd = 0;
  } else if (day === 5) {
    // Friday: today through Sunday (+2)
    daysUntilStart = 0;
    daysUntilEnd = 2;
  } else if (day === 6) {
    // Saturday: today through Sunday (+1)
    daysUntilStart = 0;
    daysUntilEnd = 1;
  } else {
    // Monday (1) to Thursday (4): upcoming Friday (5 - day) to Sunday (7 - day)
    daysUntilStart = 5 - day;
    daysUntilEnd = 7 - day;
  }

  const start = new Date(now.getTime() + daysUntilStart * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + daysUntilEnd * 24 * 60 * 60 * 1000);

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

export interface ModeEligibilityContext {
  userProfile?: UserProfile | null;
  artistPreferences?: UserArtistPreference[];
  referenceDate?: string;
  referenceInstant?: Date | string;
}

/**
 * Evaluates whether a candidate event qualifies for a specific discovery mode.
 */
export function isEventEligibleForMode(
  event: CanonicalEventSummary,
  mode: DiscoveryMode,
  context: ModeEligibilityContext,
): boolean {
  if (mode === 'all') return true;

  if (mode === 'this_weekend') {
    const window = calculateWeekendWindow(
      context.referenceDate,
      context.referenceInstant,
    );
    return (
      event.localStartDate >= window.startDate &&
      event.localStartDate <= window.endDate
    );
  }

  if (mode === 'cheap_and_nearby') {
    // Budget check: maxNormalTicketPrice (default $60 for user, $40 for guest)
    const budgetCeiling = context.userProfile?.maxNormalTicketPrice ?? 60;
    const isAffordable =
      event.eventKind === 'free_event' ||
      event.minPrice === null ||
      event.minPrice === undefined ||
      event.minPrice <= budgetCeiling;

    if (!isAffordable) return false;

    // Distance check: within default travel radius (default 30 miles)
    if (
      context.userProfile?.homeLatApprox != null &&
      context.userProfile?.homeLngApprox != null &&
      event.lat != null &&
      event.lng != null
    ) {
      const radius = context.userProfile.defaultRadiusMiles ?? 30;
      const dist = calculateHaversineDistanceMiles(
        context.userProfile.homeLatApprox,
        context.userProfile.homeLngApprox,
        event.lat,
        event.lng,
      );
      if (dist > radius) return false;
    }

    return true;
  }

  if (mode === 'worth_planning_for') {
    // Prioritizes favorite/liked artists, festivals, or multi-day shows
    const hasFavoriteOrLikedArtist = event.artists?.some((a) => {
      if (!context.artistPreferences) return false;
      const pref = context.artistPreferences.find(
        (p) =>
          (a.id && p.artistId === a.id) ||
          p.normalizedArtistName === a.name.trim().toLowerCase(),
      );
      return (
        pref?.preferenceLevel === 'favorite' || pref?.preferenceLevel === 'like'
      );
    });

    const isFestivalOrSpecial =
      event.eventKind === 'festival' ||
      Boolean(event.eventKind?.includes('festival'));

    return Boolean(hasFavoriteOrLikedArtist || isFestivalOrSpecial);
  }

  return true;
}

/**
 * Returns scoring weights tuned specifically to emphasize each discovery mode's priorities
 * while respecting the user's active preset when in "All Shows" mode.
 */
export function getModeScoringWeights(
  mode: DiscoveryMode,
  baseWeights: ScoringWeights,
): ScoringWeights {
  switch (mode) {
    case 'this_weekend':
      // Emphasize convenient timing and local proximity
      return { timing: 40, distance: 30, price: 15, artist: 15 };
    case 'cheap_and_nearby':
      // Emphasize low price and proximity, welcoming unfamiliar artists
      return { price: 40, distance: 35, artist: 15, timing: 10 };
    case 'worth_planning_for':
      // Emphasize favorite artists and worthwhile destination shows
      return { artist: 55, price: 15, timing: 15, distance: 15 };
    case 'all':
    default:
      return baseWeights;
  }
}
