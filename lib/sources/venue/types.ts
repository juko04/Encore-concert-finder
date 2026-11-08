import type { EventCandidate } from '@/lib/domain/event-candidate';
import type { Source } from '@/lib/domain/source';
import type {
  ICatalogRepository,
  IEventCandidateRepository,
  IRawIngestRepository,
  ISourceRepository,
} from '@/lib/repositories/interfaces';

export interface VenueSourceConfig {
  id?: string;
  slug: string;
  name: string;
  baseUrl: string;
  calendarUrl: string;
  city: string;
  state: string;
  country?: string;
  defaultTimezone?: string;
  reliabilityScore?: number;
  parserVersion?: string;
  defaultAddress?: string;
  defaultPostalCode?: string;
  defaultCoordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface VenueIngestionOptions {
  sourceRepo: ISourceRepository;
  rawIngestRepo: IRawIngestRepository;
  candidateRepo: IEventCandidateRepository;
  catalogRepo: ICatalogRepository;
  targetUrl?: string;
  useFixture?: boolean;
  fixtureHtml?: string;
  fixturePath?: string;
  persist?: boolean;
  reprocess?: boolean;
}

export interface VenueIngestionResult {
  source: Source;
  rawIngestsFetched: number;
  rawIngestsPersisted: number;
  rawIngestsReused: number;
  candidatesParsed: number;
  candidatesPersisted: number;
  candidatesReused: number;
  candidatesSkipped: number;
  canonicalEventsCreated: number;
  canonicalEventsMatched: number;
  candidatesNeedsReview: number;
  candidatesRejected: number;
  reviewReasons: Record<string, number>;
  persistedEventIds: string[];
  candidates: EventCandidate[];
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

export interface ParsedTimeInfo {
  showTime: string | null; // HH:mm:ss in 24h format
  doorTime: string | null; // HH:mm:ss in 24h format
  rawText?: string;
}
