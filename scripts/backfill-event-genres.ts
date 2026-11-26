#!/usr/bin/env node

/**
 * Backfill genres for upcoming events that have none (lib/genres/enrich-event-genres.ts):
 *   1. exact-name Ticketmaster attraction lookup for the headliner (real classification data;
 *      bounded and cached; needs TICKETMASTER_API_KEY), then
 *   2. explicit genre words in the show title (marked inferred).
 * Writes are fill-if-empty with provenance in events.genres_source. Dry run by default.
 *
 * Usage:
 *   npm run backfill:genres                           # dry run, title rules only
 *   npm run backfill:genres -- --lookup               # dry run incl. Ticketmaster lookups
 *   npm run backfill:genres -- --lookup --persist     # write to the (local) database
 *   --max-lookups=N   cap distinct headliner lookups (default 150)
 */

import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { inferGenresFromText } from '@/lib/genres/infer';
import { enrichEventGenres } from '@/lib/genres/enrich-event-genres';
import { createTicketmasterGenreLookup } from '@/lib/sources/ticketmaster/attraction-genres';
import { loadEnvLocal } from '@/lib/utils/load-env-local';

interface EventRow {
  id: string;
  name: string;
  event_artists: Array<{
    artist_id: string;
    sort_order: number | null;
    artists: { id: string; name: string } | null;
  }> | null;
}

async function main() {
  loadEnvLocal();
  const persist = process.argv.includes('--persist');
  const useLookup = process.argv.includes('--lookup');
  const maxLookups = Number(
    process.argv.find((a) => a.startsWith('--max-lookups='))?.split('=')[1] ??
      150,
  );
  assertSafeDatabaseTarget(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    false,
    'Event genre backfill',
  );
  const admin = createAdminClient();
  const repo = new SupabaseCatalogRepository(admin as never);

  const apiKey = process.env.TICKETMASTER_API_KEY?.trim();
  const baseLookup =
    useLookup && apiKey ? createTicketmasterGenreLookup({ apiKey }) : undefined;
  if (useLookup && !apiKey)
    console.warn('No TICKETMASTER_API_KEY: skipping lookups.');
  const seenNames = new Set<string>();
  const lookup = baseLookup
    ? async (name: string) => {
        const key = name.toLowerCase();
        if (!seenNames.has(key)) {
          if (seenNames.size >= maxLookups) return null;
          seenNames.add(key);
        }
        return baseLookup(name);
      }
    : undefined;

  const today = new Date().toISOString().slice(0, 10);
  const events: EventRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('events')
      .select(
        'id, name, event_artists(artist_id, sort_order, artists(id, name))',
      )
      .gte('local_start_date', today)
      .is('genre', null)
      .filter('genres', 'eq', '{}')
      .order('local_start_date', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    events.push(...((data ?? []) as unknown as EventRow[]));
    if (!data || data.length < 1000) break;
  }
  console.log(`Upcoming events with no genre: ${events.length}`);

  const tally = { ticketmaster_attraction: 0, inferred_title: 0, none: 0 };
  const samples: string[] = [];
  for (const ev of events) {
    const artists = (ev.event_artists ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((ea) => ea.artists)
      .filter((a): a is { id: string; name: string } => Boolean(a));
    let source: string | null;
    let genres: string[];
    if (persist) {
      const res = await enrichEventGenres(
        { eventId: ev.id, title: ev.name, artists },
        { repo, lookup },
      );
      source = res.source;
      genres = res.genres;
    } else {
      // Dry run: same decision order, no writes.
      const found = lookup && artists[0] ? await lookup(artists[0].name) : null;
      if (found && found.length > 0) {
        source = 'ticketmaster_attraction';
        genres = found;
      } else {
        const inf = inferGenresFromText(
          ev.name,
          artists.map((a) => a.name),
        );
        source = inf.genres.length > 0 ? 'inferred_title' : null;
        genres = inf.genres;
      }
    }
    if (source === 'ticketmaster_attraction') tally.ticketmaster_attraction++;
    else if (source === 'inferred_title') tally.inferred_title++;
    else tally.none++;
    if (source && samples.length < 40) {
      samples.push(
        `${source === 'inferred_title' ? 'title ' : 'TM    '} ${ev.name.slice(0, 60).padEnd(60)} -> ${genres.join(', ')}`,
      );
    }
  }

  console.log(samples.join('\n'));
  console.log(
    `\nTicketmaster lookup: ${tally.ticketmaster_attraction} | title inference: ${tally.inferred_title} | still unknown: ${tally.none}`,
  );
  console.log(
    persist
      ? 'Written to the database.'
      : 'Dry run only; re-run with --persist to write.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
