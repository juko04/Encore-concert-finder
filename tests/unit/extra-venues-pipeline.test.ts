import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXTRA_VENUE_SYNC_TARGETS,
  ensureVenueSource,
  getVenueSourceConfig,
  runVenueIngestion,
} from '@/lib/sources/venue';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';

describe('extra Colorado venue sources (fixture pipeline)', () => {
  it('registers each venue as a venue/html_http source and is idempotent', async () => {
    const sourceRepo = new MemorySourceRepository();
    for (const t of EXTRA_VENUE_SYNC_TARGETS) {
      const a = await ensureVenueSource(sourceRepo, t.config);
      const b = await ensureVenueSource(sourceRepo, t.config);
      expect(a.id).toBe(b.id);
      expect(a.sourceType).toBe('venue');
      expect(a.acquisitionMethod).toBe('html_http');
      expect(a.slug).toBe(t.config.slug);
    }
    expect(getVenueSourceConfig('mishawaka')?.slug).toBe(
      'mishawaka-amphitheatre',
    );
  });

  it.each(EXTRA_VENUE_SYNC_TARGETS.map((t) => [t.config.name, t] as const))(
    'dry-runs %s from its fixture without persisting',
    async (_name, target) => {
      const result = await runVenueIngestion({
        config: target.config,
        adapter: target.adapterFactory(),
        sourceRepo: new MemorySourceRepository(),
        rawIngestRepo: new MemoryRawIngestRepository(),
        candidateRepo: new MemoryEventCandidateRepository(),
        catalogRepo: new MemoryCatalogRepository(),
        useFixture: true,
        fixturePath: path.resolve(process.cwd(), target.fixture),
        persist: false,
      });
      expect(result.candidatesParsed).toBeGreaterThan(0);
      expect(result.canonicalEventsCreated).toBeGreaterThan(0);
      expect(result.candidatesPersisted).toBe(0);
    },
  );
});
