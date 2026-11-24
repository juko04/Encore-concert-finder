/**
 * Genre taste & similarity for artist-fit scoring.
 *
 * Builds a deterministic "genre taste profile" from the user's explicit artist preferences and
 * Spotify listening affinities, then scores how close an event artist's genres are to that taste.
 *
 * Invariants:
 * 1. 100% deterministic; no ML, no network. Genre strings come from data we already hold
 *    (Spotify artist objects). Artists without genre data are NEVER guessed (neutral).
 * 2. Explicit user preferences take precedence over inferred Spotify signals; explicitly
 *    disliked artists contribute negative (never positive) genre weight.
 * 3. A small in-repo taxonomy maps Spotify sub-genre strings to a cluster (e.g. 'melodic house'
 *    -> house) and a broad family (house -> electronic). Unknown strings only match exactly.
 */

import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import { computeSpotifyAffinity } from './spotify-affinity';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type GenreFamily =
  | 'electronic'
  | 'hip_hop'
  | 'pop'
  | 'rock'
  | 'metal'
  | 'punk'
  | 'country_folk'
  | 'jazz_blues'
  | 'soul_rnb'
  | 'reggae'
  | 'latin'
  | 'classical'
  | 'world';

export interface GenreClassification {
  family: GenreFamily | null;
  cluster: string | null;
}

interface TaxonomyRule {
  pattern: RegExp;
  family: GenreFamily;
  cluster: string;
}

/**
 * Ordered rules; the first match wins, so more specific patterns come first.
 */
const TAXONOMY_RULES: readonly TaxonomyRule[] = [
  // Latin urban (reggaeton, latin trap, ...) MUST precede reggae/hip hop/trap: "reggaeton"
  // contains "reggae" and "trap latino" contains "trap", but neither is that genre.
  {
    pattern:
      /reggaeton|dembow|perreo|urbano|moombahton|latin (urban|trap|rap|hip hop|drill)|(trap|rap|hip hop|drill) (latino|latina|argentino|chileno|mexicano|boricua|dominicano|venezolano|colombiano|peruano|espanol|en espanol)/,
    family: 'latin',
    cluster: 'latin_urban',
  },

  // Emo/cloud rap are hip hop, not punk
  {
    pattern: /\b(emo|sad|cloud|melodic) rap\b|\bemo trap\b/,
    family: 'hip_hop',
    cluster: 'hip_hop',
  },

  // Post-punk is rock (indie) rather than punk
  { pattern: /post punk|post hardcore/, family: 'rock', cluster: 'indie_rock' },

  // Punk-adjacent before metal/rock so "hardcore punk" / "pop punk" land in punk
  { pattern: /pop punk|\bemo\b|screamo/, family: 'punk', cluster: 'emo' },
  { pattern: /\bska\b/, family: 'punk', cluster: 'ska' },
  { pattern: /punk|hardcore/, family: 'punk', cluster: 'punk' },
  { pattern: /metal|grindcore|deathcore/, family: 'metal', cluster: 'metal' },

  // Dance pop / electropop are pop even though they contain "dance"/"electro"
  {
    pattern: /dance pop|electropop|synthpop|hyperpop|electro pop/,
    family: 'pop',
    cluster: 'dance_pop',
  },

  // Electronic ("bass house" is bass-music, so it precedes the generic house rule)
  { pattern: /bass house/, family: 'electronic', cluster: 'bass' },
  {
    pattern: /\bhouse\b(?! of)/,
    family: 'electronic',
    cluster: 'house',
  },
  { pattern: /techno/, family: 'electronic', cluster: 'techno' },
  { pattern: /trance/, family: 'electronic', cluster: 'trance' },
  {
    pattern: /drum and bass|\bdnb\b|jungle|liquid funk|drill and bass/,
    family: 'electronic',
    cluster: 'dnb',
  },
  {
    pattern: /dubstep|riddim|brostep|future bass|bass music|trap edm|drumstep/,
    family: 'electronic',
    cluster: 'bass',
  },
  {
    pattern:
      /ambient|\bidm\b|downtempo|chillwave|synthwave|glitch|breakbeat|electronica|indietronica|trip hop|lo fi beats|lofi beats|chillhop/,
    family: 'electronic',
    cluster: 'electronica',
  },
  {
    pattern: /\bedm\b|electro|electronic|\bdance\b|big room|\brave\b/,
    family: 'electronic',
    cluster: 'edm',
  },

  // Hip hop
  { pattern: /\btrap\b|\bdrill\b|phonk/, family: 'hip_hop', cluster: 'trap' },
  {
    pattern: /hip hop|hiphop|\brap\b|grime|boom bap|crunk/,
    family: 'hip_hop',
    cluster: 'hip_hop',
  },

  // Soul / R&B / funk
  { pattern: /funk/, family: 'soul_rnb', cluster: 'funk' },
  {
    pattern: /\brnb\b|neo soul|\bsoul\b|motown|gospel/,
    family: 'soul_rnb',
    cluster: 'soul_rnb',
  },

  // Reggae
  {
    pattern: /reggae(?!ton)|dancehall|\bdub\b/,
    family: 'reggae',
    cluster: 'reggae',
  },

  // Latin / world
  {
    pattern:
      /latin|salsa|cumbia|bachata|\bbanda\b|norteno|mariachi|corrido|ranchera|tejano|sierreno|grupera|duranguense|regional mexican|merengue|vallenato/,
    family: 'latin',
    cluster: 'latin',
  },
  {
    pattern: /afrobeat|afropop|amapiano|world|celtic|flamenco/,
    family: 'world',
    cluster: 'world',
  },

  // Country / folk / bluegrass
  {
    pattern: /bluegrass|newgrass|jamgrass/,
    family: 'country_folk',
    cluster: 'bluegrass',
  },
  {
    pattern: /country|red dirt|outlaw|honky tonk|western/,
    family: 'country_folk',
    cluster: 'country',
  },
  {
    pattern: /folk|americana|singer songwriter|troubadour/,
    family: 'country_folk',
    cluster: 'folk',
  },

  // Jazz / blues
  {
    pattern: /jazz|bebop|swing|big band/,
    family: 'jazz_blues',
    cluster: 'jazz',
  },
  { pattern: /blues/, family: 'jazz_blues', cluster: 'blues' },

  // Classical
  {
    pattern: /classical|orchestra|opera|baroque|symphon|chamber music/,
    family: 'classical',
    cluster: 'classical',
  },

  // Pop (before generic rock so "pop rock" resolves predictably)
  { pattern: /\bk pop\b|kpop/, family: 'pop', cluster: 'k_pop' },
  {
    pattern:
      /indie pop|dream pop|bedroom pop|art pop|chamber pop|jangle pop|baroque pop/,
    family: 'pop',
    cluster: 'indie_pop',
  },
  { pattern: /\bpop\b/, family: 'pop', cluster: 'pop' },

  // Rock
  { pattern: /jam band|jamtronica|\bjam\b/, family: 'rock', cluster: 'jam' },
  {
    pattern: /psychedelic|neo psych|space rock|stoner|krautrock/,
    family: 'rock',
    cluster: 'psychedelic',
  },
  {
    pattern:
      /indie|alternative|alt rock|garage|shoegaze|new wave|modern rock|lo fi/,
    family: 'rock',
    cluster: 'indie_rock',
  },
  {
    pattern: /rock|grunge|blues rock|hard rock/,
    family: 'rock',
    cluster: 'rock',
  },
];

/**
 * Canonical comparison form: lower case, diacritics stripped (norteño -> norteno), r&b -> rnb,
 * "&" -> "and", and hyphens/underscores/other punctuation collapsed to single spaces so that
 * "k-pop", "K Pop" and "k_pop" are the same genre.
 */
export function normalizeGenre(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\br\s*&\s*b\b/g, 'rnb')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function classifyGenre(raw: string): GenreClassification {
  const g = normalizeGenre(raw);
  if (!g) return { family: null, cluster: null };
  for (const rule of TAXONOMY_RULES) {
    if (rule.pattern.test(g)) {
      return { family: rule.family, cluster: rule.cluster };
    }
  }
  return { family: null, cluster: null };
}

/** Similarity weights between two genre strings (0..1). */
export const GENRE_SIMILARITY = {
  exact: 1,
  sameCluster: 0.7,
  sameFamily: 0.35,
} as const;

export function genreSimilarity(a: string, b: string): number {
  const na = normalizeGenre(a);
  const nb = normalizeGenre(b);
  if (!na || !nb) return 0;
  if (na === nb) return GENRE_SIMILARITY.exact;
  const ca = classifyGenre(na);
  const cb = classifyGenre(nb);
  if (ca.cluster && ca.cluster === cb.cluster) {
    return GENRE_SIMILARITY.sameCluster;
  }
  if (ca.family && ca.family === cb.family) {
    return GENRE_SIMILARITY.sameFamily;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Taste profile
// ---------------------------------------------------------------------------

export interface GenreTasteEntry {
  genre: string;
  /** 0..1, relative to the user's strongest genre (strongest = 1). */
  weight: number;
  /** The user artist that contributed most to this genre (for explanations). */
  sourceArtist: string;
}

export interface GenreTasteProfile {
  positive: GenreTasteEntry[];
  negative: GenreTasteEntry[];
  isEmpty: boolean;
}

export const EMPTY_GENRE_TASTE_PROFILE: GenreTasteProfile = {
  positive: [],
  negative: [],
  isEmpty: true,
};

const PREFERENCE_GENRE_WEIGHTS: Record<PreferenceLevel, number> = {
  favorite: 1,
  like: 0.75,
  interested: 0.4,
  dislike: 0,
};

/** Spotify listening-rank weighting: top 5 -> 1.0, top 10 -> 0.8, top 20 -> 0.6, rest 0.4. */
export function spotifyRankGenreWeight(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 5) return 1;
  if (rank <= 10) return 0.8;
  if (rank <= 20) return 0.6;
  return 0.4;
}

interface Accumulator {
  total: number;
  bestContribution: number;
  sourceArtist: string;
}

function addContribution(
  map: Map<string, Accumulator>,
  genres: string[],
  weight: number,
  artistName: string,
): void {
  if (weight <= 0) return;
  const seen = new Set<string>();
  for (const raw of genres) {
    const genre = normalizeGenre(raw);
    if (!genre || seen.has(genre)) continue;
    seen.add(genre);
    const acc = map.get(genre);
    if (!acc) {
      map.set(genre, {
        total: weight,
        bestContribution: weight,
        sourceArtist: artistName,
      });
    } else {
      acc.total += weight;
      if (weight > acc.bestContribution) {
        acc.bestContribution = weight;
        acc.sourceArtist = artistName;
      }
    }
  }
}

function toEntries(
  map: Map<string, Accumulator>,
  normalizeBy?: number,
): GenreTasteEntry[] {
  const max =
    normalizeBy ?? Math.max(0, ...Array.from(map.values()).map((a) => a.total));
  if (max <= 0) return [];
  return Array.from(map.entries())
    .map(([genre, acc]) => ({
      genre,
      weight: Math.min(1, acc.total / max),
      sourceArtist: acc.sourceArtist,
    }))
    .sort((a, b) => b.weight - a.weight || a.genre.localeCompare(b.genre));
}

export interface GenreTasteInput {
  artistPreferences: UserArtistPreference[];
  spotifyTopArtists?: SpotifyTopArtist[];
}

/**
 * Builds the user's genre taste from explicit preferences (with known catalog genres) and
 * Spotify top artists. Explicit preference level overrides Spotify rank for the same artist;
 * explicit dislikes only ever contribute to the negative profile.
 */
export function buildGenreTasteProfile(
  input: GenreTasteInput,
): GenreTasteProfile {
  const positive = new Map<string, Accumulator>();
  const negative = new Map<string, Accumulator>();

  const prefBySpotifyId = new Map<string, UserArtistPreference>();
  const prefByCanonicalId = new Map<string, UserArtistPreference>();
  for (const pref of input.artistPreferences ?? []) {
    const spotifyId =
      pref.spotifyArtistId ?? pref.canonicalArtist?.spotifyArtistId ?? null;
    if (spotifyId && !prefBySpotifyId.has(spotifyId)) {
      prefBySpotifyId.set(spotifyId, pref);
    }
    const canonicalId = pref.artistId ?? pref.canonicalArtist?.id ?? null;
    if (canonicalId && !prefByCanonicalId.has(canonicalId)) {
      prefByCanonicalId.set(canonicalId, pref);
    }
  }

  const handledPrefIds = new Set<string>();

  // 1. Spotify top artists (genres come from the live Spotify artist object)
  for (const sa of input.spotifyTopArtists ?? []) {
    if (!Array.isArray(sa.genres) || sa.genres.length === 0) continue;
    const explicit =
      prefBySpotifyId.get(sa.id) ??
      (sa.canonicalArtistId
        ? prefByCanonicalId.get(sa.canonicalArtistId)
        : undefined);

    if (explicit) {
      handledPrefIds.add(explicit.id);
      if (explicit.preferenceLevel === 'dislike') {
        addContribution(negative, sa.genres, 1, sa.name);
      } else {
        addContribution(
          positive,
          sa.genres,
          PREFERENCE_GENRE_WEIGHTS[explicit.preferenceLevel],
          sa.name,
        );
      }
      continue;
    }
    // Genre weight is the SUM of its artists' trend-aware affinities, so many artists in one
    // genre (e.g. lots of EDM) means a stronger interest in that genre.
    const affinity =
      sa.affinity ??
      (sa.ranksByRange
        ? computeSpotifyAffinity(sa.ranksByRange).affinity
        : undefined);
    addContribution(
      positive,
      sa.genres,
      affinity !== undefined ? affinity : spotifyRankGenreWeight(sa.rank),
      sa.name,
    );
  }

  // 2. Explicit preferences whose canonical catalog artist has stored genres
  for (const pref of input.artistPreferences ?? []) {
    if (handledPrefIds.has(pref.id)) continue;
    const genres = pref.canonicalArtist?.genres;
    if (!Array.isArray(genres) || genres.length === 0) continue;
    const name = pref.canonicalArtist?.name ?? pref.artistName;
    if (pref.preferenceLevel === 'dislike') {
      addContribution(negative, genres, 1, name);
    } else {
      addContribution(
        positive,
        genres,
        PREFERENCE_GENRE_WEIGHTS[pref.preferenceLevel],
        name,
      );
    }
  }

  const positiveEntries = toEntries(positive);
  return {
    positive: positiveEntries,
    negative: toEntries(negative, 1),
    isEmpty: positiveEntries.length === 0 && negative.size === 0,
  };
}

// ---------------------------------------------------------------------------
// Event artist fit
// ---------------------------------------------------------------------------

export interface GenreFitResult {
  /** 0..1 best weighted similarity to the user's positive taste. */
  similarity: number;
  /** Genre of the event artist that produced the match. */
  matchedGenre?: string;
  /** User taste genre it matched. */
  tasteGenre?: string;
  /** The user's own artist that this taste genre came from. */
  similarTo?: string;
  /** 0..1 strongest similarity to a genre the user explicitly dislikes. */
  dislikedGenreSimilarity: number;
  hasKnownGenres: boolean;
}

export function calculateGenreFit(
  eventArtistGenres: string[] | null | undefined,
  profile: GenreTasteProfile,
): GenreFitResult {
  const genres = Array.from(
    new Set((eventArtistGenres ?? []).map(normalizeGenre).filter(Boolean)),
  );
  const result: GenreFitResult = {
    similarity: 0,
    dislikedGenreSimilarity: 0,
    hasKnownGenres: genres.length > 0,
  };
  if (genres.length === 0 || profile.isEmpty) return result;

  for (const g of genres) {
    for (const entry of profile.positive) {
      const s = genreSimilarity(g, entry.genre) * entry.weight;
      if (s > result.similarity) {
        result.similarity = s;
        result.matchedGenre = g;
        result.tasteGenre = entry.genre;
        result.similarTo = entry.sourceArtist;
      }
    }
    for (const entry of profile.negative) {
      const s = genreSimilarity(g, entry.genre) * entry.weight;
      if (s > result.dislikedGenreSimilarity) {
        result.dislikedGenreSimilarity = s;
      }
    }
  }
  result.similarity = Math.round(result.similarity * 1000) / 1000;
  return result;
}
