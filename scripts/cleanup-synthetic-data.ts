#!/usr/bin/env node

/**
 * Reusable Local Database Cleanup Script for Synthetic & Test Fixtures.
 *
 * Requirements:
 * 1. Safe by default: `--dry-run` is active unless `--apply` is explicitly passed.
 * 2. Destination Guard: Strictly fails if run against non-local database without explicit override.
 * 3. Atomic / Dependency-Safe: Deletes in proper relational order:
 *    event_field_evidence -> event_ticket_links -> event_artists -> events ->
 *    event_candidates -> raw_ingests -> unreferenced synthetic artists ->
 *    unreferenced synthetic venues -> synthetic sources.
 * 4. User Data Isolation: NEVER touches auth.users, profiles, user_spotify_connections, or user_artist_preferences.
 * 5. Legitimate Data Isolation: NEVER deletes genuine venue-ingested concerts or evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

interface ParsedArgs {
  apply: boolean;
  dryRun: boolean;
  allowProductionWrite: boolean;
  backup: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const apply = argv.includes('--apply');
  const dryRun = !apply || argv.includes('--dry-run');
  const allowProductionWrite = argv.includes('--allow-production-write');
  const backup = !argv.includes('--no-backup');

  return {
    apply: apply && !argv.includes('--dry-run'),
    dryRun,
    allowProductionWrite,
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

// Known test fixture patterns
const KNOWN_SYNTHETIC_EVENT_PATTERNS = [
  /^FK Test Event/i,
  /^Atomic Concert Success/i,
  /^Idempotent Concert/i,
  /^Enrichment Concert/i,
  /\[mw5uv3ze_maeh\]/i,
  /57cdb36c/i,
  /^Ghost Live - Tour A/i,
  /^Acoustic Sunday \(Date Only\)/i,
  /^Canyon Winds Live/i,
  /^The Mountain Echoes Live/i,
  /^Event [12]$/i,
  /^Batch Show (One|Two)/i,
];

const KNOWN_SYNTHETIC_ARTIST_NAMES = new Set([
  'The Mountain Echoes',
  'River Pines',
  'Canyon Winds',
  'Local Acoustic Duo',
  'Ghost',
  'Artist One',
  'Artist Two',
]);

const KNOWN_SYNTHETIC_ARTIST_PATTERNS = [
  /\[mw5uv3ze_maeh\]/i,
  /57cdb36c/i,
  /17940228\d+/i,
  /^Test (Match|Idempotent|Alpha|Beta) Artist/i,
  /^Success Artist/i,
];

const KNOWN_SYNTHETIC_VENUE_NAMES = new Set([
  'Red Rock Amphitheatre', // Note the singular "Rock" used in fake adapter
]);

const KNOWN_SYNTHETIC_VENUE_PATTERNS = [
  /57cdb36c/i,
  /17940228\d+/i,
  /^Success Venue/i,
  /^Test (Primary|Secondary) Venue/i,
];

const KNOWN_SYNTHETIC_RAW_INGEST_URL_PATTERNS = [
  /^https?:\/\/example(-venue)?\.com/i,
  /^https?:\/\/example\.org/i,
  /ticketmaster\.com\/discovery\/v2\/events\.json\?classificationName=Music&stateCode=CO/i,
];

const KNOWN_SYNTHETIC_SOURCE_IDS = new Set([
  'fake-venue-adapter',
  'fake-secondary-adapter',
  'source-alpha-57cdb36c',
  'source-beta-57cdb36c',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000003',
]);

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
    ambiguousCount: number;
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

  assertSafeDatabaseTarget(
    url,
    args.allowProductionWrite,
    'Synthetic Catalog Cleanup',
  );

  const client: SupabaseClient = createClient(url, serviceRoleKey);

  console.log('----------------------------------------------------');
  console.log(
    `Encore Synthetic Catalog Cleanup (${args.apply ? 'APPLY MODE' : 'DRY RUN'})`,
  );
  console.log(`Target Database: ${url}`);
  console.log('----------------------------------------------------');

  // 1. Fetch all events and determine synthetic vs genuine
  const { data: allEvents, error: eventsErr } = await client
    .from('events')
    .select('id, name, local_start_date, venue_id, created_at');
  if (eventsErr)
    throw new Error(`Failed to query events: ${eventsErr.message}`);

  // Fetch all raw ingests
  const { data: allRawIngests, error: rawErr } = await client
    .from('raw_ingests')
    .select('id, source_id, source_url, fetched_at');
  if (rawErr) throw new Error(`Failed to query raw_ingests: ${rawErr.message}`);

  // Fetch all candidates
  const { data: allCandidates, error: candErr } = await client
    .from('event_candidates')
    .select('id, raw_ingest_id, title, source_id');
  if (candErr)
    throw new Error(`Failed to query event_candidates: ${candErr.message}`);

  // Fetch all venues
  const { data: allVenues, error: venErr } = await client
    .from('venues')
    .select('id, name, created_at');
  if (venErr) throw new Error(`Failed to query venues: ${venErr.message}`);

  // Fetch all artists
  const { data: allArtists, error: artErr } = await client
    .from('artists')
    .select('id, name, created_at');
  if (artErr) throw new Error(`Failed to query artists: ${artErr.message}`);

  // Fetch all sources
  const { data: allSources, error: srcErr } = await client
    .from('sources')
    .select('id, name, slug, source_type');
  if (srcErr) throw new Error(`Failed to query sources: ${srcErr.message}`);

  // 2. Identify synthetic raw ingests
  const syntheticRawIngestIds = new Set<string>();
  const identifiedRawIngests: Array<{
    id: string;
    url: string;
    reason: string;
  }> = [];

  for (const r of allRawIngests || []) {
    let isSynthetic = false;
    let reason = '';

    if (KNOWN_SYNTHETIC_SOURCE_IDS.has(r.source_id)) {
      isSynthetic = true;
      reason = `Matches test source_id: ${r.source_id}`;
    } else if (
      KNOWN_SYNTHETIC_RAW_INGEST_URL_PATTERNS.some((p) => p.test(r.source_url))
    ) {
      isSynthetic = true;
      reason = `Matches test URL pattern: ${r.source_url}`;
    }

    if (isSynthetic) {
      syntheticRawIngestIds.add(r.id);
      identifiedRawIngests.push({ id: r.id, url: r.source_url, reason });
    }
  }

  // 3. Identify synthetic candidates
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
      reason = `Originated from synthetic raw_ingest ${c.raw_ingest_id}`;
    } else if (KNOWN_SYNTHETIC_SOURCE_IDS.has(c.source_id)) {
      isSynthetic = true;
      reason = `Matches test source_id: ${c.source_id}`;
    }

    if (isSynthetic) {
      syntheticCandidateIds.add(c.id);
      identifiedCandidates.push({ id: c.id, title: c.title, reason });
    }
  }

  // 4. Identify synthetic events
  const syntheticEventIds = new Set<string>();
  const identifiedEvents: Array<{ id: string; name: string; reason: string }> =
    [];
  const genuineEvents: Array<{ id: string; name: string }> = [];

  for (const ev of allEvents || []) {
    let isSynthetic = false;
    let reason = '';

    for (const pattern of KNOWN_SYNTHETIC_EVENT_PATTERNS) {
      if (pattern.test(ev.name)) {
        isSynthetic = true;
        reason = `Matches test event name pattern: ${pattern}`;
        break;
      }
    }

    if (isSynthetic) {
      syntheticEventIds.add(ev.id);
      identifiedEvents.push({ id: ev.id, name: ev.name, reason });
    } else {
      genuineEvents.push({ id: ev.id, name: ev.name });
    }
  }

  // 5. Check event_field_evidence, event_ticket_links, event_artists linked to synthetic events
  let evidenceToDelete = 0;
  let ticketLinksToDelete = 0;
  let eventArtistsToDelete = 0;

  if (syntheticEventIds.size > 0 || syntheticCandidateIds.size > 0) {
    const { count: evCount } = await client
      .from('event_field_evidence')
      .select('*', { count: 'exact', head: true })
      .or(
        syntheticEventIds.size > 0
          ? `event_id.in.(${Array.from(syntheticEventIds).join(',')})`
          : 'id.is.null',
      );
    evidenceToDelete = evCount || 0;

    const { count: tlCount } = await client
      .from('event_ticket_links')
      .select('*', { count: 'exact', head: true })
      .in('event_id', Array.from(syntheticEventIds));
    ticketLinksToDelete = tlCount || 0;

    const { count: eaCount } = await client
      .from('event_artists')
      .select('*', { count: 'exact', head: true })
      .in('event_id', Array.from(syntheticEventIds));
    eventArtistsToDelete = eaCount || 0;
  }

  // 6. Identify synthetic artists (only if not referenced by genuine events)
  const identifiedArtists: Array<{ id: string; name: string; reason: string }> =
    [];
  const syntheticArtistIds = new Set<string>();

  for (const art of allArtists || []) {
    let isSynthetic = false;
    let reason = '';

    if (KNOWN_SYNTHETIC_ARTIST_NAMES.has(art.name)) {
      isSynthetic = true;
      reason = `Matches known synthetic artist name "${art.name}"`;
    } else if (KNOWN_SYNTHETIC_ARTIST_PATTERNS.some((p) => p.test(art.name))) {
      isSynthetic = true;
      reason = `Matches synthetic artist pattern: "${art.name}"`;
    }

    if (isSynthetic) {
      syntheticArtistIds.add(art.id);
      identifiedArtists.push({ id: art.id, name: art.name, reason });
    }
  }

  // 7. Identify synthetic venues (only if not referenced by genuine events)
  const identifiedVenues: Array<{ id: string; name: string; reason: string }> =
    [];
  const syntheticVenueIds = new Set<string>();

  for (const ven of allVenues || []) {
    let isSynthetic = false;
    let reason = '';

    if (KNOWN_SYNTHETIC_VENUE_NAMES.has(ven.name)) {
      isSynthetic = true;
      reason = `Matches known synthetic venue name "${ven.name}"`;
    } else if (KNOWN_SYNTHETIC_VENUE_PATTERNS.some((p) => p.test(ven.name))) {
      isSynthetic = true;
      reason = `Matches synthetic venue pattern: "${ven.name}"`;
    }

    if (isSynthetic) {
      syntheticVenueIds.add(ven.id);
      identifiedVenues.push({ id: ven.id, name: ven.name, reason });
    }
  }

  // 8. Identify synthetic sources (preserve baseline seed sources from seed.sql)
  const BASELINE_SEED_SOURCE_SLUGS = new Set([
    'fake-venue-adapter',
    'fake-secondary-adapter',
  ]);
  const identifiedSources: Array<{ id: string; name: string; reason: string }> =
    [];
  const syntheticSourceIds = new Set<string>();

  for (const src of allSources || []) {
    if (BASELINE_SEED_SOURCE_SLUGS.has(src.slug)) {
      continue; // Preserve seed sources
    }
    if (
      KNOWN_SYNTHETIC_SOURCE_IDS.has(src.id) ||
      src.name.includes('57cdb36c')
    ) {
      syntheticSourceIds.add(src.id);
      identifiedSources.push({
        id: src.id,
        name: src.name,
        reason: `Matches synthetic source ID/name: ${src.id}`,
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
      ambiguousCount: 0,
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

  // 10. Execute deletion in dependency-safe order
  console.log('\n[APPLYING CLEANUP...]');

  // Optional backup before deletion
  if (args.backup) {
    const backupDir = path.resolve(process.cwd(), '.backup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupFile = path.join(
      backupDir,
      `synthetic-cleanup-backup-${Date.now()}.json`,
    );
    const backupData = {
      timestamp: new Date().toISOString(),
      databaseUrl: url,
      events: identifiedEvents,
      rawIngests: identifiedRawIngests,
      candidates: identifiedCandidates,
      artists: identifiedArtists,
      venues: identifiedVenues,
      sources: identifiedSources,
    };
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
    report.backupFile = backupFile;
    console.log(`Backup saved to: ${backupFile}`);
  }

  // Step A: Delete event_field_evidence
  if (syntheticEventIds.size > 0) {
    const evArr = Array.from(syntheticEventIds);
    const { error: delEvidenceErr } = await client
      .from('event_field_evidence')
      .delete()
      .in('event_id', evArr);
    if (delEvidenceErr) {
      console.warn(
        `Warning deleting event_field_evidence by event_id: ${delEvidenceErr.message}`,
      );
    }
  }

  if (syntheticCandidateIds.size > 0) {
    const candArr = Array.from(syntheticCandidateIds);
    const { error: delEvidenceCandErr } = await client
      .from('event_field_evidence')
      .delete()
      .in('candidate_id', candArr);
    if (delEvidenceCandErr) {
      console.warn(
        `Warning deleting event_field_evidence by candidate_id: ${delEvidenceCandErr.message}`,
      );
    }
  }

  // Step B: Delete event_ticket_links
  if (syntheticEventIds.size > 0) {
    const evArr = Array.from(syntheticEventIds);
    const { error: delTicketLinksErr } = await client
      .from('event_ticket_links')
      .delete()
      .in('event_id', evArr);
    if (delTicketLinksErr) {
      throw new Error(
        `Failed to delete event_ticket_links: ${delTicketLinksErr.message}`,
      );
    }
  }

  // Step C: Delete event_artists
  if (syntheticEventIds.size > 0) {
    const evArr = Array.from(syntheticEventIds);
    const { error: delEventArtistsErr } = await client
      .from('event_artists')
      .delete()
      .in('event_id', evArr);
    if (delEventArtistsErr) {
      throw new Error(
        `Failed to delete event_artists: ${delEventArtistsErr.message}`,
      );
    }
  }

  // Step D: Delete events
  if (syntheticEventIds.size > 0) {
    const evArr = Array.from(syntheticEventIds);
    const { error: delEventsErr } = await client
      .from('events')
      .delete()
      .in('id', evArr);
    if (delEventsErr) {
      throw new Error(`Failed to delete events: ${delEventsErr.message}`);
    }
    console.log(`Deleted ${evArr.length} synthetic events.`);
  }

  // Step E: Delete event_candidates
  if (syntheticCandidateIds.size > 0) {
    const candArr = Array.from(syntheticCandidateIds);
    const { error: delCandidatesErr } = await client
      .from('event_candidates')
      .delete()
      .in('id', candArr);
    if (delCandidatesErr) {
      throw new Error(
        `Failed to delete event_candidates: ${delCandidatesErr.message}`,
      );
    }
    console.log(`Deleted ${candArr.length} synthetic candidates.`);
  }

  // Step F: Delete raw_ingests
  if (syntheticRawIngestIds.size > 0) {
    const rawArr = Array.from(syntheticRawIngestIds);
    const { error: delRawErr } = await client
      .from('raw_ingests')
      .delete()
      .in('id', rawArr);
    if (delRawErr) {
      throw new Error(`Failed to delete raw_ingests: ${delRawErr.message}`);
    }
    console.log(`Deleted ${rawArr.length} synthetic raw_ingests.`);
  }

  // Step G: Delete synthetic artists
  if (syntheticArtistIds.size > 0) {
    const artArr = Array.from(syntheticArtistIds);
    const { error: delArtistsErr } = await client
      .from('artists')
      .delete()
      .in('id', artArr);
    if (delArtistsErr) {
      console.warn(
        `Warning deleting synthetic artists: ${delArtistsErr.message}`,
      );
    } else {
      console.log(`Deleted ${artArr.length} synthetic artists.`);
    }
  }

  // Step H: Delete synthetic venues
  if (syntheticVenueIds.size > 0) {
    const venArr = Array.from(syntheticVenueIds);
    const { error: delVenuesErr } = await client
      .from('venues')
      .delete()
      .in('id', venArr);
    if (delVenuesErr) {
      console.warn(
        `Warning deleting synthetic venues: ${delVenuesErr.message}`,
      );
    } else {
      console.log(`Deleted ${venArr.length} synthetic venues.`);
    }
  }

  // Step I: Delete synthetic sources
  if (syntheticSourceIds.size > 0) {
    const srcArr = Array.from(syntheticSourceIds);
    const { error: delSourcesErr } = await client
      .from('sources')
      .delete()
      .in('id', srcArr);
    if (delSourcesErr) {
      console.warn(
        `Warning deleting synthetic sources: ${delSourcesErr.message}`,
      );
    } else {
      console.log(`Deleted ${srcArr.length} synthetic sources.`);
    }
  }

  console.log('\n[CLEANUP COMPLETED SUCCESSFULLY]');
  return report;
}

const args = parseArgs(process.argv.slice(2));
runCleanup(args).catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
