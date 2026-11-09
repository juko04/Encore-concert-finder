import * as cheerio from 'cheerio';
import type {
  CandidateArtist,
  EventCandidate,
} from '@/lib/domain/event-candidate';
import { localDateTimeToUtcInstant } from '../date-time';
import { isValidHttpUrl } from '../http-client';
import type { RootsMusicProjectParseContext } from './types';

export function cleanRootsArtistName(name: string): string {
  return name
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(?:and\s+|&\s+)/i, '')
    .replace(/\s+(?:w\/|with)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a title is a non-music event (educational workshop, art sale, volunteer meeting, etc.)
 */
export function isRootsNonMusicEvent(title: string): boolean {
  const norm = title.toLowerCase().trim();
  return (
    norm.includes('workshop') ||
    norm.includes('masterclass') ||
    norm.includes('art show') ||
    norm.includes('art sale') ||
    norm.includes('volunteer kick-off') ||
    norm.includes('volunteer meeting') ||
    norm.includes('private rental') ||
    norm.includes('private party') ||
    norm.includes('meeting')
  );
}

/**
 * Parses artist acts from title string for Roots Music Project.
 */
export function parseRootsArtistsFromTitle(rawTitle: string): {
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
  if (/\b(?:free(?:\s+all-ages|\s+show|\s+event)?)\b/i.test(text)) {
    isExplicitFree = true;
  }

  const cleanTitle = text.replace(/\s+/g, ' ').trim();

  // If non-music event, return empty artists list so it routes to review
  if (isRootsNonMusicEvent(cleanTitle)) {
    return { cleanTitle, isCanceled, isExplicitFree, artists: [] };
  }

  const artists: CandidateArtist[] = [];

  // Pattern A: "Promoter presents Headliner"
  const promoterMatch = cleanTitle.match(/^(?:.*?\s+presents)\s+(.*)$/i);
  if (promoterMatch) {
    const act = cleanRootsArtistName(promoterMatch[1]);
    if (act) {
      artists.push({
        name: act,
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      return { cleanTitle, isCanceled, isExplicitFree, artists };
    }
  }

  // Pattern B: "Headliner | Subtitle / Series" (e.g. "Assembly of Dust | Reid Genauer's Epic Two-Night Stand (Night 1)")
  if (cleanTitle.includes('|')) {
    const pipeParts = cleanTitle.split('|').map((s) => s.trim());
    const headlinerName = cleanRootsArtistName(pipeParts[0]);
    if (headlinerName) {
      artists.push({
        name: headlinerName,
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      return { cleanTitle, isCanceled, isExplicitFree, artists };
    }
  }

  // Pattern C: "Series: Subtitle" (e.g. "OPEN DECKS: Boulder's Free All-Ages DJ Night" or "Dave ABear’s A Very Jerry Band: Cosmic Jams & Good Vibes")
  if (cleanTitle.includes(':')) {
    const colonParts = cleanTitle.split(':').map((s) => s.trim());
    const headlinerName = cleanRootsArtistName(colonParts[0]);
    if (headlinerName) {
      artists.push({
        name: headlinerName,
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      return { cleanTitle, isCanceled, isExplicitFree, artists };
    }
  }

  // Pattern D: "Headliner w/ Support" or "Headliner with Support"
  const withMatch = cleanTitle.match(/^(.*?)\s+(?:w\/|with)\s+(.*)$/i);
  if (withMatch) {
    const headlinerName = cleanRootsArtistName(withMatch[1]);
    const supportPart = withMatch[2].trim();

    if (headlinerName) {
      artists.push({
        name: headlinerName,
        billingPosition: 'headliner',
        sortOrder: 1,
      });
    }

    if (supportPart) {
      const rawSupportActs = supportPart
        .split(/,\s*(?:and\s+)?|\s+and\s+|\s*[-–—]\s*|\s*\+\s*|\s*&\s*/i)
        .map((s) => cleanRootsArtistName(s))
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

  // Pattern E: "Headliner ft. Act 1, Act 2, and Act 3"
  const featMatch = cleanTitle.match(
    /^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i,
  );
  if (featMatch) {
    const headlinerName = cleanRootsArtistName(featMatch[1]);
    const supportPart = featMatch[2].trim();

    if (headlinerName) {
      artists.push({
        name: headlinerName,
        billingPosition: 'headliner',
        sortOrder: 1,
      });
    }

    if (supportPart) {
      const rawSupportActs = supportPart
        .split(/,\s*(?:and\s+)?|\s+and\s+|\s*[-–—]\s*|\s*\+\s*|\s*&\s*/i)
        .map((s) => cleanRootsArtistName(s))
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

  // Default: Title itself is the performing artist / showcase
  const singleName = cleanRootsArtistName(cleanTitle);
  if (singleName.length > 0) {
    artists.push({
      name: singleName,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }

  return { cleanTitle, isCanceled, isExplicitFree, artists };
}

interface EventbriteEventPayload {
  id?: string | number;
  name?: string;
  start_date?: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  timezone?: string;
  url?: string;
  is_cancelled?: boolean;
  ticket_availability?: {
    is_sold_out?: boolean;
    is_free?: boolean;
    has_available_tickets?: boolean;
    minimum_ticket_price?: {
      currency?: string;
      major_value?: string;
      value?: number;
    };
    maximum_ticket_price?: {
      currency?: string;
      major_value?: string;
      value?: number;
    };
  };
  primary_venue?: {
    name?: string;
    id?: string;
    address?: {
      address_1?: string;
      city?: string;
      region?: string;
      postal_code?: string;
      country?: string;
      latitude?: string;
      longitude?: string;
    };
  };
}

/**
 * Parses Roots Music Project calendar listing or Eventbrite response into EventCandidate objects.
 */
export function parseRootsMusicProjectEvents(
  html: string,
  context: RootsMusicProjectParseContext,
): EventCandidate[] {
  if (!html || typeof html !== 'string') return [];

  const defaultVenue = context.defaultVenueConfig;
  const baseUrl = defaultVenue?.baseUrl ?? 'https://www.rootsmusicproject.org';
  const candidates: EventCandidate[] = [];

  // 1. Primary: Check for __NEXT_DATA__ JSON from Eventbrite organizer profile
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );

  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const upcomingEvents: EventbriteEventPayload[] =
        data.props?.pageProps?.upcomingEvents ||
        data.props?.pageProps?.events ||
        [];

      for (const e of upcomingEvents) {
        if (!e.name) continue;

        const rawTitle = e.name;
        const { cleanTitle, isCanceled, isExplicitFree, artists } =
          parseRootsArtistsFromTitle(rawTitle);

        const localStartDate = e.start_date || undefined;
        const localEndDate = e.end_date || localStartDate;
        const tz =
          e.timezone || defaultVenue?.defaultTimezone || 'America/Denver';

        let startsAt: string | undefined = undefined;
        let startTimePrecision: 'instant' | 'date_only' = 'date_only';

        if (e.start_date && e.start_time) {
          try {
            startsAt = localDateTimeToUtcInstant(
              e.start_date,
              e.start_time,
              tz,
            );
            startTimePrecision = 'instant';
          } catch {
            startsAt = undefined;
            startTimePrecision = 'date_only';
          }
        }

        let endsAt: string | undefined = undefined;
        if (localEndDate && e.end_time) {
          try {
            endsAt = localDateTimeToUtcInstant(localEndDate, e.end_time, tz);
          } catch {
            endsAt = undefined;
          }
        }

        // Pricing resolution:
        // Free admission verified if is_free is true OR min price is 0.00 with explicit free title
        const isFree =
          e.ticket_availability?.is_free === true ||
          (isExplicitFree &&
            e.ticket_availability?.minimum_ticket_price?.value === 0);

        let price: EventCandidate['price'] = undefined;
        let eventKind: EventCandidate['eventKind'] = 'concert';

        if (isFree) {
          price = {
            isFree: true,
            min: 0,
            max: 0,
            currency: 'USD',
          };
          eventKind = 'free_event';
        } else if (e.ticket_availability?.minimum_ticket_price?.major_value) {
          const min = parseFloat(
            e.ticket_availability.minimum_ticket_price.major_value,
          );
          const max = parseFloat(
            e.ticket_availability.maximum_ticket_price?.major_value ||
              e.ticket_availability.minimum_ticket_price.major_value,
          );
          const currency =
            e.ticket_availability.minimum_ticket_price.currency || 'USD';
          price = {
            min,
            max,
            currency,
            isFree: false,
          };
          eventKind = 'concert';
        }

        const ticketUrl = isValidHttpUrl(e.url) ? e.url : undefined;
        const venueName =
          e.primary_venue?.name || defaultVenue?.name || 'Roots Music Project';
        const city =
          e.primary_venue?.address?.city || defaultVenue?.city || 'Boulder';
        const state =
          e.primary_venue?.address?.region || defaultVenue?.state || 'CO';
        const country =
          e.primary_venue?.address?.country || defaultVenue?.country || 'US';

        const candidate: EventCandidate = {
          sourceEventId: e.id ? String(e.id) : undefined,
          title: cleanTitle,
          artistNames: artists.map((a) => a.name),
          artists,
          venueName,
          city,
          state,
          country,
          timezone: tz,
          localStartDate,
          localEndDate,
          startsAt,
          endsAt,
          startTimePrecision,
          ticketUrl,
          price,
          eventKind,
          confidence: 0.98,
          resolutionProvenance:
            isCanceled || e.is_cancelled === true
              ? { status: 'cancelled' }
              : undefined,
          rawPayload: {
            rawName: e.name,
            isCanceled: isCanceled || e.is_cancelled === true,
            status:
              isCanceled || e.is_cancelled === true ? 'cancelled' : 'scheduled',
            eventId: e.id,
          },
          provenance: {
            sourceId: context.sourceId,
            sourceType: 'venue',
            acquisitionMethod: 'html_http',
            sourceUrl: ticketUrl || context.sourceUrl || baseUrl,
            sourceEventId: e.id ? String(e.id) : undefined,
            rawIngestId: context.rawIngestId,
            fetchedAt: context.fetchedAt ?? new Date().toISOString(),
            contentHash: context.contentHash ?? '',
            parserVersion: context.parserVersion ?? '1.0.0',
            confidence: 0.98,
          },
        };

        candidates.push(candidate);
      }

      return candidates;
    } catch {
      // Fall through to Cheerio/JSON-LD fallback
    }
  }

  // 2. Secondary fallback: Cheerio DOM or Schema.org JSON-LD
  const $ = cheerio.load(html);

  // Check Schema.org Event JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const events = Array.isArray(parsed)
        ? parsed
        : parsed['@graph']
          ? parsed['@graph']
          : [parsed];

      for (const item of events) {
        if (item['@type'] !== 'Event' || !item.name) continue;

        const { cleanTitle, isCanceled, isExplicitFree, artists } =
          parseRootsArtistsFromTitle(item.name);

        const localStartDate = item.startDate
          ? String(item.startDate).slice(0, 10)
          : undefined;

        const ticketUrl = isValidHttpUrl(item.url) ? item.url : undefined;

        candidates.push({
          title: cleanTitle,
          artistNames: artists.map((a) => a.name),
          artists,
          venueName: defaultVenue?.name ?? 'Roots Music Project',
          city: defaultVenue?.city ?? 'Boulder',
          state: defaultVenue?.state ?? 'CO',
          country: defaultVenue?.country ?? 'US',
          timezone: defaultVenue?.defaultTimezone ?? 'America/Denver',
          localStartDate,
          startTimePrecision: 'date_only',
          ticketUrl,
          price: isExplicitFree
            ? { isFree: true, min: 0, max: 0, currency: 'USD' }
            : undefined,
          eventKind: isExplicitFree ? 'free_event' : 'concert',
          confidence: 0.95,
          resolutionProvenance: isCanceled
            ? { status: 'cancelled' }
            : undefined,
          rawPayload: {
            rawName: item.name,
            isCanceled,
            status: isCanceled ? 'cancelled' : 'scheduled',
            url: item.url,
          },
          provenance: {
            sourceId: context.sourceId,
            sourceType: 'venue',
            acquisitionMethod: 'html_http',
            sourceUrl: ticketUrl || context.sourceUrl || baseUrl,
            rawIngestId: context.rawIngestId,
            fetchedAt: context.fetchedAt ?? new Date().toISOString(),
            contentHash: context.contentHash ?? '',
            parserVersion: context.parserVersion ?? '1.0.0',
            confidence: 0.95,
          },
        });
      }
    } catch {
      // ignore JSON parse error
    }
  });

  return candidates;
}
