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

export interface ZonedTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dateString: string; // YYYY-MM-DD
}

/**
 * Extracts date and time components in an explicit IANA timezone.
 * Uses Intl.DateTimeFormat to prevent UTC skew and correctly handle DST transitions.
 */
export function getZonedTimeParts(
  date: Date,
  timeZone = 'America/Denver',
): ZonedTimeParts {
  const safeTz = timeZone || 'America/Denver';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
    dateString: `${map.year}-${map.month}-${map.day}`,
  };
}

function addDaysToZonedDate(
  year: number,
  month: number,
  day: number,
  days: number,
): string {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().split('T')[0];
}

export interface WeekendWindowOptions {
  referenceDate?: string;
  referenceInstant?: Date | string;
  timeZone?: string;
}

/**
 * Calculates the calendar date window for "This Weekend" given a reference date or instant.
 *
 * Invariants:
 * 1. Computes local time and weekday using the target IANA timezone (no naive UTC slicing).
 * 2. Friday evening (>= 17:00 local time) through Sunday 23:59:59.999 constitutes the weekend.
 * 3. If today is Mon-Thu in local time, window is the upcoming Friday through Sunday.
 * 4. If today is Friday in local time, window is today through Sunday.
 * 5. If today is Saturday in local time, window includes the active weekend (Friday through Sunday).
 * 6. If today is Sunday in local time, window includes the active weekend (Friday through Sunday).
 * 7. Accommodates daylight-saving transitions (spring forward, fall back) cleanly via IANA calculations.
 */
export function calculateWeekendWindow(
  optionsOrReferenceDate?: WeekendWindowOptions | string,
  legacyInstant?: Date | string,
): { startDate: string; endDate: string } {
  let referenceDate: string | undefined;
  let referenceInstant: Date | string | undefined;
  let timeZone = 'America/Denver';

  if (
    typeof optionsOrReferenceDate === 'object' &&
    optionsOrReferenceDate !== null
  ) {
    referenceDate = optionsOrReferenceDate.referenceDate;
    referenceInstant = optionsOrReferenceDate.referenceInstant;
    if (optionsOrReferenceDate.timeZone) {
      timeZone = optionsOrReferenceDate.timeZone;
    }
  } else {
    referenceDate = optionsOrReferenceDate;
    referenceInstant = legacyInstant;
  }

  let zoned: ZonedTimeParts;

  if (referenceInstant) {
    const d =
      typeof referenceInstant === 'string'
        ? new Date(referenceInstant)
        : referenceInstant;
    zoned = getZonedTimeParts(d, timeZone);
  } else if (referenceDate) {
    const parts = referenceDate.split('-').map(Number);
    // Construct local noon date for the given calendar date to avoid midnight boundary shifts
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 18, 0, 0));
    zoned = getZonedTimeParts(d, timeZone);
    // Explicitly enforce the provided reference date components
    zoned.year = parts[0];
    zoned.month = parts[1];
    zoned.day = parts[2];
    zoned.dateString = referenceDate;
  } else {
    zoned = getZonedTimeParts(new Date(), timeZone);
  }

  // Day of week: 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const { weekday, year, month, day } = zoned;

  let daysToFriday: number;
  let daysToSunday: number;

  if (weekday === 0) {
    // Sunday: active weekend spans from Friday (-2) to today (0)
    daysToFriday = -2;
    daysToSunday = 0;
  } else if (weekday === 6) {
    // Saturday: active weekend spans from Friday (-1) to tomorrow (+1)
    daysToFriday = -1;
    daysToSunday = 1;
  } else if (weekday === 5) {
    // Friday: today through Sunday (+2)
    daysToFriday = 0;
    daysToSunday = 2;
  } else {
    // Monday (1) to Thursday (4): upcoming Friday (5 - weekday) to Sunday (7 - weekday)
    daysToFriday = 5 - weekday;
    daysToSunday = 7 - weekday;
  }

  return {
    startDate: addDaysToZonedDate(year, month, day, daysToFriday),
    endDate: addDaysToZonedDate(year, month, day, daysToSunday),
  };
}

export interface ModeEligibilityContext {
  userProfile?: UserProfile | null;
  artistPreferences?: UserArtistPreference[];
  referenceDate?: string;
  referenceInstant?: Date | string;
  timeZone?: string;
  city?: string;
}

/**
 * Evaluates whether a candidate event qualifies for a specific discovery mode.
 *
 * Invariants:
 * 1. This Weekend: Evaluated in event-local timezone. Friday shows must start at or after 17:00 local time.
 * 2. Cheap & Nearby: Applies $35 price ceiling and 35-mile travel radius by default.
 *    Unknown ticket price or unknown distance NEVER passes as proven qualifying.
 * 3. Worth Planning For: Enforces a minimum 14-day advance planning horizon from reference date.
 *    For authenticated users, prioritizes favorite/liked artists, festivals, or major concerts ($60+).
 *    For guests, permits upcoming festivals or major concerts ($60+) 14+ days in advance.
 */
export function isEventEligibleForMode(
  event: CanonicalEventSummary,
  mode: DiscoveryMode,
  context: ModeEligibilityContext,
): boolean {
  if (mode === 'all') return true;

  if (mode === 'this_weekend') {
    const eventTz = event.timezone || context.timeZone || 'America/Denver';
    const window = calculateWeekendWindow({
      referenceDate: context.referenceDate,
      referenceInstant: context.referenceInstant,
      timeZone: eventTz,
    });

    if (
      event.localStartDate < window.startDate ||
      event.localStartDate > window.endDate
    ) {
      return false;
    }

    // Friday 5 PM (17:00) local cutoff:
    // If show is on Friday, verify it starts at or after 17:00 in event-local timezone.
    if (event.localStartDate === window.startDate) {
      if (event.startsAt && event.startTimePrecision !== 'date_only') {
        const parts = getZonedTimeParts(new Date(event.startsAt), eventTz);
        if (parts.hour < 17) {
          return false;
        }
      }
    }

    return true;
  }

  if (mode === 'cheap_and_nearby') {
    // Budget check: maxNormalTicketPrice (default $35 per Phase 2 spec)
    const budgetCeiling = context.userProfile?.maxNormalTicketPrice ?? 35;

    // Price must be confirmed free or confirmed <= budgetCeiling.
    // Unknown ticket price (null/undefined) CANNOT pass as proven affordable.
    const isFree = event.eventKind === 'free_event';
    const hasKnownPrice =
      event.minPrice !== null && event.minPrice !== undefined;
    const isAffordable =
      isFree || (hasKnownPrice && event.minPrice! <= budgetCeiling);

    if (!isAffordable) return false;

    // Distance check: within preferred travel radius (default 35 miles per Phase 2 spec)
    const radius = context.userProfile?.defaultRadiusMiles ?? 35;

    if (
      context.userProfile?.homeLatApprox != null &&
      context.userProfile?.homeLngApprox != null
    ) {
      // User has configured home coordinates:
      // Unknown event distance (missing event lat/lng) CANNOT pass as proven nearby.
      if (event.lat == null || event.lng == null) {
        return false;
      }
      const dist = calculateHaversineDistanceMiles(
        context.userProfile.homeLatApprox,
        context.userProfile.homeLngApprox,
        event.lat,
        event.lng,
      );
      if (dist > radius) return false;
    } else if (context.city) {
      // User/guest has selected an active city filter: match city
      if (event.city?.toLowerCase() !== context.city.toLowerCase()) {
        return false;
      }
    } else {
      // Guest or unanchored user with no location or city specified:
      // Event must have valid city and coordinates
      if (!event.city) return false;
    }

    return true;
  }

  if (mode === 'worth_planning_for') {
    // Enforce 14-day minimum advance planning horizon from reference date
    let refDateString = context.referenceDate;
    if (!refDateString) {
      const refInst = context.referenceInstant
        ? typeof context.referenceInstant === 'string'
          ? new Date(context.referenceInstant)
          : context.referenceInstant
        : new Date();
      refDateString = getZonedTimeParts(
        refInst,
        event.timezone || 'America/Denver',
      ).dateString;
    }

    const refDateMs = new Date(`${refDateString}T00:00:00Z`).getTime();
    const eventDateMs = new Date(`${event.localStartDate}T00:00:00Z`).getTime();
    const daysInAdvance = Math.round(
      (eventDateMs - refDateMs) / (24 * 60 * 60 * 1000),
    );

    if (daysInAdvance < 14) {
      return false;
    }

    const isFestivalOrSpecial =
      event.eventKind === 'festival' ||
      Boolean(event.eventKind?.includes('festival'));

    const isMajorConcert =
      (event.minPrice !== null &&
        event.minPrice !== undefined &&
        event.minPrice >= 60) ||
      (event.maxPrice !== null &&
        event.maxPrice !== undefined &&
        event.maxPrice >= 75);

    // Authenticated user with explicit artist preferences:
    if (context.artistPreferences && context.artistPreferences.length > 0) {
      const hasFavoriteOrLikedArtist = event.artists?.some((a) => {
        const pref = context.artistPreferences!.find(
          (p) =>
            (a.id && p.artistId === a.id) ||
            p.normalizedArtistName === a.name.trim().toLowerCase(),
        );
        return (
          pref?.preferenceLevel === 'favorite' ||
          pref?.preferenceLevel === 'like'
        );
      });

      return Boolean(
        hasFavoriteOrLikedArtist || isFestivalOrSpecial || isMajorConcert,
      );
    }

    // Guest or user without explicit preferences:
    // Allow major concerts ($60+) and festivals occurring 14+ days in advance
    return Boolean(isFestivalOrSpecial || isMajorConcert);
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
