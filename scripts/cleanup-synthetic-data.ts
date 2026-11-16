#!/usr/bin/env node

/**
 * Provenance-Based Local Database Audit Utility for Synthetic & Test Fixtures.
 *
 * Read-Only Diagnostic Utility (Review Finding 1):
 * 1. Safe & Read-Only: performs zero write, update, or delete operations on any table.
 * 2. Strict Destination Guard: restricted exclusively to local development instances
 *    (127.0.0.1 or localhost). Production can NEVER be targeted.
 * 3. Paginated PostgREST Queries: all database queries are paginated via `.range(from, to)`
 *    to handle catalogs larger than 1,000 records safely.
 * 4. Provenance-Based Identification: synthetic fixtures are audited strictly by source
 *    adapter provenance, example.com mock URLs, and foreign-key evidence traces. Overly
 *    broad name patterns and official Ticketmaster URLs are never treated as synthetic.
 * 5. Fail-Loud Error Handling: if any audit query fails, an exception is thrown immediately.
 * 6. Honest Reporting: reports catalog health without misleading claims of transaction
 *    safety or deletion capabilities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

// Canonical Colorado venue source slugs that must NEVER be treated as synthetic
const CANONICAL_GENUINE_SOURCE_SLUGS = new Set([
  'cervantes-masterpiece',
  'larimer-lounge',
  'lost-lake-lounge',
  'globe-hall',
  'velvet-elk-lounge',
  'roots-music-project',
  'ticketmaster-discovery',
]);

// Known synthetic test source IDs and prefixes
const KNOWN_SYNTHETIC_SOURCE_IDS = new Set([
  'fake-venue-adapter',
  'fake-secondary-adapter',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
]);

const SYNTHETIC_SOURCE_SLUG_PREFIXES = [
  'source-alpha-',
  'source-beta-',
  'test-',
];

// Synthetic raw ingest URL patterns (strictly mock/example domains)
const SYNTHETIC_URL_PATTERNS = [
  /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?example(?:-venue)?\.(?:com|org)/i,
];

/**
 * Paginates PostgREST queries to safely handle tables with >1,000 records.
 */
async function fetchAllPaginated<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      throw new Error(
        `Pagination query failed [${from}..${to}]: ${error.message}`,
      );
    }
    if (!data || data.length === 0) {
      break;
    }
    all.push(...data);
    if (data.length < pageSize) {
      break;
    }
    from += pageSize;
  }
  return all;
}

export interface SyntheticAuditReport {
  targetDatabaseUrl: string;
  isApplied: false;
  auditPassed: boolean;
  identified: {
    events: Array<{ id: string; name: string; reason: string }>;
    rawIngests: Array<{ id: string; url: string; reason: string }>;
    candidates: Array<{ id: string; title: string; reason: string }>;
    artists: Array<{ id: string; name: string; reason: string }>;
    venues: Array<{ id: string; name: string; reason: string }>;
    sources: Array<{ id: string; name: string; reason: string }>;
    eventArtistsCount: number;
    ticketLinksCount: number;
    evidenceCount: number;
  };
  preserved: {
    realEventsCount: number;
    realArtistsCount: number;
    realVenuesCount: number;
    authUsersCount: number;
    userSpotifyConnectionsCount: number;
    userPreferencesCount: number;
  };
}

export type CleanupReport = SyntheticAuditReport;

export async function runSyntheticAudit(): Promise<SyntheticAuditReport> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for synthetic catalog audit.',
    );
  }

  // 1. Destination Safety Guard: strictly reject non-local hosts
  assertSafeDatabaseTarget(url, false, 'Synthetic Catalog Audit');

  const parsedUrl = new URL(url);
  if (
    parsedUrl.hostname !== '127.0.0.1' &&
    parsedUrl.hostname !== 'localhost'
  ) {
    throw new Error(
      `Synthetic audit is strictly restricted to local development instances (127.0.0.1 / localhost). Target ${url} is rejected.`,
    );
  }

  const client: SupabaseClient = createClient(url, serviceRoleKey);

  console.log('----------------------------------------------------');
  console.log('Encore Synthetic Catalog Audit (READ-ONLY DIAGNOSTIC)');
  console.log(`Target Database: ${url}`);
  console.log('----------------------------------------------------');

  // 2. Fetch all sources to classify by provenance (paginated)
  const allSources = await fetchAllPaginated<{
    id: string;
    name: string;
    slug: string;
    source_type: string;
  }>(async (from, to) => {
    return client
      .from('sources')
      .select('id, name, slug, source_type')
      .range(from, to);
  });

  const syntheticSourceIds = new Set<string>();
  const genuineSourceIds = new Set<string>();
  const identifiedSources: Array<{ id: string; name: string; reason: string }> =
    [];

  for (const src of allSources) {
    if (CANONICAL_GENUINE_SOURCE_SLUGS.has(src.slug)) {
      genuineSourceIds.add(src.id);
    } else if (
      KNOWN_SYNTHETIC_SOURCE_IDS.has(src.id) ||
      KNOWN_SYNTHETIC_SOURCE_IDS.has(src.slug) ||
      SYNTHETIC_SOURCE_SLUG_PREFIXES.some((prefix) =>
        src.slug.startsWith(prefix),
      )
    ) {
      syntheticSourceIds.add(src.id);
      if (
        src.slug.startsWith('source-alpha-') ||
        src.slug.startsWith('source-beta-') ||
        src.slug.startsWith('test-')
      ) {
        identifiedSources.push({
          id: src.id,
          name: src.name,
          reason: `Dynamic test source matching prefix: ${src.slug}`,
        });
      }
    }
  }

  // 3. Fetch all raw ingests and identify synthetic records strictly by source/URL provenance (paginated)
  const allRawIngests = await fetchAllPaginated<{
    id: string;
    source_id: string;
    source_url: string;
    fetched_at: string;
  }>(async (from, to) => {
    return client
      .from('raw_ingests')
      .select('id, source_id, source_url, fetched_at')
      .range(from, to);
  });

  const syntheticRawIngestIds = new Set<string>();
  const identifiedRawIngests: Array<{
    id: string;
    url: string;
    reason: string;
  }> = [];

  for (const r of allRawIngests) {
    let isSynthetic = false;
    let reason = '';

    if (syntheticSourceIds.has(r.source_id)) {
      isSynthetic = true;
      reason = `Originated from test source ID: ${r.source_id}`;
    } else if (SYNTHETIC_URL_PATTERNS.some((p) => p.test(r.source_url))) {
      isSynthetic = true;
      reason = `Originated from mock/example URL pattern: ${r.source_url}`;
    }

    if (isSynthetic) {
      syntheticRawIngestIds.add(r.id);
      identifiedRawIngests.push({ id: r.id, url: r.source_url, reason });
    }
  }

  // 4. Fetch all candidates and trace back to synthetic raw ingests or sources (paginated)
  const allCandidates = await fetchAllPaginated<{
    id: string;
    raw_ingest_id: string;
    title: string;
    source_id: string;
  }>(async (from, to) => {
    return client
      .from('event_candidates')
      .select('id, raw_ingest_id, title, source_id')
      .range(from, to);
  });

  const syntheticCandidateIds = new Set<string>();
  const identifiedCandidates: Array<{
    id: string;
    title: string;
    reason: string;
  }> = [];

  for (const c of allCandidates) {
    let isSynthetic = false;
    let reason = '';

    if (syntheticRawIngestIds.has(c.raw_ingest_id)) {
      isSynthetic = true;
      reason = `Originated from synthetic raw_ingest: ${c.raw_ingest_id}`;
    } else if (syntheticSourceIds.has(c.source_id)) {
      isSynthetic = true;
      reason = `Originated from synthetic source_id: ${c.source_id}`;
    }

    if (isSynthetic) {
      syntheticCandidateIds.add(c.id);
      identifiedCandidates.push({ id: c.id, title: c.title, reason });
    }
  }

  // 5. Fetch all events and determine synthetic status strictly by provenance (paginated)
  const allEvents = await fetchAllPaginated<{
    id: string;
    name: string;
    local_start_date: string;
    venue_id: string | null;
    created_at: string;
  }>(async (from, to) => {
    return client
      .from('events')
      .select('id, name, local_start_date, venue_id, created_at')
      .range(from, to);
  });

  // Fetch all field evidence and event_sources to trace event provenance (paginated)
  const allEvidence = await fetchAllPaginated<{
    id: string;
    event_id: string | null;
    candidate_id: string | null;
    source_id: string;
  }>(async (from, to) => {
    return client
      .from('event_field_evidence')
      .select('id, event_id, candidate_id, source_id')
      .range(from, to);
  });

  const allEventSources = await fetchAllPaginated<{
    id: string;
    event_id: string | null;
    candidate_id: string | null;
    source_id: string;
  }>(async (from, to) => {
    return client
      .from('event_sources')
      .select('id, event_id, candidate_id, source_id')
      .range(from, to);
  });

  const eventGenuineCount = new Map<string, number>();
  const eventSyntheticCount = new Map<string, number>();

  for (const ev of allEvidence) {
    if (ev.event_id) {
      if (genuineSourceIds.has(ev.source_id)) {
        eventGenuineCount.set(
          ev.event_id,
          (eventGenuineCount.get(ev.event_id) || 0) + 1,
        );
      } else if (
        syntheticSourceIds.has(ev.source_id) ||
        (ev.candidate_id && syntheticCandidateIds.has(ev.candidate_id))
      ) {
        eventSyntheticCount.set(
          ev.event_id,
          (eventSyntheticCount.get(ev.event_id) || 0) + 1,
        );
      }
    }
  }

  for (const es of allEventSources) {
    if (es.event_id) {
      if (genuineSourceIds.has(es.source_id)) {
        eventGenuineCount.set(
          es.event_id,
          (eventGenuineCount.get(es.event_id) || 0) + 1,
        );
      } else if (
        syntheticSourceIds.has(es.source_id) ||
        (es.candidate_id && syntheticCandidateIds.has(es.candidate_id))
      ) {
        eventSyntheticCount.set(
          es.event_id,
          (eventSyntheticCount.get(es.event_id) || 0) + 1,
        );
      }
    }
  }

  const syntheticEventIds = new Set<string>();
  const identifiedEvents: Array<{ id: string; name: string; reason: string }> =
    [];
  const genuineEvents: Array<{ id: string; name: string }> = [];

  for (const ev of allEvents) {
    const genuineLinks = eventGenuineCount.get(ev.id) || 0;
    const syntheticLinks = eventSyntheticCount.get(ev.id) || 0;

    if (genuineLinks > 0) {
      genuineEvents.push({ id: ev.id, name: ev.name });
    } else if (syntheticLinks > 0) {
      syntheticEventIds.add(ev.id);
      identifiedEvents.push({
        id: ev.id,
        name: ev.name,
        reason: `Linked exclusively to synthetic candidates/evidence (${syntheticLinks} synthetic links, 0 genuine links)`,
      });
    } else {
      // Event has 0 field evidence and 0 event_sources
      if (
        /^FK Test Event/i.test(ev.name) ||
        /57cdb36c|ad8047ff|5f36a446/i.test(ev.name)
      ) {
        syntheticEventIds.add(ev.id);
        identifiedEvents.push({
          id: ev.id,
          name: ev.name,
          reason: 'Zero provenance links and matches test nonce metadata',
        });
      } else {
        genuineEvents.push({ id: ev.id, name: ev.name });
      }
    }
  }

  // 6. Check counts of dependent records for identified synthetic events
  let evidenceCount = 0;
  let ticketLinksCount = 0;
  let eventArtistsCount = 0;

  if (syntheticEventIds.size > 0 || syntheticCandidateIds.size > 0) {
    const evArr = Array.from(syntheticEventIds);
    const candArr = Array.from(syntheticCandidateIds);

    const { count: evCount, error: evErr } = await client
      .from('event_field_evidence')
      .select('*', { count: 'exact', head: true })
      .or(
        evArr.length > 0
          ? `event_id.in.(${evArr.join(',')})`
          : candArr.length > 0
            ? `candidate_id.in.(${candArr.join(',')})`
            : 'id.is.null',
      );
    if (evErr) {
      throw new Error(
        `Failed to query event_field_evidence count: ${evErr.message}`,
      );
    }
    evidenceCount = evCount || 0;

    if (evArr.length > 0) {
      const { count: tlCount, error: tlErr } = await client
        .from('event_ticket_links')
        .select('*', { count: 'exact', head: true })
        .in('event_id', evArr);
      if (tlErr) {
        throw new Error(
          `Failed to query event_ticket_links count: ${tlErr.message}`,
        );
      }
      ticketLinksCount = tlCount || 0;

      const { count: eaCount, error: eaErr } = await client
        .from('event_artists')
        .select('*', { count: 'exact', head: true })
        .in('event_id', evArr);
      if (eaErr) {
        throw new Error(
          `Failed to query event_artists count: ${eaErr.message}`,
        );
      }
      eventArtistsCount = eaCount || 0;
    }
  }

  // 7. Identify synthetic artists (paginated)
  const allArtists = await fetchAllPaginated<{
    id: string;
    name: string;
    created_at: string;
  }>(async (from, to) => {
    return client
      .from('artists')
      .select('id, name, created_at')
      .range(from, to);
  });

  const allEventArtists = await fetchAllPaginated<{
    event_id: string;
    artist_id: string;
  }>(async (from, to) => {
    return client
      .from('event_artists')
      .select('event_id, artist_id')
      .range(from, to);
  });

  const allUserPrefs = await fetchAllPaginated<{
    artist_id: string;
  }>(async (from, to) => {
    return client
      .from('user_artist_preferences')
      .select('artist_id')
      .range(from, to);
  });

  const artistsWithGenuineLinks = new Set<string>();
  const artistsWithUserPrefs = new Set<string>(
    allUserPrefs.map((p) => p.artist_id),
  );
  const artistsWithSyntheticLinks = new Set<string>();

  for (const ea of allEventArtists) {
    if (syntheticEventIds.has(ea.event_id)) {
      artistsWithSyntheticLinks.add(ea.artist_id);
    } else {
      artistsWithGenuineLinks.add(ea.artist_id);
    }
  }

  const syntheticArtistIds = new Set<string>();
  const identifiedArtists: Array<{ id: string; name: string; reason: string }> =
    [];

  for (const art of allArtists) {
    if (
      artistsWithUserPrefs.has(art.id) ||
      artistsWithGenuineLinks.has(art.id)
    ) {
      continue;
    }

    if (artistsWithSyntheticLinks.has(art.id)) {
      syntheticArtistIds.add(art.id);
      identifiedArtists.push({
        id: art.id,
        name: art.name,
        reason:
          'Linked exclusively to synthetic events (0 genuine events, 0 user preferences)',
      });
    } else if (/\[mw5uv3ze_maeh\]|57cdb36c|ad8047ff|5f36a446/i.test(art.name)) {
      syntheticArtistIds.add(art.id);
      identifiedArtists.push({
        id: art.id,
        name: art.name,
        reason:
          'Orphaned test fixture with test run nonce (0 events, 0 user preferences)',
      });
    }
  }

  // 8. Identify synthetic venues (paginated)
  const allVenues = await fetchAllPaginated<{
    id: string;
    name: string;
    created_at: string;
  }>(async (from, to) => {
    return client.from('venues').select('id, name, created_at').range(from, to);
  });

  const venuesWithGenuineEvents = new Set<string>();
  const venuesWithSyntheticEvents = new Set<string>();

  for (const ev of allEvents) {
    if (ev.venue_id) {
      if (syntheticEventIds.has(ev.id)) {
        venuesWithSyntheticEvents.add(ev.venue_id);
      } else {
        venuesWithGenuineEvents.add(ev.venue_id);
      }
    }
  }

  const syntheticVenueIds = new Set<string>();
  const identifiedVenues: Array<{ id: string; name: string; reason: string }> =
    [];

  for (const ven of allVenues) {
    if (venuesWithGenuineEvents.has(ven.id)) {
      continue;
    }

    if (venuesWithSyntheticEvents.has(ven.id)) {
      syntheticVenueIds.add(ven.id);
      identifiedVenues.push({
        id: ven.id,
        name: ven.name,
        reason: 'Linked exclusively to synthetic events (0 genuine events)',
      });
    } else if (/57cdb36c|ad8047ff|5f36a446/i.test(ven.name)) {
      syntheticVenueIds.add(ven.id);
      identifiedVenues.push({
        id: ven.id,
        name: ven.name,
        reason: 'Orphaned test venue with test run nonce (0 genuine events)',
      });
    }
  }

  // 9. Inspect user & profile counts to ensure strict preservation
  const { count: authUsersCount, error: usrErr } = await client
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  if (usrErr) {
    throw new Error(`Failed to query profiles count: ${usrErr.message}`);
  }

  const { count: spotifyConnCount, error: spotErr } = await client
    .from('user_spotify_connections')
    .select('*', { count: 'exact', head: true });
  if (spotErr) {
    throw new Error(
      `Failed to query user_spotify_connections count: ${spotErr.message}`,
    );
  }

  const { count: userPrefsCount, error: upErr } = await client
    .from('user_artist_preferences')
    .select('*', { count: 'exact', head: true });
  if (upErr) {
    throw new Error(
      `Failed to query user_artist_preferences count: ${upErr.message}`,
    );
  }

  const totalIdentified =
    identifiedEvents.length +
    identifiedRawIngests.length +
    identifiedCandidates.length +
    identifiedArtists.length +
    identifiedVenues.length +
    identifiedSources.length;

  const report: SyntheticAuditReport = {
    targetDatabaseUrl: url,
    isApplied: false,
    auditPassed: totalIdentified === 0,
    identified: {
      events: identifiedEvents,
      rawIngests: identifiedRawIngests,
      candidates: identifiedCandidates,
      artists: identifiedArtists,
      venues: identifiedVenues,
      sources: identifiedSources,
      eventArtistsCount,
      ticketLinksCount,
      evidenceCount,
    },
    preserved: {
      realEventsCount: genuineEvents.length,
      realArtistsCount: allArtists.length - identifiedArtists.length,
      realVenuesCount: allVenues.length - identifiedVenues.length,
      authUsersCount: authUsersCount || 0,
      userSpotifyConnectionsCount: spotifyConnCount || 0,
      userPreferencesCount: userPrefsCount || 0,
    },
  };

  // Print Diagnostic Summary
  console.log('\nAudit Results:');
  console.log(
    `- Synthetic Events:        ${identifiedEvents.length} (out of ${allEvents.length})`,
  );
  console.log(
    `- Synthetic Raw Ingests:   ${identifiedRawIngests.length} (out of ${allRawIngests.length})`,
  );
  console.log(
    `- Synthetic Candidates:    ${identifiedCandidates.length} (out of ${allCandidates.length})`,
  );
  console.log(`- Linked Event Artists:    ${eventArtistsCount}`);
  console.log(`- Linked Ticket Links:     ${ticketLinksCount}`);
  console.log(`- Linked Field Evidence:   ${evidenceCount}`);
  console.log(
    `- Synthetic Artists:       ${identifiedArtists.length} (out of ${allArtists.length})`,
  );
  console.log(
    `- Synthetic Venues:        ${identifiedVenues.length} (out of ${allVenues.length})`,
  );
  console.log(
    `- Synthetic Sources:       ${identifiedSources.length} (out of ${allSources.length})`,
  );
  console.log('\nCatalog Health (Preserved Intact):');
  console.log(`- Genuine Events:          ${genuineEvents.length}`);
  console.log(
    `- Genuine Artists:         ${report.preserved.realArtistsCount}`,
  );
  console.log(`- Genuine Venues:          ${report.preserved.realVenuesCount}`);
  console.log(`- Profiles/Users:          ${authUsersCount || 0}`);
  console.log(`- Spotify Connections:     ${spotifyConnCount || 0}`);
  console.log(`- User Artist Preferences: ${userPrefsCount || 0}`);

  if (totalIdentified === 0) {
    console.log(
      '\n[AUDIT PASSED] Local database is 100% clean of synthetic and mock test fixtures.',
    );
  } else {
    console.warn(
      `\n[AUDIT WARNING] ${totalIdentified} synthetic fixture records identified. Diagnostic utility is read-only.`,
    );
  }

  return report;
}

export const runCleanup = runSyntheticAudit;

runSyntheticAudit().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
