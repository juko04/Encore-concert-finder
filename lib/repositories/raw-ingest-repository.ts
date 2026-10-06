import 'server-only';

/**
 * Raw Ingest Repository Implementation
 * Server-only repository for storing and querying raw ingestion payloads.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawIngest } from '@/lib/domain/source';
import { createAdminClient } from '@/lib/supabase/admin';
import type { IRawIngestRepository } from './interfaces';

interface RawIngestRow {
  id: string;
  source_id: string;
  source_url: string;
  acquisition_method: RawIngest['acquisitionMethod'];
  fetched_at: string;
  content_hash: string;
  content_type: string;
  raw_content: string | null;
  external_storage_ref: string | null;
  http_status: number;
  parser_version: string;
  created_at: string;
}

function mapRowToRawIngest(row: RawIngestRow): RawIngest & { id: string } {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    acquisitionMethod: row.acquisition_method,
    fetchedAt: row.fetched_at,
    contentHash: row.content_hash,
    contentType: row.content_type,
    rawContent: row.raw_content,
    externalStorageRef: row.external_storage_ref,
    httpStatus: row.http_status,
    parserVersion: row.parser_version,
  };
}

export class SupabaseRawIngestRepository implements IRawIngestRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createAdminClient();
  }

  async create(
    ingest: Omit<RawIngest, 'id'>,
  ): Promise<RawIngest & { id: string }> {
    const existing = await this.getBySourceUrlAndContentHash(
      ingest.sourceId,
      ingest.sourceUrl,
      ingest.contentHash,
    );
    if (existing) {
      return existing;
    }

    const row = {
      source_id: ingest.sourceId,
      source_url: ingest.sourceUrl,
      acquisition_method: ingest.acquisitionMethod,
      fetched_at: ingest.fetchedAt,
      content_hash: ingest.contentHash,
      content_type: ingest.contentType,
      raw_content: ingest.rawContent ?? null,
      external_storage_ref: ingest.externalStorageRef ?? null,
      http_status: ingest.httpStatus,
      parser_version: ingest.parserVersion,
    };

    const { data, error } = await this.client
      .from('raw_ingests')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create raw ingest: ${error.message}`);
    }
    return mapRowToRawIngest(data as RawIngestRow);
  }

  async getBySourceUrlAndContentHash(
    sourceId: string,
    sourceUrl: string,
    contentHash: string,
  ): Promise<(RawIngest & { id: string }) | null> {
    const { data, error } = await this.client
      .from('raw_ingests')
      .select('*')
      .eq('source_id', sourceId)
      .eq('source_url', sourceUrl)
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to get raw ingest by source, URL, and content hash: ${error.message}`,
      );
    }
    return data ? mapRowToRawIngest(data as RawIngestRow) : null;
  }

  async getById(id: string): Promise<(RawIngest & { id: string }) | null> {
    const { data, error } = await this.client
      .from('raw_ingests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get raw ingest by ID: ${error.message}`);
    }
    return data ? mapRowToRawIngest(data as RawIngestRow) : null;
  }

  async listBySource(
    sourceId: string,
    limit = 50,
  ): Promise<Array<RawIngest & { id: string }>> {
    const { data, error } = await this.client
      .from('raw_ingests')
      .select('*')
      .eq('source_id', sourceId)
      .order('fetched_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list raw ingests: ${error.message}`);
    }
    return (data as RawIngestRow[]).map(mapRowToRawIngest);
  }
}
