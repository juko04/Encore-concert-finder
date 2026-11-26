import type {
  AcquisitionMethod,
  CrawlContext,
  RawIngest,
  SourceProvenance,
} from '@/lib/domain/source';
import { sha256Hex } from '@/lib/utils/content-hash';
import type { VenueHttpResponse } from './http-client';

/**
 * Builds the immutable raw-ingest record for one fetched venue page. Source-specific
 * concerns (which URL to fetch, pagination, detail pages) stay in each adapter.
 */
export function buildVenueRawIngest(args: {
  context: CrawlContext;
  sourceUrl: string;
  response: VenueHttpResponse;
  acquisitionMethod: AcquisitionMethod;
  parserVersion: string;
}): RawIngest {
  const { context, sourceUrl, response, acquisitionMethod, parserVersion } =
    args;
  return {
    sourceId: context.sourceId,
    sourceUrl,
    acquisitionMethod,
    fetchedAt: response.fetchedAt,
    contentHash: sha256Hex(response.body),
    contentType: response.contentType,
    rawContent: response.body,
    httpStatus: response.status,
    parserVersion,
  };
}

/**
 * The raw-ingest-derived fields every venue parser receives as context. Adapters spread
 * this and add their own extras (e.g. `defaultVenueConfig`).
 */
export function buildVenueParseContext(
  ingest: RawIngest,
  fallbackParserVersion: string,
): {
  sourceId: string;
  rawIngestId: string | undefined;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
} {
  return {
    sourceId: ingest.sourceId,
    rawIngestId: ingest.id,
    sourceUrl: ingest.sourceUrl,
    fetchedAt: ingest.fetchedAt,
    contentHash: ingest.contentHash,
    parserVersion: ingest.parserVersion || fallbackParserVersion,
  };
}

/** First-occurrence-wins de-duplication keyed by an adapter-specific key. */
export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

interface VenueProvenanceContext {
  sourceId: string;
  rawIngestId?: string;
  fetchedAt?: string;
  contentHash?: string;
  parserVersion?: string;
}

/**
 * Field-level provenance for an HTML/JSON venue candidate. Missing context fields fall
 * back to "now" / empty hash / 1.0.0 (parsers invoked on fixtures without a raw ingest).
 */
export function buildVenueProvenance(
  context: VenueProvenanceContext,
  fields: { sourceUrl: string; sourceEventId?: string; confidence: number },
): SourceProvenance {
  return {
    sourceId: context.sourceId,
    sourceType: 'venue',
    acquisitionMethod: 'html_http',
    sourceUrl: fields.sourceUrl,
    sourceEventId: fields.sourceEventId,
    rawIngestId: context.rawIngestId,
    fetchedAt: context.fetchedAt ?? new Date().toISOString(),
    contentHash: context.contentHash ?? '',
    parserVersion: context.parserVersion ?? '1.0.0',
    confidence: fields.confidence,
  };
}
