import type { VenueHttpClient } from '../http-client';
import type { IVenueSourceAdapter, VenueSourceConfig } from '../types';

export type { IVenueSourceAdapter };

export interface Z2VenueMapping {
  venueName: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  timezone: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export const Z2_KNOWN_VENUES: Record<string, Z2VenueMapping> = {
  'boulder theater': {
    venueName: 'Boulder Theater',
    address: '2032 14th St',
    city: 'Boulder',
    state: 'CO',
    postalCode: '80302',
    country: 'US',
    timezone: 'America/Denver',
    coordinates: {
      latitude: 40.0172,
      longitude: -105.2783,
    },
  },
  'fox theatre': {
    venueName: 'Fox Theatre',
    address: '1135 13th St',
    city: 'Boulder',
    state: 'CO',
    postalCode: '80302',
    country: 'US',
    timezone: 'America/Denver',
    coordinates: {
      latitude: 40.0075,
      longitude: -105.2758,
    },
  },
  'aggie theatre': {
    venueName: 'Aggie Theatre',
    address: '204 S College Ave',
    city: 'Fort Collins',
    state: 'CO',
    postalCode: '80524',
    country: 'US',
    timezone: 'America/Denver',
    coordinates: {
      latitude: 40.5878,
      longitude: -105.0768,
    },
  },
  'chautauqua auditorium': {
    venueName: 'Chautauqua Auditorium',
    address: '900 Baseline Rd',
    city: 'Boulder',
    state: 'CO',
    postalCode: '80302',
    country: 'US',
    timezone: 'America/Denver',
    coordinates: {
      latitude: 39.9987,
      longitude: -105.2825,
    },
  },
};

export interface Z2RawArtist {
  name: string;
  billingPosition: 'headliner' | 'support';
  /**
   * Numeric position where 0 is headliner and > 0 indicates support act
   */
  position: number;
}

export interface Z2RawPrice {
  min?: number;
  max?: number;
  currency: string;
  isFree?: boolean;
}

export interface Z2RawEvent {
  id?: string;
  title: string;
  cleanTitle: string;
  headliner?: string;
  supportActs: string[];
  artists: Z2RawArtist[];
  venueName: string;
  venueInfo?: Z2VenueMapping;
  eventDateText: string;
  localStartDate: string | null;
  timeText?: string;
  showTime: string | null;
  doorTime: string | null;
  startsAt?: string;
  doorsOpenAt?: string;
  ticketUrl?: string;
  isSoldOut: boolean;
  price?: Z2RawPrice;
  imageUrl?: string;
  eventUrl?: string;
}

export interface Z2ParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl?: string;
  fetchedAt?: string;
  contentHash?: string;
  parserVersion?: string;
  defaultVenueConfig?: VenueSourceConfig;
}

export interface Z2AdapterOptions {
  httpClient?: VenueHttpClient;
  calendarUrl?: string;
  maxPages?: number;
  config?: VenueSourceConfig;
}
