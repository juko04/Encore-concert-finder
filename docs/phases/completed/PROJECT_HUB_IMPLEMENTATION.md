# Project Hub & Architecture Observatory — Implementation Specification

This specification governs the engineering of the **Encore Project Hub** (internal route `/hub`). It establishes the architecture, visualization model, UI surfaces, and phased delivery plan for Encore's internal learning observatory.

> [!NOTE]
> **Milestone Type:** Post-Phase-1 Tooling & Internal Observatory.  
> **Status:** Active Implementation Specification.  
> **Phase 2 Status:** NOT STARTED. Live Ticketmaster/Spotify integrations and recommendation engines are strictly out of scope.

---

## 1. Executive Summary & Goals

### 1.1 Purpose
The Project Hub is an internal observatory designed primarily for the repository owner and technical contributors. Its mission is to make Encore:
1. **Understandable:** Demystifying raw ingests, candidate observations, entity resolution, canonicalization, and field-level provenance through spatial and interactive visualization.
2. **Explorable:** Enabling non-linear, self-directed exploration through progressive zoom disclosure rather than prescriptive coursework, gamification, or quizzes.
3. **Transparent:** Exposing backend summary statistics, system health metrics, architectural decisions, and testing verification in an executive dashboard format.

### 1.2 Target User Experience
- **Aesthetic:** Polished hybrid dashboard combining modern engineering depth (like linear, datadog, or stripe internal tools) with Apple-like tactile elevation and subtle motion.
- **Tone:** Calm, technical, intentional, and spatial.
- **Themes:** Dedicated dark mode (graphite/zinc-950 base with subtle luminous accents) and genuinely designed light mode (warm neutral off-white with crisp contrast and soft borders).
- **Non-Negotiable Antipatterns:** No childish illustrations, no gamified badges/quizzes, no neon sci-fi gimmicks, no unreadable particle clouds, and no generic admin template grids.

---

## 2. Information Architecture & Navigation

The Hub lives at route [`/hub`](file:///Users/juliankotara/Documents/Encore-concert-finder/app/hub) within the existing Next.js 15 application, with its own isolated layout (`app/hub/layout.tsx`).

### 2.1 Major UI Surfaces

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  HUB HEADER: Brand • System Mode (2D / 3D Planned) • Search Bar • Theme Toggle  │
├──────────────────────────────────────┬──────────────────────────────────────────┤
│  LEFT / TOP OVERVIEW METRICS         │  INTERACTIVE ARCHITECTURE OBSERVATORY    │
│  - Catalog Summary (Events/Artists)  │  - Spatial Cluster Canvas (SVG/React)    │
│  - Ingestion Summary (Ingests/Cands) │  - Smooth Pan & Zoom Controls            │
│  - Milestone Status (P0/P1/Hub/P2)   │  - Progressive Zoom Levels (L0 → L3)     │
│  - System Health & Test Verification │  - Region Overlays & Connection Paths    │
├──────────────────────────────────────┴──────────────────────────────────────────┤
│  RIGHT-SIDE INSPECTOR PANEL (Slides out when node/edge is selected)             │
│  Tabs: [Overview] [Relationships] [Example] [Technical] [History]              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Architecture Visualization Model

### 3.1 2D Interactive Map (Primary Experience)
- **Rendering Technology:** Declarative SVG + React. High performance, zero heavy external canvas dependencies, vector crispness at any scale, native Tailwind styling, and accessible DOM semantics.
- **Progressive Zoom Disclosure Levels:**
  - **Level 0 (Macro View):** Major architectural systems only (External Sources $\to$ Ingestion Layer $\to$ Entity Resolution $\to$ Canonical Inventory $\to$ Discover UI).
  - **Level 1 (Subsystems & Services):** Core modules (`SourceAdapters`, `CandidateRepository`, `ArtistResolver`, `EventMatcher`, `FieldMerge`, `apply_canonicalization`).
  - **Level 2 (Entities & Data Points):** `raw_ingests`, `event_candidates`, `events`, `artists`, `venues`, `promoters`, `event_ticket_links`.
  - **Level 3 (Fine-Grained Schemas & Evidence):** `event_field_evidence`, composite foreign keys, RLS security policies, stored procedure triggers.
- **Interactive State Transitions:**
  - **Node Selection:** Emphasizes the clicked node, softly illuminates directly connected nodes and incoming/outgoing edges, and subtly reduces opacity of unrelated nodes without making them disappear.
  - **Inspector Sync:** Preserves map view while opening the tabbed right-side drawer.

### 3.2 3D Constellation Mode (Design Contract)
- Designed to share the exact same underlying node/edge schema.
- Implementation is explicitly deferred until 2D foundation is verified and approved.
- When implemented, Three.js / React Three Fiber will be loaded lazily on demand, preventing bundle bloat on initial page load.

---

## 4. Central Architecture Data Model

To avoid hardcoding architectural concepts across scattered React components, all nodes, edges, and clusters are typed via a central schema in [`lib/hub/architecture-model.ts`](file:///Users/juliankotara/Documents/Encore-concert-finder/lib/hub/architecture-model.ts):

```typescript
export type ArchitectureCategory =
  | 'sources'
  | 'ingestion'
  | 'entity_resolution'
  | 'canonical_catalog'
  | 'personalization'
  | 'client_ui'
  | 'infrastructure_security';

export type ImplementationStatus = 'implemented' | 'planned';

export interface ArchitectureNode {
  id: string;
  name: string;
  category: ArchitectureCategory;
  status: ImplementationStatus;
  zoomLevel: 0 | 1 | 2 | 3;
  cluster: string;
  position: { x: number; y: number };
  shortDescription: string;
  overviewMarkdown: string;
  technicalDetails: {
    summary: string;
    relevantFiles?: string[];
    tableNames?: string[];
    keyFunctions?: string[];
  };
  relationships: {
    inputs: string[];
    outputs: string[];
    rationale?: string;
  };
  example?: {
    title: string;
    input: string;
    output: string;
    explanation: string;
  };
  history?: {
    introducedInPhase: string;
    rationale: string;
  };
}

export interface ArchitectureEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  status: ImplementationStatus;
  relationshipType: 'transforms' | 'validates' | 'persists' | 'queries' | 'enforces';
  description: string;
}
```

### 4.1 Implemented vs. Planned Visualization Rules
- **Implemented:** Solid border, full opacity, vibrant category-themed accent indicator, live relationships.
- **Planned (e.g. Spotify taste ingestion, recommendation engine, attendance reviews):** Subtle dashed border, muted opacity, distinct outline treatment, and an explicit **`PLANNED — NOT IMPLEMENTED`** badge. Never looks broken; remains fully clickable and explorable.

---

## 5. Right-Side Inspector Specification

When a node or edge is selected, the inspector opens with 5 tabs:

1. **Overview:** Plain-English explanation.
   - What is this?
   - Why does Encore need it?
   - What does it do?
2. **Relationships:**
   - Upstream inputs (what feeds into it).
   - Downstream outputs (what it feeds into).
   - Architectural rationale for these boundaries.
3. **Example:**
   - Concrete Encore live-music example (e.g. Red Rocks Amphitheatre deduplication or Ticketmaster date-only parsing).
4. **Technical:**
   - Relevant repository files (with links).
   - Table names, foreign keys, and constraints.
   - Core TypeScript interfaces and PostgreSQL stored procedures.
5. **History:**
   - When and why it entered the architecture (Phase 0, Phase 1, or upcoming).
   - Decisions from [`docs/decisions/index.md`](../decisions/index.md) that shaped it.

---

## 6. System Health & Summary Statistics

The Hub dashboard presents summary metrics grounded in real repository state:
- **Catalog Counters:** Canonical events, artists, venues, sources, field-evidence records (using deterministic illustrative data or safe read-only repository calls).
- **System Health:**
  - Unit test suite: 86 / 86 passing.
  - PostgreSQL integration suite: 21 / 21 passing (RLS + Golden Path).
  - CI Runner: Ubuntu 24.04 LTS (pinned).
  - Node Actions: Modernized v7 native Node 24 runtime.
- **Non-Blocking Debt Registry:** Direct view into items tracked in [`docs/project/non-blocking-debt.md`](../project/non-blocking-debt.md).

---

## 7. Dependency Decisions & Bundle Strategy

| Need | Decision | Rationale |
|---|---|---|
| **Icons** | `lucide-react` | Tree-shakable, zero-runtime, modern vector icons for professional engineering dashboards. Avoids raster emoji. |
| **2D Pan/Zoom Canvas** | Custom Declarative SVG + React | Zero dependencies, complete Tailwind styling control, native accessibility, SVG vector clarity, and direct control over zoom-level progressive disclosure. |
| **Animation & Transitions** | Tailwind Transitions & CSS Transforms | Native CSS GPU acceleration, zero bundle overhead, built-in `motion-reduce:` support for accessibility. |
| **3D Constellation** | Deferred (No Three.js on Foundation) | Three.js (~600KB) is not justified until 2D map is reviewed and approved. Lazy-loaded later. |
| **Theme Management** | React Context (`ThemeProvider`) | Clean light/dark toggling with persistent localStorage and `prefers-color-scheme` synchronization. |

---

## 8. Staged Implementation Plan (Foundation Slice)

### Slice A: Core Foundation (Current Branch)
1. **Layout & Theming:**
   - Create `/app/hub/layout.tsx` and `/app/hub/page.tsx`.
   - Implement `HubThemeProvider` with dark mode (zinc-950) and designed light mode (stone-50).
2. **Central Architecture Model:**
   - Create [`lib/hub/architecture-model.ts`](file:///Users/juliankotara/Documents/Encore-concert-finder/lib/hub/architecture-model.ts) with full nodes, edges, clusters, and zoom thresholds grounded in Encore docs.
3. **Interactive 2D Architecture Map:**
   - Build SVG-based pan/zoom viewport with smooth scale controls (`+`, `-`, reset).
   - Implement progressive disclosure zoom levels (L0 Macro $\to$ L1 Services $\to$ L2 Entities).
   - Cluster boundaries for Sources, Ingestion, Resolution, Catalog, Personalization, and UI.
   - Node and edge interactive highlighting.
4. **Tabbed Inspector Panel:**
   - 5-tab inspector (Overview, Relationships, Example, Technical, History).
   - File link pathways and code highlights.
5. **Dashboard Frame & System Health Preview:**
   - Hub header with search bar (filters architecture nodes).
   - Metric cards: Catalog counts, Ingestion observations, System Health, Roadmap status.
6. **Tests & Verification:**
   - Render tests for `/hub`.
   - Node selection and tab switching unit tests.
   - Search filtering tests.

### Slice B (Future Tooling Branches):
- Live read-only development database metrics integration.
- Animated Event Pipeline Walkthrough ("Show in pipeline").
- 3D Constellation Mode (lazy-loaded Three.js).
- Interactive Recommendation Scoring simulator (post-Phase-2).
- Personal concert history & attended venue map (post-MVP).

---

## 9. Definition of Done for Foundation Slice

1. `/hub` renders cleanly in both dark and light modes with zero console warnings.
2. Architecture map supports smooth pan, zoom, and multi-level progressive disclosure.
3. Clicking any node opens the 5-tab inspector with accurate, plain-English and technical descriptions.
4. Implemented vs. planned nodes are visually distinct with explicit badges.
5. Search bar filters nodes in real time.
6. All standard verification commands pass (`npm run format:check`, `lint`, `typecheck`, `test`, `build`).
7. Full documentation updated and `AI_HANDOFF.md` maintained.

