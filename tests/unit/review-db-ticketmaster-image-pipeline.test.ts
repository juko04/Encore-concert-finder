/**
 * Fixture-based (NO live Ticketmaster network) pipeline test:
 * raw ingest -> parser -> candidate -> canonicalization -> repository read, plus the
 * `--reprocess` image backfill overlay (stored candidates immutable, idempotent).
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/ticketmaster-images-events.json';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';
import {
  TicketmasterDiscoveryAdapter,
  TicketmasterEventSchema,
  overlayTicketmasterImages,
  parseTicketmasterEvent,
  runTicketmasterIngestion,
} from '@/lib/sources/ticketmaster';

const EVENT_IMG = 'https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg';
const VENUE_IMG = 'https://s1.ticketm.net/dam/v/222/venue_16_9_1024.jpg';
const ARTIST_IMG = 'https://s1.ticketm.net/dam/a/333/artist_16_9_1024.jpg';

function setup() {
  const catalogRepo = new MemoryCatalogRepository();
  const candidateRepo = new MemoryEventCandidateRepository();
  return {
    sourceRepo: new MemorySourceRepository(),
    rawIngestRepo: new MemoryRawIngestRepository(),
    candidateRepo,
    catalogRepo,
    adapter: new TicketmasterDiscoveryAdapter(),
    fixtureJson: JSON.stringify({
      _embedded: { events: fixture.events },
      page: {
        size: 20,
        totalElements: fixture.events.length,
        totalPages: 1,
        number: 0,
      },
    }),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const storedCandidates = (repo: MemoryEventCandidateRepository): any[] =>
  Array.from((repo as any).candidates.values());

describe('Ticketmaster image ingestion (fixtures, no network)', () => {
  it('persists event, venue and attraction images; placeholders/http are ignored', async () => {
    const s = setup();
    const r = await runTicketmasterIngestion({
      ...s,
      useFixture: true,
      persist: true,
    });
    expect(r.canonicalEventsCreated).toBe(fixture.events.length);

    const events = await s.catalogRepo.listEvents();
    const withImage = events.filter((e) => e.imageUrl);
    expect(withImage.length).toBeGreaterThan(0);
    // No fallback placeholder and no insecure URL ever reaches the catalog
    for (const e of events) {
      if (e.imageUrl) {
        expect(e.imageUrl.startsWith('https://')).toBe(true);
        expect(e.imageUrl).not.toContain('placeholder');
      }
    }
    const first = events.find((e) => e.imageUrl === EVENT_IMG);
    expect(first).toBeTruthy();
    const detail = await s.catalogRepo.getEventById(first!.id);
    expect(detail?.venue?.imageUrl).toBe(VENUE_IMG);
    expect(detail?.artists.find((a) => a.imageUrl === ARTIST_IMG)).toBeTruthy();
    // Events whose payload had no real image stay null (never fabricated)
    expect(events.some((e) => !e.imageUrl)).toBe(true);
  });

  it('--reprocess backfills images onto already-ingested events; stored candidates stay immutable; re-running is idempotent', async () => {
    const s = setup();
    await runTicketmasterIngestion({ ...s, useFixture: true, persist: true });

    // Simulate data ingested BEFORE the parser read images: strip images from the catalog
    // and from stored candidates (the raw payload in raw_ingests still contains them).
    for (const e of (s.catalogRepo as any).events.values()) e.imageUrl = null;
    for (const v of (s.catalogRepo as any).venues.values()) v.imageUrl = null;
    for (const a of (s.catalogRepo as any).artists.values()) a.imageUrl = null;
    for (const c of storedCandidates(s.candidateRepo)) {
      if (c.rawPayload) delete c.rawPayload.images;
      for (const a of c.artists ?? []) delete a.imageUrl;
    }
    expect((await s.catalogRepo.listEvents()).every((e) => !e.imageUrl)).toBe(
      true,
    );

    const candidatesBefore = JSON.stringify(storedCandidates(s.candidateRepo));
    const countBefore = storedCandidates(s.candidateRepo).length;

    const r2 = await runTicketmasterIngestion({
      ...s,
      useFixture: true,
      persist: true,
      reprocess: true,
    });
    expect(r2.candidatesReused).toBeGreaterThan(0);
    expect(r2.candidatesPersisted).toBe(0);

    // Backfilled in the catalog...
    const after = await s.catalogRepo.listEvents();
    expect(after.find((e) => e.imageUrl === EVENT_IMG)).toBeTruthy();
    // ...but stored candidates were NOT mutated and none were added (immutable)
    expect(storedCandidates(s.candidateRepo).length).toBe(countBefore);
    expect(JSON.stringify(storedCandidates(s.candidateRepo))).toBe(
      candidatesBefore,
    );

    // Idempotent: a second reprocess changes nothing
    const snapshot = JSON.stringify(
      (await s.catalogRepo.listEvents()).map((e) => [e.id, e.imageUrl]),
    );
    const r3 = await runTicketmasterIngestion({
      ...s,
      useFixture: true,
      persist: true,
      reprocess: true,
    });
    expect(r3.candidatesPersisted).toBe(0);
    expect(
      JSON.stringify(
        (await s.catalogRepo.listEvents()).map((e) => [e.id, e.imageUrl]),
      ),
    ).toBe(snapshot);
    expect(storedCandidates(s.candidateRepo).length).toBe(countBefore);
  });

  it('without --reprocess an already-resolved candidate is skipped (no image backfill)', async () => {
    const s = setup();
    await runTicketmasterIngestion({ ...s, useFixture: true, persist: true });
    for (const e of (s.catalogRepo as any).events.values()) e.imageUrl = null;
    const r = await runTicketmasterIngestion({
      ...s,
      useFixture: true,
      persist: true,
    });
    expect(r.candidatesSkipped).toBeGreaterThan(0);
    expect((await s.catalogRepo.listEvents()).every((e) => !e.imageUrl)).toBe(
      true,
    );
  });

  it('artist images are matched by attraction id only, never by name (overlay)', () => {
    const ctx = {
      sourceId: 'b0000000-0000-0000-0000-000000000002',
      rawIngestId: 'c0000000-0000-0000-0000-000000000001',
      sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
      fetchedAt: '2026-11-24T12:00:00Z',
      contentHash: 'h',
      parserVersion: '1.0.0',
    };
    const withImage = TicketmasterEventSchema.parse(fixture.events[0]);
    const clash = TicketmasterEventSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...fixture.events[0],
          id: 'tm-name-clash',
          images: undefined,
          _embedded: {
            ...fixture.events[0]._embedded,
            attractions: fixture.events[0]._embedded.attractions.map((x) => ({
              id: `${x.id}-OTHER`,
              name: x.name,
              // deliberately no images
            })),
          },
        }),
      ),
    );
    const freshWithImage = parseTicketmasterEvent(withImage, ctx);
    const storedClash = parseTicketmasterEvent(clash, ctx);
    expect(freshWithImage.artists?.[0].imageUrl).toBe(ARTIST_IMG);
    expect(storedClash.artists?.[0].name).toBe(
      freshWithImage.artists?.[0].name,
    );
    expect(storedClash.artists?.[0].imageUrl).toBeUndefined();

    const merged = overlayTicketmasterImages(storedClash, freshWithImage);
    // same name, different attraction id: must NOT receive the image
    expect(merged.artists?.[0].imageUrl).toBeUndefined();
  });
});
