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
import type { VenueSourceConfig } from '../types';
import type { IndependentVenueParseContext } from './types';

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  may_: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Authoritative map of known venues in the Denver Independent Venue Group
 * ecosystem and frequently co-promoted partner Colorado locations.
 */
const KNOWN_VENUE_MAP: Record<
  string,
  {
    venueName: string;
    city: string;
    state: string;
    address?: string;
    postalCode?: string;
  }
> = {
  'larimer lounge': {
    venueName: 'Larimer Lounge',
    city: 'Denver',
    state: 'CO',
    address: '2721 Larimer St',
    postalCode: '80205',
  },
  treehouse: {
    venueName: 'Larimer Lounge - Treehouse',
    city: 'Denver',
    state: 'CO',
    address: '2721 Larimer St',
    postalCode: '80205',
  },
  campground: {
    venueName: 'Larimer Lounge - Campground',
    city: 'Denver',
    state: 'CO',
    address: '2721 Larimer St',
    postalCode: '80205',
  },
  skihouse: {
    venueName: 'Larimer Lounge - Treehouse',
    city: 'Denver',
    state: 'CO',
    address: '2721 Larimer St',
    postalCode: '80205',
  },
  'lost lake': {
    venueName: 'Lost Lake Lounge',
    city: 'Denver',
    state: 'CO',
    address: '3602 E. Colfax',
    postalCode: '80206',
  },
  'lost lake lounge': {
    venueName: 'Lost Lake Lounge',
    city: 'Denver',
    state: 'CO',
    address: '3602 E. Colfax',
    postalCode: '80206',
  },
  'globe hall': {
    venueName: 'Globe Hall',
    city: 'Denver',
    state: 'CO',
    address: '4483 Logan Street',
    postalCode: '80216',
  },
  'mission ballroom': {
    venueName: 'Mission Ballroom',
    city: 'Denver',
    state: 'CO',
    address: '4242 Wynkoop St',
    postalCode: '80216',
  },
  'ogden theatre': {
    venueName: 'Ogden Theatre',
    city: 'Denver',
    state: 'CO',
    address: '935 E Colfax Ave',
    postalCode: '80218',
  },
  'bluebird theater': {
    venueName: 'Bluebird Theater',
    city: 'Denver',
    state: 'CO',
    address: '3317 E Colfax Ave',
    postalCode: '80206',
  },
  'gothic theatre': {
    venueName: 'Gothic Theatre',
    city: 'Englewood',
    state: 'CO',
    address: '3263 S Broadway',
    postalCode: '80113',
  },
  'red rocks': {
    venueName: 'Red Rocks Amphitheatre',
    city: 'Morrison',
    state: 'CO',
    address: '18300 W Alameda Pkwy',
    postalCode: '80465',
  },
  'fiddlers green': {
    venueName: 'Fiddlers Green Amphitheatre',
    city: 'Englewood',
    state: 'CO',
    address: '6350 Greenwood Plaza Blvd',
    postalCode: '80111',
  },
  'the black sheep': {
    venueName: 'The Black Sheep',
    city: 'Colorado Springs',
    state: 'CO',
    address: '2106 E Platte Ave',
    postalCode: '80909',
  },
  'cervantes masterpiece ballroom': {
    venueName: "Cervantes' Masterpiece Ballroom",
    city: 'Denver',
    state: 'CO',
    address: '2637 Welton Street',
    postalCode: '80205',
  },
  'cervantes other side': {
    venueName: "Cervantes' Other Side",
    city: 'Denver',
    state: 'CO',
    address: '2637 Welton Street',
    postalCode: '80205',
  },
};

/**
 * Resolves venue identity and locality for Denver Independent Venue Group events.
 * Correctly attributes offsite co-promotions.
 * Never invents locality for unknown locations (omits city/state so pipeline routes to needs_review).
 */
export function resolveVenue(
  rawVenueText?: string,
  eventUrl?: string,
  defaultConfig?: VenueSourceConfig,
): {
  venueName: string;
  city?: string;
  state?: string;
  address?: string;
  postalCode?: string;
} {
  const text = rawVenueText?.trim();

  if (text) {
    const cleaned = text
      .toLowerCase()
      .replace(/[’'–—-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    for (const [key, venue] of Object.entries(KNOWN_VENUE_MAP)) {
      const keyCleaned = key
        .toLowerCase()
        .replace(/[’'–—-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.includes(keyCleaned) || keyCleaned.includes(cleaned)) {
        return venue;
      }
    }

    // Attempt to extract city and state from event URL slug if available
    // (e.g. /event/.../<venue-slug>/boulder-colorado/)
    if (eventUrl) {
      const match = eventUrl.match(/\/([a-z0-9-]+)-(colorado)\/?$/i);
      if (match) {
        const city = match[1]
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        return {
          venueName: text,
          city,
          state: 'CO',
        };
      }
    }

    // Fallback for explicitly named offsite venue: preserve name, omit city/state
    // so pipeline routes to needs_review with missing_venue_locality
    return {
      venueName: text,
    };
  }

  // If no venue text is present, fallback to default source venue configuration
  if (defaultConfig) {
    return {
      venueName: defaultConfig.name,
      city: defaultConfig.city,
      state: defaultConfig.state,
      address: defaultConfig.defaultAddress,
      postalCode: defaultConfig.defaultPostalCode,
    };
  }

  return {
    venueName: 'Unknown Venue',
  };
}

/**
 * Cleans session markers (e.g. EARLY SHOW, LATE SHOW, PATIO SHOW, solo, DJ SET)
 * from artist names while keeping them available on the event title.
 */
function cleanArtistName(name: string): string {
  return name
    .replace(
      /\s*\((?:EARLY\s+SHOW(?:\s+ADDED)?|LATE\s+SHOW|MATINEE|NIGHT\s+SHOW|PATIO\s+SHOW|DJ\s+SET(?:\s*\/\s*AFTERS)?)\)/i,
      '',
    )
    .trim();
}

/**
 * Extracts headliner and support artists from event titles.
 * Safely handles non-music listings without fabricating artists.
 */
export function parseArtistsFromTitle(rawTitle: string): {
  cleanTitle: string;
  isCanceled: boolean;
  isFestival: boolean;
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

  // Strip trailing " AT <VENUE>" suffix
  let cleanTitle = title.replace(/\s+AT\s+[A-Z0-9\s'.\-]+$/i, '').trim();

  // Strip trailing (FREE EVENT), (FREE SHOW), or (FREE)
  cleanTitle = cleanTitle
    .replace(/\s*\((?:FREE\s+(?:EVENT|SHOW)|FREE)\)/i, '')
    .trim();

  // Non-music event filters: Do not fabricate musical artists for shuttle buses, merch pop-ups, or bingo
  if (
    /(?:Official\s+)?Merch\s+Pop-Up/i.test(cleanTitle) ||
    /Bus\s+To\s+Show\s+Pickup\s+Spot/i.test(cleanTitle) ||
    /^B(?:ASS|PM)\s+BINGO(?!\s+AFTERS)/i.test(cleanTitle)
  ) {
    return {
      cleanTitle,
      isCanceled,
      isFestival: false,
      artists: [],
    };
  }

  // Detect festival
  const isFestival = /\bfestival\b|\bfest\b/i.test(cleanTitle);

  // Strip stage prefixes on multi-stage venues (e.g. "Campground – ...", "Treehouse – ...", "Skihouse – ...")
  const stageMatch = cleanTitle.match(
    /^(?:Campground|Treehouse|Skihouse)\s*[-–—:]\s*(.*)$/i,
  );
  if (stageMatch) {
    cleanTitle = stageMatch[1].trim();
  }

  // Strip recurring bingo afters series prefix: "BASS BINGO AFTERS – <Artists>"
  const bingoAftersMatch = cleanTitle.match(
    /^B(?:ASS|PM)\s+BINGO\s+AFTERS\s*[-–—:]\s*(.*)$/i,
  );
  if (bingoAftersMatch) {
    cleanTitle = bingoAftersMatch[1].trim();
  }

  // Strip promoter presents prefix: "SiriusXM Octane Presents ..." or "HiTech Presents ..."
  const presentsMatch = cleanTitle.match(
    /^(?:SiriusXM\s+[A-Za-z0-9\s]+|HiTech)\s+Presents(?:\s*:)?\s*(.*)$/i,
  );
  if (presentsMatch) {
    cleanTitle = presentsMatch[1].trim();
  }

  // Handle "Open House feat. <Artists>" recurring club night series
  const openHouseMatch = cleanTitle.match(
    /^Open\s+House(?:\s+feat\.?|\s+featuring)\s+(.*)$/i,
  );
  if (openHouseMatch) {
    const rawActs = openHouseMatch[1]
      .split(/\s*[-–—]\s*|,\s*|\s*\+\s*/)
      .map((s) => cleanArtistName(s))
      .filter((s) => s.length > 0);

    const artists: CandidateArtist[] = [];
    if (rawActs.length > 0) {
      artists.push({
        name: rawActs[0],
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      for (let i = 1; i < rawActs.length; i++) {
        artists.push({
          name: rawActs[i],
          billingPosition: 'support',
          sortOrder: i + 1,
        });
      }
    }
    return { cleanTitle, isCanceled, isFestival, artists };
  }

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

  // Strip tour names from main headliner if present before w/ (e.g. "LETDOWN. – The Happy Tour" -> "LETDOWN.")
  const tourMatch = mainHeadliner.match(
    /^(.*?)\s*[-–—]\s*(?:The\s+)?[A-Za-z0-9\s'.\-]+\s+Tour$/i,
  );
  if (tourMatch && tourMatch[1].trim().length > 0) {
    mainHeadliner = tourMatch[1].trim();
  }

  const artists: CandidateArtist[] = [];

  // Check if mainHeadliner itself is dash-separated multiple artists (e.g. "Trill Sain Sound Project – Space Hippy")
  // Only split if not containing parentheses or tour markers
  if (
    !supportPart &&
    !featured &&
    /[–—]/.test(mainHeadliner) &&
    !/tour|presents|edition/i.test(mainHeadliner)
  ) {
    const dashParts = mainHeadliner
      .split(/\s*[–—]\s*/)
      .map((s) => cleanArtistName(s))
      .filter((s) => s.length > 0);

    if (dashParts.length > 1) {
      artists.push({
        name: dashParts[0],
        billingPosition: 'headliner',
        sortOrder: 1,
      });
      for (let i = 1; i < dashParts.length; i++) {
        artists.push({
          name: dashParts[i],
          billingPosition: 'support',
          sortOrder: i + 1,
        });
      }
      return { cleanTitle, isCanceled, isFestival, artists };
    }
  }

  const primaryName = cleanArtistName(mainHeadliner);
  if (primaryName) {
    artists.push({
      name: primaryName,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }

  if (featured) {
    // Featured might contain multiple comma or dash-separated acts
    const featActs = featured
      .split(/,\s*(?:and\s+)?|\s+and\s+|\s*[-–—]\s*|\s*\+\s*/i)
      .map((s) => cleanArtistName(s))
      .filter((s) => s.length > 0);

    for (const act of featActs) {
      artists.push({
        name: act,
        billingPosition: 'support',
        sortOrder: artists.length + 1,
      });
    }
  }

  if (supportPart) {
    const supportActs = supportPart
      .split(/,\s*(?:and\s+)?|\s+and\s+|\s*[-–—]\s*|\s*\+\s*/i)
      .map((s) => cleanArtistName(s))
      .filter((s) => s.length > 0);

    for (const act of supportActs) {
      artists.push({
        name: act,
        billingPosition: 'support',
        sortOrder: artists.length + 1,
      });
    }
  }

  // Fallback: if no artists parsed and not a festival, use clean title
  if (artists.length === 0 && cleanTitle.length > 0 && !isFestival) {
    artists.push({
      name: cleanArtistName(cleanTitle),
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }

  return { cleanTitle, isCanceled, isFestival, artists };
}

/**
 * Extracts a stable source event identifier from ticket link or event page URL.
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
 * Parses official calendar HTML from Denver Independent Venue Group websites
 * (Larimer Lounge, Lost Lake Lounge, Globe Hall) into EventCandidate objects.
 */
export function parseIndependentVenueEvents(
  html: string,
  context: IndependentVenueParseContext,
): EventCandidate[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const candidates: EventCandidate[] = [];

  let currentMonthYear: string | null = null;
  const refDate = context.fetchedAt ? new Date(context.fetchedAt) : new Date();
  let activeYear = refDate.getFullYear();
  let lastMonthNum = refDate.getMonth() + 1;

  // Search inside .generalView or root document for month separators and single events in DOM order
  const elements =
    $('.generalView').length > 0
      ? $('.generalView').find(
          '.rhp-events-list-separator-month, .rhpSingleEvent',
        )
      : $('.rhp-events-list-separator-month, .rhpSingleEvent');

  elements.each((_, el) => {
    const $el = $(el);

    // 1. Month/Year separator node (List View)
    if ($el.hasClass('rhp-events-list-separator-month')) {
      currentMonthYear = $el.text().trim();
      const ym = currentMonthYear.match(/\b(20\d{2})\b/);
      if (ym) {
        activeYear = parseInt(ym[1], 10);
      }
      const mm = currentMonthYear.match(/\b([a-zA-Z]{3,9})\b/i);
      if (mm && MONTH_MAP[mm[1].toLowerCase()]) {
        lastMonthNum = parseInt(MONTH_MAP[mm[1].toLowerCase()], 10);
      }
      return;
    }

    if (!$el.hasClass('rhpSingleEvent')) {
      return;
    }

    // 2. Event Title
    const rawTitle = $el
      .find('.rhp-event__title--list, .rhp-event__title--grid, h2, h3')
      .first()
      .text()
      .trim();
    if (!rawTitle) return;

    // 3. Date Text
    const dateText = $el.find('#eventDate').first().text().trim();
    if (!dateText) return;

    // Resolve standardized localStartDate (YYYY-MM-DD)
    let localStartDate: string | null = null;
    if (currentMonthYear) {
      localStartDate = parseDateString(currentMonthYear, dateText);
    } else {
      // Grid view sequence rollover (e.g. Larimer Lounge without separator divs)
      const dateMatch = dateText.match(
        /(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?([a-z]{3,9})\s+(\d{1,2})/i,
      );
      if (dateMatch) {
        const monthNum = parseInt(MONTH_MAP[dateMatch[1].toLowerCase()], 10);
        const day = String(parseInt(dateMatch[2], 10)).padStart(2, '0');
        if (monthNum < lastMonthNum) {
          activeYear++;
        }
        lastMonthNum = monthNum;
        localStartDate = `${activeYear}-${String(monthNum).padStart(2, '0')}-${day}`;
      }
    }

    // 4. Time Text & Normalization
    const timeText = (
      $el.find('.rhp-event__time-text--list').text().trim() ||
      $el.find('.eventDoorStartDate').text().replace(/\s+/g, ' ').trim()
    ).trim();

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
        // ignore invalid doors time
      }
    }

    // 5. Venue locality
    const venueText = $el
      .find('.rhpVenueContent a, .rhpVenueContent')
      .first()
      .text()
      .trim();
    const eventUrl =
      $el.find('a#eventTitle, a.url').attr('href') || context.sourceUrl;
    const venue = resolveVenue(venueText, eventUrl, context.defaultVenueConfig);

    // 6. Ticket link & Status
    const statusClass = $el.find('.rhp-event-cta').attr('class') || '';
    const rawTicketUrl = $el.find('.rhp-event-cta a').attr('href');
    let ticketUrl: string | undefined;

    if (
      rawTicketUrl &&
      !rawTicketUrl.startsWith('javascript:') &&
      rawTicketUrl.trim().length > 0
    ) {
      try {
        ticketUrl = normalizeUrl(rawTicketUrl);
      } catch {
        ticketUrl = rawTicketUrl;
      }
    }

    const isSoldOut = statusClass.includes('sold-out');
    const { cleanTitle, isCanceled, isFestival, artists } =
      parseArtistsFromTitle(rawTitle);
    const isStatusCanceled =
      isCanceled ||
      statusClass.includes('canceled') ||
      statusClass.includes('Canceled');

    // 7. Source Event ID
    const sourceEventId = extractSourceEventId(eventUrl, rawTicketUrl);

    // 8. Provenance
    const provenance: SourceProvenance = {
      sourceId: context.sourceId,
      sourceType: 'venue',
      acquisitionMethod: 'html_http',
      sourceUrl: eventUrl,
      sourceEventId,
      rawIngestId: context.rawIngestId,
      fetchedAt: context.fetchedAt ?? new Date().toISOString(),
      contentHash: context.contentHash ?? '',
      parserVersion: context.parserVersion ?? '1.0.0',
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
      eventKind: isFestival ? 'festival' : 'concert',
      isFestival,
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
        status: isStatusCanceled ? 'cancelled' : 'scheduled',
        isCanceled: isStatusCanceled,
        isSoldOut,
      },
    };

    candidates.push(candidate);
  });

  return candidates;
}
