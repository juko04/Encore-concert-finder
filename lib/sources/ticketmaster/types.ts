import { z } from 'zod';

/**
 * Sanitizes URLs to remove sensitive credentials like `apikey` or `token`.
 * Prevents credentials from leaking into logs, diagnostic output, or error traces.
 */
export function redactSensitiveUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/key|token|secret|password|auth/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    // If not a valid absolute URL, sanitize via regex
    return rawUrl.replace(
      /([?&](?:apikey|api_key|token|secret)=)[^&]+/gi,
      '$1[REDACTED]',
    );
  }
}

/**
 * Sanitizes arbitrary error messages or strings to remove embedded credentials.
 */
export function redactSensitiveString(
  text: string,
  secretToRedact?: string,
): string {
  let sanitized = text.replace(
    /([?&](?:apikey|api_key|token|secret)=)[^&\s"']+/gi,
    '$1[REDACTED]',
  );
  sanitized = sanitized.replace(
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    'Bearer [REDACTED]',
  );
  sanitized = sanitized.replace(
    /((?:apiKey|api_key|token|secret|password)\s*[:=]\s*["']?)[^"'\s,]+/gi,
    '$1[REDACTED]',
  );
  if (secretToRedact && secretToRedact.trim().length > 0) {
    sanitized = sanitized.replaceAll(secretToRedact, '[REDACTED]');
  }
  return sanitized;
}

/**
 * Ticketmaster Attraction (Artist/Performer) Schema
 */
export const TicketmasterAttractionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  url: z.string().optional(),
  externalLinks: z
    .record(
      z.array(
        z.object({
          url: z.string().optional(),
          id: z.string().optional(),
        }),
      ),
    )
    .optional(),
  classifications: z
    .array(
      z.object({
        primary: z.boolean().optional(),
        segment: z.object({ name: z.string().optional() }).optional(),
        genre: z.object({ name: z.string().optional() }).optional(),
        subGenre: z.object({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export type TicketmasterAttraction = z.infer<
  typeof TicketmasterAttractionSchema
>;

/**
 * Ticketmaster Venue Schema
 */
export const TicketmasterVenueSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  postalCode: z.string().optional(),
  timezone: z.string().optional(),
  city: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  state: z
    .object({
      name: z.string().optional(),
      stateCode: z.string().optional(),
    })
    .optional(),
  country: z
    .object({
      name: z.string().optional(),
      countryCode: z.string().optional(),
    })
    .optional(),
  address: z
    .object({
      line1: z.string().optional(),
    })
    .optional(),
  location: z
    .object({
      longitude: z.string().optional(),
      latitude: z.string().optional(),
    })
    .optional(),
});

export type TicketmasterVenue = z.infer<typeof TicketmasterVenueSchema>;

/**
 * Ticketmaster Price Range Schema
 */
export const TicketmasterPriceRangeSchema = z.object({
  type: z.string().optional(),
  currency: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type TicketmasterPriceRange = z.infer<
  typeof TicketmasterPriceRangeSchema
>;

/**
 * Ticketmaster Dates Schema
 */
export const TicketmasterEventDatesSchema = z.object({
  start: z.object({
    localDate: z.string(), // YYYY-MM-DD
    localTime: z.string().optional(), // HH:mm:ss
    dateTime: z.string().optional(), // UTC ISO-8601
    dateTBD: z.boolean().optional().default(false),
    dateTBA: z.boolean().optional().default(false),
    timeTBA: z.boolean().optional().default(false),
    noSpecificTime: z.boolean().optional().default(false),
  }),
  end: z
    .object({
      localDate: z.string().optional(),
      localTime: z.string().optional(),
      dateTime: z.string().optional(),
    })
    .optional(),
  timezone: z.string().optional(),
  status: z
    .object({
      code: z.string().optional(), // onsale, offsale, canceled, postponed, rescheduled
    })
    .optional(),
});

export type TicketmasterEventDates = z.infer<
  typeof TicketmasterEventDatesSchema
>;

/**
 * Ticketmaster Classification Schema
 */
export const TicketmasterClassificationSchema = z.object({
  primary: z.boolean().optional(),
  segment: z
    .object({ id: z.string().optional(), name: z.string().optional() })
    .optional(),
  genre: z
    .object({ id: z.string().optional(), name: z.string().optional() })
    .optional(),
  subGenre: z
    .object({ id: z.string().optional(), name: z.string().optional() })
    .optional(),
  family: z.boolean().optional(),
});

export type TicketmasterClassification = z.infer<
  typeof TicketmasterClassificationSchema
>;

/**
 * Ticketmaster Event Schema
 */
export const TicketmasterEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  url: z.string().default(''),
  locale: z.string().optional(),
  info: z.string().optional(),
  pleaseNote: z.string().optional(),
  dates: TicketmasterEventDatesSchema,
  priceRanges: z.array(TicketmasterPriceRangeSchema).optional(),
  classifications: z.array(TicketmasterClassificationSchema).optional(),
  _embedded: z
    .object({
      venues: z.array(TicketmasterVenueSchema).optional(),
      attractions: z.array(TicketmasterAttractionSchema).optional(),
    })
    .optional(),
});

export type TicketmasterEvent = z.infer<typeof TicketmasterEventSchema>;

/**
 * Ticketmaster Page Metadata Schema
 */
export const TicketmasterPageSchema = z.object({
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  number: z.number(),
});

export type TicketmasterPage = z.infer<typeof TicketmasterPageSchema>;

/**
 * Top-Level Discovery API Events Response Schema
 */
export const TicketmasterEventsResponseSchema = z.object({
  _embedded: z
    .object({
      events: z.array(TicketmasterEventSchema).optional().default([]),
    })
    .optional(),
  _links: z.record(z.any()).optional(),
  page: TicketmasterPageSchema,
});

export type TicketmasterEventsResponse = z.infer<
  typeof TicketmasterEventsResponseSchema
>;

/**
 * Query Parameters for Ticketmaster Events Discovery
 */
export interface TicketmasterEventQueryParams {
  keyword?: string;
  attractionId?: string;
  venueId?: string;
  stateCode?: string;
  marketId?: string;
  city?: string;
  countryCode?: string;
  startDateTime?: string;
  endDateTime?: string;
  classificationName?: string;
  size?: number;
  page?: number;
  sort?: string;
}
