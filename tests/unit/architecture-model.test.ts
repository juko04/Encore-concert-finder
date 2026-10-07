import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CLUSTERS,
  EDGES,
  NODES,
} from '@/lib/hub/architecture-data';
import { HUB_STATS } from '@/lib/hub/hub-stats';

describe('Architecture Model & Graph Integrity', () => {
  it('contains valid categories for all nodes', () => {
    const validCategoryIds = new Set(Object.keys(CATEGORIES));

    for (const node of NODES) {
      expect(validCategoryIds.has(node.category)).toBe(true);
      expect(node.name.length).toBeGreaterThan(0);
      expect(node.overview.plainEnglish.length).toBeGreaterThan(10);
      expect(node.overview.whyEncoreNeedsIt.length).toBeGreaterThan(10);
      expect(node.overview.whatItDoes.length).toBeGreaterThan(10);
    }
  });

  it('contains valid cluster assignments for all nodes', () => {
    const clusterIds = new Set(CLUSTERS.map((c) => c.id));

    for (const node of NODES) {
      expect(clusterIds.has(node.cluster)).toBe(true);
    }
  });

  it('contains valid and non-dangling edges', () => {
    const nodeIds = new Set(NODES.map((n) => n.id));

    for (const edge of EDGES) {
      expect(nodeIds.has(edge.sourceId)).toBe(true);
      expect(nodeIds.has(edge.targetId)).toBe(true);
      expect(edge.relationshipType).toBeDefined();
      expect(edge.description.length).toBeGreaterThan(5);
    }
  });

  it('grounded in authoritative documentation with non-empty docReference for all nodes', () => {
    for (const node of NODES) {
      expect(node.technical.docReference).toBeDefined();
      expect(node.technical.docReference.startsWith('docs/')).toBe(true);
    }
  });

  it('enforces explicit zoom levels between 0 and 3', () => {
    for (const node of NODES) {
      expect([0, 1, 2, 3]).toContain(node.minZoomLevel);
    }

    // Macro nodes (zoom level 0) must exist for overview
    const macroNodes = NODES.filter((n) => n.minZoomLevel === 0);
    expect(macroNodes.length).toBeGreaterThanOrEqual(4);
  });

  it('clearly marks illustrative statistics vs verified system health', () => {
    const healthStats = HUB_STATS.items.filter((i) => i.category === 'health');
    const catalogStats = HUB_STATS.items.filter(
      (i) => i.category === 'catalog',
    );
    const ingestionStats = HUB_STATS.items.filter(
      (i) => i.category === 'ingestion',
    );

    // Health stats must be real (isIllustrative === false)
    for (const stat of healthStats) {
      expect(stat.isIllustrative).toBe(false);
    }

    // Catalog & ingestion preview numbers on foundation branch must be explicitly illustrative
    for (const stat of catalogStats) {
      expect(stat.isIllustrative).toBe(true);
    }
    for (const stat of ingestionStats) {
      expect(stat.isIllustrative).toBe(true);
    }

    // Exact runtime versions must match verified environment
    expect(HUB_STATS.runtimeInfo.nextVersion).toBe('15.5.27');
    expect(HUB_STATS.runtimeInfo.reactVersion).toBe('19.0.0');
    expect(HUB_STATS.runtimeInfo.unitTestsCount).toBe(86);
    expect(HUB_STATS.runtimeInfo.integrationTestsCount).toBe(21);
  });
});
