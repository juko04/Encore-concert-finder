import fs from 'node:fs';
import path from 'node:path';
import type { EventCandidate } from '@/lib/domain/event-candidate';

export type FixtureKey =
  | 'single_show'
  | 'utc_rollover_show'
  | 'non_colorado_show_austin'
  | 'non_colorado_show_london_eur_gbp'
  | 'venue_alias_red_rocks'
  | 'date_only_show'
  | 'time_upgrade_observation'
  | 'cancelled_show'
  | 'early_show_with_shared_opener'
  | 'late_show_with_shared_opener';

export function loadFixtures(): Record<
  FixtureKey,
  EventCandidate & { rawIngestId: string; sourceId: string }
> {
  const filePath = path.join(__dirname, 'phase-1-fixtures.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  const result: Record<
    string,
    EventCandidate & { rawIngestId: string; sourceId: string }
  > = {};

  for (const [key, value] of Object.entries(parsed)) {
    const val = value as EventCandidate;
    result[key] = {
      ...val,
      id: val.id ?? crypto.randomUUID(),
      rawIngestId: val.rawIngestId ?? 'c0000000-0000-0000-0000-000000000001',
      sourceId: val.sourceId ?? val.provenance.sourceId,
    };
  }

  return result as Record<
    FixtureKey,
    EventCandidate & { rawIngestId: string; sourceId: string }
  >;
}

/**
 * Builds a deterministic Ticketmaster fixture JSON namespaced with a unique nonce and date offset.
 * Used for database integration tests to guarantee clean isolation across consecutive runs
 * against persistent databases without deleting existing data or resetting the database.
 */
export function buildIsolatedTicketmasterFixture(
  suiteNonce: string,
  dayOffset = 1,
): string {
  const fixturePath = path.resolve(
    process.cwd(),
    'tests/fixtures/ticketmaster-events-response.json',
  );
  const rawJson = fs.readFileSync(fixturePath, 'utf-8');
  const parsed = JSON.parse(rawJson);

  if (parsed._embedded?.events && Array.isArray(parsed._embedded.events)) {
    parsed._embedded.events = parsed._embedded.events.map((evt: any) => {
      let shiftedLocalDate = evt.dates?.start?.localDate;
      let shiftedDateTime = evt.dates?.start?.dateTime;

      if (shiftedLocalDate) {
        const [y, m, d] = shiftedLocalDate.split('-').map(Number);
        const dateObj = new Date(Date.UTC(y, m - 1, d));
        dateObj.setUTCDate(dateObj.getUTCDate() + dayOffset);
        shiftedLocalDate = dateObj.toISOString().slice(0, 10);

        if (evt.dates?.start?.dateTime) {
          const timePart = evt.dates.start.localTime || '20:00:00';
          shiftedDateTime = `${shiftedLocalDate}T${timePart}Z`;
        }
      }

      let shiftedEndDate = evt.dates?.end?.localDate;
      if (shiftedEndDate) {
        const [ey, em, ed] = shiftedEndDate.split('-').map(Number);
        const endDateObj = new Date(Date.UTC(ey, em - 1, ed));
        endDateObj.setUTCDate(endDateObj.getUTCDate() + dayOffset);
        shiftedEndDate = endDateObj.toISOString().slice(0, 10);
      }

      const shiftedAttractions = evt._embedded?.attractions?.map(
        (attr: any) => {
          const shiftedExternalLinks = attr.externalLinks
            ? { ...attr.externalLinks }
            : undefined;
          if (
            shiftedExternalLinks?.spotify &&
            Array.isArray(shiftedExternalLinks.spotify)
          ) {
            shiftedExternalLinks.spotify = shiftedExternalLinks.spotify.map(
              (spot: any) => {
                const match = spot.url?.match(/artist\/([a-zA-Z0-9]+)/);
                const spotId = match ? match[1] : 'spotId';
                return {
                  ...spot,
                  url: `https://open.spotify.com/artist/${spotId}${suiteNonce}`,
                };
              },
            );
          }

          return {
            ...attr,
            id: `${attr.id}_${suiteNonce}`,
            name: `${attr.name} [${suiteNonce}]`,
            url: attr.url ? `${attr.url}&suiteNonce=${suiteNonce}` : attr.url,
            externalLinks: shiftedExternalLinks,
          };
        },
      );

      return {
        ...evt,
        id: `${evt.id}_${suiteNonce}`,
        name: `${evt.name} [${suiteNonce}]`,
        url: `${evt.url}&suiteNonce=${suiteNonce}`,
        dates: {
          ...evt.dates,
          start: {
            ...evt.dates.start,
            localDate: shiftedLocalDate,
            dateTime: shiftedDateTime,
          },
          ...(shiftedEndDate
            ? {
                end: {
                  ...evt.dates.end,
                  localDate: shiftedEndDate,
                },
              }
            : {}),
        },
        _embedded: {
          ...evt._embedded,
          attractions: shiftedAttractions,
        },
      };
    });
  }

  return JSON.stringify(parsed);
}
