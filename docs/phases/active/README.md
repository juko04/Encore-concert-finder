# Active Phase Specification Slot

This directory contains the implementation specification for the currently active phase.

---

## Convention

1. **One Active Phase at a Time:** Only one phase specification file may live in this active directory at any given time (e.g., `PHASE_2_IMPLEMENTATION.md`).
2. **Persistent Source of Truth:** During active planning and development, this file is the living contract and specification for that phase.
3. **Archiving on Merge:** Once the phase passes independent code review, verifies all CI checks, and merges into `main`, it is permanently archived to [`docs/phases/completed/`](../completed/).

---

## Current Status

- **Active Specification:** [`PROJECT_HUB_IMPLEMENTATION.md`](PROJECT_HUB_IMPLEMENTATION.md) (Encore Project Hub & Internal Architecture Observatory)
- **Completed Phases:**
  - [Phase 0 — Foundation & Infrastructure](../completed/PHASE_0_IMPLEMENTATION.md)
  - [Phase 1 — Canonical Inventory & Ingestion Foundation](../completed/PHASE_1_IMPLEMENTATION.md)
- **Current Milestone Status:**
  - Phase 0: **COMPLETE**
  - Phase 1: **COMPLETE**
  - Repository Organization + AI Context Optimization: **COMPLETE**
  - Encore Project Hub / Learning Hub: **IN PROGRESS** (`feature/project-hub-foundation`)
  - Phase 2: **NOT STARTED** (will open active specification here once the Learning Hub is complete)
