/**
 * Spotify artist embed helpers (pure).
 *
 * Spotify no longer returns `preview_url` to new apps, so short listens use Spotify's official
 * embedded player for the artist (it plays the artist's popular tracks). Only a verified Spotify
 * artist id from our catalog is ever used; nothing is guessed from names.
 */

/** Spotify ids are 22 base-62 characters. */
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

export function isValidSpotifyArtistId(value: unknown): value is string {
  return typeof value === 'string' && SPOTIFY_ID_PATTERN.test(value);
}

export function spotifyArtistEmbedUrl(spotifyArtistId: string): string | null {
  if (!isValidSpotifyArtistId(spotifyArtistId)) return null;
  return `https://open.spotify.com/embed/artist/${spotifyArtistId}?utm_source=generator`;
}
