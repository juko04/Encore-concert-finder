import * as cheerio from 'cheerio';
import type {
  CandidateArtist,
  EventCandidate,
} from '@/lib/domain/event-candidate';
import { localDateTimeToUtcInstant, parseTimeText } from '../date-time';
import { isValidHttpUrl } from '../http-client';
import type { VelvetElkParseContext } from './types';

interface JsonLdEvent {
  '@type'?: string;
  startDate?: string;
  sameAs?: string;
  url?: string;
  name?: string;
  description?: string;
}

const MONTH_NAMES: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

export function cleanVelvetElkArtistName(name: string): string {
  return name
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:and\s+|&\s+)/i, '')
    .replace(/\s+(?:w\/|with)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a title is a non-music event (bar promo, trivia, private rental, etc.)
 */
export function isNonMusicEvent(title: string): boolean {
  const norm = title.toLowerCase().trim();
  return (
    norm === 'happy hour' ||
    norm.startsWith('happy hour') ||
    norm.includes('trivia night') ||
    norm.includes('pub trivia') ||
    norm.includes('private event') ||
    norm.includes('closed for') ||
    norm === 'closed'
  );
}

/**
 * Parses artist acts from title string.
 * Supports "Artist A with Artist B", "Artist A w/ Artist B", "Artist A feat. Artist B", etc.
 */
export function parseVelvetElkArtistsFromTitle(rawTitle: string): {
  cleanTitle: string;
  isCanceled: boolean;
  isExplicitFree: boolean;
  artists: CandidateArtist[];
} {
  let isCanceled = false;
  let isExplicitFree = false;

  let text = rawTitle.trim();

  // 1. Detect cancellation markers
  if (/\((?:CANCELLED|CANCELED|POSTPONED)\)/i.test(text)) {
    isCanceled = true;
    text = text.replace(/\s*\((?:CANCELLED|CANCELED|POSTPONED)\)/gi, '').trim();
  }

  // 2. Detect explicit free indicators
  if (/\((?:FREE(?:\s+SHOW|\s+EVENT)?)\)/i.test(text)) {
    isExplicitFree = true;
    text = text.replace(/\s*\((?:FREE(?:\s+SHOW|\s+EVENT)?)\)/gi, '').trim();
  }

  const cleanTitle = text.replace(/\s+/g, ' ').trim();

  // If non-music event, return empty artists list so it routes to review
  if (isNonMusicEvent(cleanTitle)) {
    return { cleanTitle, isCanceled, isExplicitFree, artists: [] };
  }

  let headlinerPart = cleanTitle;
  let supportPart = '';

  const withMatch = cleanTitle.match(/^(.*?)\s+(?:w\/|with)\s+(.*)$/i);
  if (withMatch) {
    headlinerPart = withMatch[1].trim();
    supportPart = withMatch[2].trim();
  } else {
    const featMatch = cleanTitle.match(
      /^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i,
    );
    if (featMatch) {
      headlinerPart = featMatch[1].trim();
      supportPart = featMatch[2].trim();
    }
  }

  const artists: CandidateArtist[] = [];
  const headlinerName = cleanVelvetElkArtistName(headlinerPart);

  if (headlinerName.length > 0) {
    artists.push({
      name: headlinerName,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }

  if (supportPart) {
    const rawSupportActs = supportPart
      .split(/,\s*(?:and\s+)?|\s+and\s+|\s*[-–—]\s*|\s*\+\s*|\s*&\s*/i)
      .map((s) => cleanVelvetElkArtistName(s))
      .filter((s) => s.length > 0);

    for (let i = 0; i < rawSupportActs.length; i++) {
      artists.push({
        name: rawSupportActs[i],
        billingPosition: 'support',
        sortOrder: artists.length + 1,
      });
    }
  }

  return { cleanTitle, isCanceled, isExplicitFree, artists };
}

/**
 * Parses date string like "November 13" or "November 20th" into ISO YYYY-MM-DD.
 * Resolves year boundary based on context fetchedAt date.
 */
export function parseDateHeading(
  heading: string,
  referenceDateStr?: string,
): { localStartDate: string | null; remainingTitle: string } {
  const match = heading.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(.*)$/i,
  );

  if (!match) {
    return { localStartDate: null, remainingTitle: heading };
  }

  const monthName = match[1].toLowerCase();
  const dayStr = match[2];
  const remainingTitle = match[3].trim();

  const monthNum = MONTH_NAMES[monthName];
  if (!monthNum) {
    return { localStartDate: null, remainingTitle: heading };
  }

  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  const refYear = isNaN(refDate.getTime())
    ? new Date().getUTCFullYear()
    : refDate.getUTCFullYear();
  const refMonth = isNaN(refDate.getTime())
    ? new Date().getUTCMonth() + 1
    : refDate.getUTCMonth() + 1;

  const targetMonth = parseInt(monthNum, 10);
  let targetYear = refYear;

  // If target month is more than 2 months before ref month, assume next calendar year
  if (targetMonth < refMonth - 2) {
    targetYear = refYear + 1;
  }

  const paddedDay = dayStr.padStart(2, '0');
  const localStartDate = `${targetYear}-${monthNum}-${paddedDay}`;

  return { localStartDate, remainingTitle };
}

/**
 * Determines whether raw HTML represents an event detail subpage or the calendar listing.
 */
export function isVelvetElkDetailPage(html: string): boolean {
  if (!html || typeof html !== 'string') return false;
  const $ = cheerio.load(html);
  return $('article.content, .boxes-event-template').length > 0;
}

const ALLOWED_VELVET_ELK_HOSTS = new Set([
  'velvetelklounge.com',
  'www.velvetelklounge.com',
]);

/**
 * Validates that a URL is an expected official Velvet Elk event detail page URL.
 * Restricts automatic detail-page fetching to expected official Velvet Elk event-page origins and paths.
 * Rejects external ticketing origins (e.g. Etix), third-party hosts, calendar roots, and non-event paths.
 */
export function isAllowedVelvetElkDetailUrl(
  urlStr: string,
  allowedBaseUrl = 'https://www.velvetelklounge.com',
): boolean {
  if (!isValidHttpUrl(urlStr)) return false;
  try {
    const parsed = new URL(urlStr);

    const allowedHosts = new Set(ALLOWED_VELVET_ELK_HOSTS);
    if (allowedBaseUrl) {
      try {
        allowedHosts.add(new URL(allowedBaseUrl).hostname.toLowerCase());
      } catch {
        // ignore invalid allowedBaseUrl
      }
    }

    if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
      return false;
    }

    // Must be an event detail path under /event/ or /events/
    // e.g. /event/november-13-the-galentine-with-abernathy/
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const isEventSubpath =
      normalizedPath.startsWith('/event/') ||
      normalizedPath.startsWith('/events/');

    if (!isEventSubpath) {
      return false;
    }

    // Reject the listing root itself (/events or /event)
    if (normalizedPath === '/events' || normalizedPath === '/event') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts unique event detail page URLs from calendar listing card links.
 * Strictly restricted to official Velvet Elk event detail URLs.
 */
export function extractVelvetElkDetailUrls(
  html: string,
  baseUrl = 'https://www.velvetelklounge.com',
): string[] {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $('li.card, .card--cols-three').each((_, cardEl) => {
    const rawHref = $(cardEl).find('a.card__btn').attr('href') || '';
    if (!rawHref) return;

    let eventUrl: string | undefined = undefined;
    if (rawHref.startsWith('http')) {
      eventUrl = rawHref;
    } else {
      try {
        eventUrl = new URL(rawHref, baseUrl).toString();
      } catch {
        eventUrl = undefined;
      }
    }

    if (
      eventUrl &&
      isAllowedVelvetElkDetailUrl(eventUrl, baseUrl) &&
      !seen.has(eventUrl)
    ) {
      seen.add(eventUrl);
      urls.push(eventUrl);
    }
  });

  return urls;
}

/**
 * Parses Velvet Elk Lounge HTML calendar listing or event detail page into EventCandidate objects.
 */
export function parseVelvetElkEvents(
  html: string,
  context: VelvetElkParseContext,
): EventCandidate[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const defaultVenue = context.defaultVenueConfig;
  const baseUrl = defaultVenue?.baseUrl ?? 'https://www.velvetelklounge.com';
  const candidates: EventCandidate[] = [];

  // Check if this is an Event Detail Page:
  const isDetailPage = isVelvetElkDetailPage(html);

  if (isDetailPage) {
    const titleHeader = $('article.content h1, h1').first().text().trim();
    if (titleHeader) {
      // Find date/time line in detail page: e.g. "<p><strong>November 13, 2026 08:00 PM</strong></p>"
      const dateText = $('article.content p strong, .event-date')
        .first()
        .text()
        .trim();

      // Check detail page JSON-LD
      let jsonLdEvent: JsonLdEvent | null = null;
      for (const el of $('script[type="application/ld+json"]').toArray()) {
        try {
          const parsed = JSON.parse($(el).html() || '{}');
          if (
            parsed &&
            typeof parsed === 'object' &&
            parsed['@type'] === 'Event'
          ) {
            jsonLdEvent = parsed as JsonLdEvent;
            break;
          }
        } catch {
          // ignore malformed JSON-LD
        }
      }

      const { localStartDate, remainingTitle } = parseDateHeading(
        titleHeader,
        context.fetchedAt,
      );

      const titleToParse = remainingTitle || titleHeader;
      const { cleanTitle, isCanceled, isExplicitFree, artists } =
        parseVelvetElkArtistsFromTitle(titleToParse);

      const targetStartDate =
        (jsonLdEvent?.startDate as string) || localStartDate || undefined;

      // Extract time from dateText: e.g. "08:00 PM"
      let startsAt: string | undefined = undefined;
      let startTimePrecision: 'instant' | 'date_only' = 'date_only';

      if (dateText && targetStartDate) {
        const timeParsed = parseTimeText(dateText);
        if (timeParsed.showTime) {
          try {
            startsAt = localDateTimeToUtcInstant(
              targetStartDate,
              timeParsed.showTime,
              defaultVenue?.defaultTimezone || 'America/Denver',
            );
            startTimePrecision = 'instant';
          } catch {
            startsAt = undefined;
            startTimePrecision = 'date_only';
          }
        }
      }

      // Ticket link: sameAs in JSON-LD or .btn-brand
      const rawTicketUrl =
        (jsonLdEvent?.sameAs as string) ||
        $('a.btn.btn-brand, a[href*="etix.com"]').attr('href') ||
        (jsonLdEvent?.url as string) ||
        context.sourceUrl ||
        baseUrl;

      const ticketUrl = isValidHttpUrl(rawTicketUrl) ? rawTicketUrl : undefined;

      const candidate: EventCandidate = {
        title: cleanTitle,
        artistNames: artists.map((a) => a.name),
        artists,
        venueName: defaultVenue?.name ?? 'Velvet Elk Lounge',
        city: defaultVenue?.city ?? 'Boulder',
        state: defaultVenue?.state ?? 'CO',
        country: defaultVenue?.country ?? 'US',
        timezone: defaultVenue?.defaultTimezone ?? 'America/Denver',
        localStartDate: targetStartDate,
        startsAt,
        startTimePrecision,
        ticketUrl,
        price: isExplicitFree
          ? { isFree: true, min: 0, max: 0, currency: 'USD' }
          : undefined,
        eventKind: isExplicitFree ? 'free_event' : 'concert',
        confidence: 0.98,
        resolutionProvenance: isCanceled ? { status: 'cancelled' } : undefined,
        rawPayload: {
          rawTitle: titleHeader || cleanTitle,
          heading: titleHeader,
          dateText,
          isCanceled,
          status: isCanceled ? 'cancelled' : 'scheduled',
        },
        provenance: {
          sourceId: context.sourceId,
          sourceType: 'venue',
          acquisitionMethod: 'html_http',
          sourceUrl: context.sourceUrl || baseUrl,
          rawIngestId: context.rawIngestId,
          fetchedAt: context.fetchedAt ?? new Date().toISOString(),
          contentHash: context.contentHash ?? '',
          parserVersion: context.parserVersion ?? '1.0.0',
          confidence: 0.98,
        },
      };

      candidates.push(candidate);
      return candidates;
    }
  }

  // Otherwise, parse as Events Listing Page (Cards)
  const cards = $('li.card, .card--cols-three');

  cards.each((_, cardEl) => {
    const $card = $(cardEl);
    const heading =
      $card.find('h2.card__heading, .card__heading').text().trim() ||
      $card.find('a.card__btn').attr('aria-label') ||
      '';

    if (!heading) return;

    const rawHref = $card.find('a.card__btn').attr('href') || '';
    let eventUrl: string | undefined = undefined;
    if (rawHref) {
      if (rawHref.startsWith('http')) {
        eventUrl = rawHref;
      } else {
        try {
          eventUrl = new URL(rawHref, baseUrl).toString();
        } catch {
          eventUrl = undefined;
        }
      }
    }

    if (!isValidHttpUrl(eventUrl)) {
      eventUrl = undefined;
    }

    const { localStartDate, remainingTitle } = parseDateHeading(
      heading,
      context.fetchedAt,
    );

    const titleToParse = remainingTitle || heading;
    const { cleanTitle, isCanceled, isExplicitFree, artists } =
      parseVelvetElkArtistsFromTitle(titleToParse);

    const candidate: EventCandidate = {
      title: cleanTitle,
      artistNames: artists.map((a) => a.name),
      artists,
      venueName: defaultVenue?.name ?? 'Velvet Elk Lounge',
      city: defaultVenue?.city ?? 'Boulder',
      state: defaultVenue?.state ?? 'CO',
      country: defaultVenue?.country ?? 'US',
      timezone: defaultVenue?.defaultTimezone ?? 'America/Denver',
      localStartDate: localStartDate || undefined,
      startTimePrecision: 'date_only',
      ticketUrl: eventUrl,
      price: isExplicitFree
        ? { isFree: true, min: 0, max: 0, currency: 'USD' }
        : undefined,
      eventKind: isExplicitFree ? 'free_event' : 'concert',
      confidence: 0.95,
      resolutionProvenance: isCanceled ? { status: 'cancelled' } : undefined,
      rawPayload: {
        rawTitle: heading,
        cleanTitle,
        isCanceled,
        status: isCanceled ? 'cancelled' : 'scheduled',
        eventUrl,
      },
      provenance: {
        sourceId: context.sourceId,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        sourceUrl: eventUrl || context.sourceUrl || baseUrl,
        rawIngestId: context.rawIngestId,
        fetchedAt: context.fetchedAt ?? new Date().toISOString(),
        contentHash: context.contentHash ?? '',
        parserVersion: context.parserVersion ?? '1.0.0',
        confidence: 0.95,
      },
    };

    candidates.push(candidate);
  });

  return candidates;
}
