import React from 'react';
import { spotifyArtistEmbedUrl } from '@/lib/spotify/embed';

interface SpotifyArtistEmbedProps {
  /** Verified Spotify artist id from the catalog. Renders nothing when missing or malformed. */
  spotifyArtistId?: string | null;
  artistName: string;
}

/**
 * Short listen to the headliner's popular songs, via Spotify's official embedded player.
 * Lazy-loaded so it never affects first paint; no fake player when there is no verified id.
 */
export function SpotifyArtistEmbed({
  spotifyArtistId,
  artistName,
}: SpotifyArtistEmbedProps) {
  const src = spotifyArtistId ? spotifyArtistEmbedUrl(spotifyArtistId) : null;
  if (!src) return null;

  return (
    <div className="space-y-2" data-testid="spotify-artist-embed">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Listen
      </h2>
      <iframe
        title={`Listen to ${artistName} on Spotify`}
        src={src}
        width="100%"
        height="152"
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="rounded-xl border-0"
      />
      <p className="text-[11px] text-zinc-400">
        Popular songs by {artistName}, played by Spotify.
      </p>
    </div>
  );
}
