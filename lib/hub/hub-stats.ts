/**
 * System Statistics and Health Metrics for the Encore Project Hub.
 *
 * NOTE FOR CONTRIBUTORS & REVIEWERS:
 * Items marked with `isIllustrative: true` represent sample metrics designed
 * for offline observatory preview during this foundation slice.
 * Real verified test counts and runtime versions are marked `isIllustrative: false`.
 */

import type { HubStatsData, HubSystemStatItem } from './architecture-model';

export const HUB_STATS: HubStatsData = {
  runtimeInfo: {
    nextVersion: '15.5.27', // Verified from package-lock.json
    reactVersion: '19.0.0', // Verified from package.json
    nodeRunner: 'Node 24 (ubuntu-24.04 LTS)',
    unitTestsCount: 86, // Verified: 86 in-memory unit tests passing
    integrationTestsCount: 21, // Verified: 21 PostgreSQL integration tests passing in CI
  },
  items: [
    // --- REAL SYSTEM HEALTH (Measured & Verified) ---
    {
      id: 'stat_unit_tests',
      label: 'Unit Test Suite',
      value: '86 / 86 PASS',
      change: '100% Passing',
      isIllustrative: false,
      category: 'health',
      description:
        'Vitest in-memory test suite verifying domain value-objects, resolvers, and coordinator logic.',
    },
    {
      id: 'stat_integration_tests',
      label: 'PostgreSQL Integration Suite',
      value: '21 / 21 PASS',
      change: '100% Passing in CI',
      isIllustrative: false,
      category: 'health',
      description:
        'Supabase integration tests proving catalog RLS, profiles RLS, and Golden Path composite FK integrity.',
    },
    {
      id: 'stat_ci_runner',
      label: 'CI Runner & Engine',
      value: 'Ubuntu 24.04 LTS',
      change: 'Actions v7 (Node 24)',
      isIllustrative: false,
      category: 'health',
      description:
        'Pinned GitHub Actions runner with native Node 24 actions (checkout@v7, setup-node@v7).',
    },

    // --- ILLUSTRATIVE PREVIEW COUNTERS (Clearly Marked Sample Metrics) ---
    {
      id: 'stat_canonical_events',
      label: 'Canonical Events',
      value: 142,
      change: '+18 merged',
      isIllustrative: true,
      category: 'catalog',
      description:
        'Illustrative count of master deduplicated events in the canonical catalog.',
    },
    {
      id: 'stat_artists_venues',
      label: 'Artists & Venues',
      value: '284 / 65',
      change: 'Disambiguated',
      isIllustrative: true,
      category: 'catalog',
      description:
        'Illustrative count of resolved artists and physical venues in reference tables.',
    },
    {
      id: 'stat_field_evidence',
      label: 'Provenance Evidence Records',
      value: '1,894',
      change: '100% Traceable',
      isIllustrative: true,
      category: 'catalog',
      description:
        'Illustrative count of granular event_field_evidence provenance records linking fields to sources.',
    },
    {
      id: 'stat_raw_ingests',
      label: 'Raw Ingest Audits',
      value: 310,
      change: 'Append-Only',
      isIllustrative: true,
      category: 'ingestion',
      description:
        'Illustrative count of immutable raw payloads stored with cryptographic SHA-256 hashes.',
    },
    {
      id: 'stat_event_candidates',
      label: 'Candidate Observations',
      value: 495,
      change: 'Parsed',
      isIllustrative: true,
      category: 'ingestion',
      description:
        'Illustrative count of parsed event observations linked to raw ingests via composite FK.',
    },
    {
      id: 'stat_needs_review',
      label: 'Needs Review Flag',
      value: 4,
      change: 'Conservative Guard',
      isIllustrative: true,
      category: 'ingestion',
      description:
        'Illustrative count of ambiguous same-name candidates safely held for operator inspection.',
    },

    // --- MILESTONE STATUS ---
    {
      id: 'stat_phase_0',
      label: 'Phase 0: Foundations',
      value: 'COMPLETE',
      isIllustrative: false,
      category: 'milestones',
      description:
        'Next.js 15, TypeScript, Tailwind, Supabase RLS, and CI workflows established.',
    },
    {
      id: 'stat_phase_1',
      label: 'Phase 1: Canonical Inventory',
      value: 'COMPLETE',
      isIllustrative: false,
      category: 'milestones',
      description:
        'Ingestion models, immutable raw observations, entity resolution, and atomic stored procedures.',
    },
    {
      id: 'stat_project_hub',
      label: 'Project Hub Observatory',
      value: 'IN PROGRESS',
      isIllustrative: false,
      category: 'milestones',
      description:
        'Internal developer observatory, 2D architecture map, and progressive zoom exploration.',
    },
    {
      id: 'stat_phase_2',
      label: 'Phase 2: Live Ingestion',
      value: 'NOT STARTED',
      isIllustrative: false,
      category: 'milestones',
      description:
        'Ticketmaster live API adapter and Spotify taste profile ingestion (upcoming).',
    },
  ],
};

export function getStatsByCategory(category: HubSystemStatItem['category']) {
  return HUB_STATS.items.filter((item) => item.category === category);
}
