import { describe, expect, it, vi, beforeEach } from 'vitest';
import fixtureData from '../fixtures/ticketmaster-events-response.json';
import {
  TicketmasterDiscoveryAdapter,
  TicketmasterApiClient,
  parseTicketmasterEvent,
  redactSensitiveString,
  redactSensitiveUrl,
  TicketmasterEvent,
} from '@/lib/sources/ticketmaster';
import type { RawIngest } from '@/lib/domain/source';

describe('Ticketmaster Ingestion Foundation', () => {
  const dummyContext = {
    sourceId: 'b0000000-0000-0000-0000-000000000002',
    rawIngestId: 'raw-ingest-test-123',
    sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
    fetchedAt: '2026-10-10T12:00:00Z',
    contentHash: 'mock-content-hash-abc',
    parserVersion: '1.0.0',
  };

  describe('Credential Redaction & URL Sanitization', () => {
    it('redacts apikey in URLs', () => {
      const raw =
        'https://app.ticketmaster.com/discovery/v2/events.json?apikey=SECRET12345&stateCode=CO';
      const sanitized = redactSensitiveUrl(raw);

      expect(sanitized).not.toContain('SECRET12345');
      expect(sanitized).toContain('apikey=%5BREDACTED%5D');
      expect(sanitized).toContain('stateCode=CO');
    });

    it('redacts credentials in error strings', () => {
      const errorMsg =
        'Failed to fetch: https://app.ticketmaster.com/discovery/v2/events.json?apikey=MY_SECRET_KEY&foo=bar';
      const sanitized = redactSensitiveString(errorMsg);

      expect(sanitized).not.toContain('MY_SECRET_KEY');
      expect(sanitized).toContain('apikey=[REDACTED]');
    });
  });

  describe('Ticketmaster Event Parser (parseTicketmasterEvent)', () => {
    const events = fixtureData._embedded
      .events as unknown as TicketmasterEvent[];

    it('parses standard single-act concert with instant start time precision and pricing', () => {
      const evt1 = events.find((e) => e.id === 'tm-evt-001')!;
      const candidate = parseTicketmasterEvent(evt1, dummyContext);

      expect(candidate.sourceEventId).toBe('tm-evt-001');
      expect(candidate.title).toBe('The Black Keys - Dropout Boogie Tour');
      expect(candidate.artistNames).toEqual(['The Black Keys']);
      expect(candidate.artists?.[0].name).toBe('The Black Keys');
      expect(candidate.artists?.[0].billingPosition).toBe('headliner');

      // External IDs: Ticketmaster + Spotify
      const extIds = candidate.artists?.[0].externalIds || [];
      expect(extIds).toContainEqual({
        provider: 'ticketmaster',
        externalId: 'K8vZ9171Cff',
        providerUrl:
          'https://www.ticketmaster.com/the-black-keys-tickets/artist/821044',
      });
      expect(extIds).toContainEqual({
        provider: 'spotify',
        externalId: '7mnBLXK823vNxN3UWB7Gfz',
        providerUrl: 'https://open.spotify.com/artist/7mnBLXK823vNxN3UWB7Gfz',
      });

      // Venue
      expect(candidate.venueName).toBe('Red Rocks Amphitheatre');
      expect(candidate.city).toBe('Morrison');
      expect(candidate.state).toBe('CO');
      expect(candidate.country).toBe('US');

      // Temporal
      expect(candidate.localStartDate).toBe('2026-10-15');
      expect(candidate.startTimePrecision).toBe('instant');
      expect(candidate.startsAt).toBe('2026-10-16T01:30:00Z');
      expect(candidate.timezone).toBe('America/Denver');
      expect(candidate.rawPayload?.status).toBe('scheduled');
      expect(candidate.eventKind).toBe('concert');

      // Price
      expect(candidate.price?.min).toBe(49.5);
      expect(candidate.price?.max).toBe(129.5);
      expect(candidate.price?.currency).toBe('USD');

      // URL normalization (tracking stripped)
      expect(candidate.ticketUrl).toBe(
        'https://www.ticketmaster.com/the-black-keys-morrison-colorado-10-15-2026/event/1E005D01',
      );
      expect(candidate.ticketUrl).not.toContain('utm_source');
      expect(candidate.ticketUrl).not.toContain('gclid');

      // Provenance
      expect(candidate.provenance.sourceId).toBe(dummyContext.sourceId);
      expect(candidate.provenance.sourceEventId).toBe('tm-evt-001');
      expect(candidate.provenance.confidence).toBe(0.95);
    });

    it('parses multi-act bills with headliner and opening support acts', () => {
      const evt2 = events.find((e) => e.id === 'tm-evt-002')!;
      const candidate = parseTicketmasterEvent(evt2, dummyContext);

      expect(candidate.artistNames).toEqual(['Khruangbin', 'Men I Trust']);
      expect(candidate.artists?.length).toBe(2);

      const [headliner, support] = candidate.artists!;
      expect(headliner.name).toBe('Khruangbin');
      expect(headliner.billingPosition).toBe('headliner');
      expect(headliner.sortOrder).toBe(0);

      expect(support.name).toBe('Men I Trust');
      expect(support.billingPosition).toBe('support');
      expect(support.sortOrder).toBe(1);

      expect(candidate.venueName).toBe('Mission Ballroom');
      expect(candidate.city).toBe('Denver');
    });

    it('parses multi-day festival into multi_day_festival eventKind with date-only precision', () => {
      const evt3 = events.find((e) => e.id === 'tm-evt-003')!;
      const candidate = parseTicketmasterEvent(evt3, dummyContext);

      expect(candidate.isFestival).toBe(true);
      expect(candidate.eventKind).toBe('multi_day_festival');
      expect(candidate.localStartDate).toBe('2027-06-17');
      expect(candidate.localEndDate).toBe('2027-06-20');
      expect(candidate.startTimePrecision).toBe('date_only');
      expect(candidate.startsAt).toBeUndefined();
      expect(candidate.venueName).toBe('Telluride Town Park');
      expect(candidate.city).toBe('Telluride');
    });

    it('parses date-only show with timeTBA = true without fabricating startsAt', () => {
      const evt4 = events.find((e) => e.id === 'tm-evt-004')!;
      const candidate = parseTicketmasterEvent(evt4, dummyContext);

      expect(candidate.localStartDate).toBe('2026-11-05');
      expect(candidate.startTimePrecision).toBe('date_only');
      expect(candidate.startsAt).toBeUndefined();
      expect(candidate.price?.min).toBe(20.0);
    });

    it('maps canceled status properly', () => {
      const evt5 = events.find((e) => e.id === 'tm-evt-005')!;
      const candidate = parseTicketmasterEvent(evt5, dummyContext);

      expect(candidate.rawPayload).toBeDefined();
      expect(candidate.venueName).toBe('Ogden Theatre');
      // Status in raw payload preserves normalized and provider status
      expect(candidate.rawPayload?.status).toBe('cancelled');
      expect(candidate.rawPayload?.providerStatus).toBe('canceled');
    });

    it('preserves undefined city when venue lacks locality', () => {
      const evt6 = events.find((e) => e.id === 'tm-evt-006')!;
      const candidate = parseTicketmasterEvent(evt6, dummyContext);

      expect(candidate.venueName).toBe('Mystery Ranch Venue');
      expect(candidate.city).toBeUndefined();
      expect(candidate.resolutionStatus).toBe('needs_review');
      expect(candidate.resolutionProvenance).toEqual({
        reasons: ['missing_venue_locality'],
      });
      expect(candidate.confidence).toBe(0.5);
    });

    it('handles missing timezone without fabricating America/Denver fallback', () => {
      const baseEvt = events[0];
      const evtMissingTz: TicketmasterEvent = {
        ...baseEvt,
        id: 'tm-evt-no-tz',
        dates: {
          ...baseEvt.dates,
          timezone: undefined,
        },
        _embedded: {
          ...baseEvt._embedded,
          venues: [
            {
              id: 'ven-1',
              name: 'Venue With No Timezone',
              city: { name: 'Denver' },
              state: { stateCode: 'CO' },
            },
          ],
        },
      };

      const candidate = parseTicketmasterEvent(evtMissingTz, dummyContext);
      expect(candidate.timezone).toBeUndefined();
      expect(candidate.resolutionStatus).toBe('needs_review');
      expect(candidate.resolutionProvenance?.reasons).toContain(
        'missing_or_invalid_timezone',
      );
      expect(candidate.confidence).toBe(0.5);
    });

    it('handles missing venue without fabricating Unknown Venue', () => {
      const baseEvt = events[0];
      const evtMissingVenue: TicketmasterEvent = {
        ...baseEvt,
        id: 'tm-evt-no-venue',
        _embedded: {
          ...baseEvt._embedded,
          venues: undefined,
        },
      };

      const candidate = parseTicketmasterEvent(evtMissingVenue, dummyContext);
      expect(candidate.venueName).toBe('');
      expect(candidate.venueName).not.toBe('Unknown Venue');
      expect(candidate.city).toBeUndefined();
      expect(candidate.resolutionStatus).toBe('needs_review');
      expect(candidate.resolutionProvenance?.reasons).toContain(
        'missing_venue_identity',
      );
      expect(candidate.resolutionProvenance?.reasons).toContain(
        'missing_venue_locality',
      );
    });

    it('handles missing attractions without substituting event name as artist', () => {
      const baseEvt = events[0];
      const evtMissingAttractions: TicketmasterEvent = {
        ...baseEvt,
        id: 'tm-evt-no-artists',
        name: 'Underground Electronic Showcase',
        _embedded: {
          ...baseEvt._embedded,
          attractions: undefined,
        },
      };

      const candidate = parseTicketmasterEvent(
        evtMissingAttractions,
        dummyContext,
      );
      expect(candidate.artistNames).toEqual([]);
      expect(candidate.artists).toEqual([]);
      expect(
        candidate.artists?.some(
          (a) => a.name === 'Underground Electronic Showcase',
        ),
      ).toBe(false);
      expect(candidate.resolutionStatus).toBe('needs_review');
      expect(candidate.resolutionProvenance?.reasons).toContain(
        'missing_artist_identity',
      );
    });
  });

  describe('TicketmasterDiscoveryAdapter', () => {
    const adapter = new TicketmasterDiscoveryAdapter({ apiKey: 'mock-key' });

    it('exposes correct metadata and interface properties', () => {
      expect(adapter.id).toBe('b0000000-0000-0000-0000-000000000002');
      expect(adapter.slug).toBe('ticketmaster-discovery');
      expect(adapter.sourceType).toBe('ticketing');
      expect(adapter.acquisitionMethod).toBe('api');
      expect(adapter.parserVersion).toBe('1.0.0');
    });

    it('parses raw ingests from deterministic fixture into candidates', async () => {
      const rawIngest: RawIngest = {
        id: 'raw-ingest-456',
        sourceId: adapter.id,
        sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
        acquisitionMethod: 'api',
        fetchedAt: '2026-10-10T12:00:00Z',
        contentHash: 'hash-xyz',
        contentType: 'application/json',
        rawContent: JSON.stringify(fixtureData),
        httpStatus: 200,
        parserVersion: adapter.parserVersion,
      };

      const candidates = await adapter.parse([rawIngest]);
      expect(candidates.length).toBe(6);

      // Verify every candidate links back to rawIngest ID
      for (const cand of candidates) {
        expect(cand.rawIngestId).toBe('raw-ingest-456');
        expect(cand.sourceId).toBe(adapter.id);
        expect(cand.provenance.rawIngestId).toBe('raw-ingest-456');
      }
    });

    it('throws descriptive error on malformed JSON rawContent', async () => {
      const malformedIngest: RawIngest = {
        id: 'raw-ingest-bad-json',
        sourceId: adapter.id,
        sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
        acquisitionMethod: 'api',
        fetchedAt: '2026-10-10T12:00:00Z',
        contentHash: 'bad-hash',
        contentType: 'application/json',
        rawContent: '{"invalid": json syntax oops}',
        httpStatus: 200,
        parserVersion: adapter.parserVersion,
      };

      await expect(adapter.parse([malformedIngest])).rejects.toThrow(
        /Failed to parse Ticketmaster raw ingest JSON/,
      );
    });

    it('throws descriptive error on invalid response schema rawContent', async () => {
      const invalidSchemaIngest: RawIngest = {
        id: 'raw-ingest-bad-schema',
        sourceId: adapter.id,
        sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
        acquisitionMethod: 'api',
        fetchedAt: '2026-10-10T12:00:00Z',
        contentHash: 'bad-hash',
        contentType: 'application/json',
        rawContent: JSON.stringify({ invalid: 'schema-missing-page' }),
        httpStatus: 200,
        parserVersion: adapter.parserVersion,
      };

      await expect(adapter.parse([invalidSchemaIngest])).rejects.toThrow(
        /schema validation failed/,
      );
    });

    it('returns empty candidate list on valid empty response with 0 events', async () => {
      const emptyIngest: RawIngest = {
        id: 'raw-ingest-empty',
        sourceId: adapter.id,
        sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
        acquisitionMethod: 'api',
        fetchedAt: '2026-10-10T12:00:00Z',
        contentHash: 'empty-hash',
        contentType: 'application/json',
        rawContent: JSON.stringify({
          page: {
            size: 20,
            totalElements: 0,
            totalPages: 0,
            number: 0,
          },
        }),
        httpStatus: 200,
        parserVersion: adapter.parserVersion,
      };

      const candidates = await adapter.parse([emptyIngest]);
      expect(candidates).toEqual([]);
    });
  });

  describe('TicketmasterApiClient Edge Cases & Safeguards', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('throws when API key is missing', async () => {
      delete process.env.TICKETMASTER_API_KEY;
      const client = new TicketmasterApiClient({ apiKey: '' });

      await expect(client.fetchEvents()).rejects.toThrowError(
        /Ticketmaster API key is required/,
      );
    });

    it('rejects deep pagination exceeding page * size >= 1000', async () => {
      const client = new TicketmasterApiClient({ apiKey: 'test-key' });

      await expect(
        client.fetchEvents({ page: 20, size: 50 }), // 20 * 50 = 1000
      ).rejects.toThrowError(/deep pagination limit exceeded/);
    });

    it('enforces conservative inter-request rate limit spacing', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'test-key',
        requestsPerSecond: 2, // 500ms delay
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(fixtureData),
      });
      global.fetch = fetchMock;

      const start = Date.now();
      await client.fetchEvents({ size: 1 });
      await client.fetchEvents({ size: 1 });
      const elapsed = Date.now() - start;

      // Two consecutive calls with 2 req/s must take at least ~450ms
      expect(elapsed).toBeGreaterThanOrEqual(450);
    });

    it('retries on HTTP 429 with Retry-After header', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'test-key',
        requestsPerSecond: 100, // fast for testing
        maxRetries: 2,
      });

      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ 'Retry-After': '0' }),
            text: async () => 'Rate limit exceeded',
          };
        }
        return {
          ok: true,
          text: async () => JSON.stringify(fixtureData),
        };
      });

      const result = await client.fetchEvents({ size: 2 });
      expect(attempts).toBe(2);
      expect(result.response._embedded?.events?.length).toBe(6);
    });

    it('sanitizes API keys when throwing server errors', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'SUPER_SECRET_TOKEN',
        requestsPerSecond: 100,
        maxRetries: 0,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized: Invalid key SUPER_SECRET_TOKEN',
      });

      try {
        await client.fetchEvents();
        expect.unreachable();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).not.toContain('SUPER_SECRET_TOKEN');
        expect(msg).toContain('apikey=[REDACTED]');
      }
    });

    it.each([
      { status: 400, name: 'Bad Request' },
      { status: 401, name: 'Unauthorized' },
      { status: 403, name: 'Forbidden' },
    ])(
      'fails immediately on HTTP $status without retrying regardless of maxRetries',
      async ({ status, name }) => {
        const client = new TicketmasterApiClient({
          apiKey: 'SECRET_API_KEY_123',
          requestsPerSecond: 100,
          maxRetries: 3,
        });

        let fetchCalls = 0;
        global.fetch = vi.fn().mockImplementation(async () => {
          fetchCalls++;
          return {
            ok: false,
            status,
            text: async () => `${name} error with key SECRET_API_KEY_123`,
          };
        });

        try {
          await client.fetchEvents();
          expect.unreachable();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Exactly 1 fetch call: no retries!
          expect(fetchCalls).toBe(1);
          expect(msg).toContain(`HTTP ${status}`);
          // Credentials redacted
          expect(msg).not.toContain('SECRET_API_KEY_123');
          expect(msg).toContain('apikey=[REDACTED]');
        }
      },
    );

    it('fails immediately on HTTP 200 with malformed JSON without retrying', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'test-key',
        requestsPerSecond: 100,
        maxRetries: 3,
      });

      let fetchCalls = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return {
          ok: true,
          text: async () => '{"broken": json',
        };
      });

      await expect(client.fetchEvents()).rejects.toThrow(/Malformed JSON/);
      expect(fetchCalls).toBe(1);
    });

    it('fails immediately on HTTP 200 with invalid schema without retrying', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'test-key',
        requestsPerSecond: 100,
        maxRetries: 3,
      });

      let fetchCalls = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return {
          ok: true,
          text: async () => JSON.stringify({ notAValidResponse: true }),
        };
      });

      await expect(client.fetchEvents()).rejects.toThrow(
        /schema validation failed/,
      );
      expect(fetchCalls).toBe(1);
    });

    it('handles HTTP-date formatted Retry-After header on HTTP 429', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'test-key',
        requestsPerSecond: 100,
        maxRetries: 2,
      });

      let attempts = 0;
      const futureDate = new Date(Date.now() + 50).toUTCString();

      global.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ 'Retry-After': futureDate }),
            text: async () => 'Rate limit exceeded',
          };
        }
        return {
          ok: true,
          text: async () => JSON.stringify(fixtureData),
        };
      });

      const res = await client.fetchEvents({ size: 1 });
      expect(attempts).toBe(2);
      expect(res.response._embedded?.events?.length).toBe(6);
    });

    it('rejects invalid pagination parameters immediately', async () => {
      const client = new TicketmasterApiClient({ apiKey: 'test-key' });

      await expect(client.fetchEvents({ page: -1 })).rejects.toThrow(
        /Invalid page parameter/,
      );
      await expect(client.fetchEvents({ size: 0 })).rejects.toThrow(
        /Invalid size parameter/,
      );
      await expect(client.fetchEvents({ size: 201 })).rejects.toThrow(
        /Invalid size parameter/,
      );
    });

    it('maintains concurrency-safe rate limit spacing under parallel requests', async () => {
      const client = new TicketmasterApiClient({
        apiKey: 'test-key',
        requestsPerSecond: 5, // 200ms spacing
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(fixtureData),
      });

      const start = Date.now();
      // Launch 3 requests in parallel
      await Promise.all([
        client.fetchEvents({ size: 1 }),
        client.fetchEvents({ size: 1 }),
        client.fetchEvents({ size: 1 }),
      ]);
      const elapsed = Date.now() - start;

      // 3 serial requests with 200ms spacing should take at least ~350ms
      expect(elapsed).toBeGreaterThanOrEqual(350);
    });
  });
});
