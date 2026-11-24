import type { Event, EventStatus } from '@/lib/domain/catalog';
import { normalizeName } from '@/lib/domain/value-objects';
import {
  getCandidateGenres,
  type EventCandidate,
} from '@/lib/domain/event-candidate';

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

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when `candidateTitle` is the current name followed by a tour/show name after a colon or
 * dash ("Nickelback" -> "Nickelback: Everything Under The Sun Tour"). Used to upgrade a bare or
 * derived title to the tour name; never shortens, and never treats "w/ opener" or "feat." suffixes
 * as a more specific title.
 */
export function isMoreSpecificTitle(
  currentName: string,
  candidateTitle: string,
): boolean {
  const cur = currentName.trim();
  const cand = candidateTitle.trim();
  if (!cur || cand.length <= cur.length) return false;
  const escaped = cur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\s*[:\\-–—]\\s+\\S`, 'i').test(cand);
}

export function evaluateFieldMerge(
  current: Event,
  candidate: EventCandidate,
  parserVersion = '1.0.0',
): FieldMergeOutcome {
  const updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>> = {};
  const evidences: FieldMergeOutcome['evidences'] = [];

  // 0. Title: upgrade a bare/derived title to the more specific show or tour name, but never
  // let a ticket-package listing ("Club Level Seating: X") override the real show title.
  if (
    candidate.title &&
    candidate.rawPayload?.isTicketPackage !== true &&
    isMoreSpecificTitle(current.name, candidate.title)
  ) {
    updates.name = candidate.title.trim();
    updates.normalizedName = normalizeName(candidate.title);
    evidences.push({
      fieldName: 'name',
      observedValue: candidate.title.trim(),
      valueHash: `name_${normalizeTitle(candidate.title)}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

  // 0b. Genres are fill-if-empty (never overwrite genres we already hold).
  const candidateGenres = getCandidateGenres(candidate);
  if (
    candidateGenres.length > 0 &&
    (!Array.isArray(current.genres) || current.genres.length === 0)
  ) {
    updates.genre = current.genre ?? candidateGenres[0];
    updates.genres = candidateGenres;
    evidences.push({
      fieldName: 'genres',
      observedValue: candidateGenres,
      valueHash: `genres_${candidateGenres.join('|').toLowerCase()}`,
      confidence: candidate.confidence,
      parserVersion,
    });
  }

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

  // 3. Local end date update (never accept an end date before the effective start date)
  const effectiveStartDate = updates.localStartDate ?? current.localStartDate;
  if (
    candidate.localEndDate &&
    candidate.localEndDate !== current.localEndDate &&
    candidate.localEndDate >= effectiveStartDate
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

  // 3b. Keep is_multi_day consistent with the merged date range
  // (mirrors the events.check_events_multi_day_consistency constraint).
  if (
    updates.localStartDate !== undefined ||
    updates.localEndDate !== undefined
  ) {
    const mergedEndDate =
      updates.localEndDate !== undefined
        ? updates.localEndDate
        : current.localEndDate;
    const mergedIsMultiDay = Boolean(
      mergedEndDate && mergedEndDate > effectiveStartDate,
    );
    if (mergedIsMultiDay !== current.isMultiDay) {
      updates.isMultiDay = mergedIsMultiDay;
    }
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

  // 5. Start time precision update (when precision changed without starts_at).
  // Only accept a precision consistent with the merged starts_at (mirrors the
  // check_events_date_only_no_starts_at / check_events_instant_starts_at constraints):
  // a less precise "date_only" observation never downgrades an event that already
  // has a known start instant.
  const mergedStartsAt = updates.startsAt ?? current.startsAt ?? null;
  const precisionConsistent =
    candidate.startTimePrecision === 'date_only'
      ? mergedStartsAt === null
      : mergedStartsAt !== null;
  if (
    candidate.startTimePrecision &&
    candidate.startTimePrecision !== current.startTimePrecision &&
    !updates.startTimePrecision &&
    precisionConsistent
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
  const candidateStatus =
    candidate.rawPayload?.isCanceled === true
      ? 'cancelled'
      : (candidate.rawPayload?.status as EventStatus | undefined);
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
