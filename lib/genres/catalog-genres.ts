/**
 * Single shared genre vocabulary for the catalog UI and search.
 *
 * Badges, the Search genre filter and free-text search all go through this module so they agree.
 * It reuses the deterministic taxonomy in `lib/recommendation/genre.ts` (no new taxonomy).
 *
 * Rules:
 * 1. Not-a-genre labels are DROPPED here, in one place: "Live Music" (every show is live),
 *    children's music, French music, world music, rodeo. They never produce a badge, a filter
 *    option or a search expansion.
 * 2. Raw strings the taxonomy cannot classify degrade gracefully: no label (no badge), never a
 *    throw. Input of any type is tolerated.
 * 3. A show whose genre field resolves to more than one distinct label (festivals) is "Mixed".
 */

import { classifyGenre, normalizeGenre } from '@/lib/recommendation/genre';

export const MIXED_GENRE_LABEL = 'Mixed';
export const FESTIVAL_GENRE_LABEL = 'Festival';

/** Normalized (see normalizeGenre) strings that are explicitly not genres. */
const NON_GENRES: ReadonlySet<string> = new Set([
  'live music',
  'live',
  'music',
  'concert',
  'concerts',
  'miscellaneous',
  'undefined',
  'other',
  'children s music',
  'childrens music',
  'children music',
  'kids music',
  'family',
  'french music',
  'world music',
  'world',
  'rodeo',
]);

export type CatalogGenreLabel =
  | 'Electronic'
  | 'Hip-Hop'
  | 'Pop'
  | 'Rock'
  | 'Indie'
  | 'Metal'
  | 'Punk'
  | 'Country'
  | 'Folk'
  | 'Jazz'
  | 'Blues'
  | 'R&B'
  | 'Reggae'
  | 'Latin'
  | 'Classical';

const LABEL_ORDER: readonly CatalogGenreLabel[] = [
  'Electronic',
  'Hip-Hop',
  'Pop',
  'Rock',
  'Indie',
  'Metal',
  'Punk',
  'Country',
  'Folk',
  'Jazz',
  'Blues',
  'R&B',
  'Reggae',
  'Latin',
  'Classical',
];

/** Canonical filter/badge genres, in a stable display order. */
export const CATALOG_GENRE_LABELS: readonly CatalogGenreLabel[] = LABEL_ORDER;

function labelFromClassification(
  family: string | null,
  cluster: string | null,
): CatalogGenreLabel | null {
  switch (family) {
    case 'electronic':
      return 'Electronic';
    case 'hip_hop':
      return 'Hip-Hop';
    case 'pop':
      return 'Pop';
    case 'rock':
      return cluster === 'indie_rock' ? 'Indie' : 'Rock';
    case 'metal':
      return 'Metal';
    case 'punk':
      return 'Punk';
    case 'country_folk':
      return cluster === 'folk' ? 'Folk' : 'Country';
    case 'jazz_blues':
      return cluster === 'blues' ? 'Blues' : 'Jazz';
    case 'soul_rnb':
      return 'R&B';
    case 'reggae':
      return 'Reggae';
    case 'latin':
      return 'Latin';
    case 'classical':
      return 'Classical';
    default:
      // 'world' is deliberately not a genre; unknown families have no label.
      return null;
  }
}

/**
 * Map one raw genre string to a canonical label, or null when it is not a genre / unknown.
 * "Festival" is kept as the one pseudo-genre the catalog filter already understands.
 */
export function canonicalGenreLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = normalizeGenre(raw);
  if (!n || NON_GENRES.has(n)) return null;
  if (n === 'festival') return FESTIVAL_GENRE_LABEL;
  const { family, cluster } = classifyGenre(n);
  return labelFromClassification(family, cluster);
}

/** Split a source genre field such as "Rock/Pop" or "Rock, Folk" into raw parts. */
function splitGenreField(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[/,;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Distinct canonical labels for a genre field (string with separators, or a list). */
export function genreLabelsOf(
  ...fields: Array<string | readonly string[] | null | undefined>
): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const parts = Array.isArray(field)
      ? field.flatMap((f) => splitGenreField(f))
      : splitGenreField(field);
    for (const part of parts) {
      const label = canonicalGenreLabel(part);
      if (label && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

/**
 * Label shown on a badge: the single genre, "Mixed" when the show spans several genres, or
 * null (no badge) when nothing usable is known.
 */
export function displayGenreLabel(
  genre: string | readonly string[] | null | undefined,
): string | null {
  const labels = genreLabelsOf(genre);
  if (labels.length === 0) return null;
  if (labels.length > 1) return dominantGenreLabel(genre) ?? MIXED_GENRE_LABEL;
  return labels[0];
}

/** Entries needed before one genre may stand for a large bill (a festival lineup). */
export const DOMINANT_GENRE_MIN_ENTRIES = 8;
export const DOMINANT_GENRE_MIN_SHARE = 0.6;

/**
 * For a big bill (festival) whose genre entries are mostly one genre, that genre; otherwise null.
 * Counts every raw entry (an artist's genres repeat per artist), so one stray pop act on an EDM
 * festival does not turn the badge into "Mixed". Small bills are never summarised this way.
 */
function dominantGenreLabel(
  genre: string | readonly string[] | null | undefined,
): string | null {
  if (!Array.isArray(genre)) return null;
  const counts = new Map<string, number>();
  let total = 0;
  for (const entry of genre) {
    for (const label of genreLabelsOf(entry)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
      total++;
    }
  }
  if (total < DOMINANT_GENRE_MIN_ENTRIES) return null;
  let top: string | null = null;
  let topCount = 0;
  for (const [label, count] of counts) {
    if (count > topCount) {
      top = label;
      topCount = count;
    }
  }
  return top && topCount / total >= DOMINANT_GENRE_MIN_SHARE ? top : null;
}

export interface EventGenreSource {
  genre?: string | null;
  genres?: readonly string[] | null;
  /** Artists on the bill; any that carry a `genres` list contribute to the badge. */
  artists?: ReadonlyArray<object> | null;
}

/**
 * Every raw genre string an event carries, for the badge: its own `genre` and `genres` plus
 * the `genres` of every artist on the bill. Subgenres are deliberately excluded (they refine a
 * genre and would create a false "Mixed"). The badge resolves these through the shared
 * normalizer, so one genre in several spellings stays a single label.
 */
export function eventGenreList(event: EventGenreSource): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v);
  };
  push(event.genre);
  for (const g of event.genres ?? []) push(g);
  for (const a of event.artists ?? []) {
    const g = (a as { genres?: unknown } | null)?.genres;
    if (Array.isArray(g)) for (const x of g) push(x);
  }
  return out;
}

/** Badge label for an event using all of its genre metadata. */
export function eventDisplayGenreLabel(event: EventGenreSource): string | null {
  return displayGenreLabel(eventGenreList(event));
}

/** Deduplicated, sorted filter options from raw facet strings (non-genres dropped). */
export function normalizeGenreFacets(
  rawGenres: readonly unknown[] | null | undefined,
): string[] {
  const set = new Set<string>();
  for (const raw of rawGenres ?? []) {
    for (const label of genreLabelsOf(typeof raw === 'string' ? raw : null)) {
      set.add(label);
    }
  }
  const known = new Map(LABEL_ORDER.map((l, i) => [l as string, i]));
  return Array.from(set).sort((a, b) => {
    const ia = known.get(a) ?? 999;
    const ib = known.get(b) ?? 999;
    return ia - ib || a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// Search / filter matching
// ---------------------------------------------------------------------------

/** Normalized query strings that mean a canonical genre. */
const GENRE_ALIASES: Readonly<Record<string, CatalogGenreLabel>> = {
  'hip hop': 'Hip-Hop',
  hiphop: 'Hip-Hop',
  rap: 'Hip-Hop',
  'hip hop rap': 'Hip-Hop',
  'rap music': 'Hip-Hop',
  edm: 'Electronic',
  electronica: 'Electronic',
  electronic: 'Electronic',
  'r and b': 'R&B',
  rnb: 'R&B',
  'rhythm and blues': 'R&B',
  pop: 'Pop',
  rock: 'Rock',
  indie: 'Indie',
  metal: 'Metal',
  punk: 'Punk',
  country: 'Country',
  folk: 'Folk',
  jazz: 'Jazz',
  blues: 'Blues',
  reggae: 'Reggae',
  latin: 'Latin',
  classical: 'Classical',
};

/**
 * Case-insensitive substrings searched in the stored genre column for each label (stored
 * source strings vary: "Hip-Hop/Rap", "Hip Hop", "R&B").
 */
const LABEL_DB_TERMS: Readonly<Record<CatalogGenreLabel, readonly string[]>> = {
  Electronic: ['electronic', 'edm', 'dance'],
  'Hip-Hop': ['hip-hop', 'hip hop', 'hiphop', 'rap'],
  Pop: ['pop'],
  Rock: ['rock', 'jam band'],
  Indie: ['indie', 'alternative'],
  Metal: ['metal'],
  Punk: ['punk', 'ska'],
  Country: ['country', 'bluegrass'],
  Folk: ['folk', 'americana'],
  Jazz: ['jazz'],
  Blues: ['blues'],
  'R&B': ['r&b', 'rnb', 'soul', 'funk', 'gospel'],
  Reggae: ['reggae'],
  Latin: ['latin'],
  Classical: ['classical'],
};

/**
 * If a free-text query is a genre name or alias ("hip hop", "hiphop", "hip-hop", "rap"),
 * return its canonical label; otherwise null (ordinary text search only).
 */
export function resolveGenreQuery(
  query: string | null | undefined,
): string | null {
  if (typeof query !== 'string') return null;
  const n = normalizeGenre(query);
  if (!n) return null;
  return GENRE_ALIASES[n] ?? null;
}

/** Substrings to look for in a stored genre column for this label/query; [] when none apply. */
export function genreDbTerms(label: string | null | undefined): string[] {
  if (!label) return [];
  const terms = LABEL_DB_TERMS[label as CatalogGenreLabel];
  return terms ? [...terms] : [];
}

/**
 * Does an event with these genre strings satisfy a selected filter value? A canonical label
 * matches by label (so "Hip-Hop" matches "Hip-Hop/Rap"); anything else falls back to a
 * case-insensitive substring match.
 */
export function eventMatchesGenre(
  selected: string | null | undefined,
  ...fields: Array<string | readonly string[] | null | undefined>
): boolean {
  if (!selected || selected === 'all') return true;
  const wanted = canonicalGenreLabel(selected);
  if (wanted) {
    return genreLabelsOf(...fields).includes(wanted);
  }
  const needle = selected.toLowerCase();
  return fields.some((f) =>
    (Array.isArray(f) ? f : [f]).some(
      (v) => typeof v === 'string' && v.toLowerCase().includes(needle),
    ),
  );
}

/** Does a free-text query match an event's genre (alias-aware)? */
export function genreMatchesQuery(
  query: string,
  ...fields: Array<string | readonly string[] | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const label = resolveGenreQuery(q);
  if (label && genreLabelsOf(...fields).includes(label)) return true;
  return fields.some((f) =>
    (Array.isArray(f) ? f : [f]).some(
      (v) => typeof v === 'string' && v.toLowerCase().includes(q),
    ),
  );
}

// ---------------------------------------------------------------------------
// Badge colors (single mapping)
// ---------------------------------------------------------------------------

/**
 * Tailwind classes per label. Light: *-100 bg with *-900 text; dark: *-950 bg with *-200 text
 * (both well above 4.5:1). Class strings are literal so Tailwind can see them.
 */
const GENRE_BADGE_CLASSES: Readonly<Record<string, string>> = {
  Electronic:
    'border-cyan-300 bg-cyan-100 text-cyan-900 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
  'Hip-Hop':
    'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  Pop: 'border-pink-300 bg-pink-100 text-pink-900 dark:border-pink-700 dark:bg-pink-950 dark:text-pink-200',
  Rock: 'border-red-300 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200',
  Indie:
    'border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200',
  Metal:
    'border-stone-400 bg-stone-200 text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200',
  Punk: 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-900 dark:border-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-200',
  Country:
    'border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200',
  Folk: 'border-lime-300 bg-lime-100 text-lime-900 dark:border-lime-700 dark:bg-lime-950 dark:text-lime-200',
  Jazz: 'border-indigo-300 bg-indigo-100 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200',
  Blues:
    'border-blue-300 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200',
  'R&B':
    'border-purple-300 bg-purple-100 text-purple-900 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200',
  Reggae:
    'border-green-300 bg-green-100 text-green-900 dark:border-green-700 dark:bg-green-950 dark:text-green-200',
  Latin:
    'border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200',
  Classical:
    'border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200',
  Festival:
    'border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200',
  [MIXED_GENRE_LABEL]:
    'border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100',
};

const NEUTRAL_BADGE =
  'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

export function genreBadgeClasses(label: string | null | undefined): string {
  return (label && GENRE_BADGE_CLASSES[label]) || NEUTRAL_BADGE;
}
