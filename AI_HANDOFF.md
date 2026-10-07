# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Encore Project Hub / Learning Hub** (Internal Architecture Observatory).
- **Active Specification:** [`docs/phases/active/PROJECT_HUB_IMPLEMENTATION.md`](docs/phases/active/PROJECT_HUB_IMPLEMENTATION.md).
- **Current Branch:** `feature/project-hub-foundation`
- **Active Implementing Agent:** Google Antigravity
- **Current Task:** Project Hub Foundation Slice (Route `/hub`, 2D interactive architecture map, progressive zoom disclosure, 5-tab inspector, theme toggle, and system health metrics) — COMPLETE.
- **Verification State:** ALL CHECKS GREEN (`format:check`, `lint` with 0 warnings, `typecheck`, 99/99 unit tests across 10 suites, Next.js production build).
- **Immediate Next Action:** Await user review and feedback on the Project Hub foundation slice on branch `feature/project-hub-foundation`.
- **Phase 2 Status:** **NOT STARTED.** Live Ticketmaster/Spotify ingestion and recommendation algorithms remain strictly out of scope.

---

## What the Next Agent Must Know

1. **Internal Observatory Mission:** The Project Hub at `/hub` is an internal tool for the repository owner to visually explore, understand, and inspect Encore's architecture, data pipeline, and system health.
2. **2D Map Primacy:** The primary visualization is a responsive, declarative SVG + React 2D map with progressive disclosure across zoom levels (L0 Macro $\to$ L1 Subsystems $\to$ L2 Entities $\to$ L3 Tables/Schemas). 3D constellation mode is designed into the data model but deferred.
3. **Implemented vs. Planned Clarity:** Implemented architecture nodes are visually distinct from planned nodes (dashed/outline treatment with explicit `PLANNED — NOT IMPLEMENTED` badges).
4. **No Write Capabilities:** The Hub is strictly read-only and must never introduce `service_role` keys into the browser.
5. **Durable Records:** Product direction for future attended concerts and non-collapsing feedback signals is recorded in [`docs/product/attended-concerts-and-reviews.md`](docs/product/attended-concerts-and-reviews.md).
