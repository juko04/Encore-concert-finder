import { describe, expect, it } from 'vitest';
import { extractJsonLdEvents } from '@/lib/sources/venue/jsonld-extractor';

describe('extractJsonLdEvents', () => {
  it('extracts single Schema.org Event object from script tag', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Event",
            "name": "Live Concert",
            "startDate": "2026-11-24T18:00:00-0700",
            "location": {
              "@type": "Place",
              "name": "Cervantes' Masterpiece Ballroom",
              "address": "2637 Welton Street, Denver, CO"
            },
            "offers": {
              "@type": "Offer",
              "url": "https://www.etix.com/ticket/p/12345",
              "price": 25
            }
          }
          </script>
        </head>
      </html>
    `;

    const events = extractJsonLdEvents(html);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Live Concert');
    expect(events[0].startDate).toBe('2026-11-24T18:00:00-0700');
    expect(events[0].location?.name).toBe("Cervantes' Masterpiece Ballroom");
    expect(events[0].offers?.price).toBe(25);
  });

  it('extracts multiple events from @graph array', () => {
    const html = `
      <html>
        <body>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "MusicEvent",
                "name": "Show One",
                "startDate": "2026-12-01T20:00:00-0700"
              },
              {
                "@type": "Organization",
                "name": "The Venue"
              },
              {
                "@type": "MusicEvent",
                "name": "Show Two",
                "startDate": "2026-12-02T20:00:00-0700"
              }
            ]
          }
          </script>
        </body>
      </html>
    `;

    const events = extractJsonLdEvents(html);
    expect(events).toHaveLength(2);
    expect(events[0].name).toBe('Show One');
    expect(events[1].name).toBe('Show Two');
  });

  it('ignores malformed JSON gracefully', () => {
    const html = `
      <script type="application/ld+json">{ invalid json</script>
    `;
    const events = extractJsonLdEvents(html);
    expect(events).toHaveLength(0);
  });

  it('returns empty array when no JSON-LD script is present', () => {
    expect(
      extractJsonLdEvents('<html><body>No events</body></html>'),
    ).toHaveLength(0);
    expect(extractJsonLdEvents('')).toHaveLength(0);
  });
});
