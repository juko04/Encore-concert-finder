# Contributor Onboarding Guide

Welcome to Encore. This guide orients new human engineers and AI coding assistants arriving at the project today.

---

## Current Project State

Encore has completed its foundational milestones and is preparing for developer/operator tooling:

- **Phase 0 (Foundation & Infrastructure):** **COMPLETE.** Next.js 15, TypeScript, Tailwind CSS, Supabase RLS, and CI pipelines are established.
- **Phase 1 (Canonical Inventory & Ingestion Foundation):** **COMPLETE.** Ingestion models, immutable source observations (`raw_ingests`, `event_candidates`), entity resolution for artists, venues, and events, field-level provenance (`event_field_evidence`), and atomic canonicalization (`apply_canonicalization`) are built and verified against PostgreSQL.
- **Repository Organization & AI Context Optimization:** **COMPLETE.** Canonical documentation resides under `docs/` with progressive disclosure routing and pinned CI runners.
- **Encore Project Hub / Learning Hub:** **NEXT MILESTONE.** Interactive documentation, entity inspection, and pipeline visualizer.
- **Phase 2 (Live Ingestion & Recommendation Scaffolding):** **NOT STARTED.** Live Ticketmaster API ingestion, Spotify taste ingestion, and scoring will begin after the Learning Hub is established.

---

## Recommended Starting Sequence

To avoid overwhelming yourself (or saturating AI context windows), follow this progressive sequence:

1. [`README.md`](../../README.md): Project overview, architecture summary, and local developer setup.
2. [`AI_HANDOFF.md`](../../AI_HANDOFF.md): Current operational state, active branch, test status, and next immediate action.
3. [`AGENTS.md`](../../AGENTS.md): Engineering invariants, progressive disclosure routing table, and required verification commands.
4. [`docs/index.md`](../index.md): The documentation map routing directly to subsystem specifications.
5. [`docs/learning/glossary.md`](../learning/glossary.md): **If you are new to the domain or concepts**, read this for plain-English definitions and Encore examples of Canonical Events, Entity Resolution, RLS, Provenance, and more.
6. **Task-Specific Documentation:** Read *only* the specific architecture or product specifications relevant to your assigned task, selected using the routing table in `AGENTS.md`.

> [!IMPORTANT]
> **Historical Phase Specifications:** Completed phase specifications in [`docs/phases/completed/`](../phases/completed/) (`PHASE_0_IMPLEMENTATION.md`, `PHASE_1_IMPLEMENTATION.md`) are permanent historical records. Do **not** load them into prompt context unless you specifically require historical implementation context or decision rationale.

---

## Contributor Guidelines

1. **One Task Per Branch:** Always branch off current `main`. Never commit directly to `main`.
2. **Repository as Source of Truth:** Durable architectural decisions belong in Markdown under `docs/decisions/index.md`. Never let decisions live only in chat transcripts.
3. **Run Full Local Verification:**
   ```bash
   npm run format:check     # Check Prettier formatting
   npm run lint             # Check ESLint rules
   npm run typecheck        # Strict TypeScript type check (tsc --noEmit)
   npm test                 # Run in-memory unit tests (86 tests)
   npm run build            # Compile production Next.js build
   ```
4. **Deferred Features:** Email/newsletter ingestion is explicitly **deferred, not rejected**; do not scaffold email ingestion until alerts, presales, and promoter coverage milestones begin.
