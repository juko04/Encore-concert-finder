/**
 * Authoritative Architecture Graph Definition for the Encore Project Hub.
 *
 * Grounded in docs/architecture/ and docs/learning/glossary.md.
 * Nodes contain concise summaries and direct links to authoritative documentation.
 */

import type {
  ArchitectureCategory,
  ArchitectureCluster,
  ArchitectureEdge,
  ArchitectureNode,
  CategoryMetadata,
} from './architecture-model';

export const CATEGORIES: Record<ArchitectureCategory, CategoryMetadata> = {
  sources: {
    id: 'sources',
    name: 'External Sources',
    description:
      'Ticketing platforms, venue calendars, promoter sites, and music streaming APIs.',
    colorDark: '#38bdf8', // sky-400
    colorLight: '#0284c7', // sky-600
    borderColorDark: '#0369a1',
    borderColorLight: '#bae6fd',
    accentBgDark: 'rgba(56, 189, 248, 0.1)',
    accentBgLight: 'rgba(2, 132, 199, 0.08)',
  },
  ingestion: {
    id: 'ingestion',
    name: 'Ingestion & Observations',
    description:
      'Immutable crawls, raw payloads, hashing, and parsed candidate events.',
    colorDark: '#a78bfa', // purple-400
    colorLight: '#7c3aed', // purple-600
    borderColorDark: '#6d28d9',
    borderColorLight: '#ddd6fe',
    accentBgDark: 'rgba(167, 139, 250, 0.1)',
    accentBgLight: 'rgba(124, 58, 237, 0.08)',
  },
  entity_resolution: {
    id: 'entity_resolution',
    name: 'Entity Resolution',
    description:
      'Identity disambiguation, conservative matching, field-level merge, and atomic canonicalization.',
    colorDark: '#f472b6', // pink-400
    colorLight: '#db2777', // pink-600
    borderColorDark: '#be185d',
    borderColorLight: '#fbcfe8',
    accentBgDark: 'rgba(244, 114, 182, 0.1)',
    accentBgLight: 'rgba(219, 39, 119, 0.08)',
  },
  canonical_catalog: {
    id: 'canonical_catalog',
    name: 'Canonical Catalog',
    description:
      'Master deduplicated inventory, artists, venues, ticket links, and field provenance.',
    colorDark: '#34d399', // emerald-400
    colorLight: '#059669', // emerald-600
    borderColorDark: '#047857',
    borderColorLight: '#a7f3d0',
    accentBgDark: 'rgba(52, 211, 153, 0.1)',
    accentBgLight: 'rgba(5, 150, 105, 0.08)',
  },
  personalization: {
    id: 'personalization',
    name: 'Personalization & Ranking',
    description:
      'Taste profiling, multi-dimensional affinity, willingness-to-pay, and transparent scoring.',
    colorDark: '#fbbf24', // amber-400
    colorLight: '#d97706', // amber-600
    borderColorDark: '#b45309',
    borderColorLight: '#fde68a',
    accentBgDark: 'rgba(251, 191, 36, 0.1)',
    accentBgLight: 'rgba(217, 119, 6, 0.08)',
  },
  client_ui: {
    id: 'client_ui',
    name: 'Client Applications',
    description:
      'Discover feed, event cards, responsive PWA shell, and developer observatory.',
    colorDark: '#818cf8', // indigo-400
    colorLight: '#4f46e5', // indigo-600
    borderColorDark: '#4338ca',
    borderColorLight: '#c7d2fe',
    accentBgDark: 'rgba(129, 140, 248, 0.1)',
    accentBgLight: 'rgba(79, 70, 229, 0.08)',
  },
  infrastructure_security: {
    id: 'infrastructure_security',
    name: 'Security & Database',
    description:
      'Row Level Security, service-role barriers, audit triggers, and atomic PostgreSQL transactions.',
    colorDark: '#94a3b8', // slate-400
    colorLight: '#475569', // slate-600
    borderColorDark: '#334155',
    borderColorLight: '#cbd5e1',
    accentBgDark: 'rgba(148, 163, 184, 0.1)',
    accentBgLight: 'rgba(71, 85, 105, 0.08)',
  },
};

export const CLUSTERS: ArchitectureCluster[] = [
  {
    id: 'sources_cluster',
    name: 'External Source Ingest',
    category: 'sources',
    bounds: { x: 40, y: 40, width: 260, height: 520 },
    minZoomLevel: 0,
    description:
      'Ticketing APIs and direct venue website crawlers that produce raw data payloads.',
  },
  {
    id: 'ingestion_cluster',
    name: 'Observation Pipeline',
    category: 'ingestion',
    bounds: { x: 340, y: 40, width: 280, height: 520 },
    minZoomLevel: 0,
    description:
      'Immutable raw ingest audit log and parsed event candidate observations.',
  },
  {
    id: 'resolution_cluster',
    name: 'Entity Resolution Engine',
    category: 'entity_resolution',
    bounds: { x: 660, y: 40, width: 300, height: 520 },
    minZoomLevel: 0,
    description:
      'Deterministic artist and venue disambiguation, event matching, and atomic canonicalization.',
  },
  {
    id: 'catalog_cluster',
    name: 'Canonical Inventory (PostgreSQL)',
    category: 'canonical_catalog',
    bounds: { x: 1000, y: 40, width: 300, height: 520 },
    minZoomLevel: 0,
    description:
      'Deduplicated master events, artists, venues, ticket links, and field-level evidence.',
  },
  {
    id: 'personalization_cluster',
    name: 'Taste & Personalization (Planned)',
    category: 'personalization',
    bounds: { x: 1340, y: 40, width: 270, height: 250 },
    minZoomLevel: 1,
    description:
      'Spotify listening profile ingestion and transparent recommendation scoring (Phase 2+).',
  },
  {
    id: 'ui_cluster',
    name: 'Encore UI Surface',
    category: 'client_ui',
    bounds: { x: 1340, y: 310, width: 270, height: 250 },
    minZoomLevel: 0,
    description:
      'Consumer Discover feed, event cards, and internal Project Hub observatory.',
  },
];

export const NODES: ArchitectureNode[] = [
  // ================= SOURCES =================
  {
    id: 'src_ticketmaster',
    name: 'Ticketmaster Discovery API',
    category: 'sources',
    status: 'implemented', // Scaffolding & fixtures implemented in Phase 1, live crawler Phase 2
    minZoomLevel: 1,
    cluster: 'sources_cluster',
    position: { x: 80, y: 100 },
    shortDescription:
      'Baseline event inventory API providing initial tour dates, venues, and ticket links.',
    overview: {
      plainEnglish:
        'Provides baseline concert tour dates, multi-city itineraries, and primary ticketing links.',
      whyEncoreNeedsIt:
        'Gives Encore broad immediate coverage across major clubs, theaters, and arenas.',
      whatItDoes:
        'Emits structured event observations with venue external IDs and artist lineups.',
    },
    technical: {
      summary:
        'HTTP JSON adapter parsing Discovery v2 events into standardized candidates.',
      relevantFiles: [
        'lib/domain/source.ts',
        'tests/fixtures/phase-1-fixtures.json',
      ],
      docReference: 'docs/architecture/sources.md#1-major-ticketing-platforms',
    },
    relationships: {
      inputs: [],
      outputs: ['raw_ingest_repo'],
      rationale:
        'Source feeds send raw HTTP responses directly into the immutable raw ingest store.',
    },
    example: {
      title: 'Tour Date Feed',
      scenario: 'Ingesting national tour announcements.',
      input: 'Ticketmaster API payload for "The Mountain Echoes at Red Rocks".',
      output: 'Raw JSON payload with HTTP status 200 and SHA-256 hash.',
      explanation:
        'Payload is stored verbatim without transformation before candidate parsing.',
    },
    history: {
      introducedInPhase: 'Phase 1',
      decisionRef: 'docs/decisions/index.md#initial-external-integrations',
      rationale:
        'Chosen as initial baseline source to prove multi-source candidate ingestion.',
    },
  },
  {
    id: 'src_venue_scrapers',
    name: 'Direct Venue Crawlers',
    category: 'sources',
    status: 'implemented', // Scaffolding & adapter interface established
    minZoomLevel: 1,
    cluster: 'sources_cluster',
    position: { x: 80, y: 240 },
    shortDescription:
      'Cheerio / HTTP web scrapers targeting independent clubs, bars, and community spaces.',
    overview: {
      plainEnglish:
        'Crawls official websites of independent venues that do not use big ticketing platforms.',
      whyEncoreNeedsIt:
        'Crucial for "Cheap & Nearby" and small local shows that never appear on Ticketmaster.',
      whatItDoes:
        'Fetches HTML pages, detects microdata/JSON-LD, and captures local start times.',
    },
    technical: {
      summary:
        'HTTP + Cheerio crawler producing immutable HTML snapshots in raw_ingests.',
      relevantFiles: ['lib/domain/source.ts', 'docs/architecture/ingestion.md'],
      docReference: 'docs/architecture/sources.md#3-venues-and-local-calendars',
    },
    relationships: {
      inputs: [],
      outputs: ['raw_ingest_repo'],
      rationale:
        'HTML crawls are preserved as immutable audit records before parsing.',
    },
  },
  {
    id: 'src_spotify',
    name: 'Spotify Web API',
    category: 'sources',
    status: 'planned',
    minZoomLevel: 2,
    cluster: 'sources_cluster',
    position: { x: 80, y: 390 },
    shortDescription:
      'OAuth taste profile extraction: top artists, saved tracks, and listening frequency.',
    overview: {
      plainEnglish:
        'Connects to a user’s Spotify account to learn which artists and genres they actually love.',
      whyEncoreNeedsIt:
        'Encore is a personalized discovery app; recommendations require real listening signals.',
      whatItDoes:
        'Extracts top artists across short/medium/long term horizons and maps Spotify artist IDs.',
    },
    technical: {
      summary:
        'OAuth 2.0 PKCE integration extracting artist affinities into user taste vectors.',
      docReference:
        'docs/product/recommendation-philosophy.md#listening-affinity',
    },
    relationships: {
      inputs: [],
      outputs: ['node_recommendation_engine'],
      rationale:
        'Streams affinity signals into the recommendation scoring pipeline.',
    },
    history: {
      introducedInPhase: 'Phase 2 (Planned)',
      rationale:
        'Deferred to Phase 2 after canonical inventory foundation is verified.',
    },
  },

  // ================= INGESTION LAYER =================
  {
    id: 'raw_ingest_repo',
    name: 'Raw Ingest Audit Store',
    category: 'ingestion',
    status: 'implemented',
    minZoomLevel: 0,
    cluster: 'ingestion_cluster',
    position: { x: 380, y: 150 },
    shortDescription:
      'Immutable PostgreSQL audit table (raw_ingests) storing untouched payloads with SHA-256 hashes.',
    overview: {
      plainEnglish:
        'An unalterable digital vault storing exact copies of everything downloaded from the web.',
      whyEncoreNeedsIt:
        'If a scraper has a bug, we can re-parse the raw data without re-crawling external sites.',
      whatItDoes:
        'Persists raw JSON/HTML, source URL, HTTP status, timestamp, and content hash.',
    },
    technical: {
      summary:
        'Table raw_ingests with immutable append-only constraints and external storage ref.',
      relevantFiles: [
        'lib/repositories/raw-ingest-repository.ts',
        'supabase/migrations/20261005120100_create_ingestion_and_candidates.sql',
      ],
      tableNames: ['raw_ingests'],
      docReference: 'docs/architecture/ingestion.md#immutable-raw-ingests',
    },
    relationships: {
      inputs: ['src_ticketmaster', 'src_venue_scrapers'],
      outputs: ['event_candidate_repo'],
      rationale:
        'Raw ingests are the immutable parent records for all candidate observations.',
    },
    example: {
      title: 'Idempotent Ingestion',
      scenario: 'Source crawler re-runs on a 30-minute cron.',
      input: 'Identical payload with matching SHA-256 hash.',
      output:
        'Existing raw_ingest record returned without creating duplicate rows.',
      explanation:
        'Preserves storage efficiency while guaranteeing complete audit history.',
    },
    history: {
      introducedInPhase: 'Phase 1',
      decisionRef: 'docs/decisions/index.md#data',
      rationale:
        'Non-negotiable architectural invariant: source data must never be overwritten in place.',
    },
  },
  {
    id: 'event_candidate_repo',
    name: 'Event Candidate Store',
    category: 'ingestion',
    status: 'implemented',
    minZoomLevel: 0,
    cluster: 'ingestion_cluster',
    position: { x: 380, y: 340 },
    shortDescription:
      'Standardized source observations (event_candidates) linked to parent raw_ingests via composite FK.',
    overview: {
      plainEnglish:
        'A normalized snapshot of what a specific source claimed about an upcoming concert.',
      whyEncoreNeedsIt:
        'Isolates source-specific quirks before attempting to merge facts into the master catalog.',
      whatItDoes:
        'Stores artist names, venue strings, dates, doors/start times, ticket URLs, and source confidence.',
    },
    technical: {
      summary:
        'Table event_candidates with composite FK (id, raw_ingest_id) ensuring provenance integrity.',
      relevantFiles: [
        'lib/repositories/event-candidate-repository.ts',
        'lib/domain/event-candidate.ts',
      ],
      tableNames: ['event_candidates'],
      docReference:
        'docs/architecture/ingestion.md#parsed-candidate-observations',
    },
    relationships: {
      inputs: ['raw_ingest_repo'],
      outputs: ['artist_resolver', 'venue_resolver', 'event_matcher'],
      rationale:
        'Candidates feed into the entity resolution engine for identity disambiguation.',
    },
    example: {
      title: 'Parsed Candidate',
      scenario: 'Ticketmaster parser extracts show.',
      input: 'Raw JSON event object.',
      output:
        'Candidate with normalized_name="mountain echoes", local_start_date="2026-10-15".',
      explanation: 'Preserves raw observed values while standardizing types.',
    },
  },

  // ================= ENTITY RESOLUTION =================
  {
    id: 'artist_resolver',
    name: 'ArtistResolver',
    category: 'entity_resolution',
    status: 'implemented',
    minZoomLevel: 1,
    cluster: 'resolution_cluster',
    position: { x: 700, y: 90 },
    shortDescription:
      'Disambiguates artist identities; prioritizes external IDs over normalized names.',
    overview: {
      plainEnglish:
        'Determines whether a band named on a flyer is a band already in our database.',
      whyEncoreNeedsIt:
        'Prevents merging different bands that share identical names (e.g. "Ghost" or "Islands").',
      whatItDoes:
        'Matches canonical IDs, trusted external IDs, alias tables, and normalized names conservatively.',
    },
    technical: {
      summary:
        'Conservative resolution pipeline routing ambiguous same-name artists to needs_review.',
      relevantFiles: ['lib/entity-resolution/artist-resolver.ts'],
      docReference:
        'docs/architecture/entity-resolution.md#1-artist-resolution-artistresolver',
    },
    relationships: {
      inputs: ['event_candidate_repo'],
      outputs: ['canonicalization_coordinator'],
      rationale:
        'Resolves canonical artist IDs required to link event billing.',
    },
  },
  {
    id: 'venue_resolver',
    name: 'VenueResolver',
    category: 'entity_resolution',
    status: 'implemented',
    minZoomLevel: 1,
    cluster: 'resolution_cluster',
    position: { x: 700, y: 220 },
    shortDescription:
      'Resolves physical venues using external IDs, coordinate proximity, and suffix stripping.',
    overview: {
      plainEnglish:
        'Recognizes that "Red Rocks Amphitheater" and "Red Rocks Amphitheatre, Morrison CO" are the same place.',
      whyEncoreNeedsIt:
        'Venues have dozens of spelling variations; deduplication is essential for venue affinity scoring.',
      whatItDoes:
        'Normalizes suffixes ("Amphitheatre" vs "Amphitheater"), compares coordinates, and checks alias lists.',
    },
    technical: {
      summary:
        'Deterministic venue matcher with geographical bounding and alias lookup.',
      relevantFiles: ['lib/entity-resolution/venue-resolver.ts'],
      docReference:
        'docs/architecture/entity-resolution.md#2-venue-resolution-venueresolver',
    },
    relationships: {
      inputs: ['event_candidate_repo'],
      outputs: ['canonicalization_coordinator'],
      rationale:
        'Provides resolved venue ID to event matching and field merging.',
    },
  },
  {
    id: 'event_matcher',
    name: 'EventMatcher',
    category: 'entity_resolution',
    status: 'implemented',
    minZoomLevel: 1,
    cluster: 'resolution_cluster',
    position: { x: 700, y: 350 },
    shortDescription:
      'Matches candidate observations to canonical events using date intervals and primary headliners.',
    overview: {
      plainEnglish:
        'Decides if a show listed on Ticketmaster is the exact same concert listed on the club calendar.',
      whyEncoreNeedsIt:
        'Users must see a single master event card, not duplicate cards from different ticket sellers.',
      whatItDoes:
        'Compares resolved venue, headliner artist, local start date, and time precision bounds.',
    },
    technical: {
      summary:
        'Matching engine enforcing strict date collision boundaries and disambiguation guards.',
      relevantFiles: ['lib/entity-resolution/event-matcher.ts'],
      docReference:
        'docs/architecture/entity-resolution.md#3-event-matching-eventmatcher',
    },
    relationships: {
      inputs: ['artist_resolver', 'venue_resolver'],
      outputs: ['canonicalization_coordinator'],
      rationale:
        'Determines whether to merge into an existing event or create a new canonical event.',
    },
  },
  {
    id: 'canonicalization_coordinator',
    name: 'CanonicalizationCoordinator',
    category: 'entity_resolution',
    status: 'implemented',
    minZoomLevel: 0,
    cluster: 'resolution_cluster',
    position: { x: 700, y: 470 },
    shortDescription:
      'Executes atomic PostgreSQL stored procedure (apply_canonicalization) with field-level evidence.',
    overview: {
      plainEnglish:
        'The conductor that safely writes verified concert updates into the master database in a single atomic transaction.',
      whyEncoreNeedsIt:
        'Ensures zero orphaned entities or partial updates if the database or server encounters an error.',
      whatItDoes:
        'Calculates field-level merges, builds evidence payloads, and calls the atomic RPC.',
    },
    technical: {
      summary:
        'PostgreSQL SECURITY DEFINER RPC apply_canonicalization restricted strictly to service_role.',
      relevantFiles: [
        'lib/entity-resolution/canonicalization-coordinator.ts',
        'supabase/migrations/20261005120200_create_canonicalization_and_provenance.sql',
      ],
      keyFunctions: ['apply_canonicalization()'],
      docReference:
        'docs/architecture/entity-resolution.md#5-atomic-canonicalization-persister',
    },
    relationships: {
      inputs: ['artist_resolver', 'venue_resolver', 'event_matcher'],
      outputs: ['canonical_events_table', 'field_evidence_table'],
      rationale:
        'Persists master events and immutable field provenance in a single database transaction.',
    },
  },

  // ================= CANONICAL CATALOG =================
  {
    id: 'canonical_events_table',
    name: 'events (Master Catalog)',
    category: 'canonical_catalog',
    status: 'implemented',
    minZoomLevel: 0,
    cluster: 'catalog_cluster',
    position: { x: 1040, y: 120 },
    shortDescription:
      'The central canonical events table displaying verified titles, dates, timezones, and venue links.',
    overview: {
      plainEnglish:
        'The master concert catalog row presented to users throughout the Encore application.',
      whyEncoreNeedsIt:
        'Combines the most accurate facts from multiple independent sources into one clean event.',
      whatItDoes:
        'Stores canonical title, event kind, local dates, UTC timestamps, and status.',
    },
    technical: {
      summary:
        'Primary catalog table secured with public-read RLS and strict foreign key integrity.',
      relevantFiles: [
        'lib/repositories/catalog-repository.ts',
        'supabase/migrations/20261005120000_create_inventory_reference_and_catalog.sql',
      ],
      tableNames: ['events', 'event_artists', 'event_ticket_links'],
      docReference: 'docs/architecture/data-model.md#canonical-events',
    },
    relationships: {
      inputs: ['canonicalization_coordinator'],
      outputs: ['ui_discover_page'],
      rationale:
        'Feeds canonical event summaries directly into user discovery components.',
    },
  },
  {
    id: 'field_evidence_table',
    name: 'event_field_evidence',
    category: 'canonical_catalog',
    status: 'implemented',
    minZoomLevel: 3,
    cluster: 'catalog_cluster',
    position: { x: 1040, y: 300 },
    shortDescription:
      'Granular audit trail recording the exact source, candidate, and confidence behind every field.',
    overview: {
      plainEnglish:
        'The fine-grained provenance trail proving where every single detail (price, start time, title) came from.',
      whyEncoreNeedsIt:
        'If two sites disagree on doors vs show time, evidence explains which source won and why.',
      whatItDoes:
        'Records field_name, source_id, candidate_id, raw_ingest_id, observed_at, and confidence.',
    },
    technical: {
      summary:
        'Immutable provenance table linking canonical event fields back to candidate observations.',
      relevantFiles: ['lib/entity-resolution/field-merge.ts'],
      tableNames: ['event_field_evidence'],
      docReference:
        'docs/architecture/entity-resolution.md#4-field-level-merge-fieldmerge',
    },
    relationships: {
      inputs: ['canonicalization_coordinator'],
      outputs: [],
      rationale:
        'Stores permanent historical provenance for every canonical value.',
    },
  },
  {
    id: 'artists_venues_tables',
    name: 'artists & venues Reference',
    category: 'canonical_catalog',
    status: 'implemented',
    minZoomLevel: 2,
    cluster: 'catalog_cluster',
    position: { x: 1040, y: 440 },
    shortDescription:
      'Master artist and venue reference entities with external ID registries and aliases.',
    overview: {
      plainEnglish:
        'The authoritative directory of bands, musicians, venues, and amphitheaters.',
      whyEncoreNeedsIt:
        'Stores external identity keys (Spotify IDs, MusicBrainz IDs) and physical coordinates.',
      whatItDoes:
        'Tracks artist aliases, venue aliases, city/region/country, and timezone metadata.',
    },
    technical: {
      summary:
        'Reference tables artists, artist_external_ids, artist_aliases, venues, and venue_aliases.',
      tableNames: ['artists', 'venues', 'artist_external_ids'],
      docReference: 'docs/architecture/data-model.md#artists-and-venues',
    },
    relationships: {
      inputs: ['canonicalization_coordinator'],
      outputs: ['canonical_events_table'],
      rationale:
        'Linked to master events via event_artists and venue_id foreign keys.',
    },
  },

  // ================= PERSONALIZATION & RANKING =================
  {
    id: 'node_recommendation_engine',
    name: 'Recommendation & Scoring Engine',
    category: 'personalization',
    status: 'planned',
    minZoomLevel: 1,
    cluster: 'personalization_cluster',
    position: { x: 1370, y: 130 },
    shortDescription:
      'Transparent ranking algorithm combining listening affinity, venue affinity, and willingness-to-pay.',
    overview: {
      plainEnglish:
        'The core formula that ranks concerts by how worthwhile they are for an individual fan.',
      whyEncoreNeedsIt:
        'Encore is not a generic calendar; it tells you which shows are genuinely worth your time and money.',
      whatItDoes:
        'Computes explainable scores with human-readable reasons (e.g. "Top Artist", "Favorite Venue").',
    },
    technical: {
      summary:
        'Planned deterministic weighted scoring formula: Affinity * Timing * PriceFit * DistanceFit.',
      docReference: 'docs/product/recommendation-philosophy.md#core-formula',
    },
    relationships: {
      inputs: ['canonical_events_table', 'src_spotify'],
      outputs: ['ui_discover_page'],
      rationale:
        'Scores master catalog events before presenting them in ranked order to the user.',
    },
    history: {
      introducedInPhase: 'Phase 2 / Phase 3 (Planned)',
      rationale:
        'Deferred until live inventory ingestion and Spotify profile data are established.',
    },
  },

  // ================= CLIENT UI =================
  {
    id: 'ui_discover_page',
    name: 'Discover Catalog (/discover)',
    category: 'client_ui',
    status: 'implemented',
    minZoomLevel: 0,
    cluster: 'ui_cluster',
    position: { x: 1370, y: 350 },
    shortDescription:
      'The user-facing live concert feed displaying verified canonical events, dates, and ticket links.',
    overview: {
      plainEnglish:
        'The main user-facing page where concert fans discover upcoming live music.',
      whyEncoreNeedsIt:
        'Translates all backend ingestion and canonicalization into a fast, elegant mobile-ready UI.',
      whatItDoes:
        'Renders verified event cards with local dates, start times, venues, and ticket buttons.',
    },
    technical: {
      summary:
        'Next.js 15 Server Component with revalidate=60 reading from SupabaseCatalogRepository.',
      relevantFiles: [
        'app/discover/page.tsx',
        'components/catalog/EventCard.tsx',
      ],
      docReference: 'docs/product/vision.md#core-user-modes',
    },
    relationships: {
      inputs: ['canonical_events_table', 'node_recommendation_engine'],
      outputs: [],
      rationale:
        'Consumes canonical event data and presents it to human users.',
    },
  },
  {
    id: 'ui_hub_observatory',
    name: 'Project Hub Observatory (/hub)',
    category: 'client_ui',
    status: 'implemented',
    minZoomLevel: 0,
    cluster: 'ui_cluster',
    position: { x: 1370, y: 460 },
    shortDescription:
      'Internal engineering observatory providing spatial architecture visualization and health stats.',
    overview: {
      plainEnglish:
        'This very observatory: an internal dashboard to understand, explore, and inspect Encore.',
      whyEncoreNeedsIt:
        'Provides immediate visual transparency into how events move through the system.',
      whatItDoes:
        'Renders interactive 2D architecture graph, progressive zoom levels, inspector drawer, and system stats.',
    },
    technical: {
      summary:
        'Declarative SVG canvas + React inspector reading from architecture-model.ts and docs.',
      relevantFiles: ['app/hub/page.tsx', 'lib/hub/architecture-model.ts'],
      docReference: 'docs/phases/active/PROJECT_HUB_IMPLEMENTATION.md',
    },
    relationships: {
      inputs: ['canonical_events_table'],
      outputs: [],
      rationale: 'Visualizes the entire Encore system topology.',
    },
  },
];

export const EDGES: ArchitectureEdge[] = [
  {
    id: 'edge_tm_to_raw',
    sourceId: 'src_ticketmaster',
    targetId: 'raw_ingest_repo',
    relationshipType: 'transforms',
    label: 'HTTP Crawl Payload',
    status: 'implemented',
    description:
      'Ticketmaster API responses are stored untouched as immutable raw_ingest audit rows.',
  },
  {
    id: 'edge_scrapers_to_raw',
    sourceId: 'src_venue_scrapers',
    targetId: 'raw_ingest_repo',
    relationshipType: 'transforms',
    label: 'Raw HTML Snapshot',
    status: 'implemented',
    description:
      'Venue website crawls produce immutable HTML snapshots with SHA-256 hashes.',
  },
  {
    id: 'edge_raw_to_cand',
    sourceId: 'raw_ingest_repo',
    targetId: 'event_candidate_repo',
    relationshipType: 'transforms',
    label: 'Parse & Normalize',
    status: 'implemented',
    description:
      'Source adapters extract structured candidate observations linked via composite FK.',
  },
  {
    id: 'edge_cand_to_artist',
    sourceId: 'event_candidate_repo',
    targetId: 'artist_resolver',
    relationshipType: 'validates',
    label: 'Artist Names & External IDs',
    status: 'implemented',
    description:
      'Candidate artist strings and external IDs are matched against canonical artists.',
  },
  {
    id: 'edge_cand_to_venue',
    sourceId: 'event_candidate_repo',
    targetId: 'venue_resolver',
    relationshipType: 'validates',
    label: 'Venue Name & Geo Bounds',
    status: 'implemented',
    description:
      'Candidate venue strings are matched using suffix normalization and coordinate checks.',
  },
  {
    id: 'edge_artist_to_coord',
    sourceId: 'artist_resolver',
    targetId: 'canonicalization_coordinator',
    relationshipType: 'validates',
    label: 'Resolved Artist IDs',
    status: 'implemented',
    description:
      'Supplies verified artist IDs to the canonicalization transaction.',
  },
  {
    id: 'edge_venue_to_matcher',
    sourceId: 'venue_resolver',
    targetId: 'event_matcher',
    relationshipType: 'validates',
    label: 'Resolved Venue ID',
    status: 'implemented',
    description: 'Supplies verified venue ID for event collision detection.',
  },
  {
    id: 'edge_matcher_to_coord',
    sourceId: 'event_matcher',
    targetId: 'canonicalization_coordinator',
    relationshipType: 'validates',
    label: 'Match Decision (New vs Merge)',
    status: 'implemented',
    description:
      'Directs coordinator whether to create a new canonical event or merge into an existing one.',
  },
  {
    id: 'edge_coord_to_events',
    sourceId: 'canonicalization_coordinator',
    targetId: 'canonical_events_table',
    relationshipType: 'persists',
    label: 'apply_canonicalization()',
    status: 'implemented',
    description:
      'Executes atomic PostgreSQL stored procedure to create or update canonical event rows.',
  },
  {
    id: 'edge_coord_to_evidence',
    sourceId: 'canonicalization_coordinator',
    targetId: 'field_evidence_table',
    relationshipType: 'persists',
    label: 'Field-Level Provenance',
    status: 'implemented',
    description:
      'Records granular audit rows for title, date, venue, status, and ticket links.',
  },
  {
    id: 'edge_coord_to_entities',
    sourceId: 'canonicalization_coordinator',
    targetId: 'artists_venues_tables',
    relationshipType: 'persists',
    label: 'Artist & Venue References',
    status: 'implemented',
    description:
      'Creates new artist and venue records when unfamiliar entities are introduced.',
  },
  {
    id: 'edge_events_to_ui',
    sourceId: 'canonical_events_table',
    targetId: 'ui_discover_page',
    relationshipType: 'queries',
    label: 'SupabaseCatalogRepository',
    status: 'implemented',
    description:
      'Next.js Server Component queries master events via public-read RLS policy.',
  },
  {
    id: 'edge_events_to_hub',
    sourceId: 'canonical_events_table',
    targetId: 'ui_hub_observatory',
    relationshipType: 'queries',
    label: 'Observatory Schema Inspection',
    status: 'implemented',
    description:
      'Project Hub inspects canonical architecture topology and summary statistics.',
  },
  {
    id: 'edge_spotify_to_rec',
    sourceId: 'src_spotify',
    targetId: 'node_recommendation_engine',
    relationshipType: 'transforms',
    label: 'Listening Affinities (Planned)',
    status: 'planned',
    description:
      'Spotify top artists and stream frequencies stream into recommendation vectors.',
  },
  {
    id: 'edge_rec_to_ui',
    sourceId: 'node_recommendation_engine',
    targetId: 'ui_discover_page',
    relationshipType: 'queries',
    label: 'Ranked & Scored Feed (Planned)',
    status: 'planned',
    description:
      'Personalized scores determine ordering on the consumer discover page.',
  },
];
