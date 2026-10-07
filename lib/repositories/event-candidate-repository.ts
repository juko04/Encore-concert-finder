import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CandidateArtist,
  CandidatePrice,
  CandidateVerificationStatus,
  EventCandidate,
  StartTimePrecision,
} from '@/lib/domain/event-candidate';
import type { AcquisitionMethod, SourceType } from '@/lib/domain/source';
import { computeCandidateFingerprint } from '@/lib/domain/value-objects';
import { createAdminClient } from '@/lib/supabase/admin';
import type { IEventCandidateRepository } from './interfaces';

interface EventCandidateRow {
  id: string;
  raw_ingest_id: string;
  source_id: string;
  source_event_id: string | null;
  source_type: SourceType;
  acquisition_method: AcquisitionMethod;
  source_url: string;
  content_hash: string;
  candidate_fingerprint: string;
  fetched_at: string;
  title: string;
  artist_names: string[];
  candidate_artists: Record<string, unknown>[] | null;
  venue_name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  local_start_date: string | null;
  local_end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  start_time_precision: StartTimePrecision;
  doors_open_at: string | null;
  ticket_url: string | null;
  price: Record<string, unknown> | null;
  is_festival: boolean;
  event_kind: string;
  confidence: number | string;
  verification_status: CandidateVerificationStatus;
  parser_version: string;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

function mapRowToCandidate(
  row: EventCandidateRow,
): EventCandidate & { id: string; rawIngestId: string; sourceId: string } {
  return {
    id: row.id,
    rawIngestId: row.raw_ingest_id,
    sourceId: row.source_id,
    sourceEventId: row.source_event_id ?? undefined,
    candidateFingerprint: row.candidate_fingerprint,
    provenance: {
      sourceId: row.source_id,
      sourceType: row.source_type,
      acquisitionMethod: row.acquisition_method,
      sourceUrl: row.source_url,
      sourceEventId: row.source_event_id ?? undefined,
      rawIngestId: row.raw_ingest_id,
      fetchedAt: row.fetched_at,
      contentHash: row.content_hash,
      parserVersion: row.parser_version,
      confidence: Number(row.confidence),
    },
    title: row.title,
    artistNames: row.artist_names,
    artists:
      (row.candidate_artists as unknown as CandidateArtist[]) ?? undefined,
    venueName: row.venue_name,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    country: row.country ?? undefined,
    timezone: row.timezone ?? undefined,
    localStartDate: row.local_start_date ?? undefined,
    localEndDate: row.local_end_date ?? undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    startTimePrecision: row.start_time_precision,
    doorsOpenAt: row.doors_open_at ?? undefined,
    ticketUrl: row.ticket_url ?? undefined,
    price: (row.price as unknown as CandidatePrice) ?? undefined,
    isFestival: row.is_festival,
    eventKind: (row.event_kind as EventCandidate['eventKind']) ?? 'concert',
    confidence: Number(row.confidence),
    verificationStatus: row.verification_status,
    rawPayload: row.raw_payload ?? undefined,
  };
}

function candidateToRow(
  candidate: EventCandidate & { rawIngestId: string; sourceId: string },
) {
  return {
    raw_ingest_id: candidate.rawIngestId,
    source_id: candidate.sourceId,
    source_event_id:
      candidate.sourceEventId ?? candidate.provenance?.sourceEventId ?? null,
    source_type: candidate.provenance?.sourceType ?? 'venue',
    acquisition_method:
      candidate.provenance?.acquisitionMethod ?? 'structured_json',
    source_url: candidate.provenance?.sourceUrl ?? '',
    content_hash: candidate.provenance?.contentHash ?? '',
    candidate_fingerprint:
      candidate.candidateFingerprint ??
      computeCandidateFingerprint({
        sourceEventId: candidate.sourceEventId,
        title: candidate.title,
        artistNames: candidate.artistNames,
        venueName: candidate.venueName,
        localStartDate: candidate.localStartDate,
        startsAt: candidate.startsAt,
        ticketUrl: candidate.ticketUrl,
      }),
    fetched_at: candidate.provenance?.fetchedAt ?? new Date().toISOString(),
    title: candidate.title,
    artist_names: candidate.artistNames,
    candidate_artists: candidate.artists ?? [],
    venue_name: candidate.venueName,
    city: candidate.city ?? null,
    state: candidate.state ?? null,
    country: candidate.country ?? null,
    timezone: candidate.timezone ?? null,
    local_start_date: candidate.localStartDate ?? null,
    local_end_date: candidate.localEndDate ?? null,
    starts_at: candidate.startsAt ?? null,
    ends_at: candidate.endsAt ?? null,
    start_time_precision:
      candidate.startTimePrecision ??
      (candidate.startsAt ? 'instant' : 'date_only'),
    doors_open_at: candidate.doorsOpenAt ?? null,
    ticket_url: candidate.ticketUrl ?? null,
    price: candidate.price ?? null,
    is_festival: candidate.isFestival ?? false,
    event_kind:
      candidate.eventKind ?? (candidate.isFestival ? 'festival' : 'concert'),
    confidence: candidate.confidence,
    verification_status: candidate.verificationStatus ?? 'unverified',
    parser_version: candidate.provenance?.parserVersion ?? '1.0.0',
    raw_payload: candidate.rawPayload ?? null,
  };
}

export class SupabaseEventCandidateRepository implements IEventCandidateRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createAdminClient();
  }

  async create(
    candidate: EventCandidate & { rawIngestId: string; sourceId: string },
  ): Promise<
    EventCandidate & { id: string; rawIngestId: string; sourceId: string }
  > {
    const row = candidateToRow(candidate);

    if (row.source_event_id) {
      const { data: existing } = await this.client
        .from('event_candidates')
        .select('*')
        .eq('raw_ingest_id', row.raw_ingest_id)
        .eq('source_event_id', row.source_event_id)
        .maybeSingle();

      if (existing) {
        return mapRowToCandidate(existing as EventCandidateRow);
      }
    } else if (row.candidate_fingerprint) {
      const { data: existing } = await this.client
        .from('event_candidates')
        .select('*')
        .eq('raw_ingest_id', row.raw_ingest_id)
        .eq('candidate_fingerprint', row.candidate_fingerprint)
        .maybeSingle();

      if (existing) {
        return mapRowToCandidate(existing as EventCandidateRow);
      }
    }

    const { data, error } = await this.client
      .from('event_candidates')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create event candidate: ${error.message}`);
    }
    return mapRowToCandidate(data as EventCandidateRow);
  }

  async createMany(
    candidates: Array<
      EventCandidate & { rawIngestId: string; sourceId: string }
    >,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  > {
    const results: Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    > = [];
    for (const candidate of candidates) {
      results.push(await this.create(candidate));
    }
    return results;
  }

  async getById(
    id: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  > {
    const { data, error } = await this.client
      .from('event_candidates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get event candidate by ID: ${error.message}`);
    }
    return data ? mapRowToCandidate(data as EventCandidateRow) : null;
  }

  async getByRawIngestId(
    rawIngestId: string,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  > {
    const { data, error } = await this.client
      .from('event_candidates')
      .select('*')
      .eq('raw_ingest_id', rawIngestId);

    if (error) {
      throw new Error(
        `Failed to get candidates by raw ingest ID: ${error.message}`,
      );
    }
    return ((data as EventCandidateRow[]) || []).map(mapRowToCandidate);
  }

  async listBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    Array<
      EventCandidate & { id: string; rawIngestId: string; sourceId: string }
    >
  > {
    const { data, error } = await this.client
      .from('event_candidates')
      .select('*')
      .eq('source_id', sourceId)
      .eq('source_event_id', sourceEventId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(
        `Failed to list candidates by source event ID: ${error.message}`,
      );
    }
    return ((data as EventCandidateRow[]) || []).map(mapRowToCandidate);
  }

  async getLatestBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<
    | (EventCandidate & { id: string; rawIngestId: string; sourceId: string })
    | null
  > {
    const { data, error } = await this.client
      .from('event_candidates')
      .select('*')
      .eq('source_id', sourceId)
      .eq('source_event_id', sourceEventId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(
        `Failed to get latest candidate by source event ID: ${error.message}`,
      );
    }
    const rows = (data as EventCandidateRow[]) || [];
    return rows.length > 0 ? mapRowToCandidate(rows[0]) : null;
  }
}
