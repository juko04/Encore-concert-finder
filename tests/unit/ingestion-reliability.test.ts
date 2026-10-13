import { describe, expect, it } from 'vitest';
import {
  classifyIngestionError,
  PipelineDatabaseError,
  runTicketmasterIngestion,
  TicketmasterApiClient,
  TicketmasterAuthError,
  TicketmasterDiscoveryAdapter,
  TicketmasterNetworkError,
  TicketmasterRateLimitError,
  TicketmasterValidationError,
} from '@/lib/sources/ticketmaster';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';

describe('Phase 2 PR 3: Ingestion Reliability & Discover Improvements', () => {
  describe('Error Classification Taxonomy', () => {
    it('classifies authentication errors (HTTP 401, 403, missing key) as auth_failure', () => {
      const err401 = new TicketmasterAuthError(
        'Ticketmaster API request failed with HTTP 401 at https://app.ticketmaster.com/events.json?apikey=[REDACTED]: Invalid Key',
        { statusCode: 401 },
      );
      const report401 = classifyIngestionError(err401);
      expect(report401.category).toBe('auth_failure');
      expect(report401.statusCode).toBe(401);

      const err403 = new TicketmasterAuthError(
        'Ticketmaster API request failed with HTTP 403: Forbidden account quota',
        { statusCode: 403 },
      );
      const report403 = classifyIngestionError(err403);
      expect(report403.category).toBe('auth_failure');
      expect(report403.statusCode).toBe(403);

      // Raw unclassified string fallback matching
      const genericAuthMsg =
        'Request failed with HTTP 401: Unauthorized access with key SECRET_KEY_99';
      const fallbackReport = classifyIngestionError(
        new Error(genericAuthMsg),
        'SECRET_KEY_99',
      );
      expect(fallbackReport.category).toBe('auth_failure');
      expect(fallbackReport.statusCode).toBe(401);
      expect(fallbackReport.message).not.toContain('SECRET_KEY_99');
      expect(fallbackReport.message).toContain('[REDACTED]');
    });

    it('classifies rate limit errors (HTTP 429) as rate_limit_exceeded', () => {
      const rateLimitErr = new TicketmasterRateLimitError(
        'Ticketmaster API rate limit exceeded (HTTP 429) at https://app.ticketmaster.com/events.json. Max retries (3) reached.',
        { statusCode: 429 },
      );
      const report = classifyIngestionError(rateLimitErr);
      expect(report.category).toBe('rate_limit_exceeded');
      expect(report.statusCode).toBe(429);
      expect(report.message).toContain('HTTP 429');

      // Generic string fallback
      const generic429 = classifyIngestionError(
        new Error('HTTP 429: Too many requests, rate limit exhausted'),
      );
      expect(generic429.category).toBe('rate_limit_exceeded');
      expect(generic429.statusCode).toBe(429);
    });

    it('classifies validation and malformed payload errors as validation_error', () => {
      const validationErr = new TicketmasterValidationError(
        'Ticketmaster API response schema validation failed at https://app.ticketmaster.com/events.json: page.totalElements: Required',
        { statusCode: 422 },
      );
      const report = classifyIngestionError(validationErr);
      expect(report.category).toBe('validation_error');
      expect(report.statusCode).toBe(422);

      // Deep pagination limit validation
      const paginationErr = new TicketmasterValidationError(
        'Ticketmaster API deep pagination limit exceeded: page (50) * size (20) = 1000 >= 1000',
        { statusCode: 400 },
      );
      expect(classifyIngestionError(paginationErr).category).toBe(
        'validation_error',
      );

      // Malformed JSON response
      const malformedJsonErr = classifyIngestionError(
        new Error(
          'Malformed JSON response from Ticketmaster API: Unexpected token < in JSON',
        ),
      );
      expect(malformedJsonErr.category).toBe('validation_error');
    });

    it('classifies transient network, timeout, and server errors as network_error', () => {
      const netErr = new TicketmasterNetworkError(
        'Failed to fetch from Ticketmaster API after 3 attempts at https://app.ticketmaster.com/events.json',
      );
      const report = classifyIngestionError(netErr);
      expect(report.category).toBe('network_error');

      // Aborted fetch timeout
      const timeoutErr = classifyIngestionError(
        new Error('The operation was aborted due to timeout'),
      );
      expect(timeoutErr.category).toBe('network_error');

      // Connection reset
      const connErr = classifyIngestionError(
        new Error('fetch failed: ECONNRESET'),
      );
      expect(connErr.category).toBe('network_error');
    });

    it('classifies database persistence failures as database_error', () => {
      const dbErr = new PipelineDatabaseError(
        'Database error during ingestion persistence: relation "event_candidates" does not exist',
      );
      const report = classifyIngestionError(dbErr);
      expect(report.category).toBe('database_error');
      expect(report.message).toContain('relation "event_candidates"');

      // Generic PostgreSQL error string fallback
      const genericPgErr = classifyIngestionError(
        new Error(
          'duplicate key value violates unique constraint "uq_artist_provider_external_id"',
        ),
      );
      expect(genericPgErr.category).toBe('database_error');
    });

    it('strictly redacts sensitive credentials across all error classifications', () => {
      const secret = 'MY_SUPER_SECRET_TOKEN_98765';
      const rawError = new Error(
        `Failed to authenticate with apikey=${secret} and bearer token: ${secret}`,
      );
      const report = classifyIngestionError(rawError, secret);

      expect(report.message).not.toContain(secret);
      expect(report.message).toContain('[REDACTED]');
    });
    it('safely serializes error reports containing nested Error objects, credentials, and circular references', () => {
      const secret = 'tm_super_secret_key_888';
      const nestedError = new Error(`Connection timeout for key=${secret}`);
      (nestedError as unknown as { code: string }).code = 'ECONNRESET';

      const circularObj: Record<string, unknown> = {
        apiKey: secret,
        url: `https://app.ticketmaster.com/v2/events.json?apikey=${secret}`,
        nested: nestedError,
      };
      circularObj.self = circularObj;

      const dbErr = new PipelineDatabaseError(
        `Failed to commit batch transaction with key=${secret}`,
        circularObj,
      );

      const report = classifyIngestionError(dbErr, secret);
      expect(report.category).toBe('database_error');
      expect(report.message).not.toContain(secret);
      expect(report.message).toContain('[REDACTED]');

      // Must be safely serializable with JSON.stringify without throwing circular error
      const serialized = JSON.stringify(report);
      expect(serialized).toBeDefined();
      expect(serialized).not.toContain(secret);
      expect(serialized).toContain('[REDACTED]');
      expect(serialized).toContain('[Circular Reference]');

      const parsed = JSON.parse(serialized);
      expect(parsed.details.apiKey).toBe('[REDACTED]');
      expect(parsed.details.url).toContain('apikey=[REDACTED]');
      expect(parsed.details.nested.message).toContain('[REDACTED]');
    });
  });

  describe('Ingestion Telemetry & Replay Invariants', () => {
    function setupTestPipeline() {
      const sourceRepo = new MemorySourceRepository();
      const rawIngestRepo = new MemoryRawIngestRepository();
      const candidateRepo = new MemoryEventCandidateRepository();
      const catalogRepo = new MemoryCatalogRepository();
      const adapter = new TicketmasterDiscoveryAdapter();

      return {
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
      };
    }

    it('returns per-run execution timing and duration in dry-run mode', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
        setupTestPipeline();

      const result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        persist: false,
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(1);
      expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result.startedAt).getTime(),
      );

      // Verify safe dry-run: zero database entities created
      expect(result.rawIngestsPersisted).toBe(0);
      expect(result.candidatesPersisted).toBe(0);
      expect(result.canonicalEventsCreated).toBe(0);
      expect(catalogRepo.events.size).toBe(0);
    });

    it('accurately distinguishes telemetry counters for First Ingestion and Identical Replay', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
        setupTestPipeline();

      // 1. FIRST INGESTION
      const run1 = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        persist: true,
      });

      expect(run1.rawIngestsPersisted).toBe(1);
      expect(run1.rawIngestsReused).toBe(0);
      expect(run1.candidatesParsed).toBe(6);
      expect(run1.candidatesPersisted).toBe(6);
      expect(run1.candidatesReused).toBe(0);
      expect(run1.canonicalEventsCreated).toBe(5);
      expect(run1.canonicalEventsMatched).toBe(0);
      expect(run1.candidatesNeedsReview).toBe(1);
      expect(run1.reviewReasons['missing_venue_locality']).toBe(1);

      // Verify source health success recorded
      const sourceRecord = await sourceRepo.getById(run1.source.id);
      expect(sourceRecord?.consecutiveFailures).toBe(0);
      expect(sourceRecord?.lastFetchedAt).toBeDefined();

      // 2. IDENTICAL REPLAY (same fixture without reprocess)
      const run2 = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        persist: true,
      });

      // Raw ingest was reused by contentHash
      expect(run2.rawIngestsPersisted).toBe(0);
      expect(run2.rawIngestsReused).toBe(1);

      // Candidates are reused; 0 newly persisted candidate rows
      expect(run2.candidatesPersisted).toBe(0);
      expect(run2.candidatesReused).toBe(6);

      // CRITICAL REPLAY INVARIANT: zero new events created, and previously created events are NOT reported as matched!
      expect(run2.canonicalEventsCreated).toBe(0);
      expect(run2.canonicalEventsMatched).toBe(0);

      // Review candidates are preserved in reporting
      expect(run2.candidatesNeedsReview).toBe(1);
      expect(run2.reviewReasons['missing_venue_locality']).toBe(1);

      // Total canonical events in catalog remain exactly 5
      expect(catalogRepo.events.size).toBe(5);
    });

    it('correctly increments canonicalEventsMatched on Updated Provider Observation', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
        setupTestPipeline();

      // Run 1: First ingestion of initial fixture
      await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        persist: true,
      });

      expect(catalogRepo.events.size).toBe(5);

      // Run 2: Ingest an updated observation for an existing event (e.g. Khruangbin with new ticket price or updated timestamp)
      const initialJson = JSON.parse(
        await import('fs').then((fs) =>
          fs.readFileSync(
            'tests/fixtures/ticketmaster-events-response.json',
            'utf-8',
          ),
        ),
      );

      // Keep only event 0 (Khruangbin) with an updated price and slightly modified title note
      const updatedEvent = {
        ...initialJson._embedded.events[0],
        priceRanges: [{ min: 45.0, max: 95.0, currency: 'USD' }],
      };
      const updatedPayload = JSON.stringify({
        ...initialJson,
        _embedded: {
          events: [updatedEvent],
        },
      });

      const updateRun = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        fixtureJson: updatedPayload,
        persist: true,
      });

      // New raw ingest row and new candidate row persisted because payload is distinct
      expect(updateRun.rawIngestsPersisted).toBe(1);
      expect(updateRun.rawIngestsReused).toBe(0);
      expect(updateRun.candidatesPersisted).toBe(1);
      expect(updateRun.candidatesReused).toBe(0);

      // It matched against the existing canonical event, updating it instead of creating a duplicate
      expect(updateRun.canonicalEventsCreated).toBe(0);
      expect(updateRun.canonicalEventsMatched).toBe(1);
      expect(updateRun.candidatesNeedsReview).toBe(0);

      // Total canonical events remains 5 (no duplicates created!)
      expect(catalogRepo.events.size).toBe(5);
    });

    it('does not label parsing or validation failures as database errors, and invokes recordFailure', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo } =
        setupTestPipeline();

      // Custom adapter that fails during parsing
      const brokenAdapter = new TicketmasterDiscoveryAdapter();
      brokenAdapter.parse = async () => {
        throw new TicketmasterValidationError(
          'Schema validation failed: Missing required field dates.start.localDate',
        );
      };

      await expect(
        runTicketmasterIngestion({
          sourceRepo,
          rawIngestRepo,
          candidateRepo,
          catalogRepo,
          adapter: brokenAdapter,
          useFixture: true,
          persist: true,
        }),
      ).rejects.toThrow(TicketmasterValidationError);

      // Source health consecutiveFailures must increment
      const source = await sourceRepo.getBySlug('ticketmaster-discovery');
      expect(source?.consecutiveFailures).toBe(1);
    });

    it('populates source attribution badges on canonical events in listEvents (Tech Debt 1.3)', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
        setupTestPipeline();

      const result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        persist: true,
      });

      expect(result.canonicalEventsCreated).toBe(5);

      // Retrieve events via catalogRepo.listEvents()
      const listed = await catalogRepo.listEvents({ limit: 10 });
      expect(listed.length).toBe(5);

      // Every returned summary has source attribution populated
      for (const summary of listed) {
        expect(summary.sources).toBeDefined();
        expect(summary.sources!.length).toBeGreaterThanOrEqual(1);
        expect(summary.sources![0].name).toBe('Ticketmaster Discovery API');
        expect(summary.sources![0].slug).toBe('ticketmaster-discovery');
        expect(summary.sourceName).toBe('Ticketmaster Discovery API');
      }
    });

    it('strictly isolates needs_review candidates so they are NEVER returned by listEvents on /discover (Tech Debt 1.4 invariant)', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
        setupTestPipeline();

      const result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        useFixture: true,
        persist: true,
      });

      // Fixture event 6 ("Secret Mountain Pop-up" at "Mystery Ranch Venue") lacks venue city locality
      expect(result.candidatesNeedsReview).toBe(1);
      expect(result.reviewReasons['missing_venue_locality']).toBe(1);

      // Verify that candidate exists in candidate resolutions as needs_review
      const resolutions = Array.from(catalogRepo.candidateResolutions.values());
      const needsReviewResolution = resolutions.find(
        (r) => r.status === 'needs_review',
      );
      expect(needsReviewResolution).toBeDefined();
      expect(needsReviewResolution?.eventId).toBeNull();

      // List all events visible on discover
      const discoverEvents = await catalogRepo.listEvents({ limit: 50 });
      expect(discoverEvents.length).toBe(5);

      // Secret Mountain Pop-up MUST NOT be present in canonical events
      const secretShow = discoverEvents.find((e) =>
        e.title.includes('Secret Mountain Pop-up'),
      );
      expect(secretShow).toBeUndefined();

      // Candidates needing review are 100% isolated from Discover
      for (const event of discoverEvents) {
        expect(event.title).not.toBe('Secret Mountain Pop-up');
      }
    });

    it('never defaults missing venue to event title in listEvents (Tech Debt 1.4)', async () => {
      const { catalogRepo } = setupTestPipeline();

      // Directly create an event with null venueId to test fallback behavior
      const orphanedEvent = await catalogRepo.createEvent({
        name: 'The National — Special Showcase',
        normalizedName: 'the national special showcase',
        eventKind: 'concert',
        status: 'scheduled',
        venueId: null, // No resolved venue
        city: 'Denver',
        region: 'CO',
        timezone: 'America/Denver',
        localStartDate: '2026-11-30',
        startTimePrecision: 'date_only',
        isMultiDay: false,
      });

      const listed = await catalogRepo.listEvents();
      const found = listed.find((e) => e.id === orphanedEvent.id);
      expect(found).toBeDefined();

      // Must be 'Venue TBA', NEVER 'The National — Special Showcase'
      expect(found?.venueName).toBe('Venue TBA');
      expect(found?.venueName).not.toBe('The National — Special Showcase');
    });

    it('wraps and classifies unexpected database persistence failures into PipelineDatabaseError and increments source failures', async () => {
      const { sourceRepo, rawIngestRepo, candidateRepo, catalogRepo, adapter } =
        setupTestPipeline();

      // Force rawIngestRepo to throw simulated database error
      rawIngestRepo.getBySourceUrlAndContentHash = async () => {
        throw new Error('connection lost to postgres pool');
      };

      await expect(
        runTicketmasterIngestion({
          sourceRepo,
          rawIngestRepo,
          candidateRepo,
          catalogRepo,
          adapter,
          useFixture: true,
          persist: true,
        }),
      ).rejects.toThrow(PipelineDatabaseError);

      const source = await sourceRepo.getBySlug('ticketmaster-discovery');
      expect(source?.consecutiveFailures).toBe(1);
    });
  });
});
