import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { SupabaseSourceRepository } from '@/lib/repositories/source-repository';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import { SupabaseEventCandidateRepository } from '@/lib/repositories/event-candidate-repository';
import { SupabaseCatalogRepository } from '@/lib/repositories/catalog-repository';
import { ensureTicketmasterSource } from '@/lib/sources/ticketmaster/source-registry';
import { runTicketmasterIngestion } from '@/lib/sources/ticketmaster/ingestion-pipeline';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import type { CanonicalizationPayload } from '@/lib/repositories/interfaces';
import { buildIsolatedTicketmasterFixture } from '../fixtures/fixture-helper';

interface LocalCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

function resolveSupabaseCredentials(): LocalCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && anonKey && serviceRoleKey) {
    return {
      url,
      anonKey,
      serviceRoleKey,
    };
  }

  try {
    const rawOutput = execSync('npx supabase status -o json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(rawOutput) as {
      API_URL?: string;
      ANON_KEY?: string;
      SERVICE_ROLE_KEY?: string;
    };

    if (parsed.API_URL && parsed.ANON_KEY && parsed.SERVICE_ROLE_KEY) {
      return {
        url: url || parsed.API_URL,
        anonKey: anonKey || parsed.ANON_KEY,
        serviceRoleKey: serviceRoleKey || parsed.SERVICE_ROLE_KEY,
      };
    }
  } catch {
    // Ignore
  }

  return null;
}

describe('Supabase Integration: Ticketmaster Ingestion & Canonicalization', () => {
  const credentials = resolveSupabaseCredentials();

  // Generate an isolated fixture uniquely namespaced to this test suite execution.
  // Guarantees repeat runs against the same persistent local development database
  // pass cleanly without requiring a database reset.
  const suiteNonce = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const dayOffset = (Date.now() % 50000) + Math.floor(Math.random() * 500) + 1;
  const isolatedFixtureJson = buildIsolatedTicketmasterFixture(
    suiteNonce,
    dayOffset,
  );

  let adminClient: SupabaseClient | null = null;
  let isDbAvailable = false;

  let sourceRepo: SupabaseSourceRepository;
  let rawIngestRepo: SupabaseRawIngestRepository;
  let candidateRepo: SupabaseEventCandidateRepository;
  let catalogRepo: SupabaseCatalogRepository;

  const trackedCreated = {
    rawIngestIds: new Set<string>(),
    candidateIds: new Set<string>(),
    eventIds: new Set<string>(),
    artistIds: new Set<string>(),
  };

  function ensureDbAvailable(): boolean {
    if (!isDbAvailable || !adminClient) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase stack is not responding at ${credentials?.url ?? 'unknown'} in CI. Database validation is required on pull requests.`,
        );
      }
      return false;
    }
    return true;
  }

  beforeAll(async () => {
    if (!credentials) {
      if (process.env.CI) {
        throw new Error('Supabase credentials could not be resolved in CI.');
      }
      return;
    }

    // Verify database target passes strict destination safety guard
    assertSafeDatabaseTarget(
      credentials.url,
      false,
      'Ticketmaster integration test suite',
    );

    try {
      const response = await fetch(`${credentials.url}/auth/v1/health`, {
        headers: { apikey: credentials.anonKey },
      });
      if (response.ok) {
        isDbAvailable = true;
      }
    } catch {
      isDbAvailable = false;
    }

    if (!isDbAvailable) {
      if (process.env.CI) {
        throw new Error(
          `Local Supabase stack is not responding at ${credentials.url} in CI. Database validation is required on pull requests.`,
        );
      }
      console.warn(
        `Local Supabase is not running at ${credentials.url}. Skipping Ticketmaster integration tests locally.`,
      );
      return;
    }

    adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    sourceRepo = new SupabaseSourceRepository(adminClient);
    rawIngestRepo = new SupabaseRawIngestRepository(adminClient);
    candidateRepo = new SupabaseEventCandidateRepository(adminClient);
    catalogRepo = new SupabaseCatalogRepository(adminClient);
  });

  it('enforces destination guard safety against non-local and spoofed database hosts', () => {
    expect(() =>
      assertSafeDatabaseTarget(
        'https://evil-local.com',
        false,
        'Integration destination test',
      ),
    ).toThrow(
      /Target database .* is not a verified local or development instance/,
    );
    expect(() =>
      assertSafeDatabaseTarget(
        'https://attacker.dev',
        false,
        'Integration destination test',
      ),
    ).toThrow(
      /Target database .* is not a verified local or development instance/,
    );
    expect(() =>
      assertSafeDatabaseTarget(
        'https://project-ref.supabase.co',
        false,
        'Integration destination test',
      ),
    ).toThrow(
      /Target database .* is not a verified local or development instance/,
    );
  });

  it('runs deterministic fixture ingestion through PostgreSQL stored procedure and verifies canonical events', async () => {
    if (!ensureDbAvailable()) return;

    const source = await ensureTicketmasterSource(sourceRepo);
    expect(source.slug).toBe('ticketmaster-discovery');

    const result = await runTicketmasterIngestion({
      useFixture: true,
      fixtureJson: isolatedFixtureJson,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });

    expect(result.rawIngestsPersisted).toBeGreaterThan(0);
    expect(result.candidatesPersisted).toBeGreaterThan(0);
    expect(result.canonicalEventsCreated).toBeGreaterThan(0);

    for (const id of result.persistedEventIds) {
      trackedCreated.eventIds.add(id);
    }
    for (const cand of result.candidates) {
      if (cand.id) {
        trackedCreated.candidateIds.add(cand.id);
      }
      if (cand.rawIngestId) {
        trackedCreated.rawIngestIds.add(cand.rawIngestId);
      }
    }

    // Verify canonical events are listed in catalog
    const events = await catalogRepo.listEvents({ limit: 10 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('verifies idempotent replay through PostgreSQL stored procedure produces zero duplicate events and stable evidence/resolution counts', async () => {
    if (!ensureDbAvailable()) return;

    const eventsBefore = await catalogRepo.listEvents({ limit: 50 });
    const resolutionsBefore = await catalogRepo.countResolutions();
    const evidenceBefore = await catalogRepo.countFieldEvidence();

    const replayRun = await runTicketmasterIngestion({
      useFixture: true,
      fixtureJson: isolatedFixtureJson,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
    });

    // Replay must match existing canonical events rather than creating duplicates
    expect(replayRun.rawIngestsPersisted).toBe(0);
    expect(replayRun.rawIngestsReused).toBeGreaterThan(0);
    expect(replayRun.candidatesReused).toBeGreaterThan(0);
    expect(replayRun.candidatesSkipped).toBeGreaterThan(0);
    expect(replayRun.canonicalEventsCreated).toBe(0);
    expect(replayRun.canonicalEventsMatched).toBe(0);

    const eventsAfter = await catalogRepo.listEvents({ limit: 50 });
    expect(eventsAfter.length).toBe(eventsBefore.length);

    // Verify candidate resolutions and field evidence row counts did NOT inflate on replay
    const resolutionsAfter = await catalogRepo.countResolutions();
    const evidenceAfter = await catalogRepo.countFieldEvidence();
    expect(resolutionsAfter).toBe(resolutionsBefore);
    expect(evidenceAfter).toBe(evidenceBefore);
  });

  it('reprocess mode deliberately re-evaluates candidates through PostgreSQL stored procedure', async () => {
    if (!ensureDbAvailable()) return;

    const reprocessRun = await runTicketmasterIngestion({
      useFixture: true,
      fixtureJson: isolatedFixtureJson,
      persist: true,
      sourceRepo,
      rawIngestRepo,
      candidateRepo,
      catalogRepo,
      reprocess: true,
    });

    expect(reprocessRun.candidatesSkipped).toBe(0);
    expect(reprocessRun.candidatesReused).toBeGreaterThan(0);
    expect(reprocessRun.canonicalEventsCreated).toBe(0);
    expect(reprocessRun.canonicalEventsMatched).toBeGreaterThan(0);

    for (const id of reprocessRun.persistedEventIds) {
      trackedCreated.eventIds.add(id);
    }
    for (const cand of reprocessRun.candidates) {
      if (cand.id) {
        trackedCreated.candidateIds.add(cand.id);
      }
      if (cand.rawIngestId) {
        trackedCreated.rawIngestIds.add(cand.rawIngestId);
      }
    }
  });

  it('successfully enriches external IDs for matched artist in PostgreSQL stored procedure', async () => {
    if (!ensureDbAvailable()) return;

    const testNonce = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const artistName = `Test Match Artist ${testNonce}`;

    // 1. Create artist in PostgreSQL
    const { data: artist, error: artistError } = await adminClient!
      .from('artists')
      .insert({
        name: artistName,
        normalized_name: artistName.toLowerCase().trim(),
      })
      .select('id')
      .single();

    expect(artistError).toBeNull();
    expect(artist?.id).toBeDefined();
    trackedCreated.artistIds.add(artist!.id);

    // 2. Execute canonicalization transaction enriching the artist with a Ticketmaster external ID
    const externalId = `TM-ENRICH-${testNonce}`;
    const payload: CanonicalizationPayload = {
      event: {
        name: `Enrichment Concert ${testNonce}`,
        normalized_name: `enrichment concert ${testNonce}`,
        local_start_date: '2026-11-20',
        timezone: 'America/Denver',
      },
      artists: [
        {
          artist_id: artist!.id,
          name: artistName,
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: externalId,
              provider_url: `https://ticketmaster.com/artist/${externalId}`,
            },
          ],
        },
      ],
    };

    const res = await catalogRepo.applyCanonicalization(payload);
    expect(res.eventId).toBeDefined();
    if (res.eventId) trackedCreated.eventIds.add(res.eventId);

    // 3. Verify external ID record was committed to artist_external_ids
    const { data: extRecords, error: extError } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artist!.id)
      .eq('provider', 'ticketmaster');

    expect(extError).toBeNull();
    expect(extRecords?.length).toBe(1);
    expect(extRecords![0].external_id).toBe(externalId);
  });

  it('idempotent identical external ID replay succeeds in PostgreSQL without error', async () => {
    if (!ensureDbAvailable()) return;

    const testNonce = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const artistName = `Test Idempotent Artist ${testNonce}`;

    const { data: artist, error: artistError } = await adminClient!
      .from('artists')
      .insert({
        name: artistName,
        normalized_name: artistName.toLowerCase().trim(),
      })
      .select('id')
      .single();

    expect(artistError).toBeNull();
    expect(artist?.id).toBeDefined();
    trackedCreated.artistIds.add(artist!.id);

    const externalId = `TM-IDEM-${testNonce}`;
    const payload: CanonicalizationPayload = {
      event: {
        name: `Idempotent Concert ${testNonce}`,
        normalized_name: `idempotent concert ${testNonce}`,
        local_start_date: '2026-11-21',
        timezone: 'America/Denver',
      },
      artists: [
        {
          artist_id: artist!.id,
          name: artistName,
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: externalId,
            },
          ],
        },
      ],
    };

    // First application
    const res1 = await catalogRepo.applyCanonicalization(payload);
    expect(res1.eventId).toBeDefined();
    if (res1.eventId) trackedCreated.eventIds.add(res1.eventId);

    // Replay with identical (artist_id, provider, external_id)
    const res2 = await catalogRepo.applyCanonicalization(payload);
    expect(res2.eventId).toBeDefined();
    if (res2.eventId) trackedCreated.eventIds.add(res2.eventId);

    // Verify row count in artist_external_ids remains exactly 1
    const { data: extRecords } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artist!.id)
      .eq('provider', 'ticketmaster');

    expect(extRecords?.length).toBe(1);
  });

  it('cross-artist external ID conflict rejects with 23505 and rolls back entire transaction atomically in PostgreSQL', async () => {
    if (!ensureDbAvailable()) return;

    const testNonce = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const artist1Name = `Test Alpha Artist ${testNonce}`;
    const artist2Name = `Test Beta Artist ${testNonce}`;

    // 1. Create artist 1 and assign external ID
    const { data: artist1, error: a1Error } = await adminClient!
      .from('artists')
      .insert({
        name: artist1Name,
        normalized_name: artist1Name.toLowerCase().trim(),
      })
      .select('id')
      .single();
    expect(a1Error).toBeNull();
    trackedCreated.artistIds.add(artist1!.id);

    const sharedExternalId = `TM-SHARED-${testNonce}`;
    const { error: ext1Error } = await adminClient!
      .from('artist_external_ids')
      .insert({
        artist_id: artist1!.id,
        provider: 'ticketmaster',
        external_id: sharedExternalId,
      });
    expect(ext1Error).toBeNull();

    // 2. Create artist 2
    const { data: artist2, error: a2Error } = await adminClient!
      .from('artists')
      .insert({
        name: artist2Name,
        normalized_name: artist2Name.toLowerCase().trim(),
      })
      .select('id')
      .single();
    expect(a2Error).toBeNull();
    trackedCreated.artistIds.add(artist2!.id);

    // 3. Attempt canonicalization transaction with a new event and venue, attempting to assign artist 1's external ID to artist 2
    const conflictingEventName = `Conflicting Concert ${testNonce}`;
    const conflictingVenueName = `Conflicting Venue ${testNonce}`;
    const conflictPayload: CanonicalizationPayload = {
      event: {
        name: conflictingEventName,
        normalized_name: conflictingEventName.toLowerCase().trim(),
        local_start_date: '2026-11-22',
        timezone: 'America/Denver',
      },
      venueToCreate: {
        name: conflictingVenueName,
        normalized_name: conflictingVenueName.toLowerCase().trim(),
        city: 'Denver',
      },
      artists: [
        {
          artist_id: artist2!.id,
          name: artist2Name,
          external_ids: [
            {
              provider: 'ticketmaster',
              external_id: sharedExternalId, // Belongs to Artist 1!
            },
          ],
        },
      ],
    };

    // Stored procedure must raise exception 23505 and fail the transaction
    await expect(
      catalogRepo.applyCanonicalization(conflictPayload),
    ).rejects.toThrow(
      /Cannot assign external_id .* already assigned to artist|23505|unique constraint/i,
    );

    // 4. Verify complete PostgreSQL transaction rollback:
    // Event was NOT inserted
    const { data: rolledBackEvents } = await adminClient!
      .from('events')
      .select('id')
      .eq('name', conflictingEventName);
    expect(rolledBackEvents?.length).toBe(0);

    // Venue was NOT inserted
    const { data: rolledBackVenues } = await adminClient!
      .from('venues')
      .select('id')
      .eq('name', conflictingVenueName);
    expect(rolledBackVenues?.length).toBe(0);

    // Artist 2 was NOT given the external ID
    const { data: artist2Ext } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artist2!.id);
    expect(artist2Ext?.length).toBe(0);

    // Artist 1 still exclusively owns the external ID
    const { data: artist1Ext } = await adminClient!
      .from('artist_external_ids')
      .select('*')
      .eq('external_id', sharedExternalId);
    expect(artist1Ext?.length).toBe(1);
    expect(artist1Ext![0].artist_id).toBe(artist1!.id);
  });

  afterAll(async () => {
    if (!adminClient || !isDbAvailable) return;

    const eventIds = Array.from(trackedCreated.eventIds);
    const candidateIds = Array.from(trackedCreated.candidateIds);
    const rawIngestIds = Array.from(trackedCreated.rawIngestIds);
    const trackedArtistIds = Array.from(trackedCreated.artistIds);

    // Also include any events or candidates namespaced with this suite's unique nonce
    const { data: nonceEvents, error: nonceEvErr } = await adminClient
      .from('events')
      .select('id')
      .ilike('name', `%[${suiteNonce}]%`);
    if (nonceEvErr) {
      throw new Error(
        `Failed to query nonce events in cleanup: ${nonceEvErr.message}`,
      );
    }
    if (nonceEvents) {
      for (const ne of nonceEvents) eventIds.push(ne.id);
    }

    const { data: nonceCandidates, error: nonceCandErr } = await adminClient
      .from('event_candidates')
      .select('id, raw_ingest_id')
      .ilike('title', `%[${suiteNonce}]%`);
    if (nonceCandErr) {
      throw new Error(
        `Failed to query nonce candidates in cleanup: ${nonceCandErr.message}`,
      );
    }
    if (nonceCandidates) {
      for (const nc of nonceCandidates) {
        candidateIds.push(nc.id);
        if (nc.raw_ingest_id) rawIngestIds.push(nc.raw_ingest_id);
      }
    }

    const uniqueEventIds = Array.from(new Set(eventIds));
    const uniqueCandidateIds = Array.from(new Set(candidateIds));
    const uniqueRawIngestIds = Array.from(new Set(rawIngestIds));

    // Identify linked artists and venues before deleting the canonical events
    let linkedArtistIds = [...trackedArtistIds];
    let linkedVenueIds: string[] = [];

    if (uniqueEventIds.length > 0) {
      const { data: ea, error: eaErr } = await adminClient
        .from('event_artists')
        .select('artist_id')
        .in('event_id', uniqueEventIds);
      if (eaErr) {
        throw new Error(
          `Failed to query event_artists in cleanup: ${eaErr.message}`,
        );
      }
      if (ea) {
        for (const r of ea) linkedArtistIds.push(r.artist_id);
      }

      const { data: ev, error: evErr } = await adminClient
        .from('events')
        .select('venue_id')
        .in('id', uniqueEventIds);
      if (evErr) {
        throw new Error(
          `Failed to query events for venue_ids in cleanup: ${evErr.message}`,
        );
      }
      if (ev) {
        linkedVenueIds = Array.from(
          new Set(ev.map((r) => r.venue_id).filter(Boolean) as string[]),
        );
      }
    }

    // Also include any artists created with suiteNonce in their name
    const { data: nonceArtists, error: nonceArtErr } = await adminClient
      .from('artists')
      .select('id')
      .ilike('name', `%[${suiteNonce}]%`);
    if (nonceArtErr) {
      throw new Error(
        `Failed to query nonce artists in cleanup: ${nonceArtErr.message}`,
      );
    }
    if (nonceArtists) {
      for (const na of nonceArtists) linkedArtistIds.push(na.id);
    }

    const uniqueArtistIds = Array.from(new Set(linkedArtistIds));

    // 1. Delete event_field_evidence
    if (uniqueEventIds.length > 0) {
      const { error: delEvidenceErr } = await adminClient
        .from('event_field_evidence')
        .delete()
        .in('event_id', uniqueEventIds);
      if (delEvidenceErr) {
        throw new Error(
          `Failed to delete event_field_evidence by event_id: ${delEvidenceErr.message}`,
        );
      }
    }
    if (uniqueCandidateIds.length > 0) {
      const { error: delEvidenceCandErr } = await adminClient
        .from('event_field_evidence')
        .delete()
        .in('candidate_id', uniqueCandidateIds);
      if (delEvidenceCandErr) {
        throw new Error(
          `Failed to delete event_field_evidence by candidate_id: ${delEvidenceCandErr.message}`,
        );
      }
    }

    // 2. Delete event_ticket_links
    if (uniqueEventIds.length > 0) {
      const { error: delTlErr } = await adminClient
        .from('event_ticket_links')
        .delete()
        .in('event_id', uniqueEventIds);
      if (delTlErr) {
        throw new Error(
          `Failed to delete event_ticket_links: ${delTlErr.message}`,
        );
      }
    }

    // 3. Delete event_artists
    if (uniqueEventIds.length > 0) {
      const { error: delEaErr } = await adminClient
        .from('event_artists')
        .delete()
        .in('event_id', uniqueEventIds);
      if (delEaErr) {
        throw new Error(`Failed to delete event_artists: ${delEaErr.message}`);
      }
    }

    // 4. Delete event_sources
    if (uniqueEventIds.length > 0) {
      const { error: delEsErr } = await adminClient
        .from('event_sources')
        .delete()
        .in('event_id', uniqueEventIds);
      if (delEsErr) {
        throw new Error(
          `Failed to delete event_sources by event_id: ${delEsErr.message}`,
        );
      }
    }
    if (uniqueCandidateIds.length > 0) {
      const { error: delEsCandErr } = await adminClient
        .from('event_sources')
        .delete()
        .in('candidate_id', uniqueCandidateIds);
      if (delEsCandErr) {
        throw new Error(
          `Failed to delete event_sources by candidate_id: ${delEsCandErr.message}`,
        );
      }
    }

    // 5. Delete events
    if (uniqueEventIds.length > 0) {
      const { error: delEventsErr } = await adminClient
        .from('events')
        .delete()
        .in('id', uniqueEventIds);
      if (delEventsErr) {
        throw new Error(`Failed to delete events: ${delEventsErr.message}`);
      }
    }

    // 6. Delete event_candidates
    if (uniqueCandidateIds.length > 0) {
      const { error: delCandErr } = await adminClient
        .from('event_candidates')
        .delete()
        .in('id', uniqueCandidateIds);
      if (delCandErr) {
        throw new Error(
          `Failed to delete event_candidates: ${delCandErr.message}`,
        );
      }
    }

    // 7. Delete raw_ingests
    if (uniqueRawIngestIds.length > 0) {
      const { error: delRawErr } = await adminClient
        .from('raw_ingests')
        .delete()
        .in('id', uniqueRawIngestIds);
      if (delRawErr) {
        throw new Error(`Failed to delete raw_ingests: ${delRawErr.message}`);
      }
    }

    // 8. Delete test artists and their external IDs (strictly checking remaining references)
    for (const artistId of uniqueArtistIds) {
      const { count: remainingEventCount, error: countErr } = await adminClient
        .from('event_artists')
        .select('id', { count: 'exact', head: true })
        .eq('artist_id', artistId);
      if (countErr) {
        throw new Error(
          `Failed to check remaining event_artists: ${countErr.message}`,
        );
      }

      if (remainingEventCount === 0) {
        const { error: extErr } = await adminClient
          .from('artist_external_ids')
          .delete()
          .eq('artist_id', artistId);
        if (extErr) {
          throw new Error(
            `Failed to delete artist_external_ids: ${extErr.message}`,
          );
        }

        const { error: artErr } = await adminClient
          .from('artists')
          .delete()
          .eq('id', artistId);
        if (artErr) {
          throw new Error(`Failed to delete artist: ${artErr.message}`);
        }
      }
    }

    // 9. Clean up test venues (if 0 remaining events)
    for (const venueId of linkedVenueIds) {
      const { count: remainingVenueCount, error: countErr } = await adminClient
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId);
      if (countErr) {
        throw new Error(
          `Failed to check remaining events for venue: ${countErr.message}`,
        );
      }

      if (remainingVenueCount === 0) {
        const { error: aliasErr } = await adminClient
          .from('venue_aliases')
          .delete()
          .eq('venue_id', venueId);
        if (aliasErr) {
          throw new Error(
            `Failed to delete venue_aliases: ${aliasErr.message}`,
          );
        }

        const { error: venErr } = await adminClient
          .from('venues')
          .delete()
          .eq('id', venueId);
        if (venErr) {
          throw new Error(`Failed to delete venue: ${venErr.message}`);
        }
      }
    }
  });
});
