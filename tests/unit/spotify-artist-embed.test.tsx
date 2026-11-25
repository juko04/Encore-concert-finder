// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SpotifyArtistEmbed } from '@/components/index/SpotifyArtistEmbed';
import {
  isValidSpotifyArtistId,
  spotifyArtistEmbedUrl,
} from '@/lib/spotify/embed';

describe('spotify embed helpers', () => {
  it('accepts only 22-character base-62 ids', () => {
    expect(isValidSpotifyArtistId('2MdFJmUQf3ckA99IhFF9my')).toBe(true);
    for (const bad of [
      '',
      'short',
      '2MdFJmUQf3ckA99IhFF9my1',
      '2MdFJmUQf3ckA99IhFF9m!',
      '../../evil',
      null,
      undefined,
      42,
    ]) {
      expect(isValidSpotifyArtistId(bad)).toBe(false);
    }
  });

  it('builds the official embed url only for a valid id', () => {
    expect(spotifyArtistEmbedUrl('2MdFJmUQf3ckA99IhFF9my')).toBe(
      'https://open.spotify.com/embed/artist/2MdFJmUQf3ckA99IhFF9my?utm_source=generator',
    );
    expect(spotifyArtistEmbedUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('SpotifyArtistEmbed', () => {
  it('renders a lazy, titled iframe for a verified id', () => {
    const { container, getByTestId } = render(
      <SpotifyArtistEmbed
        spotifyArtistId="2MdFJmUQf3ckA99IhFF9my"
        artistName="Ely Oaks"
      />,
    );
    expect(getByTestId('spotify-artist-embed')).toBeDefined();
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('title')).toBe('Listen to Ely Oaks on Spotify');
    expect(frame?.getAttribute('loading')).toBe('lazy');
    expect(frame?.getAttribute('src')).toContain(
      'open.spotify.com/embed/artist/2MdFJmUQf3ckA99IhFF9my',
    );
  });

  it('renders nothing without a valid id', () => {
    for (const id of [undefined, null, '', 'nope']) {
      const { container, unmount } = render(
        <SpotifyArtistEmbed spotifyArtistId={id} artistName="X" />,
      );
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });
});
