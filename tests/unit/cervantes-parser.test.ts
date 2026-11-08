import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCervantesEvents } from '@/lib/sources/venue/cervantes/parser';

describe('Cervantes Parser', () => {
  const fixturePath = path.resolve(
    process.cwd(),
    'tests/fixtures/cervantes-events-response.html',
  );
  const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

  const defaultContext = {
    sourceId: 'b0000000-0000-0000-0000-000000000004',
    sourceUrl: 'https://cervantesmasterpiece.com/events/',
    fetchedAt: '2026-11-08T00:00:00.000Z',
    contentHash: 'abc123hash',
    parserVersion: '1.0.0',
  };

  it('parses exactly 103 concerts from real Cervantes calendar fixture', () => {
    const candidates = parseCervantesEvents(fixtureHtml, defaultContext);
    expect(candidates).toHaveLength(103);
  });

  it('extracts headliner and support billing with distinct positions', () => {
    const candidates = parseCervantesEvents(fixtureHtml, defaultContext);

    // Event 2: Mfinity w/ 5AM, Phurn, Swomp
    const mfinityShow = candidates.find((c) => c.title.includes('Mfinity'));
    expect(mfinityShow).toBeDefined();
    expect(mfinityShow?.artists).toBeDefined();

    const headliner = mfinityShow?.artists?.find(
      (a) => a.billingPosition === 'headliner',
    );
    expect(headliner?.name).toContain('Mfinity');

    const supportActs = mfinityShow?.artists?.filter(
      (a) => a.billingPosition === 'support',
    );
    expect(supportActs && supportActs.length).toBeGreaterThanOrEqual(2);
    expect(supportActs?.map((a) => a.name)).toEqual(
      expect.arrayContaining(['5AM (Head-nod Set)', 'Phurn', 'Swomp']),
    );
  });

  it('accurately distinguishes offsite co-promoted shows from in-house rooms', () => {
    const candidates = parseCervantesEvents(fixtureHtml, defaultContext);

    // 1. Mission Ballroom offsite show
    const danielDonato = candidates.find((c) =>
      c.title.includes("Daniel Donato's Cosmic Country"),
    );
    expect(danielDonato).toBeDefined();
    expect(danielDonato?.venueName).toBe('Mission Ballroom');
    expect(danielDonato?.city).toBe('Denver');
    expect(danielDonato?.state).toBe('CO');

    // 2. Fiddlers Green offsite amphitheatre show
    const stickFigure = candidates.find((c) =>
      c.title.includes('Stick Figure'),
    );
    expect(stickFigure).toBeDefined();
    expect(stickFigure?.venueName).toBe('Fiddlers Green Amphitheatre');
    expect(stickFigure?.city).toBe('Englewood');
    expect(stickFigure?.state).toBe('CO');

    // 3. Cervantes' Other Side in-house room
    const houseParty = candidates.find((c) => c.title.includes('House Party'));
    expect(houseParty).toBeDefined();
    expect(houseParty?.venueName).toBe("Cervantes' Other Side");
    expect(houseParty?.city).toBe('Denver');
    expect(houseParty?.state).toBe('CO');
  });

  it('cleans CANCELED prefix and identifies cancelled event status', () => {
    const candidates = parseCervantesEvents(fixtureHtml, defaultContext);

    const canceledShow = candidates.find((c) =>
      c.title.includes('Jalen Ngonda'),
    );
    expect(canceledShow).toBeDefined();
    expect(canceledShow?.title).not.toMatch(/^CANCELED/i);
    expect(canceledShow?.rawPayload?.isCanceled).toBe(true);
  });

  it('preserves IANA timezone America/Denver and derives valid startsAt instant', () => {
    const candidates = parseCervantesEvents(fixtureHtml, defaultContext);

    const firstShow = candidates[0];
    expect(firstShow.timezone).toBe('America/Denver');
    expect(firstShow.localStartDate).toBe('2026-11-07');
    expect(firstShow.startTimePrecision).toBe('instant');
    expect(firstShow.startsAt).toBe('2026-11-08T03:00:00.000Z');
    expect(firstShow.doorsOpenAt).toBe('2026-11-08T02:00:00.000Z');
  });

  it('extracts and normalizes primary Etix ticketing URLs', () => {
    const candidates = parseCervantesEvents(fixtureHtml, defaultContext);

    const showWithTicket = candidates.find((c) => c.ticketUrl);
    expect(showWithTicket).toBeDefined();
    expect(showWithTicket?.ticketUrl).toContain('etix.com/ticket/p/');
    expect(showWithTicket?.ticketUrl).toContain('cobrand=Cervantes');
  });

  it('handles empty or malformed HTML safely without throwing', () => {
    expect(parseCervantesEvents('', defaultContext)).toEqual([]);
    expect(
      parseCervantesEvents('<div>No events</div>', defaultContext),
    ).toEqual([]);
  });
});
