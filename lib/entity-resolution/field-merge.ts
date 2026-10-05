import type { Event, EventStatus } from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';

export interface FieldMergeEvidence {
  fieldName: string;
  observedValue: unknown;
  valueHash: string;
  confidence: number;
  parserVersion: string;
}

export interface FieldMergeOutcome {
  updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>;
  evidences: FieldMergeEvidence[];
}

export function evaluateFieldMerge(
  current: Event,
  candidate: EventCandidate,
  parserVersion = '1.0.0',
): FieldMergeOutcome {
  const updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>> = {};
  const evidences: FieldMergeOutcome['evidences'] = [];

  // 1. Upgrade date_only to instant precision if candidate has startsAt
  if (current.startTimePrecision === 'date_only' && candidate.startsAt) {
    updates.startTimePrecision = 'instant';
    updates.startsAt = candidate.startsAt;
    evidences.push({
      fieldName: 'starts_at',
      observedValue: candidate.startsAt,
      valueHash: `starts_at_${candidate.startsAt}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 2. Cancellation / Postponement / Reschedule update
  // Check candidate verification status or raw payload status
  const candidateStatus = candidate.rawPayload?.status as
    EventStatus | undefined;
  if (
    candidateStatus &&
    ['cancelled', 'postponed', 'rescheduled'].includes(candidateStatus) &&
    current.status !== candidateStatus
  ) {
    updates.status = candidateStatus;
    evidences.push({
      fieldName: 'status',
      observedValue: candidateStatus,
      valueHash: `status_${candidateStatus}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 3. Primary ticket URL populate if missing
  if (!current.primaryTicketUrl && candidate.ticketUrl) {
    updates.primaryTicketUrl = candidate.ticketUrl;
    evidences.push({
      fieldName: 'primary_ticket_url',
      observedValue: candidate.ticketUrl,
      valueHash: `ticket_${candidate.ticketUrl}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 4. Doors time populate if missing
  if (!current.doorsAt && candidate.doorsOpenAt) {
    updates.doorsAt = candidate.doorsOpenAt;
    evidences.push({
      fieldName: 'doors_at',
      observedValue: candidate.doorsOpenAt,
      valueHash: `doors_${candidate.doorsOpenAt}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  return { updates, evidences };
}
