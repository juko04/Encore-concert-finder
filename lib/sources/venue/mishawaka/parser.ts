import * as cheerio from 'cheerio';
import type {
  CandidatePrice,
  EventCandidate,
  EventKind,
  StartTimePrecision,
} from '@/lib/domain/event-candidate';
import { asHttpsImageUrl } from '@/lib/domain/event-candidate';
import type { SourceProvenance } from '@/lib/domain/source';
import { isNonPublicEventTitle } from '@/lib/sources/non-events';
import {
  localDateTimeToUtcInstant,
  parseDateString,
  parseTimeText,
} from '../date-time';
import { isValidHttpUrl } from '../http-client';
import { decodeHtmlText, parseBilling } from '../tribe-events/billing';
import type { MishawakaParseContext } from './types';

const TIMEZONE = 'America/Denver';

/**
 * Titles at the Mishawaka that are dinners, family experiences or markets rather than
 * concerts (the calendar mixes them in with shows). Skipped so they never become "artists".
 */
const NON_MUSIC_TITLE_PATTERNS: readonly RegExp[] = [
  /\bmurder mystery\b/i,
  /^santa claus live\b/i,
  /\bmaker'?s market\b/i,
];

export function isMishawakaNonMusicTitle(title: string): boolean {
  const normalized = title.replace(/[‘’]/g, "'");
  return NON_MUSIC_TITLE_PATTERNS.some((re) => re.test(normalized));
}

/**
 * The calendar page's own inline script removes events for certain venue ids from the page
 * (offsite "Mishawaka Presents" listings). Honor that: those events are not shown to visitors.
 */
export function extractHiddenVenueIds(html: string): Set<string> {
  const hidden = new Set<string>();
  for (const m of html.matchAll(
    /div\[id=["']eventVenueId-(\d+)["']\][^)]*\)\s*\.each\([^)]*\)\s*\{[^}]*\.remove\(\)/g,
  )) {
    hidden.add(m[1]);
  }
  return hidden;
}

function extractSourceEventId(
  eventUrl?: string,
  ticketUrl?: string,
): string | undefined {
  const etix = ticketUrl?.match(/\/ticket\/p\/(\d+)/i);
  if (etix) return `etix-${etix[1]}`;
  const slug = eventUrl?.match(/\/event\/([^/]+)/i);
  return slug ? slug[1] : undefined;
}

/** Parses the Mishawaka (RHP Events) list-view calendar into EventCandidates. */
export function parseMishawakaEvents(
  html: string,
  context: MishawakaParseContext,
): EventCandidate[] {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const hiddenVenueIds = extractHiddenVenueIds(html);
  const fallback = context.defaultVenueConfig;
  const candidates: EventCandidate[] = [];

  $('.rhpSingleEvent').each((_, el) => {
    const $el = $(el);

    const venueDiv = $el.find('[id^="eventVenueId-"]').first();
    const venueId = (venueDiv.attr('id') ?? '').replace('eventVenueId-', '');
    if (venueId && hiddenVenueIds.has(venueId)) return;

    const rawTitle = decodeHtmlText($el.find('.rhp-event__title--list').text());
    if (!rawTitle) return;
    if (isNonPublicEventTitle(rawTitle) || isMishawakaNonMusicTitle(rawTitle)) {
      return;
    }

    const dateText = $el.find('#eventDate').text().trim();
    const timeText = $el.find('.rhp-event__time-text--list').text().trim();
    // Date text carries its own year ("Wed, Nov 25, 2026"); fall back to month separator.
    const separator = $el
      .prevAll('.rhp-events-list-separator-month')
      .first()
      .text()
      .trim();
    const localStartDate = parseDateString(
      dateText.match(/\b20\d{2}\b/) ? dateText : separator,
      dateText,
    );
    if (!localStartDate) return;

    const { showTime, doorTime } = parseTimeText(timeText);
    let startsAt: string | undefined;
    let doorsOpenAt: string | undefined;
    let startTimePrecision: StartTimePrecision = 'date_only';
    if (showTime) {
      try {
        startsAt = localDateTimeToUtcInstant(
          localStartDate,
          showTime,
          TIMEZONE,
        );
        startTimePrecision = 'instant';
      } catch {
        startsAt = undefined;
      }
    }
    if (doorTime) {
      try {
        doorsOpenAt = localDateTimeToUtcInstant(
          localStartDate,
          doorTime,
          TIMEZONE,
        );
      } catch {
        doorsOpenAt = undefined;
      }
    }

    const eventUrlRaw =
      $el.find('a#eventTitle').attr('href') || $el.find('a.url').attr('href');
    const eventUrl = isValidHttpUrl(eventUrlRaw)
      ? eventUrlRaw!
      : context.sourceUrl;
    const ctaLink = $el.find('.rhp-event-cta a').first();
    const ticketRaw = ctaLink.attr('href');
    const ticketUrl = isValidHttpUrl(ticketRaw) ? ticketRaw : undefined;
    const ctaClass = $el.find('.rhp-event-cta').first().attr('class') ?? '';
    const ctaText = ctaLink.text().trim().toLowerCase();

    const billing = parseBilling(rawTitle);
    const isSoldOut =
      /\bsold-out\b/.test(ctaClass) ||
      ctaText.includes('sold out') ||
      billing.isSoldOutInTitle;
    const isCancelled =
      billing.isCancelled || /\bcancel+ed\b/i.test(`${ctaClass} ${ctaText}`);
    const inventoryStatus: EventCandidate['inventoryStatus'] = isCancelled
      ? 'cancelled'
      : isSoldOut
        ? 'sold_out'
        : 'unknown';

    const isFree = /^free\s*:/i.test(rawTitle);
    const price: CandidatePrice | undefined = isFree
      ? { isFree: true, min: 0, max: 0, currency: 'USD' }
      : undefined;
    const eventKind: EventKind = isFree ? 'free_event' : 'concert';

    const image = asHttpsImageUrl(
      $el.find('img.rhp-event__image--list').first().attr('src'),
    );
    const stage = rawTitle.match(/\(((?:indoor|outdoor|main)\s+stage)\)/i)?.[1];

    const venueText = $el
      .find('.rhpVenueContent a, .rhp-event__venue--list a')
      .first()
      .text()
      .trim();
    const venueName = venueText || fallback?.name || 'Mishawaka Amphitheatre';

    const sourceEventId = extractSourceEventId(eventUrl, ticketUrl);
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
      confidence: 0.95,
    };

    candidates.push({
      rawIngestId: context.rawIngestId,
      sourceId: context.sourceId,
      title: billing.cleanTitle,
      artistNames: billing.artists.map((a) => a.name),
      artists: billing.artists,
      venueName,
      city: fallback?.city ?? 'Bellvue',
      state: fallback?.state ?? 'CO',
      country: 'US',
      timezone: TIMEZONE,
      localStartDate,
      startsAt,
      doorsOpenAt,
      startTimePrecision,
      ticketUrl,
      price,
      inventoryStatus,
      eventKind,
      isFestival: false,
      confidence: 0.95,
      verificationStatus: 'unverified',
      provenance,
      rawPayload: {
        rawTitle,
        dateText,
        timeText,
        status: isCancelled ? 'cancelled' : 'scheduled',
        isCanceled: isCancelled,
        isRescheduled: billing.isRescheduled,
        isSoldOut,
        stage,
        ...(image
          ? { images: { source: 'venue_website', eventImageUrl: image } }
          : {}),
      },
    });
  });

  return candidates;
}
