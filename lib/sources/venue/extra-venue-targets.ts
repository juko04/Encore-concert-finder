import type { EventSourceAdapter } from '@/lib/domain/source';
import { MishawakaAdapter } from './mishawaka/adapter';
import {
  BOHEMIAN_LIVE_MUSIC_API_URL,
  BOHEMIAN_LIVE_MUSIC_CONFIG,
  MISHAWAKA_CONFIG,
  TEN_MILE_MUSIC_HALL_API_URL,
  TEN_MILE_MUSIC_HALL_CONFIG,
} from './source-registry';
import { TribeEventsAdapter } from './tribe-events/adapter';
import type { VenueSourceConfig } from './types';

export interface VenueSyncTarget {
  config: VenueSourceConfig;
  adapterFactory: () => EventSourceAdapter;
  fixture: string;
}

/**
 * Colorado venues added after the original seven (shared by `sync:all` and `sync:new-venues`).
 * Each adapter fetches only its venue's public calendar (robots.txt permitting).
 */
export const EXTRA_VENUE_SYNC_TARGETS: VenueSyncTarget[] = [
  {
    config: MISHAWAKA_CONFIG,
    adapterFactory: () => new MishawakaAdapter(MISHAWAKA_CONFIG),
    fixture: 'tests/fixtures/mishawaka-events-response.html',
  },
  {
    config: BOHEMIAN_LIVE_MUSIC_CONFIG,
    adapterFactory: () =>
      new TribeEventsAdapter(BOHEMIAN_LIVE_MUSIC_CONFIG, {
        apiUrl: BOHEMIAN_LIVE_MUSIC_API_URL,
        useConfigVenueFallback: false,
      }),
    fixture: 'tests/fixtures/bohemian-live-music-events-response.json',
  },
  {
    config: TEN_MILE_MUSIC_HALL_CONFIG,
    adapterFactory: () =>
      new TribeEventsAdapter(TEN_MILE_MUSIC_HALL_CONFIG, {
        apiUrl: TEN_MILE_MUSIC_HALL_API_URL,
      }),
    fixture: 'tests/fixtures/ten-mile-music-hall-events-response.json',
  },
];
