import * as cheerio from 'cheerio';
import type {
  CandidateArtist,
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
import type { CervantesParseContext } from './types';

/**
 * Known offsite Colorado venues co-promoted by Cervantes.
 * Maps extracted venue text to authoritative canonical venue attributes.
 */
const KNOWN_VENUE_MAP: Record<
  string,
  { venueName: string; city: string; state: string; address?: string }
> = {
  'cervantes masterpiece ballroom': {
    venueName: "Cervantes' Masterpiece Ballroom",
    city: 'Denver',
    state: 'CO',
    address: '2637 Welton Street',
  },
  'cervantes other side': {
    venueName: "Cervantes' Other Side",
    city: 'Denver',
    state: 'CO',
    address: '2637 Welton Street',
  },
  'cervantes’ other side': {
    venueName: "Cervantes' Other Side",
    city: 'Denver',
    state: 'CO',
    address: '2637 Welton Street',
  },
  'mission ballroom': {
    venueName: 'Mission Ballroom',
    city: 'Denver',
    state: 'CO',
    address: '4242 Wynkoop St',
  },
  'ogden theatre': {
    venueName: 'Ogden Theatre',
    city: 'Denver',
    state: 'CO',
    address: '935 E Colfax Ave',
  },
  'red rocks': {
    venueName: 'Red Rocks Amphitheatre',
    city: 'Morrison',
    state: 'CO',
    address: '18300 W Alameda Pkwy',
  },
  'fiddlers green': {
    venueName: 'Fiddlers Green Amphitheatre',
    city: 'Englewood',
    state: 'CO',
    address: '6350 Greenwood Plaza Blvd',
  },
  'fiddlers green amphitheatre': {
    venueName: 'Fiddlers Green Amphitheatre',
    city: 'Englewood',
    state: 'CO',
    address: '6350 Greenwood Plaza Blvd',
  },
  'fiddler’s green amphitheatre': {
    venueName: 'Fiddlers Green Amphitheatre',
    city: 'Englewood',
    state: 'CO',
    address: '6350 Greenwood Plaza Blvd',
  },
};

/**
 * Resolves venue identity and locality, properly assigning offsite venues
 * when Cervantes presents shows at partner venues (e.g., Mission Ballroom, Ogden).
 */
function resolveVenue(rawVenueText?: string): {
  venueName: string;
  city: string;
  state: string;
  address?: string;
} {
  if (!rawVenueText || rawVenueText.trim().length === 0) {
    return {
      venueName: "Cervantes' Masterpiece Ballroom",
      city: 'Denver',
      state: 'CO',
      address: '2637 Welton Street',
    };
  }

  const cleaned = rawVenueText.toLowerCase().replace(/[’']/g, '').trim();

  // Check known map
  for (const [key, venue] of Object.entries(KNOWN_VENUE_MAP)) {
    const keyCleaned = key.toLowerCase().replace(/[’']/g, '');
    if (cleaned.includes(keyCleaned) || keyCleaned.includes(cleaned)) {
      return venue;
    }
  }

  // Fallback: preserve extracted venue name with default Colorado locality
  return {
    venueName: rawVenueText.trim(),
    city: 'Denver',
    state: 'CO',
  };
}

/**
 * Extracts headliner and support billing from event titles.
 * Examples:
 *   - "Daniel Donato’s Cosmic Country AT MISSION BALLROOM" -> headliner "Daniel Donato's Cosmic Country"
 *   - "Mfinity (Bass Sets) w/ 5AM, Phurn" -> headliner "Mfinity (Bass Sets)", support ["5AM", "Phurn"]
 */
function parseArtistsFromTitle(rawTitle: string): {
  cleanTitle: string;
  isCanceled: boolean;
  artists: CandidateArtist[];
} {
  let title = rawTitle
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();

  let isCanceled = false;
  if (/^cancel(?:l?ed)?\s*[-–—:]\s*/i.test(title)) {
    isCanceled = true;
    title = title.replace(/^cancel(?:l?ed)?\s*[-–—:]\s*/i, '').trim();
  }

  // Remove " AT <VENUE>" suffix from title to prevent venue duplication in artist names
  const cleanTitle = title.replace(/\s+AT\s+[A-Z0-9\s'.\-]+$/i, '').trim();

  let headlinerPart = cleanTitle;
  let supportPart = '';

  const withMatch = cleanTitle.match(/^(.*?)\s+(?:w\/|with)\s+(.*)$/i);
  if (withMatch) {
    headlinerPart = withMatch[1].trim();
    supportPart = withMatch[2].trim();
  }

  let mainHeadliner = headlinerPart;
  let featured = '';
  const featMatch = headlinerPart.match(
    /^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i,
  );
  if (featMatch) {
    mainHeadliner = featMatch[1].trim();
    featured = featMatch[2].trim();
  }

  const artists: CandidateArtist[] = [];
  if (mainHeadliner) {
    artists.push({
      name: mainHeadliner,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }

  if (featured) {
    artists.push({
      name: featured,
      billingPosition: 'support',
      sortOrder: artists.length + 1,
    });
  }

  if (supportPart) {
    const supportActs = supportPart
      .split(/,\s*(?:and\s+)?|\s+and\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const act of supportActs) {
      artists.push({
        name: act,
        billingPosition: 'support',
        sortOrder: artists.length + 1,
      });
    }
  }

  // If no artist could be parsed, fallback to clean title as headliner
  if (artists.length === 0 && cleanTitle.length > 0) {
    artists.push({
      name: cleanTitle,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }

  return { cleanTitle, isCanceled, artists };
}

/**
 * Extracts a stable source event ID from an event link or ticket link.
 */
function extractSourceEventId(
  eventUrl?: string,
  ticketUrl?: string,
): string | undefined {
  if (ticketUrl) {
    const etixIdMatch = ticketUrl.match(/\/ticket\/p\/(\d+)/i);
    if (etixIdMatch) {
      return `etix-${etixIdMatch[1]}`;
    }
  }

  if (eventUrl) {
    const slugMatch = eventUrl.match(/\/event\/([^/]+)/i);
    if (slugMatch) {
      return slugMatch[1];
    }
  }

  return undefined;
}

/**
 * Parses Cervantes' Masterpiece Ballroom HTML calendar listing into EventCandidate objects.
 */
export function parseCervantesEvents(
  html: string,
  context: CervantesParseContext,
): EventCandidate[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const candidates: EventCandidate[] = [];

  let currentMonthYear: string | null = null;

  $('.generalView')
    .children()
    .each((_, el) => {
      const $el = $(el);

      if ($el.hasClass('rhp-events-list-separator-month')) {
        currentMonthYear = $el.text().trim();
        return;
      }

      if (!$el.hasClass('rhp-event__single-event--list')) {
        return;
      }

      const rawTitle = $el.find('.rhp-event__title--list').text().trim();
      if (!rawTitle) return;

      const dateText = $el.find('#eventDate').text().trim();
      const timeText = $el.find('.rhp-event__time-text--list').text().trim();
      const venueText = $el.find('.rhpVenueContent a').text().trim();
      const eventUrl =
        $el.find('a#eventTitle').attr('href') ||
        $el.find('a.url').attr('href') ||
        context.sourceUrl;
      const rawTicketUrl = $el.find('.rhp-event-cta a').attr('href');
      const statusClass = $el.find('.rhp-event-cta').attr('class') || '';

      // 1. Title, Status & Artist parsing
      const { cleanTitle, isCanceled, artists } =
        parseArtistsFromTitle(rawTitle);
      const isSoldOut = statusClass.includes('sold-out');
      const isStatusCanceled =
        isCanceled ||
        statusClass.includes('Canceled') ||
        statusClass.includes('canceled');

      // 2. Date & Time normalization in local timezone
      const localStartDate = parseDateString(currentMonthYear, dateText);
      const { showTime, doorTime } = parseTimeText(timeText);

      let startsAt: string | undefined;
      let doorsOpenAt: string | undefined;
      let startTimePrecision: StartTimePrecision = 'date_only';

      if (localStartDate && showTime) {
        try {
          startsAt = localDateTimeToUtcInstant(
            localStartDate,
            showTime,
            'America/Denver',
          );
          startTimePrecision = 'instant';
        } catch {
          // Fallback to date_only
          startTimePrecision = 'date_only';
        }
      }

      if (localStartDate && doorTime) {
        try {
          doorsOpenAt = localDateTimeToUtcInstant(
            localStartDate,
            doorTime,
            'America/Denver',
          );
        } catch {
          // Ignore invalid doors time
        }
      }

      // 3. Venue locality
      const venue = resolveVenue(venueText);

      // 4. Ticket URL normalization
      let ticketUrl: string | undefined;
      if (rawTicketUrl) {
        try {
          ticketUrl = normalizeUrl(rawTicketUrl);
        } catch {
          ticketUrl = rawTicketUrl;
        }
      }

      // 5. Source Event ID
      const sourceEventId = extractSourceEventId(eventUrl, rawTicketUrl);

      // 6. Provenance
      const provenance: SourceProvenance = {
        sourceId: context.sourceId,
        sourceType: 'venue',
        acquisitionMethod: 'html_http',
        sourceUrl: eventUrl,
        sourceEventId,
        rawIngestId: context.rawIngestId,
        fetchedAt: context.fetchedAt,
        contentHash: context.contentHash,
        parserVersion: context.parserVersion,
        confidence: 0.98,
      };

      const candidate: EventCandidate = {
        rawIngestId: context.rawIngestId,
        sourceId: context.sourceId,
        title: cleanTitle,
        artistNames: artists.map((a) => a.name),
        artists,
        venueName: venue.venueName,
        city: venue.city,
        state: venue.state,
        country: 'US',
        timezone: 'America/Denver',
        localStartDate: localStartDate ?? undefined,
        startsAt,
        doorsOpenAt,
        startTimePrecision,
        ticketUrl,
        eventKind: 'concert',
        confidence: 0.98,
        verificationStatus: 'unverified',
        provenance,
        rawPayload: {
          rawTitle,
          dateText,
          timeText,
          venueText,
          statusClass,
          monthYearSeparator: currentMonthYear,
          isCanceled: isStatusCanceled,
          isSoldOut,
        },
      };

      candidates.push(candidate);
    });

  return candidates;
}
