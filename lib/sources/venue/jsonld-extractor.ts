import * as cheerio from 'cheerio';

export interface SchemaOrgEvent {
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  image?: string | string[];
  description?: string;
  location?: {
    '@type'?: string;
    name?: string;
    address?:
      | string
      | {
          streetAddress?: string;
          addressLocality?: string;
          addressRegion?: string;
          postalCode?: string;
          addressCountry?: string;
        };
  };
  offers?: {
    '@type'?: string;
    url?: string;
    price?: number | string;
    priceCurrency?: string;
    availability?: string;
  };
  performer?:
    | {
        '@type'?: string;
        name?: string;
      }
    | Array<{
        '@type'?: string;
        name?: string;
      }>;
}

/**
 * Extracts and parses Schema.org Event/MusicEvent objects from HTML JSON-LD scripts.
 */
export function extractJsonLdEvents(html: string): SchemaOrgEvent[] {
  if (!html || typeof html !== 'string') return [];

  const $ = cheerio.load(html);
  const events: SchemaOrgEvent[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const rawJson = $(el).html();
      if (!rawJson) return;

      const parsed = JSON.parse(rawJson);

      function processNode(node: unknown) {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
          for (const item of node) processNode(item);
          return;
        }

        const obj = node as Record<string, unknown>;

        // If graph is present
        if ('@graph' in obj && Array.isArray(obj['@graph'])) {
          for (const item of obj['@graph']) processNode(item);
          return;
        }

        const type = obj['@type'];
        const isEventType =
          type === 'Event' ||
          type === 'MusicEvent' ||
          (Array.isArray(type) &&
            (type.includes('Event') || type.includes('MusicEvent')));

        if (isEventType) {
          events.push(obj as unknown as SchemaOrgEvent);
        }
      }

      processNode(parsed);
    } catch {
      // Ignore malformed JSON-LD scripts
    }
  });

  return events;
}
