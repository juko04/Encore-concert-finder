/**
 * Central Type Definitions for the Encore Architecture Observatory (Project Hub).
 *
 * Defines the schema for nodes, edges, clusters, progressive zoom levels,
 * and system statistics. Grounded in authoritative documentation under docs/.
 */

export type ArchitectureCategory =
  | 'sources'
  | 'ingestion'
  | 'entity_resolution'
  | 'canonical_catalog'
  | 'personalization'
  | 'client_ui'
  | 'infrastructure_security';

export type ImplementationStatus = 'implemented' | 'planned';

export type ZoomLevel = 0 | 1 | 2 | 3;

export interface CategoryMetadata {
  id: ArchitectureCategory;
  name: string;
  description: string;
  colorDark: string;
  colorLight: string;
  borderColorDark: string;
  borderColorLight: string;
  accentBgDark: string;
  accentBgLight: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface NodeRelationships {
  inputs: string[]; // IDs of nodes feeding into this node
  outputs: string[]; // IDs of nodes this node feeds into
  rationale?: string;
}

export interface NodeTechnicalDetails {
  summary: string;
  relevantFiles?: string[];
  tableNames?: string[];
  keyFunctions?: string[];
  docReference: string; // Authoritative markdown path (e.g. 'docs/architecture/entity-resolution.md')
}

export interface NodeExample {
  title: string;
  scenario: string;
  input: string;
  output: string;
  explanation: string;
}

export interface NodeHistory {
  introducedInPhase: string; // e.g. 'Phase 0', 'Phase 1', 'Phase 2 (Planned)'
  decisionRef?: string; // e.g. 'docs/decisions/index.md#product'
  rationale: string;
}

export interface ArchitectureNode {
  id: string;
  name: string;
  category: ArchitectureCategory;
  status: ImplementationStatus;
  minZoomLevel: ZoomLevel; // 0 = Macro (always visible), 1 = Services, 2 = Entities, 3 = Schemas
  cluster: string;
  position: NodePosition;
  shortDescription: string;
  overview: {
    plainEnglish: string;
    whyEncoreNeedsIt: string;
    whatItDoes: string;
  };
  technical: NodeTechnicalDetails;
  relationships: NodeRelationships;
  example?: NodeExample;
  history?: NodeHistory;
}

export interface ArchitectureEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType:
    'transforms' | 'validates' | 'persists' | 'queries' | 'enforces';
  label?: string;
  status: ImplementationStatus;
  description: string;
  docReference?: string;
}

export interface ArchitectureCluster {
  id: string;
  name: string;
  category: ArchitectureCategory;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  minZoomLevel: ZoomLevel;
  description: string;
}

export interface HubSystemStatItem {
  id: string;
  label: string;
  value: string | number;
  change?: string;
  isIllustrative: boolean; // MUST be true for mock/placeholder numbers on foundation branch
  category: 'catalog' | 'ingestion' | 'health' | 'milestones';
  description: string;
}

export interface HubStatsData {
  items: HubSystemStatItem[];
  runtimeInfo: {
    nextVersion: string;
    reactVersion: string;
    nodeRunner: string;
    unitTestsCount: number;
    integrationTestsCount: number;
  };
}
