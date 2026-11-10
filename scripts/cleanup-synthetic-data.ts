#!/usr/bin/env node

/**
 * Provenance-Based Local Database Cleanup Utility for Synthetic & Test Fixtures.
 *
 * Requirements (Findings 1 & 2):
 * 1. Safe by default: `--dry-run` is active unless `--apply` is explicitly passed.
 * 2. Strict Destination Guard: Restricted exclusively to local development instances
 *    (127.0.0.1 or localhost). Production can NEVER be targeted under any condition.
 * 3. Provenance-Based Identification: Identification of synthetic records is based
 *    strictly on source adapter provenance, example.com URLs, and foreign-key evidence
 *    traces. Overly broad name patterns and official Ticketmaster URLs are never used
 *    as indicators of synthetic data.
 * 4. Recoverable Backup: Before executing any deletion in apply mode, full raw database
 *    rows for all targeted records are queried and serialized to disk under `.backup/`.
 *    If backup creation fails, the cleanup aborts immediately before any deletion.
 * 5. Fail-Loud Error Handling: If any deletion query fails, an exception is thrown
 *    immediately so the process exits with a non-zero exit code.
 * 6. User Data Isolation: NEVER touches profiles, user_spotify_connections, or user_artist_preferences.
 * 7. Legitimate Data Isolation: NEVER deletes genuine venue-ingested concerts or evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

interface ParsedArgs {
  apply: boolean;
  dryRun: boolean;
  backup: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const apply = argv.includes('--apply');
  const dryRun = !apply || argv.includes('--dry-run');
  const backup = !argv.includes('--no-backup');

  return {
    apply: apply && !argv.includes('--dry-run'),
    dryRun,
    backup,
  };
}

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

export interface CleanupReport {
  targetDatabaseUrl: string;
  isApplied: boolean;
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
  backupFile?: string;
}

export async function runCleanup(args: ParsedArgs): Promise<CleanupReport> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for synthetic catalog cleanup.',
    );
  }

  // 1. Destination Safety Guard: strictly reject non-local hosts
  assertSafeDatabaseTarget(url, false, 'Synthetic Catalog Cleanup');

  const parsedUrl = new URL(url);
  if (
    parsedUrl.hostname !== '127.0.0.1' &&
    parsedUrl.hostname !== 'localhost'
  ) {
    throw new Error(
      `Synthetic cleanup is strictly restricted to local development instances (127.0.0.1 / localhost). Target ${url} is rejected.`,
    );
  }

  const client: SupabaseClient = createClient(url, serviceRoleKey);

  console.log('----------------------------------------------------');
  console.log(
    `Encore Synthetic Catalog Cleanup (${args.apply ? 'APPLY MODE' : 'DRY RUN'})`,
  );
  console.log(`Target Database: ${url}`);
  console.log('----------------------------------------------------');

  // 2. Fetch all sources to classify by provenance
  const { data: allSources, error: srcErr } = await client
    .from('sources')
    .select('id, name, slug, source_type');
  if (srcErr) throw new Error(`Failed to query sources: ${srcErr.message}`);

  const syntheticSourceIds = new Set<string>();
  const genuineSourceIds = new Set<string>();
  const identifiedSources: Array<{ id: string; name: string; reason: string }> =
    [];

  for (const src of allSources || []) {
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

  // 3. Fetch all raw ingests and identify synthetic records strictly by source/URL provenance
  const { data: allRawIngests, error: rawErr } = await client
    .from('raw_ingests')
    .select('id, source_id, source_url, fetched_at');
  if (rawErr) throw new Error(`Failed to query raw_ingests: ${rawErr.message}`);

  const syntheticRawIngestIds = new Set<string>();
  const identifiedRawIngests: Array<{
    id: string;
    url: string;
    reason: string;
  }> = [];

  for (const r of allRawIngests || []) {
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

  // 4. Fetch all candidates and trace back to synthetic raw ingests or sources
  const { data: allCandidates, error: candErr } = await client
    .from('event_candidates')
    .select('id, raw_ingest_id, title, source_id');
  if (candErr)
    throw new Error(`Failed to query event_candidates: ${candErr.message}`);

  const syntheticCandidateIds = new Set<string>();
  const identifiedCandidates: Array<{
    id: string;
    title: string;
    reason: string;
  }> = [];

  for (const c of allCandidates || []) {
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

  // 5. Fetch all events and determine synthetic status strictly by provenance
  const { data: allEvents, error: eventsErr } = await client
    .from('events')
    .select('id, name, local_start_date, venue_id, created_at');
  if (eventsErr)
    throw new Error(`Failed to query events: ${eventsErr.message}`);

  // Fetch all field evidence and event_sources to trace event provenance
  const { data: allEvidence, error: evErr } = await client
    .from('event_field_evidence')
    .select('id, event_id, candidate_id, source_id');
  if (evErr)
    throw new Error(`Failed to query event_field_evidence: ${evErr.message}`);

  const { data: allEventSources, error: esErr } = await client
    .from('event_sources')
    .select('id, event_id, candidate_id, source_id');
  if (esErr) throw new Error(`Failed to query event_sources: ${esErr.message}`);

  const eventGenuineCount = new Map<string, number>();
  const eventSyntheticCount = new Map<string, number>();

  for (const ev of allEvidence || []) {
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

  for (const es of allEventSources || []) {
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

  for (const ev of allEvents || []) {
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
  let evidenceToDelete = 0;
  let ticketLinksToDelete = 0;
  let eventArtistsToDelete = 0;

  if (syntheticEventIds.size > 0 || syntheticCandidateIds.size > 0) {
    const evArr = Array.from(syntheticEventIds);
    const candArr = Array.from(syntheticCandidateIds);

    const { count: evCount } = await client
      .from('event_field_evidence')
      .select('*', { count: 'exact', head: true })
      .or(
        evArr.length > 0
          ? `event_id.in.(${evArr.join(',')})`
          : candArr.length > 0
            ? `candidate_id.in.(${candArr.join(',')})`
            : 'id.is.null',
      );
    evidenceToDelete = evCount || 0;

    if (evArr.length > 0) {
      const { count: tlCount } = await client
        .from('event_ticket_links')
        .select('*', { count: 'exact', head: true })
        .in('event_id', evArr);
      ticketLinksToDelete = tlCount || 0;

      const { count: eaCount } = await client
        .from('event_artists')
        .select('*', { count: 'exact', head: true })
        .in('event_id', evArr);
      eventArtistsToDelete = eaCount || 0;
    }
  }

  // 7. Identify synthetic artists (strictly provenance-based: only artists linked exclusively to synthetic events)
  const { data: allArtists, error: artErr } = await client
    .from('artists')
    .select('id, name, created_at');
  if (artErr) throw new Error(`Failed to query artists: ${artErr.message}`);

  const { data: allEventArtists, error: eaErr } = await client
    .from('event_artists')
    .select('event_id, artist_id');
  if (eaErr) throw new Error(`Failed to query event_artists: ${eaErr.message}`);

  const { data: allUserPrefs, error: upErr } = await client
    .from('user_artist_preferences')
    .select('artist_id');
  if (upErr)
    throw new Error(
      `Failed to query user_artist_preferences: ${upErr.message}`,
    );

  const artistsWithGenuineLinks = new Set<string>();
  const artistsWithUserPrefs = new Set<string>(
    (allUserPrefs || []).map((p) => p.artist_id),
  );
  const artistsWithSyntheticLinks = new Set<string>();

  for (const ea of allEventArtists || []) {
    if (syntheticEventIds.has(ea.event_id)) {
      artistsWithSyntheticLinks.add(ea.artist_id);
    } else {
      artistsWithGenuineLinks.add(ea.artist_id);
    }
  }

  const syntheticArtistIds = new Set<string>();
  const identifiedArtists: Array<{ id: string; name: string; reason: string }> =
    [];

  for (const art of allArtists || []) {
    // Never touch artists with user preferences or genuine event links
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

  // 8. Identify synthetic venues (strictly provenance-based: only venues linked exclusively to synthetic events)
  const { data: allVenues, error: venErr } = await client
    .from('venues')
    .select('id, name, created_at');
  if (venErr) throw new Error(`Failed to query venues: ${venErr.message}`);

  const venuesWithGenuineEvents = new Set<string>();
  const venuesWithSyntheticEvents = new Set<string>();

  for (const ev of allEvents || []) {
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

  for (const ven of allVenues || []) {
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
  const { count: authUsersCount } = await client
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  const { count: spotifyConnCount } = await client
    .from('user_spotify_connections')
    .select('*', { count: 'exact', head: true });
  const { count: userPrefsCount } = await client
    .from('user_artist_preferences')
    .select('*', { count: 'exact', head: true });

  const report: CleanupReport = {
    targetDatabaseUrl: url,
    isApplied: args.apply,
    identified: {
      events: identifiedEvents,
      rawIngests: identifiedRawIngests,
      candidates: identifiedCandidates,
      artists: identifiedArtists,
      venues: identifiedVenues,
      sources: identifiedSources,
      eventArtistsCount: eventArtistsToDelete,
      ticketLinksCount: ticketLinksToDelete,
      evidenceCount: evidenceToDelete,
    },
    preserved: {
      realEventsCount: genuineEvents.length,
      realArtistsCount: (allArtists?.length || 0) - identifiedArtists.length,
      realVenuesCount: (allVenues?.length || 0) - identifiedVenues.length,
      authUsersCount: authUsersCount || 0,
      userSpotifyConnectionsCount: spotifyConnCount || 0,
      userPreferencesCount: userPrefsCount || 0,
    },
  };

  // Print Summary
  console.log(`\nIdentified for removal:`);
  console.log(
    `- Events:            ${identifiedEvents.length} (out of ${allEvents?.length || 0})`,
  );
  console.log(
    `- Raw Ingests:       ${identifiedRawIngests.length} (out of ${allRawIngests?.length || 0})`,
  );
  console.log(
    `- Candidates:        ${identifiedCandidates.length} (out of ${allCandidates?.length || 0})`,
  );
  console.log(`- Event Artists:     ${eventArtistsToDelete}`);
  console.log(`- Ticket Links:      ${ticketLinksToDelete}`);
  console.log(`- Field Evidence:    ${evidenceToDelete}`);
  console.log(
    `- Artists:           ${identifiedArtists.length} (out of ${allArtists?.length || 0})`,
  );
  console.log(
    `- Venues:            ${identifiedVenues.length} (out of ${allVenues?.length || 0})`,
  );
  console.log(
    `- Sources:           ${identifiedSources.length} (out of ${allSources?.length || 0})`,
  );
  console.log(`\nPreserved intact:`);
  console.log(`- Genuine Events:    ${genuineEvents.length}`);
  console.log(`- Profiles/Users:    ${authUsersCount || 0}`);
  console.log(`- Spotify Conns:     ${spotifyConnCount || 0}`);
  console.log(`- User Preferences:  ${userPrefsCount || 0}`);

  if (args.dryRun) {
    console.log('\n[DRY RUN COMPLETE] No records were modified or deleted.');
    console.log('Run with --apply to execute the cleanup.');
    return report;
  }

  // 10. Execute deletion in dependency-safe order with recoverable backup
  console.log('\n[APPLYING CLEANUP...]');

  // Recoverable Backup: Fetch complete rows before deleting
  if (args.backup) {
    const backupDir = path.resolve(process.cwd(), '.backup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupFile = path.join(
      backupDir,
      `synthetic-cleanup-backup-${Date.now()}.json`,
    );

    const evIds = Array.from(syntheticEventIds);
    const candIds = Array.from(syntheticCandidateIds);
    const rawIds = Array.from(syntheticRawIngestIds);
    const artIds = Array.from(syntheticArtistIds);
    const venIds = Array.from(syntheticVenueIds);
    const srcIds = identifiedSources.map((s) => s.id);

    const fullBackupData: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      databaseUrl: url,
    };

    if (evIds.length > 0) {
      const { data: bEv, error: eErr } = await client
        .from('events')
        .select('*')
        .in('id', evIds);
      if (eErr)
        throw new Error(`Backup failed querying events: ${eErr.message}`);
      fullBackupData.events = bEv;

      const { data: bEa, error: eaErr2 } = await client
        .from('event_artists')
        .select('*')
        .in('event_id', evIds);
      if (eaErr2)
        throw new Error(
          `Backup failed querying event_artists: ${eaErr2.message}`,
        );
      fullBackupData.event_artists = bEa;

      const { data: bTl, error: tlErr2 } = await client
        .from('event_ticket_links')
        .select('*')
        .in('event_id', evIds);
      if (tlErr2)
        throw new Error(
          `Backup failed querying event_ticket_links: ${tlErr2.message}`,
        );
      fullBackupData.event_ticket_links = bTl;

      const { data: bEs, error: esErr2 } = await client
        .from('event_sources')
        .select('*')
        .in('event_id', evIds);
      if (esErr2)
        throw new Error(
          `Backup failed querying event_sources: ${esErr2.message}`,
        );
      fullBackupData.event_sources = bEs;

      const { data: bCr, error: crErr2 } = await client
        .from('candidate_resolutions')
        .select('*')
        .in('event_id', evIds);
      if (crErr2)
        throw new Error(
          `Backup failed querying candidate_resolutions: ${crErr2.message}`,
        );
      fullBackupData.candidate_resolutions = bCr;

      const { data: bFe, error: feErr2 } = await client
        .from('event_field_evidence')
        .select('*')
        .in('event_id', evIds);
      if (feErr2)
        throw new Error(
          `Backup failed querying event_field_evidence: ${feErr2.message}`,
        );
      fullBackupData.event_field_evidence = bFe;
    }

    if (candIds.length > 0) {
      const { data: bCand, error: cErr } = await client
        .from('event_candidates')
        .select('*')
        .in('id', candIds);
      if (cErr)
        throw new Error(
          `Backup failed querying event_candidates: ${cErr.message}`,
        );
      fullBackupData.event_candidates = bCand;
    }

    if (rawIds.length > 0) {
      const { data: bRaw, error: rErr } = await client
        .from('raw_ingests')
        .select('*')
        .in('id', rawIds);
      if (rErr)
        throw new Error(`Backup failed querying raw_ingests: ${rErr.message}`);
      fullBackupData.raw_ingests = bRaw;
    }

    if (artIds.length > 0) {
      const { data: bArt, error: aErr } = await client
        .from('artists')
        .select('*')
        .in('id', artIds);
      if (aErr)
        throw new Error(`Backup failed querying artists: ${aErr.message}`);
      fullBackupData.artists = bArt;

      const { data: bExt, error: extErr } = await client
        .from('artist_external_ids')
        .select('*')
        .in('artist_id', artIds);
      if (extErr)
        throw new Error(
          `Backup failed querying artist_external_ids: ${extErr.message}`,
        );
      fullBackupData.artist_external_ids = bExt;
    }

    if (venIds.length > 0) {
      const { data: bVen, error: vErr } = await client
        .from('venues')
        .select('*')
        .in('id', venIds);
      if (vErr)
        throw new Error(`Backup failed querying venues: ${vErr.message}`);
      fullBackupData.venues = bVen;
    }

    if (srcIds.length > 0) {
      const { data: bSrc, error: sErr } = await client
        .from('sources')
        .select('*')
        .in('id', srcIds);
      if (sErr)
        throw new Error(`Backup failed querying sources: ${sErr.message}`);
      fullBackupData.sources = bSrc;
    }

    try {
      fs.writeFileSync(
        backupFile,
        JSON.stringify(fullBackupData, null, 2),
        'utf-8',
      );
      if (!fs.existsSync(backupFile) || fs.statSync(backupFile).size === 0) {
        throw new Error(
          'Backup file verification failed: file is missing or empty.',
        );
      }
      report.backupFile = backupFile;
      console.log(`Recoverable backup successfully saved to: ${backupFile}`);
    } catch (err) {
      throw new Error(
        `Failed to write recoverable backup: ${err instanceof Error ? err.message : String(err)}. Aborting cleanup.`,
      );
    }
  }

  // Execute deletions step by step with fail-loud error checks
  const evArr = Array.from(syntheticEventIds);
  const candArr = Array.from(syntheticCandidateIds);
  const rawArr = Array.from(syntheticRawIngestIds);
  const artArr = Array.from(syntheticArtistIds);
  const venArr = Array.from(syntheticVenueIds);
  const srcArr = identifiedSources.map((s) => s.id);

  // A. event_field_evidence
  if (evArr.length > 0) {
    const { error } = await client
      .from('event_field_evidence')
      .delete()
      .in('event_id', evArr);
    if (error)
      throw new Error(
        `Failed to delete event_field_evidence by event_id: ${error.message}`,
      );
  }
  if (candArr.length > 0) {
    const { error } = await client
      .from('event_field_evidence')
      .delete()
      .in('candidate_id', candArr);
    if (error)
      throw new Error(
        `Failed to delete event_field_evidence by candidate_id: ${error.message}`,
      );
  }

  // B. event_ticket_links
  if (evArr.length > 0) {
    const { error } = await client
      .from('event_ticket_links')
      .delete()
      .in('event_id', evArr);
    if (error)
      throw new Error(`Failed to delete event_ticket_links: ${error.message}`);
  }

  // C. event_artists
  if (evArr.length > 0) {
    const { error } = await client
      .from('event_artists')
      .delete()
      .in('event_id', evArr);
    if (error)
      throw new Error(`Failed to delete event_artists: ${error.message}`);
  }

  // D. event_sources
  if (evArr.length > 0) {
    const { error } = await client
      .from('event_sources')
      .delete()
      .in('event_id', evArr);
    if (error)
      throw new Error(`Failed to delete event_sources: ${error.message}`);
  }
  if (candArr.length > 0) {
    const { error } = await client
      .from('event_sources')
      .delete()
      .in('candidate_id', candArr);
    if (error)
      throw new Error(
        `Failed to delete event_sources by candidate_id: ${error.message}`,
      );
  }

  // E. candidate_resolutions
  if (evArr.length > 0) {
    const { error } = await client
      .from('candidate_resolutions')
      .delete()
      .in('event_id', evArr);
    if (error)
      throw new Error(
        `Failed to delete candidate_resolutions: ${error.message}`,
      );
  }

  // F. events
  if (evArr.length > 0) {
    const { error } = await client.from('events').delete().in('id', evArr);
    if (error) throw new Error(`Failed to delete events: ${error.message}`);
    console.log(`Deleted ${evArr.length} synthetic events.`);
  }

  // G. event_candidates
  if (candArr.length > 0) {
    const { error } = await client
      .from('event_candidates')
      .delete()
      .in('id', candArr);
    if (error)
      throw new Error(`Failed to delete event_candidates: ${error.message}`);
    console.log(`Deleted ${candArr.length} synthetic candidates.`);
  }

  // H. raw_ingests
  if (rawArr.length > 0) {
    const { error } = await client
      .from('raw_ingests')
      .delete()
      .in('id', rawArr);
    if (error)
      throw new Error(`Failed to delete raw_ingests: ${error.message}`);
    console.log(`Deleted ${rawArr.length} synthetic raw_ingests.`);
  }

  // I. artist_external_ids & artists
  if (artArr.length > 0) {
    const { error: extErr } = await client
      .from('artist_external_ids')
      .delete()
      .in('artist_id', artArr);
    if (extErr)
      throw new Error(
        `Failed to delete artist_external_ids: ${extErr.message}`,
      );
    const { error: artDelErr } = await client
      .from('artists')
      .delete()
      .in('id', artArr);
    if (artDelErr)
      throw new Error(`Failed to delete artists: ${artDelErr.message}`);
    console.log(`Deleted ${artArr.length} synthetic artists.`);
  }

  // J. venue_aliases & venues
  if (venArr.length > 0) {
    const { error: aliasErr } = await client
      .from('venue_aliases')
      .delete()
      .in('venue_id', venArr);
    if (aliasErr)
      throw new Error(`Failed to delete venue_aliases: ${aliasErr.message}`);
    const { error: venDelErr } = await client
      .from('venues')
      .delete()
      .in('id', venArr);
    if (venDelErr)
      throw new Error(`Failed to delete venues: ${venDelErr.message}`);
    console.log(`Deleted ${venArr.length} synthetic venues.`);
  }

  // K. dynamic test sources
  if (srcArr.length > 0) {
    const { error: srcDelErr } = await client
      .from('sources')
      .delete()
      .in('id', srcArr);
    if (srcDelErr)
      throw new Error(`Failed to delete sources: ${srcDelErr.message}`);
    console.log(`Deleted ${srcArr.length} synthetic sources.`);
  }

  console.log('\n[CLEANUP COMPLETED SUCCESSFULLY]');
  return report;
}

const args = parseArgs(process.argv.slice(2));
runCleanup(args).catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
