import type { EventSortOption } from '@/lib/repositories/interfaces';

/** Sort options accepted by /search and /api/catalog/search (anything else -> date_asc). */
const VALID_SORTS: readonly EventSortOption[] = [
  'price_asc',
  'price_desc',
  'date_asc',
  'date_desc',
  'title_asc',
  'score_desc',
];

export function parseEventSort(
  value: string | null | undefined,
): EventSortOption {
  return value && (VALID_SORTS as readonly string[]).includes(value)
    ? (value as EventSortOption)
    : 'date_asc';
}

/** URL flag semantics shared by the search page and API: only "true" / "1" are true. */
export function isTruthyFlag(value: string | null | undefined): boolean {
  return value === 'true' || value === '1';
}

/** `includeUnknownPrice` defaults to true when the param is absent. */
export function parseIncludeUnknownPrice(
  value: string | null | undefined,
): boolean {
  return value === null || value === undefined ? true : isTruthyFlag(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
