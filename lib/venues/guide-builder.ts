/**
 * Decision guide builder.
 *
 * Produces the "why this suits you" and "what to consider" lists for an event
 * from REAL data only:
 *  - the scored event's own explanation/factors (when the user is personalised)
 *  - facts about the show itself (free, start time, status, listed openers)
 *  - researched, source-backed venue facts (see ./data/venue-guides.json)
 * Nothing is invented; when nothing is known the guide says so.
 */

import { VENUE_GUIDES_RESEARCHED_ON, formatResearchedOn } from './guides';
import { matchVenueGuide } from './matcher';
import type { VenueGuideItem, VenueGuideMatch } from './types';

export type GuideEvidence = 'official' | 'community' | 'event' | 'profile';

export interface GuideBullet {
  text: string;
  evidence: GuideEvidence;
  sourceUrls: string[];
}

interface FactorLike {
  score: number;
  explanation?: string | null;
}

/** Structural subset of IndexEventItem the guide needs. */
export interface DecisionGuideEventInput {
  venueName?: string | null;
  city?: string | null;
  region?: string | null;
  localStartDate?: string | null;
  startsAt?: string | null;
  timezone?: string | null;
  startTimePrecision?: string | null;
  eventKind?: string | null;
  status?: string | null;
  inventoryStatus?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  headlinerName?: string | null;
  artists?: Array<{ name: string; billingPosition?: string | null }>;
  whyItSuitsYou?: string[];
  considerations?: string[];
  isSuppressed?: boolean;
  suppressionReason?: string | null;
  isExploratory?: boolean;
  personalScore?: {
    isPersonalized?: boolean;
    isDisliked?: boolean;
    isExploratory?: boolean;
    factors?: {
      artist?: FactorLike;
      distance?: FactorLike;
      price?: FactorLike;
    };
  } | null;
}

export interface DecisionGuideResult {
  whyTitle: string;
  why: GuideBullet[];
  consider: GuideBullet[];
  /** Shown when the "why" column would otherwise be empty. */
  whyEmptyMessage: string | null;
  venue: {
    name: string;
    kind: VenueGuideMatch['kind'];
    confidence: 'high' | 'medium' | 'low';
  } | null;
  /** Shown when there is no guide for this venue. */
  fallbackNote: string | null;
  /** Shown for low-confidence guides. */
  confidenceNote: string | null;
  researchedOnLabel: string | null;
  /** Unique source URLs behind the venue-derived bullets that are shown. */
  sources: string[];
}

export const MAX_WHY = 4;
export const MAX_CONSIDER = 5;

const FALLBACK_NOTE =
  "We don't have a detailed guide for this venue yet — check the venue's site for age policy, doors and parking.";
const LOW_CONFIDENCE_NOTE =
  'Limited verified information for this venue — confirm age policy, doors and parking with the venue before you go.';

// Items that rest on a single anecdote add noise, not guidance.
const ANECDOTAL = /\b(one reviewer|a reviewer|single reviewer|anecdotal)\b/i;
const ALREADY_HEDGED =
  /\b(reviewers?|reported|reports?|community|according to|said|says?|described|called|mention(?:ed|s)?|praise[sd]?)\b/i;
const NEUTRAL_EXPLANATION =
  /\b(neutral|unavailable|unknown|tba|not available)\b/i;

function hedgeCommunity(text: string): string {
  return ALREADY_HEDGED.test(text) ? text : `Community reports: ${text}`;
}

function venueBullets(items: VenueGuideItem[]): GuideBullet[] {
  const usable = items.filter((item) => !ANECDOTAL.test(item.text));
  const official = usable.filter((item) => item.evidence === 'official');
  const community = usable.filter((item) => item.evidence === 'community');
  return [...official, ...community].map((item) => ({
    text: item.evidence === 'community' ? hedgeCommunity(item.text) : item.text,
    evidence: item.evidence,
    sourceUrls: item.sourceUrls,
  }));
}

interface LocalTime {
  minutes: number; // minutes after local midnight
  label: string; // e.g. "9:30 PM"
  weekday: string; // e.g. "Friday"
}

function localTime(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  precision: string | null | undefined,
): LocalTime | null {
  if (!startsAt || !timezone) return null;
  if (precision && precision !== 'instant') return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return {
      minutes: hour * 60 + minute,
      label: `${hour12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`,
      weekday: get('weekday'),
    };
  } catch {
    return null; // invalid timezone: say nothing rather than guess
  }
}

function usableFactor(
  factor: FactorLike | undefined,
  minScore: number,
): string | null {
  if (!factor || typeof factor.score !== 'number') return null;
  if (factor.score < minScore) return null;
  const text = factor.explanation?.trim();
  if (!text || NEUTRAL_EXPLANATION.test(text)) return null;
  return text;
}

function dedupe(bullets: GuideBullet[]): GuideBullet[] {
  const seen = new Set<string>();
  return bullets.filter((bullet) => {
    const key = bullet.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildDecisionGuide(
  event: DecisionGuideEventInput,
): DecisionGuideResult {
  const match = matchVenueGuide({
    venueName: event.venueName,
    city: event.city,
    region: event.region,
  });
  const guide = match?.guide ?? null;
  const time = localTime(
    event.startsAt,
    event.timezone,
    event.startTimePrecision,
  );
  const personal = event.personalScore;
  const isPersonalized = Boolean(personal?.isPersonalized);
  const isDisliked = Boolean(personal?.isDisliked || event.isSuppressed);
  const isFree = event.eventKind === 'free_event';

  // ---------- Why ----------
  const supplied: GuideBullet[] = (event.whyItSuitsYou ?? [])
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => ({ text: text.trim(), evidence: 'event', sourceUrls: [] }));

  const personalBullets: GuideBullet[] = [];
  if (isPersonalized && !isDisliked) {
    const artist = usableFactor(personal?.factors?.artist, 60);
    if (artist) {
      personalBullets.push({
        text: artist,
        evidence: 'profile',
        sourceUrls: [],
      });
    } else if (personal?.isExploratory ?? event.isExploratory) {
      personalBullets.push({
        text: 'New to your taste profile — a discovery pick rather than a familiar favorite.',
        evidence: 'profile',
        sourceUrls: [],
      });
    }
    const distance = usableFactor(personal?.factors?.distance, 70);
    if (distance) {
      personalBullets.push({
        text: distance,
        evidence: 'profile',
        sourceUrls: [],
      });
    }
    if (!isFree) {
      const price = usableFactor(personal?.factors?.price, 75);
      if (price) {
        personalBullets.push({
          text: price,
          evidence: 'profile',
          sourceUrls: [],
        });
      }
    }
  }

  const showFacts: GuideBullet[] = [];
  if (isFree) {
    showFacts.push({
      text: 'Free admission — listed as a free event.',
      evidence: 'event',
      sourceUrls: [],
    });
  }
  const headliner = event.headlinerName?.trim().toLowerCase();
  const others = (event.artists ?? []).filter(
    (artist) =>
      artist.billingPosition !== 'headliner' &&
      artist.name.trim().toLowerCase() !== headliner,
  );
  if (others.length > 0) {
    const names = others.slice(0, 3).map((artist) => artist.name);
    const extra = others.length - names.length;
    showFacts.push({
      text: `Also on the bill: ${names.join(', ')}${extra > 0 ? ` and ${extra} more` : ''}.`,
      evidence: 'event',
      sourceUrls: [],
    });
  }
  if (
    time &&
    (time.weekday === 'Friday' || time.weekday === 'Saturday') &&
    time.minutes >= 17 * 60
  ) {
    showFacts.push({
      text: `${time.weekday}-night show (${time.label}).`,
      evidence: 'event',
      sourceUrls: [],
    });
  }

  const venueWhy = guide ? venueBullets(guide.whyPeopleLikeIt) : [];

  // Slots: supplied + personal first (max 2 together beyond supplied), one
  // show fact, then venue facts fill the rest.
  const topPersonal = [...supplied, ...personalBullets].slice(0, 2);
  const topShow = showFacts.slice(0, 1);
  const why = dedupe([...topPersonal, ...topShow]);
  const room = Math.max(MAX_WHY - why.length, 0);
  const whyFinal = dedupe([...why, ...venueWhy.slice(0, room)]).slice(
    0,
    MAX_WHY,
  );

  // ---------- Consider ----------
  const critical: GuideBullet[] = [];
  if (event.status === 'cancelled' || event.inventoryStatus === 'cancelled') {
    critical.push({
      text: 'This show is listed as cancelled — check the ticket source before making plans.',
      evidence: 'event',
      sourceUrls: [],
    });
  } else if (event.inventoryStatus === 'sold_out') {
    critical.push({
      text: 'Listed as sold out on the ticket source — check the ticket link for updates.',
      evidence: 'event',
      sourceUrls: [],
    });
  } else if (event.inventoryStatus === 'low_inventory') {
    critical.push({
      text: 'The ticket source reports limited availability.',
      evidence: 'event',
      sourceUrls: [],
    });
  }
  if (isDisliked && event.suppressionReason) {
    critical.push({
      text: event.suppressionReason,
      evidence: 'profile',
      sourceUrls: [],
    });
  }
  if (match?.kind === 'sub-space' && guide) {
    critical.push({
      text: `This listing is for a different space than the main room; the venue notes below describe ${guide.name} and may not apply exactly.`,
      evidence: 'event',
      sourceUrls: [],
    });
  }

  const timing: GuideBullet[] = [];
  if (time && time.minutes >= 21 * 60 + 30) {
    timing.push({
      text: `Late start: listed at ${time.label}, so plan your ride home.`,
      evidence: 'event',
      sourceUrls: [],
    });
  } else if (time && time.minutes < 17 * 60 + 30) {
    timing.push({
      text: `Early start: listed at ${time.label}.`,
      evidence: 'event',
      sourceUrls: [],
    });
  }

  const suppliedConsider: GuideBullet[] = (event.considerations ?? [])
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => ({ text: text.trim(), evidence: 'event', sourceUrls: [] }));

  const venueConsider = guide
    ? venueBullets(guide.considerBeforeAttending)
    : [];

  const priceUnknown: GuideBullet[] = [];
  const hasPrice =
    typeof event.minPrice === 'number' || typeof event.maxPrice === 'number';
  const eventLevel = [...critical, ...suppliedConsider, ...timing];
  if (!guide && !hasPrice && !isFree) {
    priceUnknown.push({
      text: "Ticket price isn't listed in our data — check the ticket page before you go.",
      evidence: 'event',
      sourceUrls: [],
    });
  }

  const consider = dedupe([
    ...eventLevel,
    ...venueConsider,
    ...(eventLevel.length + venueConsider.length < 2 ? priceUnknown : []),
  ]).slice(0, MAX_CONSIDER);

  // ---------- Titles, notes, sources ----------
  const hasPersonalReasons =
    isPersonalized && whyFinal.some((bullet) => bullet.evidence === 'profile');
  const whyTitle = hasPersonalReasons
    ? 'Why This Suits You'
    : venueWhy.length > 0
      ? 'Why people like this venue'
      : 'Highlights';

  const whyEmptyMessage =
    whyFinal.length > 0
      ? null
      : isPersonalized
        ? 'No standout match signals for this show yet.'
        : 'Sign in and add favorite artists to see personalized reasons here.';

  const sources = Array.from(
    new Set([...whyFinal, ...consider].flatMap((bullet) => bullet.sourceUrls)),
  );

  return {
    whyTitle,
    why: whyFinal,
    consider,
    whyEmptyMessage,
    venue: guide
      ? { name: guide.name, kind: match!.kind, confidence: guide.confidence }
      : null,
    fallbackNote: guide ? null : FALLBACK_NOTE,
    confidenceNote: guide?.confidence === 'low' ? LOW_CONFIDENCE_NOTE : null,
    researchedOnLabel: guide
      ? formatResearchedOn(VENUE_GUIDES_RESEARCHED_ON)
      : null,
    sources,
  };
}
