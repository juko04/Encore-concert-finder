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
      rawIngestId: val.rawIngestId ?? `raw_${key}`,
      sourceId: val.sourceId ?? val.provenance.sourceId,
    };
  }

  return result as Record<
    FixtureKey,
    EventCandidate & { rawIngestId: string; sourceId: string }
  >;
}
