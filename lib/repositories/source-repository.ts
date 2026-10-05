import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Source } from '@/lib/domain/source';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ISourceRepository } from './interfaces';

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  source_type: Source['sourceType'];
  acquisition_method: Source['acquisitionMethod'];
  base_url: string | null;
  reliability_score: number | string;
  active: boolean;
  parser_version: string;
  last_fetched_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

function mapRowToSource(row: SourceRow): Source {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sourceType: row.source_type,
    acquisitionMethod: row.acquisition_method,
    baseUrl: row.base_url,
    reliabilityScore: Number(row.reliability_score),
    active: row.active,
    parserVersion: row.parser_version,
    lastFetchedAt: row.last_fetched_at,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseSourceRepository implements ISourceRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createAdminClient();
  }

  async getById(id: string): Promise<Source | null> {
    const { data, error } = await this.client
      .from('sources')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get source by ID: ${error.message}`);
    }
    return data ? mapRowToSource(data as SourceRow) : null;
  }

  async getBySlug(slug: string): Promise<Source | null> {
    const { data, error } = await this.client
      .from('sources')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get source by slug: ${error.message}`);
    }
    return data ? mapRowToSource(data as SourceRow) : null;
  }

  async listActive(): Promise<Source[]> {
    const { data, error } = await this.client
      .from('sources')
      .select('*')
      .eq('active', true)
      .order('slug', { ascending: true });

    if (error) {
      throw new Error(`Failed to list active sources: ${error.message}`);
    }
    return (data as SourceRow[]).map(mapRowToSource);
  }

  async upsert(
    source: Omit<Source, 'createdAt' | 'updatedAt'>,
  ): Promise<Source> {
    const row = {
      id: source.id,
      slug: source.slug,
      name: source.name,
      source_type: source.sourceType,
      acquisition_method: source.acquisitionMethod,
      base_url: source.baseUrl ?? null,
      reliability_score: source.reliabilityScore,
      active: source.active,
      parser_version: source.parserVersion,
      last_fetched_at: source.lastFetchedAt ?? null,
      consecutive_failures: source.consecutiveFailures,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('sources')
      .upsert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to upsert source: ${error.message}`);
    }
    return mapRowToSource(data as SourceRow);
  }

  async recordFailure(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;

    const { error } = await this.client
      .from('sources')
      .update({
        consecutive_failures: existing.consecutiveFailures + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to record source failure: ${error.message}`);
    }
  }

  async recordSuccess(id: string, lastFetchedAt?: string): Promise<void> {
    const { error } = await this.client
      .from('sources')
      .update({
        consecutive_failures: 0,
        last_fetched_at: lastFetchedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to record source success: ${error.message}`);
    }
  }
}
