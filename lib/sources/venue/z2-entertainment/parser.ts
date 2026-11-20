import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type {
  CandidateArtist,
  CandidatePrice,
  EventCandidate,
  StartTimePrecision,
} from '@/lib/domain/event-candidate';
import type { SourceProvenance } from '@/lib/domain/source';
import { normalizeUrl } from '@/lib/domain/value-objects';
import {
  localDateTimeToUtcInstant,
  parseDateString,
  parseTimeText,
} from '../date-time';
import {
  Z2_KNOWN_VENUES,
  type Z2ParseContext,
  type Z2RawArtist,
  type Z2RawEvent,
  type Z2VenueMapping,
} from './types';

/**
 * Resolves a venue name to authoritative Z2 venue metadata (Boulder Theater, Fox Theatre, Aggie Theatre, Chautauqua).
 */
export function resolveZ2Venue(
  rawVenueText?: string | null,
): Z2VenueMapping | { venueName: string } {
  if (!rawVenueText || !rawVenueText.trim()) {
    return { venueName: 'Unknown Venue' };
  }

  const cleaned = rawVenueText
    .toLowerCase()
    .replace(/[’'–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Direct and normalized lookup
  if (Z2_KNOWN_VENUES[cleaned]) {
    return Z2_KNOWN_VENUES[cleaned];
  }

  // 2. Alias matching
  if (
    cleaned.includes('boulder theater') ||
    cleaned.includes('boulder theatre') ||
    cleaned.includes('bouldertheater')
  ) {
    return Z2_KNOWN_VENUES['boulder theater'];
  }

  if (
    cleaned.includes('fox theatre') ||
    cleaned.includes('fox theater') ||
    cleaned.includes('the fox') ||
    cleaned === 'fox'
  ) {
    return Z2_KNOWN_VENUES['fox theatre'];
  }

  if (
    cleaned.includes('aggie theatre') ||
    cleaned.includes('aggie theater') ||
    cleaned.includes('the aggie') ||
    cleaned === 'aggie'
  ) {
    return Z2_KNOWN_VENUES['aggie theatre'];
  }

  if (
    cleaned.includes('chautauqua') ||
    cleaned.includes('chautauqua auditorium')
  ) {
    return Z2_KNOWN_VENUES['chautauqua auditorium'];
  }

  return { venueName: rawVenueText.trim() };
}

/**
 * Parses headliner and support acts from title and/or dedicated support elements.
 */
export function parseZ2Artists(
  rawTitle: string,
  rawSupport?: string | null,
): {
  cleanTitle: string;
  artists: CandidateArtist[];
  rawArtists: Z2RawArtist[];
} {
  const title = rawTitle
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();

  let headlinerPart = title;
  const supportNames: string[] = [];

  // 1. Check if title contains "w/", "with", "ft.", "feat."
  const withMatch = title.match(/^(.*?)\s+(?:w\/|with)\s+(.*)$/i);
  if (withMatch) {
    headlinerPart = withMatch[1].trim();
    const inlineSupport = withMatch[2].trim();
    if (inlineSupport) {
      const parts = inlineSupport
        .split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*|\s*\/\s*/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      supportNames.push(...parts);
    }
  }

  // Check feat/ft in headliner part
  const featMatch = headlinerPart.match(
    /^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i,
  );
  if (featMatch) {
    headlinerPart = featMatch[1].trim();
    const featured = featMatch[2].trim();
    if (featured) {
      supportNames.unshift(featured);
    }
  }

  // 2. If separate support element was provided, extract support acts
  if (rawSupport && rawSupport.trim()) {
    let cleanSupport = rawSupport.trim();
    cleanSupport = cleanSupport.replace(/^(?:w\/|with|support:|plus)\s*/i, '');
    const parts = cleanSupport
      .split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*|\s*\/\s*/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const p of parts) {
      if (!supportNames.includes(p)) {
        supportNames.push(p);
      }
    }
  }

  const cleanTitle = headlinerPart || title;
  const artists: CandidateArtist[] = [];
  const rawArtists: Z2RawArtist[] = [];

  if (cleanTitle) {
    artists.push({
      name: cleanTitle,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
    rawArtists.push({
      name: cleanTitle,
      billingPosition: 'headliner',
      position: 0,
    });
  }

  supportNames.forEach((name, index) => {
    artists.push({
      name,
      billingPosition: 'support',
      sortOrder: index + 2,
    });
    rawArtists.push({
      name,
      billingPosition: 'support',
      position: index + 1,
    });
  });

  return { cleanTitle, artists, rawArtists };
}

/**
 * Standardizes date text into local calendar date (YYYY-MM-DD).
 */
export function parseZ2Date(dateText?: string | null): string | null {
  if (!dateText || !dateText.trim()) return null;
  const trimmed = dateText.trim();

  // 1. Direct ISO format YYYY-MM-DD
  const isoMatch = trimmed.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. Extract year if present
  let year = new Date().getFullYear();
  const yearMatch = trimmed.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  const parsed = parseDateString(`${year}`, trimmed);
  if (parsed) {
    if (yearMatch) {
      const parts = parsed.split('-');
      return `${year}-${parts[1]}-${parts[2]}`;
    }
    return parsed;
  }

  // 3. Fallback: MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  if (slashMatch) {
    const m = String(parseInt(slashMatch[1], 10)).padStart(2, '0');
    const d = String(parseInt(slashMatch[2], 10)).padStart(2, '0');
    let y = slashMatch[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Parses price range, single price, or free admission from raw text.
 */
export function parseZ2Price(
  priceText?: string | null,
): CandidatePrice | undefined {
  if (!priceText || typeof priceText !== 'string') return undefined;
  const trimmed = priceText.trim();
  if (!trimmed || /^(?:tba|tbd|n\/a)$/i.test(trimmed)) return undefined;

  // Free admission
  if (/\bfree\b/i.test(trimmed) || /^\$?\s*0(?:\.00)?$/.test(trimmed)) {
    return {
      isFree: true,
      min: 0,
      max: 0,
      currency: 'USD',
    };
  }

  const matches = Array.from(trimmed.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g));
  if (matches.length === 0) {
    return undefined;
  }

  const numbers = matches.map((m) => parseFloat(m[1])).filter((n) => !isNaN(n));
  if (numbers.length === 0) return undefined;

  const min = Math.min(...numbers);
  const max = Math.max(...numbers);

  return {
    min,
    max,
    currency: 'USD',
    isFree: min === 0 && max === 0,
  };
}

/**
 * Extracts a stable source event ID from AXS ticket link or event page URL.
 */
export function extractZ2SourceEventId(
  eventUrl?: string,
  ticketUrl?: string,
  fallbackKey?: string,
): string {
  if (ticketUrl) {
    const axsMatch = ticketUrl.match(/axs\.com\/events\/(\d+)/i);
    if (axsMatch) {
      return `axs-${axsMatch[1]}`;
    }
  }

  if (eventUrl) {
    const detailMatch = eventUrl.match(/\/events\/(?:detail\/)?([^/?#]+)/i);
    if (detailMatch) {
      return detailMatch[1];
    }
  }

  if (fallbackKey) {
    return crypto
      .createHash('sha256')
      .update(fallbackKey)
      .digest('hex')
      .slice(0, 16);
  }

  return crypto.randomUUID();
}

/**
 * Extracts pagination next page URL if present.
 */
export function extractZ2NextPageUrl(
  html: string,
  baseUrl: string = 'https://z2ent.com',
): string | null {
  if (!html || !html.trim()) return null;
  const $ = cheerio.load(html);

  const nextLink = $(
    '.w-pagination-next, a[rel="next"], a.next-page, .pagination__next a',
  ).attr('href');
  if (!nextLink) return null;

  try {
    return new URL(nextLink, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Parses raw HTML into Z2RawEvent intermediate model.
 */
export function parseZ2RawEvents(html: string): Z2RawEvent[] {
  if (!html || !html.trim()) return [];

  const $ = cheerio.load(html);
  const events: Z2RawEvent[] = [];

  // Support Webflow collection items, custom cards, or event items
  const cardSelector =
    '.c-event-card, .event-card, .event-item, .w-dyn-item:has(.c-event-card__title, .event-title, .venue, .event-venue)';
  const cards = $(cardSelector);

  cards.each((_, el) => {
    const $card = $(el);

    // Title & Support
    const rawTitle = $card
      .find(
        '.c-event-card__title, .event-title, h1, h2, h3, .title, .event-name',
      )
      .first()
      .text()
      .trim();
    if (!rawTitle) return;

    const rawSupport = $card
      .find(
        '.c-event-card__support, .event-support, .support, .support-artists',
      )
      .first()
      .text()
      .trim();

    const { cleanTitle, rawArtists } = parseZ2Artists(rawTitle, rawSupport);

    // Venue
    const rawVenueText = $card
      .find(
        '.c-event-card__venue, .event-venue, .venue, .venue-name, .location',
      )
      .first()
      .text()
      .trim();
    const venueResolved = resolveZ2Venue(rawVenueText);
    const venueMapping =
      'address' in venueResolved
        ? (venueResolved as Z2VenueMapping)
        : undefined;

    // Date & Time
    const dateText =
      $card.find('time').attr('datetime') ||
      $card
        .find('.c-event-card__date, .event-date, .date')
        .first()
        .text()
        .trim();
    const localStartDate = parseZ2Date(dateText);

    const timeText = $card
      .find('.c-event-card__time, .event-time, .time, .event-doors')
      .first()
      .text()
      .trim();
    const { showTime, doorTime } = parseTimeText(timeText);

    let startsAt: string | undefined;
    let doorsOpenAt: string | undefined;

    if (localStartDate && showTime) {
      try {
        startsAt = localDateTimeToUtcInstant(
          localStartDate,
          showTime,
          venueMapping?.timezone || 'America/Denver',
        );
      } catch {
        startsAt = undefined;
      }
    }

    if (localStartDate && doorTime) {
      try {
        doorsOpenAt = localDateTimeToUtcInstant(
          localStartDate,
          doorTime,
          venueMapping?.timezone || 'America/Denver',
        );
      } catch {
        doorsOpenAt = undefined;
      }
    }

    // Sold Out detection
    const cardClass = $card.attr('class') || '';
    const statusText = $card
      .find(
        '.sold-out, .c-event-card--sold-out, .badge-sold-out, .badge, .status, .event-status',
      )
      .text()
      .trim();
    const isSoldOut =
      cardClass.includes('sold-out') ||
      $card.find('.sold-out, .c-event-card--sold-out, .badge-sold-out').length >
        0 ||
      /\bsold\s*out\b/i.test(statusText) ||
      /\bsold\s*out\b/i.test($card.text());

    // Price extraction
    const rawPriceText = $card
      .find('.c-event-card__price, .event-price, .price, .ticket-price')
      .first()
      .text()
      .trim();
    const price = parseZ2Price(rawPriceText);

    // Links & Image
    const rawTicketUrl = $card
      .find(
        'a[href*="axs.com"], a.ticket-btn, a.btn-tickets, a.c-event-card__tickets, a.tickets',
      )
      .first()
      .attr('href');
    const rawEventUrl = $card
      .find('a.event-link, a.c-event-card__link, a[href*="/events/"]')
      .first()
      .attr('href');
    const rawImageUrl = $card
      .find('img.c-event-card__image, img.event-image, img')
      .first()
      .attr('src');

    let ticketUrl: string | undefined;
    if (rawTicketUrl) {
      try {
        ticketUrl = normalizeUrl(rawTicketUrl);
      } catch {
        ticketUrl = rawTicketUrl;
      }
    }

    let eventUrl: string | undefined;
    if (rawEventUrl) {
      try {
        eventUrl = normalizeUrl(rawEventUrl);
      } catch {
        eventUrl = rawEventUrl;
      }
    }

    const rawEvent: Z2RawEvent = {
      title: rawTitle,
      cleanTitle,
      headliner: rawArtists.find((a) => a.position === 0)?.name,
      supportActs: rawArtists.filter((a) => a.position > 0).map((a) => a.name),
      artists: rawArtists,
      venueName: venueResolved.venueName,
      venueInfo: venueMapping,
      eventDateText: dateText,
      localStartDate,
      timeText: timeText || undefined,
      showTime,
      doorTime,
      startsAt,
      doorsOpenAt,
      ticketUrl,
      isSoldOut,
      price: price
        ? {
            min: price.min,
            max: price.max,
            currency: price.currency || 'USD',
            isFree: price.isFree,
          }
        : undefined,
      imageUrl: rawImageUrl || undefined,
      eventUrl,
    };

    events.push(rawEvent);
  });

  return events;
}

/**
 * Parses Z2 Entertainment HTML calendar into validated EventCandidate objects.
 */
export function parseZ2Events(
  html: string,
  context: Z2ParseContext,
): EventCandidate[] {
  const rawEvents = parseZ2RawEvents(html);
  const candidates: EventCandidate[] = [];

  for (const raw of rawEvents) {
    const venueResolved = resolveZ2Venue(raw.venueName);
    const venueInfo =
      'address' in venueResolved
        ? (venueResolved as Z2VenueMapping)
        : undefined;

    const sourceEventId = extractZ2SourceEventId(
      raw.eventUrl,
      raw.ticketUrl,
      `${raw.cleanTitle}|${venueResolved.venueName}|${raw.localStartDate}`,
    );

    const provenance: SourceProvenance = {
      sourceId: context.sourceId,
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      sourceUrl:
        raw.eventUrl || context.sourceUrl || 'https://z2ent.com/events',
      sourceEventId,
      rawIngestId: context.rawIngestId,
      fetchedAt: context.fetchedAt || new Date().toISOString(),
      contentHash: context.contentHash || '',
      parserVersion: context.parserVersion || '1.0.0',
      confidence: 0.98,
    };

    const startTimePrecision: StartTimePrecision = raw.showTime
      ? 'instant'
      : 'date_only';

    const candidateArtists: CandidateArtist[] = raw.artists.map((a) => ({
      name: a.name,
      billingPosition: a.billingPosition,
      sortOrder: a.position === 0 ? 1 : a.position + 1,
    }));

    const candidate: EventCandidate = {
      rawIngestId: context.rawIngestId,
      sourceId: context.sourceId,
      sourceEventId,
      title: raw.cleanTitle,
      artistNames: raw.artists.map((a) => a.name),
      artists: candidateArtists,
      venueName: venueResolved.venueName,
      city: venueInfo?.city || context.defaultVenueConfig?.city,
      state: venueInfo?.state || context.defaultVenueConfig?.state,
      country:
        venueInfo?.country || context.defaultVenueConfig?.country || 'US',
      timezone:
        venueInfo?.timezone ||
        context.defaultVenueConfig?.defaultTimezone ||
        'America/Denver',
      localStartDate: raw.localStartDate || undefined,
      startsAt: raw.startsAt,
      doorsOpenAt: raw.doorsOpenAt,
      startTimePrecision,
      ticketUrl: raw.ticketUrl,
      price: raw.price
        ? {
            min: raw.price.min,
            max: raw.price.max,
            currency: raw.price.currency,
            isFree: raw.price.isFree,
          }
        : undefined,
      inventoryStatus: raw.isSoldOut ? 'sold_out' : 'available',
      eventKind: raw.price?.isFree ? 'free_event' : 'concert',
      isFestival: false,
      confidence: 0.98,
      verificationStatus: 'unverified',
      provenance,
      rawPayload: {
        rawTitle: raw.title,
        dateText: raw.eventDateText,
        timeText: raw.timeText,
        venueText: raw.venueName,
        address: venueInfo?.address,
        isSoldOut: raw.isSoldOut,
        priceText: raw.price,
        imageUrl: raw.imageUrl,
        ticketUrl: raw.ticketUrl,
      },
    };

    candidates.push(candidate);
  }

  return candidates;
}
