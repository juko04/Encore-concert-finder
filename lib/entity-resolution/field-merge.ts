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

  // 1. Reschedule or start time update (instant or date change)
  if (candidate.startsAt && candidate.startsAt !== current.startsAt) {
    updates.startsAt = candidate.startsAt;
    evidences.push({
      fieldName: 'starts_at',
      observedValue: candidate.startsAt,
      valueHash: `starts_at_${candidate.startsAt}`,
      confidence: candidate.confidence,
      parserVersion,
    });

    if (current.startTimePrecision !== 'instant') {
      updates.startTimePrecision = 'instant';
      evidences.push({
        fieldName: 'start_time_precision',
        observedValue: 'instant',
        valueHash: 'start_time_precision_instant',
        confidence: candidate.confidence,
        parserVersion,
      });
    }
  }

  // 2. Local start date update (date rescheduled)
  if (
    candidate.localStartDate &&
    candidate.localStartDate !== current.localStartDate
  ) {
    updates.localStartDate = candidate.localStartDate;
    evidences.push({
      fieldName: 'local_start_date',
      observedValue: candidate.localStartDate,
      valueHash: `local_start_date_${candidate.localStartDate}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 3. Local end date update
  if (
    candidate.localEndDate &&
    candidate.localEndDate !== current.localEndDate
  ) {
    updates.localEndDate = candidate.localEndDate;
    evidences.push({
      fieldName: 'local_end_date',
      observedValue: candidate.localEndDate,
      valueHash: `local_end_date_${candidate.localEndDate}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 4. Ends at update
  if (candidate.endsAt && candidate.endsAt !== current.endsAt) {
    updates.endsAt = candidate.endsAt;
    evidences.push({
      fieldName: 'ends_at',
      observedValue: candidate.endsAt,
      valueHash: `ends_at_${candidate.endsAt}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 5. Start time precision update (when precision changed without starts_at)
  if (
    candidate.startTimePrecision &&
    candidate.startTimePrecision !== current.startTimePrecision &&
    !updates.startTimePrecision
  ) {
    updates.startTimePrecision = candidate.startTimePrecision;
    evidences.push({
      fieldName: 'start_time_precision',
      observedValue: candidate.startTimePrecision,
      valueHash: `start_time_precision_${candidate.startTimePrecision}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 6. Cancellation / Postponement / Reschedule status update
  const candidateStatus = candidate.rawPayload?.status as
    EventStatus | undefined;
  if (
    candidateStatus &&
    ['scheduled', 'cancelled', 'postponed', 'rescheduled'].includes(
      candidateStatus,
    ) &&
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
  } else if (
    !candidateStatus &&
    (updates.startsAt || updates.localStartDate) &&
    current.status === 'scheduled' &&
    candidate.rawPayload?.isRescheduled === true
  ) {
    updates.status = 'rescheduled';
    evidences.push({
      fieldName: 'status',
      observedValue: 'rescheduled',
      valueHash: 'status_rescheduled',
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 7. Primary ticket URL populate if missing or updated with high confidence
  if (
    candidate.ticketUrl &&
    candidate.ticketUrl !== current.primaryTicketUrl &&
    (!current.primaryTicketUrl || candidate.confidence >= 0.8)
  ) {
    updates.primaryTicketUrl = candidate.ticketUrl;
    evidences.push({
      fieldName: 'primary_ticket_url',
      observedValue: candidate.ticketUrl,
      valueHash: `ticket_${candidate.ticketUrl}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 8. Doors time populate or update
  if (candidate.doorsOpenAt && candidate.doorsOpenAt !== current.doorsAt) {
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
