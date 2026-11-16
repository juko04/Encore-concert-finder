import type { PrototypeEvent, PrototypeUserPreference } from './fixtures';
import type { UserViewMode } from './store';

export interface ComputedSignalScore {
  score: number; // 0 - 100
  isSuppressed: boolean;
  suppressionReason?: string;
  badgeLabel: string;
  badgeColorClass: string;
  matchReason: string;
  affinityType: 'favorite' | 'like' | 'interested' | 'exploratory' | 'disliked';
  breakdown: {
    artistAffinity: number; // 0 - 100
    venueFit: number; // 0 - 100
    priceValue: number; // 0 - 100
    timingConvenience: number; // 0 - 100
  };
}

/**
 * Computes live signal score accounting for current preferences and view mode.
 * Strictly adheres to Invariant 11:
 * Disliked headliner fully suppresses the event (score 0, suppressed).
 * Explicit Favorite headliner yields a top match (95-100).
 */
export function computeSignalScore(
  event: PrototypeEvent,
  preferences: PrototypeUserPreference[],
  viewMode: UserViewMode,
): ComputedSignalScore {
  if (viewMode === 'guest') {
    const score = event.samplePersonalScore.guestScore;
    return {
      score,
      isSuppressed: false,
      badgeLabel: `${score}% Radar`,
      badgeColorClass: 'text-zinc-300 border-zinc-700 bg-zinc-800/80',
      matchReason: 'General curated live-music recommendation (Guest Mode)',
      affinityType: 'exploratory',
      breakdown: {
        artistAffinity: 70,
        venueFit: 78,
        priceValue:
          event.minPrice === 0
            ? 100
            : event.minPrice && event.minPrice <= 25
              ? 90
              : 75,
        timingConvenience: 80,
      },
    };
  }

  // Authenticated Mode: check live user preferences for artists
  const headliner =
    event.artists.find((a) => a.billingPosition === 'headliner') ||
    event.artists[0];
  const headlinerPref = headliner
    ? preferences.find((p) => p.artistId === headliner.id)
    : undefined;

  // Check support artists for ignore
  const supportPrefs = event.artists
    .filter((a) => a.billingPosition !== 'headliner')
    .map((a) => preferences.find((p) => p.artistId === a.id))
    .filter(Boolean) as PrototypeUserPreference[];

  // Invariant 11: Disliked headliner always suppresses the event
  if (headlinerPref?.level === 'ignore') {
    return {
      score: 0,
      isSuppressed: true,
      suppressionReason: `Headliner ${headliner.name} is on your Ignored list`,
      badgeLabel: 'SUPPRESSED',
      badgeColorClass: 'text-rose-400 border-rose-900/60 bg-rose-950/40',
      matchReason: `SUPPRESSED: Headliner artist (${headliner.name}) is on your Ignored list`,
      affinityType: 'disliked',
      breakdown: {
        artistAffinity: 0,
        venueFit: 60,
        priceValue: 50,
        timingConvenience: 60,
      },
    };
  }

  // Favorite headliner: top score
  if (headlinerPref?.level === 'favorite') {
    return {
      score: Math.max(96, event.samplePersonalScore.authenticatedScore),
      isSuppressed: false,
      badgeLabel: '98% FAVORITE',
      badgeColorClass:
        'text-violet-300 border-violet-500/50 bg-violet-950/60 shadow-[0_0_12px_rgba(139,92,246,0.35)]',
      matchReason: `Top Favorite Headliner (${headliner.name}) · High priority signal`,
      affinityType: 'favorite',
      breakdown: {
        artistAffinity: 100,
        venueFit: 92,
        priceValue: event.minPrice === 0 ? 100 : 85,
        timingConvenience: 90,
      },
    };
  }

  // Liked headliner
  if (headlinerPref?.level === 'like') {
    return {
      score: Math.max(88, event.samplePersonalScore.authenticatedScore),
      isSuppressed: false,
      badgeLabel: '90% LIKED',
      badgeColorClass:
        'text-emerald-300 border-emerald-500/40 bg-emerald-950/50',
      matchReason: `Liked Artist (${headliner.name}) in your taste radar`,
      affinityType: 'like',
      breakdown: {
        artistAffinity: 88,
        venueFit: 85,
        priceValue: event.minPrice === 0 ? 100 : 80,
        timingConvenience: 85,
      },
    };
  }

  // Disliked support acts (unless headliner is favorite)
  const hasDislikedSupport = supportPrefs.some((p) => p.level === 'ignore');
  if (hasDislikedSupport) {
    return {
      score: 30,
      isSuppressed: true,
      suppressionReason: 'Lineup contains an artist from your Ignored list',
      badgeLabel: 'SUPPRESSED (SUPPORT)',
      badgeColorClass: 'text-amber-400 border-amber-900/60 bg-amber-950/40',
      matchReason: 'Lineup contains a support artist marked as Ignored',
      affinityType: 'disliked',
      breakdown: {
        artistAffinity: 20,
        venueFit: 70,
        priceValue: 60,
        timingConvenience: 70,
      },
    };
  }

  // Default to the fixture's authenticated score
  const score = event.samplePersonalScore.authenticatedScore;
  let badgeColorClass = 'text-cyan-300 border-cyan-500/40 bg-cyan-950/50';
  let badgeLabel = `${score}% MATCH`;

  if (score >= 90) {
    badgeColorClass =
      'text-violet-300 border-violet-500/50 bg-violet-950/60 shadow-[0_0_12px_rgba(139,92,246,0.3)]';
    badgeLabel = `${score}% TOP MATCH`;
  } else if (score >= 80) {
    badgeColorClass =
      'text-emerald-300 border-emerald-500/40 bg-emerald-950/50';
    badgeLabel = `${score}% STRONG`;
  } else if (score >= 70) {
    badgeColorClass = 'text-amber-300 border-amber-500/40 bg-amber-950/50';
    badgeLabel = `${score}% DISCOVER`;
  }

  return {
    score,
    isSuppressed: false,
    badgeLabel,
    badgeColorClass,
    matchReason: event.samplePersonalScore.matchReason,
    affinityType: event.samplePersonalScore.affinityType,
    breakdown: {
      artistAffinity: score >= 90 ? 92 : score >= 80 ? 80 : 65,
      venueFit: 84,
      priceValue:
        event.minPrice === 0
          ? 100
          : event.minPrice && event.minPrice <= 25
            ? 94
            : 78,
      timingConvenience: 82,
    },
  };
}

export function formatEventPrice(
  minPrice: number | null | undefined,
  maxPrice: number | null | undefined,
  currency?: string | null | undefined,
): string {
  const currencySuffix = currency && currency !== 'USD' ? ` ${currency}` : '';
  if (
    minPrice === 0 &&
    (maxPrice === 0 || maxPrice === null || maxPrice === undefined)
  ) {
    return 'FREE ($0)';
  }
  if (
    (minPrice === null || minPrice === undefined) &&
    (maxPrice === null || maxPrice === undefined)
  ) {
    return 'Price TBA';
  }
  if (minPrice != null && (maxPrice == null || minPrice === maxPrice)) {
    return `$${minPrice}${currencySuffix}`;
  }
  if (minPrice != null && maxPrice != null) {
    return `$${minPrice} – $${maxPrice}${currencySuffix}`;
  }
  return 'Price TBA';
}

export function formatEventDate(dateString: string): {
  dayOfWeek: string;
  monthDay: string;
  year: string;
  relativeLabel?: string;
} {
  // Use UTC year/month/day parsing to avoid time-of-day jumps
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const dayOfWeek = date
    .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const monthDay = date
    .toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase();

  // Specific mock scenario dates
  let relativeLabel: string | undefined;
  if (dateString === '2026-11-13') {
    relativeLabel = 'THIS FRIDAY';
  } else if (dateString === '2026-11-14') {
    relativeLabel = 'THIS SATURDAY';
  } else if (dateString === '2026-11-15') {
    relativeLabel = 'THIS SUNDAY';
  } else if (dateString === '2026-11-19') {
    relativeLabel = 'NEXT THURSDAY';
  } else if (dateString === '2026-12-05') {
    relativeLabel = 'DECEMBER';
  }

  return {
    dayOfWeek,
    monthDay,
    year: String(year),
    relativeLabel,
  };
}
