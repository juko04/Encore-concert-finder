/**
 * Genre inference from show text (pure, deterministic, no I/O).
 *
 * Many listings (bar and club calendars especially) carry no genre. When the TITLE itself states
 * one ("Bluegrass Jam", "Latin Night", "Jazz at ...", "Metal Monday") we can say so, clearly
 * marked as inferred (events.genres_source = 'inferred_title'). Nothing is guessed from a band's
 * name alone: only explicit genre phrases count, ambiguous single words are excluded, and known
 * false positives are guarded. Returns raw genre strings that the shared genre vocabulary
 * (lib/genres/catalog-genres.ts) maps to display labels.
 */

import { normalizeGenre } from '@/lib/recommendation/genre';

interface InferenceRule {
  genre: string;
  pattern: RegExp;
}

/**
 * Titles that look like a genre word but are a specific act or place (never inferred from).
 * Matched against the normalized title.
 */
const FALSE_POSITIVES =
  /\b(blues traveler|soul asylum|soul coughing|mf doom|metal mulisha|jazz is dead|utah jazz|rap snacks|country club|house party|full house|open house|rock the block)\b/;

/** Ordered rules; patterns run against the normalized title (lower case, punctuation removed). */
const RULES: readonly InferenceRule[] = [
  {
    genre: 'Bluegrass',
    pattern: /\b(bluegrass|string band|newgrass|jamgrass)\b/,
  },
  {
    genre: 'Americana',
    pattern: /\b(americana|alt country|outlaw country)\b/,
  },
  {
    genre: 'Country',
    pattern:
      /\b(country (night|western|music|jam|dance)|honky tonk|line dancing|western swing)\b/,
  },
  { genre: 'Jazz', pattern: /\b(jazz|bebop|big band)\b/ },
  { genre: 'Blues', pattern: /\bblues\b/ },
  { genre: 'Funk', pattern: /\bfunk\b/ },
  { genre: 'R&B', pattern: /\b(rnb|r and b|neo soul)\b/ },
  {
    genre: 'Soul',
    pattern: /\b(motown|northern soul|neo soul|soul night|soul train)\b/,
  },
  { genre: 'Gospel', pattern: /\bgospel\b/ },
  { genre: 'Reggae', pattern: /\b(reggae|dancehall|roots reggae)\b/ },
  { genre: 'Ska', pattern: /\bska\b/ },
  { genre: 'Punk', pattern: /\b(punk|hardcore|emo night|emo nite)\b/ },
  {
    genre: 'Metal',
    pattern: /\b(metal|thrash|grindcore|deathcore|death metal)\b/,
  },
  {
    genre: 'Hip Hop',
    pattern: /\b(hip hop|hiphop|boom bap|rap night|rap battle|cypher)\b/,
  },
  {
    genre: 'Electronic',
    pattern:
      /\b(edm|techno|house music|deep house|tech house|progressive house|trance|dubstep|drum and bass|drum n bass|dnb|bass music|synthwave|electronic|rave|dj set|dj night|b2b)\b/,
  },
  {
    genre: 'Latin',
    pattern:
      /\b(latin|salsa|bachata|cumbia|reggaeton|mariachi|norteno|tejano|banda|noche sonidera)\b/,
  },
  {
    genre: 'Classical',
    pattern:
      /\b(symphony|philharmonic|opera|baroque|choir|chorale|recital|symphony orchestra|orchestra presents|chamber orchestra)\b/,
  },
  {
    genre: 'Folk',
    pattern:
      /\b(folk|singer songwriter|singer songwriters|songwriter showcase)\b/,
  },
  { genre: 'Indie', pattern: /\b(indie|shoegaze|dream pop|post punk)\b/ },
  { genre: 'Jam Band', pattern: /\b(jam band|jamtronica)\b/ },
  {
    genre: 'Rock',
    pattern:
      /\b(rock and roll|rock n roll|rockabilly|classic rock|garage rock|hard rock|psychedelic)\b/,
  },
  { genre: 'Pop', pattern: /\b(pop night|k pop|kpop|top 40)\b/ },
];

/** A leading "DJ <name>" billing is a DJ set. */
const LEADING_DJ = /^dj\b/;

export const MAX_INFERRED_GENRES = 2;

export interface InferredGenres {
  /** Raw genre strings (e.g. "Bluegrass"), at most MAX_INFERRED_GENRES, in rule order. */
  genres: string[];
  /** The text each genre was inferred from, for explanation/debugging. */
  evidence: Array<{ genre: string; phrase: string }>;
}

const NONE: InferredGenres = { genres: [], evidence: [] };

/**
 * Infers genres from a show title (and optionally the headliner/billed names, which are only
 * checked for a leading "DJ"). Returns empty when the text states no genre.
 */
export function inferGenresFromText(
  title: string | null | undefined,
  billedNames: ReadonlyArray<string | null | undefined> = [],
): InferredGenres {
  const text = normalizeGenre(typeof title === 'string' ? title : '');
  if (!text) return NONE;
  if (FALSE_POSITIVES.test(text)) return NONE;

  const genres: string[] = [];
  const evidence: InferredGenres['evidence'] = [];
  const add = (genre: string, phrase: string) => {
    if (genres.includes(genre) || genres.length >= MAX_INFERRED_GENRES) return;
    genres.push(genre);
    evidence.push({ genre, phrase });
  };

  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) add(rule.genre, m[0]);
  }

  if (genres.length === 0) {
    const names = [title, ...billedNames]
      .map((n) => normalizeGenre(typeof n === 'string' ? n : ''))
      .filter(Boolean);
    if (names.some((n) => LEADING_DJ.test(n))) add('Electronic', 'dj');
  }

  return genres.length > 0 ? { genres, evidence } : NONE;
}

export const INFERRED_TITLE_SOURCE = 'inferred_title';
export const TM_ATTRACTION_SOURCE = 'ticketmaster_attraction';
