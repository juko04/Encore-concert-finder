import type {
  CandidatePrice,
  EventCandidate,
  EventKind,
  StartTimePrecision,
} from '@/lib/domain/event-candidate';
import { asHttpsImageUrl } from '@/lib/domain/event-candidate';
import type { SourceProvenance } from '@/lib/domain/source';
import { isNonPublicEventTitle } from '@/lib/sources/non-events';
import { localDateTimeToUtcInstant } from '../date-time';
import { isValidHttpUrl } from '../http-client';
import { decodeHtmlText, parseBilling } from './billing';
import type {
  TribeEvent,
  TribeEventsResponse,
  TribeParseContext,
  TribeVenue,
} from './types';

const DEFAULT_TZ = 'America/Denver';

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function asVenue(venue: TribeEvent['venue']): TribeVenue | null {
  if (!venue || Array.isArray(venue) || typeof venue !== 'object') return null;
  return venue as TribeVenue;
}

/** Genres exactly as the site writes them (custom field labelled "Genre"). Never inferred. */
export function extractTribeGenres(event: TribeEvent): string[] {
  const fields = event.custom_fields;
  if (!fields || Array.isArray(fields) || typeof fields !== 'object') return [];
  const out: string[] = [];
  for (const field of Object.values(fields)) {
    if (!field || !/^genres?$/i.test((field.label ?? '').trim())) continue;
    const raw = field.value;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const text = decodeHtmlText(v);
      if (text && !out.some((g) => g.toLowerCase() === text.toLowerCase())) {
        out.push(text);
      }
    }
  }
  return out;
}

function parsePrice(event: TribeEvent): {
  price?: CandidatePrice;
  isFreeStated: boolean;
  isSoldOutStated: boolean;
} {
  const costText = decodeHtmlText(event.cost);
  const isFreeStated = /^free$/i.test(costText);
  const isSoldOutStated = /sold\s*out/i.test(costText);
  if (isFreeStated) {
    return {
      price: { isFree: true, min: 0, max: 0, currency: 'USD' },
      isFreeStated,
      isSoldOutStated,
    };
  }
  const values = (event.cost_details?.values ?? [])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return { isFreeStated, isSoldOutStated };
  const currency = (event.cost_details?.currency_code || 'USD').toUpperCase();
  return {
    price: {
      min: Math.min(...values),
      max: Math.max(...values),
      currency,
      isFree: false,
      feeStatus: 'unknown',
    },
    isFreeStated,
    isSoldOutStated,
  };
}

/** Parses a Tribe Events REST v1 JSON page into EventCandidates. */
export function parseTribeEvents(
  body: string,
  context: TribeParseContext,
): EventCandidate[] {
  if (!body || typeof body !== 'string') return [];
  let data: TribeEventsResponse;
  try {
    data = JSON.parse(body) as TribeEventsResponse;
  } catch {
    return [];
  }
  if (!data || !Array.isArray(data.events)) return [];

  const fallback =
    context.useConfigVenueFallback === false
      ? undefined
      : context.defaultVenueConfig;
  const timezoneFallback =
    context.defaultVenueConfig?.defaultTimezone ?? DEFAULT_TZ;
  const candidates: EventCandidate[] = [];

  for (const event of data.events) {
    if (!event || event.hide_from_listings || event.is_virtual) continue;
    if (event.status && event.status !== 'publish') continue;

    const rawTitle = decodeHtmlText(event.title);
    if (!rawTitle || isNonPublicEventTitle(rawTitle)) continue;

    const startMatch = (event.start_date ?? '').match(
      /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?/,
    );
    if (!startMatch) continue;
    const localStartDate = startMatch[1];
    const showTime = startMatch[2]
      ? `${startMatch[2]}:${startMatch[3] ?? '00'}`
      : null;

    const timezone =
      event.timezone && isValidTimeZone(event.timezone)
        ? event.timezone
        : timezoneFallback;

    let startsAt: string | undefined;
    let startTimePrecision: StartTimePrecision = 'date_only';
    if (showTime && !event.all_day) {
      try {
        startsAt = localDateTimeToUtcInstant(
          localStartDate,
          showTime,
          timezone,
        );
        startTimePrecision = 'instant';
      } catch {
        startsAt = undefined;
      }
    }

    const venue = asVenue(event.venue);
    const venueName = decodeHtmlText(venue?.venue) || fallback?.name || '';
    if (!venueName) continue;
    const city = decodeHtmlText(venue?.city) || fallback?.city || undefined;
    const state =
      decodeHtmlText(venue?.stateprovince || venue?.state) ||
      fallback?.state ||
      undefined;

    const billing = parseBilling(rawTitle);
    const { price, isFreeStated, isSoldOutStated } = parsePrice(event);
    const isSoldOut = isSoldOutStated || billing.isSoldOutInTitle;
    const inventoryStatus: EventCandidate['inventoryStatus'] =
      billing.isCancelled ? 'cancelled' : isSoldOut ? 'sold_out' : 'unknown';

    const eventUrl = isValidHttpUrl(event.url) ? event.url! : context.sourceUrl;
    const websiteUrl = isValidHttpUrl(event.website) ? event.website! : '';
    const ticketUrl = websiteUrl || eventUrl;

    const image =
      event.image && typeof event.image === 'object'
        ? asHttpsImageUrl(event.image.url)
        : null;
    const genres = extractTribeGenres(event);

    const eventKind: EventKind = isFreeStated ? 'free_event' : 'concert';
    const sourceEventId = `${context.defaultVenueConfig?.slug ?? 'tribe'}:${event.id}`;

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
      city,
      state,
      country: 'US',
      timezone,
      localStartDate,
      startsAt,
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
        sourceEventId,
        costText: decodeHtmlText(event.cost),
        status: billing.isCancelled ? 'cancelled' : 'scheduled',
        isCanceled: billing.isCancelled,
        isRescheduled: billing.isRescheduled,
        isSoldOut,
        venueAddress: decodeHtmlText(venue?.address) || undefined,
        venuePostalCode: decodeHtmlText(venue?.zip) || undefined,
        ...(genres.length > 0 ? { genres } : {}),
        ...(image
          ? { images: { source: 'venue_website', eventImageUrl: image } }
          : {}),
      },
    });
  }

  return candidates;
}
