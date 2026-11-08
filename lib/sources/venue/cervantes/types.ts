export interface CervantesParseContext {
  sourceId: string;
  rawIngestId?: string;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
}

export interface CervantesRawEventData {
  title: string;
  cleanTitle: string;
  subheader?: string;
  dateText: string;
  monthYearSeparator?: string;
  localStartDate: string | null;
  timeText?: string;
  showTime: string | null;
  doorTime: string | null;
  venueName: string;
  city: string;
  state: string;
  address?: string;
  eventUrl: string;
  ticketUrl?: string;
  imageUrl?: string;
  status: 'scheduled' | 'cancelled' | 'sold_out' | 'postponed';
  artists: Array<{
    name: string;
    billingPosition: 'headliner' | 'support';
  }>;
}
