#!/usr/bin/env node

/**
 * Seed Synthetic Fixture: John Summit
 *
 * Seeds a synthetic concert fixture for canonical artist John Summit
 * to test end-to-end personalization and recommendation scoring without external API dependencies.
 *
 * Invariants Preserved:
 * - Invariant 5: Conservative Entity Resolution (Spotify ID '7kNqXtgeIwFtelmRjWv205' mapped strictly)
 * - Invariant 6: Strict Destination Guard (127.0.0.1 / localhost local Supabase only)
 * - Invariant 12: Isolation of Synthetic & Demo Data (isolated source 'synthetic_fixture_test_john_summit',
 *   no real ticketing URL, clearly marked TEST EVENT)
 *
 * Usage:
 *   npx vite-node --config vitest.config.ts scripts/seed-john-summit-fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';

export const JOHN_SUMMIT_ARTIST_NAME = 'John Summit';
export const JOHN_SUMMIT_NORMALIZED_NAME = 'john summit';
export const JOHN_SUMMIT_SPOTIFY_ID = '7kNqXtgeIwFtelmRjWv205';
export const SYNTHETIC_SOURCE_SLUG = 'synthetic_fixture_test_john_summit';
export const SYNTHETIC_EVENT_TITLE = 'TEST EVENT — John Summit (NOT REAL)';
export const SYNTHETIC_EVENT_NORMALIZED_TITLE =
  'test event john summit not real';
export const SYNTHETIC_EVENT_DATE = '2026-11-25';
export const SYNTHETIC_EVENT_STARTS_AT = '2026-11-26T03:00:00Z'; // 8:00 PM Mountain Time on 2026-11-25
export const SYNTHETIC_SOURCE_EVENT_ID = 'synthetic_john_summit_20261125';
export const SYNTHETIC_SOURCE_URL =
  'https://synthetic.encore.test/events/john-summit-20261125';
export const SYNTHETIC_HASH = 'hash_synthetic_john_summit_20261125';

export interface SeedResult {
  artistId: string;
  venueId: string;
  eventId: string;
  sourceId: string;
  rawIngestId: string;
  candidateId: string;
}

export function loadEnvLocal(): void {
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

export function resolveSupabaseAdmin(): {
  client: SupabaseClient;
  url: string;
} {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required to seed John Summit fixture.',
    );
  }

  // Invariant 6: Strict destination safety check
  assertSafeDatabaseTarget(url, false, 'seed-john-summit-fixture', true);

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { client, url };
}

/**
 * Idempotently seeds the John Summit synthetic concert fixture into the local Supabase database.
 */
export async function seedJohnSummitFixture(
  client?: SupabaseClient,
): Promise<SeedResult> {
  const adminClient = client ?? resolveSupabaseAdmin().client;

  // 1. Ensure canonical artist John Summit exists in `artists`
  let artistId: string;
  const { data: existingArtist, error: artLookupErr } = await adminClient
    .from('artists')
    .select('id, name')
    .ilike('name', JOHN_SUMMIT_ARTIST_NAME)
    .maybeSingle();

  if (artLookupErr) {
    throw new Error(`Failed to query artists: ${artLookupErr.message}`);
  }

  if (existingArtist) {
    artistId = existingArtist.id;
  } else {
    const { data: newArtist, error: artInsertErr } = await adminClient
      .from('artists')
      .insert({
        name: JOHN_SUMMIT_ARTIST_NAME,
        normalized_name: JOHN_SUMMIT_NORMALIZED_NAME,
      })
      .select('id')
      .single();

    if (artInsertErr || !newArtist) {
      throw new Error(
        `Failed to insert canonical artist: ${artInsertErr?.message}`,
      );
    }
    artistId = newArtist.id;
  }

  // 2. Ensure verified Spotify external ID is mapped in `artist_external_ids`
  const { data: existingExt, error: extLookupErr } = await adminClient
    .from('artist_external_ids')
    .select('id, artist_id, external_id')
    .eq('provider', 'spotify')
    .eq('external_id', JOHN_SUMMIT_SPOTIFY_ID)
    .maybeSingle();

  if (extLookupErr) {
    throw new Error(
      `Failed to query artist_external_ids: ${extLookupErr.message}`,
    );
  }

  if (!existingExt) {
    // Check if artist already has another Spotify external ID
    const { data: artistHasSpotify, error: checkErr } = await adminClient
      .from('artist_external_ids')
      .select('id')
      .eq('artist_id', artistId)
      .eq('provider', 'spotify')
      .maybeSingle();

    if (checkErr) {
      throw new Error(
        `Failed to check artist Spotify external IDs: ${checkErr.message}`,
      );
    }

    if (artistHasSpotify) {
      const { error: extUpdateErr } = await adminClient
        .from('artist_external_ids')
        .update({
          external_id: JOHN_SUMMIT_SPOTIFY_ID,
          provider_url: `https://open.spotify.com/artist/${JOHN_SUMMIT_SPOTIFY_ID}`,
        })
        .eq('id', artistHasSpotify.id);

      if (extUpdateErr) {
        throw new Error(
          `Failed to update artist_external_ids: ${extUpdateErr.message}`,
        );
      }
    } else {
      const { error: extInsertErr } = await adminClient
        .from('artist_external_ids')
        .insert({
          artist_id: artistId,
          provider: 'spotify',
          external_id: JOHN_SUMMIT_SPOTIFY_ID,
          provider_url: `https://open.spotify.com/artist/${JOHN_SUMMIT_SPOTIFY_ID}`,
        });

      if (extInsertErr) {
        throw new Error(
          `Failed to insert artist_external_ids: ${extInsertErr.message}`,
        );
      }
    }
  }

  // 3. Ensure synthetic source registry entry exists in `sources`
  let sourceId: string;
  const { data: existingSource, error: srcLookupErr } = await adminClient
    .from('sources')
    .select('id, slug')
    .eq('slug', SYNTHETIC_SOURCE_SLUG)
    .maybeSingle();

  if (srcLookupErr) {
    throw new Error(`Failed to query sources: ${srcLookupErr.message}`);
  }

  if (existingSource) {
    sourceId = existingSource.id;
  } else {
    const { data: newSource, error: srcInsertErr } = await adminClient
      .from('sources')
      .insert({
        slug: SYNTHETIC_SOURCE_SLUG,
        name: 'Synthetic Fixture — John Summit',
        source_type: 'synthetic_fixture',
        acquisition_method: 'fixture',
        base_url: 'https://synthetic.encore.test',
        active: true,
        reliability_score: 1.0,
        parser_version: '1.0.0',
      })
      .select('id')
      .single();

    if (srcInsertErr || !newSource) {
      throw new Error(`Failed to insert source: ${srcInsertErr?.message}`);
    }
    sourceId = newSource.id;
  }

  // 4. Resolve venue (prefer existing Denver Mission Ballroom)
  let venueId: string;
  let venueCity = 'Denver';
  let venueRegion = 'CO';
  let venueCountry = 'US';
  let venueTimezone = 'America/Denver';

  const { data: existingVenue, error: venueLookupErr } = await adminClient
    .from('venues')
    .select('id, name, city, region, country_code, timezone')
    .ilike('name', '%Mission Ballroom%')
    .limit(1)
    .maybeSingle();

  if (venueLookupErr) {
    throw new Error(`Failed to query venues: ${venueLookupErr.message}`);
  }

  if (existingVenue) {
    venueId = existingVenue.id;
    venueCity = existingVenue.city || venueCity;
    venueRegion = existingVenue.region || venueRegion;
    venueCountry = existingVenue.country_code || venueCountry;
    venueTimezone = existingVenue.timezone || venueTimezone;
  } else {
    // If not found, create canonical Mission Ballroom
    const { data: newVenue, error: venueInsertErr } = await adminClient
      .from('venues')
      .insert({
        name: 'Mission Ballroom',
        normalized_name: 'mission ballroom',
        city: 'Denver',
        region: 'CO',
        country_code: 'US',
        timezone: 'America/Denver',
        website: 'https://missionballroom.com',
      })
      .select('id')
      .single();

    if (venueInsertErr || !newVenue) {
      throw new Error(`Failed to insert venue: ${venueInsertErr?.message}`);
    }
    venueId = newVenue.id;
  }

  // 5. Ensure raw_ingests provenance record exists (Invariant 3)
  let rawIngestId: string;
  const { data: existingRaw, error: rawLookupErr } = await adminClient
    .from('raw_ingests')
    .select('id')
    .eq('source_id', sourceId)
    .eq('source_url', SYNTHETIC_SOURCE_URL)
    .maybeSingle();

  if (rawLookupErr) {
    throw new Error(`Failed to query raw_ingests: ${rawLookupErr.message}`);
  }

  if (existingRaw) {
    rawIngestId = existingRaw.id;
  } else {
    const { data: newRaw, error: rawInsertErr } = await adminClient
      .from('raw_ingests')
      .insert({
        source_id: sourceId,
        source_url: SYNTHETIC_SOURCE_URL,
        acquisition_method: 'fixture',
        content_hash: SYNTHETIC_HASH,
        content_type: 'application/json',
        raw_content: JSON.stringify({
          title: SYNTHETIC_EVENT_TITLE,
          artist: JOHN_SUMMIT_ARTIST_NAME,
          date: SYNTHETIC_EVENT_DATE,
          venue: 'Mission Ballroom',
        }),
      })
      .select('id')
      .single();

    if (rawInsertErr || !newRaw) {
      throw new Error(`Failed to insert raw_ingests: ${rawInsertErr?.message}`);
    }
    rawIngestId = newRaw.id;
  }

  // 6. Ensure event_candidates record exists (Invariant 3)
  let candidateId: string;
  const { data: existingCandidate, error: candLookupErr } = await adminClient
    .from('event_candidates')
    .select('id')
    .eq('source_id', sourceId)
    .eq('source_event_id', SYNTHETIC_SOURCE_EVENT_ID)
    .maybeSingle();

  if (candLookupErr) {
    throw new Error(
      `Failed to query event_candidates: ${candLookupErr.message}`,
    );
  }

  if (existingCandidate) {
    candidateId = existingCandidate.id;
  } else {
    const { data: newCand, error: candInsertErr } = await adminClient
      .from('event_candidates')
      .insert({
        raw_ingest_id: rawIngestId,
        source_id: sourceId,
        source_event_id: SYNTHETIC_SOURCE_EVENT_ID,
        source_type: 'synthetic_fixture',
        acquisition_method: 'fixture',
        source_url: SYNTHETIC_SOURCE_URL,
        content_hash: SYNTHETIC_HASH,
        candidate_fingerprint: 'fp_synthetic_john_summit_20261125',
        title: SYNTHETIC_EVENT_TITLE,
        artist_names: [JOHN_SUMMIT_ARTIST_NAME],
        venue_name: 'Mission Ballroom',
        city: venueCity,
        state: venueRegion,
        country: venueCountry,
        timezone: venueTimezone,
        local_start_date: SYNTHETIC_EVENT_DATE,
        starts_at: SYNTHETIC_EVENT_STARTS_AT,
        start_time_precision: 'instant',
        event_kind: 'concert',
        verification_status: 'synthetic_fixture',
        confidence: 1.0,
      })
      .select('id')
      .single();

    if (candInsertErr || !newCand) {
      throw new Error(
        `Failed to insert event_candidates: ${candInsertErr?.message}`,
      );
    }
    candidateId = newCand.id;
  }

  // 7. Ensure canonical event exists in `events` (Invariant 12)
  let eventId: string;
  const { data: existingEvent, error: evLookupErr } = await adminClient
    .from('events')
    .select('id')
    .eq('name', SYNTHETIC_EVENT_TITLE)
    .maybeSingle();

  if (evLookupErr) {
    throw new Error(`Failed to query events: ${evLookupErr.message}`);
  }

  if (existingEvent) {
    eventId = existingEvent.id;
  } else {
    const { data: newEvent, error: evInsertErr } = await adminClient
      .from('events')
      .insert({
        name: SYNTHETIC_EVENT_TITLE,
        normalized_name: SYNTHETIC_EVENT_NORMALIZED_TITLE,
        event_kind: 'concert',
        status: 'scheduled',
        venue_id: venueId,
        city: venueCity,
        region: venueRegion,
        country_code: venueCountry,
        lat: null,
        lng: null,
        timezone: venueTimezone,
        local_start_date: SYNTHETIC_EVENT_DATE,
        starts_at: SYNTHETIC_EVENT_STARTS_AT,
        start_time_precision: 'instant',
        is_multi_day: false,
        official_url: SYNTHETIC_SOURCE_URL,
        primary_ticket_url: null, // Invariant 12: No real ticketing URL
      })
      .select('id')
      .single();

    if (evInsertErr || !newEvent) {
      throw new Error(`Failed to insert event: ${evInsertErr?.message}`);
    }
    eventId = newEvent.id;
  }

  // 8. Ensure headliner link in `event_artists`
  const { data: existingEvArtist, error: evArtLookupErr } = await adminClient
    .from('event_artists')
    .select('id')
    .eq('event_id', eventId)
    .eq('artist_id', artistId)
    .maybeSingle();

  if (evArtLookupErr) {
    throw new Error(`Failed to query event_artists: ${evArtLookupErr.message}`);
  }

  if (!existingEvArtist) {
    const { error: evArtInsertErr } = await adminClient
      .from('event_artists')
      .insert({
        event_id: eventId,
        artist_id: artistId,
        billing_position: 'headliner',
        sort_order: 1,
      });

    if (evArtInsertErr) {
      throw new Error(
        `Failed to insert event_artists: ${evArtInsertErr.message}`,
      );
    }
  }

  // 9. Ensure provenance link in `event_sources`
  const { data: existingEvSource, error: evSrcLookupErr } = await adminClient
    .from('event_sources')
    .select('id')
    .eq('event_id', eventId)
    .eq('source_id', sourceId)
    .maybeSingle();

  if (evSrcLookupErr) {
    throw new Error(`Failed to query event_sources: ${evSrcLookupErr.message}`);
  }

  if (!existingEvSource) {
    const { error: evSrcInsertErr } = await adminClient
      .from('event_sources')
      .insert({
        event_id: eventId,
        source_id: sourceId,
        candidate_id: candidateId,
        raw_ingest_id: rawIngestId,
        source_event_id: SYNTHETIC_SOURCE_EVENT_ID,
        source_url: SYNTHETIC_SOURCE_URL,
        confidence: 1.0,
        is_current: true,
      });

    if (evSrcInsertErr) {
      throw new Error(
        `Failed to insert event_sources: ${evSrcInsertErr.message}`,
      );
    }
  }

  return {
    artistId,
    venueId,
    eventId,
    sourceId,
    rawIngestId,
    candidateId,
  };
}

// CLI entrypoint
const isCliEntry =
  !process.env.VITEST &&
  !process.env.PLAYWRIGHT_TEST &&
  Boolean(process.argv[1]?.includes('seed-john-summit-fixture'));

if (isCliEntry) {
  seedJohnSummitFixture()
    .then((result) => {
      console.log('✓ Successfully seeded John Summit synthetic fixture:');
      console.log(
        `  Artist ID:     ${result.artistId} (${JOHN_SUMMIT_ARTIST_NAME})`,
      );
      console.log(`  Spotify ID:    ${JOHN_SUMMIT_SPOTIFY_ID}`);
      console.log(`  Venue ID:      ${result.venueId}`);
      console.log(
        `  Event ID:      ${result.eventId} (${SYNTHETIC_EVENT_TITLE})`,
      );
      console.log(
        `  Source ID:     ${result.sourceId} (${SYNTHETIC_SOURCE_SLUG})`,
      );
      console.log(`  Raw Ingest ID: ${result.rawIngestId}`);
      console.log(`  Candidate ID:  ${result.candidateId}`);
    })
    .catch((err) => {
      console.error('✗ Failed to seed John Summit fixture:', err);
      process.exit(1);
    });
}
