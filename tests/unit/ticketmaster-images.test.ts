import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/ticketmaster-images-events.json';
import {
  TicketmasterEventSchema,
  overlayTicketmasterImages,
  parseTicketmasterEvent,
  selectTicketmasterImage,
  type TicketmasterEvent,
} from '@/lib/sources/ticketmaster';
import {
  getCandidateImages,
  type EventCandidate,
} from '@/lib/domain/event-candidate';
import { CanonicalizationCoordinator } from '@/lib/entity-resolution/canonicalization-coordinator';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';

const context = {
  sourceId: 'b0000000-0000-0000-0000-000000000002',
  rawIngestId: 'c0000000-0000-0000-0000-000000000001',
  sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
  fetchedAt: '2026-11-24T12:00:00Z',
  contentHash: 'images-hash',
  parserVersion: '1.0.0',
};

// Parse through the real zod schema so the test fails if `images` is stripped.
const events = fixture.events.map((e) =>
  TicketmasterEventSchema.parse(e),
) as TicketmasterEvent[];
const byId = (id: string) => events.find((e) => e.id === id)!;

type StoredCandidate = EventCandidate & {
  rawIngestId: string;
  sourceId: string;
};
// Candidates handed to the coordinator are always persisted ones (ids set).
const asStored = (c: EventCandidate) => c as StoredCandidate;

// Simulates a candidate stored before images were parsed.
const stripArtistImages = (artists: EventCandidate['artists']) =>
  artists?.map((a) => {
    const copy = { ...a };
    delete copy.imageUrl;
    return copy;
  });

describe('selectTicketmasterImage', () => {
  it('returns null for missing or empty image lists', () => {
    expect(selectTicketmasterImage(undefined)).toBeNull();
    expect(selectTicketmasterImage(null)).toBeNull();
    expect(selectTicketmasterImage([])).toBeNull();
  });

  it('prefers 16:9 within 640-1200px, closest to 1024px', () => {
    const url = selectTicketmasterImage(byId('tm-img-001').images);
    expect(url).toBe('https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg');
  });

  it('skips fallback placeholders and non-https URLs', () => {
    expect(selectTicketmasterImage(byId('tm-img-002').images)).toBeNull();
    expect(
      selectTicketmasterImage([
        { url: 'http://x.example/a.jpg', ratio: '16_9', width: 1024 },
        { url: 'not a url', ratio: '16_9', width: 1024 },
      ]),
    ).toBeNull();
  });

  it('prefers a real image over a fallback even if the fallback is a better size', () => {
    const url = selectTicketmasterImage([
      {
        url: 'https://s1.ticketm.net/placeholder.jpg',
        ratio: '16_9',
        width: 1024,
        fallback: true,
      },
      { url: 'https://s1.ticketm.net/real.jpg', ratio: '4_3', width: 305 },
    ]);
    expect(url).toBe('https://s1.ticketm.net/real.jpg');
  });

  it('falls back to the closest-width image when no 16:9 exists', () => {
    const url = selectTicketmasterImage([
      { url: 'https://s1.ticketm.net/small.jpg', ratio: '3_2', width: 305 },
      { url: 'https://s1.ticketm.net/medium.jpg', ratio: '3_2', width: 1024 },
    ]);
    expect(url).toBe('https://s1.ticketm.net/medium.jpg');
  });
});

describe('parseTicketmasterEvent images', () => {
  it('maps event, attraction and venue images to the right entities', () => {
    const candidate = parseTicketmasterEvent(byId('tm-img-001'), context);

    expect(candidate.artists?.[0].imageUrl).toBe(
      'https://s1.ticketm.net/dam/a/333/artist_16_9_1024.jpg',
    );
    // The opener has no images: must stay empty, never inherit another artist's image.
    expect(candidate.artists?.[1].name).toBe('Image Test Opener');
    expect(candidate.artists?.[1].imageUrl).toBeUndefined();

    expect(getCandidateImages(candidate)).toEqual({
      eventImageUrl: 'https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg',
      venueImageUrl: 'https://s1.ticketm.net/dam/v/222/venue_16_9_1024.jpg',
    });
    expect(candidate.rawPayload?.images).toMatchObject({
      source: 'ticketmaster',
    });
  });

  it('never fabricates images from placeholders or insecure URLs', () => {
    const candidate = parseTicketmasterEvent(byId('tm-img-002'), context);
    expect(getCandidateImages(candidate)).toEqual({
      eventImageUrl: null,
      venueImageUrl: null,
    });
    expect(candidate.rawPayload?.images).toBeUndefined();
    expect(candidate.artists?.[0].imageUrl).toBeUndefined();
  });

  it('leaves everything null when the payload has no images', () => {
    const candidate = parseTicketmasterEvent(byId('tm-img-003'), context);
    expect(getCandidateImages(candidate)).toEqual({
      eventImageUrl: null,
      venueImageUrl: null,
    });
    expect(candidate.artists?.[0]).not.toHaveProperty('imageUrl');
  });
});

describe('overlayTicketmasterImages', () => {
  it('adds current images to a stored candidate in memory without mutating it', () => {
    const fresh = parseTicketmasterEvent(byId('tm-img-001'), context);
    const stored = parseTicketmasterEvent(byId('tm-img-003'), context);
    // Pretend the stored candidate is the same attraction ingested before images existed.
    const storedOld: EventCandidate = {
      ...fresh,
      rawPayload: { id: 'tm-img-001' },
      artists: stripArtistImages(fresh.artists),
    };
    void stored;

    const merged = overlayTicketmasterImages(storedOld, fresh);

    expect(getCandidateImages(merged).eventImageUrl).toBe(
      'https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg',
    );
    expect(merged.artists?.[0].imageUrl).toBe(
      'https://s1.ticketm.net/dam/a/333/artist_16_9_1024.jpg',
    );
    expect(merged.artists?.[1].imageUrl).toBeUndefined();
    // Original stored candidate untouched
    expect(storedOld.rawPayload).toEqual({ id: 'tm-img-001' });
    expect(storedOld.artists?.[0]).not.toHaveProperty('imageUrl');
  });

  it('returns the stored candidate unchanged when nothing new is available', () => {
    const none = parseTicketmasterEvent(byId('tm-img-003'), context);
    expect(overlayTicketmasterImages(none, none)).toBe(none);
  });
});

describe('canonicalization persists images (fill-if-empty)', () => {
  it('stores event, venue and artist images on create', async () => {
    const repo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator(repo);
    const candidate = parseTicketmasterEvent(byId('tm-img-001'), context);

    const result = await coordinator.canonicalize(asStored(candidate));
    expect(result.status).toBe('created');

    const detail = await repo.getEventById(result.eventId!);
    expect(detail?.imageUrl).toBe(
      'https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg',
    );
    expect(detail?.venue?.imageUrl).toBe(
      'https://s1.ticketm.net/dam/v/222/venue_16_9_1024.jpg',
    );
    const headliner = detail?.artists.find(
      (a) => a.name === 'Image Test Headliner',
    );
    const opener = detail?.artists.find((a) => a.name === 'Image Test Opener');
    expect(headliner?.imageUrl).toBe(
      'https://s1.ticketm.net/dam/a/333/artist_16_9_1024.jpg',
    );
    expect(opener?.imageUrl).toBeNull();

    const [summary] = await repo.listEvents();
    expect(summary.imageUrl).toBe(detail?.imageUrl);

    // Provenance for the event image is recorded as field evidence
    const imageEvidence = Array.from(repo.eventFieldEvidence.values()).filter(
      (e) => e.fieldName === 'image_url',
    );
    expect(imageEvidence).toHaveLength(1);
    expect(imageEvidence[0].sourceId).toBe(context.sourceId);
  });

  it('keeps null images when the source provides none', async () => {
    const repo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator(repo);
    const result = await coordinator.canonicalize(
      asStored(parseTicketmasterEvent(byId('tm-img-003'), context)),
    );
    const detail = await repo.getEventById(result.eventId!);
    expect(detail?.imageUrl ?? null).toBeNull();
    expect(detail?.venue?.imageUrl ?? null).toBeNull();
    expect(detail?.artists[0].imageUrl ?? null).toBeNull();
  });

  it('never overwrites an existing image on re-ingest, but fills missing ones', async () => {
    const repo = new MemoryCatalogRepository();
    const coordinator = new CanonicalizationCoordinator(repo);

    // 1st ingest: no images at all
    const noImages = parseTicketmasterEvent(
      { ...byId('tm-img-001'), images: undefined },
      context,
    );
    const stripped = {
      ...noImages,
      rawPayload: { ...noImages.rawPayload, images: undefined },
      artists: stripArtistImages(noImages.artists),
    };
    const first = await coordinator.canonicalize(asStored(stripped));
    expect(first.status).toBe('created');
    expect(
      (await repo.getEventById(first.eventId!))?.imageUrl ?? null,
    ).toBeNull();

    // 2nd ingest (same source event id, now with images): fills the gaps
    const withImages = parseTicketmasterEvent(byId('tm-img-001'), context);
    const second = await coordinator.canonicalize(asStored(withImages));
    expect(second.status).toBe('matched');
    expect(second.eventId).toBe(first.eventId);
    const filled = await repo.getEventById(first.eventId!);
    expect(filled?.imageUrl).toBe(
      'https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg',
    );

    // 3rd ingest: a different image must NOT replace the stored one
    const different = parseTicketmasterEvent(
      {
        ...byId('tm-img-001'),
        images: [
          {
            url: 'https://s1.ticketm.net/dam/a/999/other_16_9_1024.jpg',
            ratio: '16_9',
            width: 1024,
          },
        ],
      },
      context,
    );
    await coordinator.canonicalize(asStored(different));
    expect((await repo.getEventById(first.eventId!))?.imageUrl).toBe(
      'https://s1.ticketm.net/dam/a/111/event_16_9_1024.jpg',
    );
  });
});
