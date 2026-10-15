// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpotifyConnectionCard } from '@/components/taste/SpotifyConnectionCard';
import { SpotifyTastePreview } from '@/components/taste/SpotifyTastePreview';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

describe('Spotify UI Components', () => {
  describe('SpotifyConnectionCard', () => {
    it('renders disconnected state with connect link and preview toggle', () => {
      const onToggle = vi.fn();
      const onDisconnect = vi.fn();

      render(
        <SpotifyConnectionCard
          connected={false}
          isConfigured={true}
          isSyntheticDemo={false}
          onToggleDemoMode={onToggle}
          onDisconnect={onDisconnect}
        />,
      );

      expect(screen.getByTestId('spotify-connection-card')).toBeDefined();
      expect(screen.getByTestId('spotify-disconnected-badge')).toBeDefined();

      const connectBtn = screen.getByTestId('connect-spotify-btn');
      expect(connectBtn.getAttribute('href')).toBe(
        '/api/integrations/spotify/connect',
      );

      const previewBtn = screen.getByTestId('toggle-preview-mode-btn');
      expect(previewBtn.textContent).toContain('Interactive Preview');

      fireEvent.click(previewBtn);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders preview mode badge when isSyntheticDemo is true', () => {
      render(
        <SpotifyConnectionCard
          connected={false}
          isConfigured={true}
          isSyntheticDemo={true}
          onToggleDemoMode={vi.fn()}
          onDisconnect={vi.fn()}
        />,
      );

      expect(screen.getByTestId('spotify-demo-badge')).toBeDefined();
      expect(screen.getByTestId('spotify-demo-badge').textContent).toContain(
        'Preview Mode',
      );
    });

    it('renders connected state with account ID, sync time, and disconnect workflow', () => {
      const onDisconnect = vi.fn();

      render(
        <SpotifyConnectionCard
          connected={true}
          spotifyAccountId="spotify-user-12345"
          status="connected"
          lastSyncedAt="2026-10-15T12:00:00Z"
          isConfigured={true}
          isSyntheticDemo={false}
          onToggleDemoMode={vi.fn()}
          onDisconnect={onDisconnect}
        />,
      );

      expect(screen.getByTestId('spotify-connected-badge')).toBeDefined();
      expect(screen.getByTestId('spotify-account-id-label').textContent).toBe(
        'spotify-user-12345',
      );

      const disconnectBtn = screen.getByTestId('disconnect-spotify-btn');
      fireEvent.click(disconnectBtn);

      const confirmBtn = screen.getByTestId('confirm-disconnect-btn');
      fireEvent.click(confirmBtn);

      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('SpotifyTastePreview', () => {
    const mockArtists: SpotifyTopArtist[] = [
      {
        id: 'artist-1',
        name: 'Chappell Roan',
        rank: 1,
        imageUrl: 'https://example.com/chappell.jpg',
        spotifyUrl: 'https://open.spotify.com/artist/1',
        genres: ['pop', 'indie pop'],
        popularity: 92,
        trend: 'rising',
        timeRange: 'short_term',
      },
      {
        id: 'artist-2',
        name: 'Khruangbin',
        rank: 2,
        imageUrl: null,
        spotifyUrl: 'https://open.spotify.com/artist/2',
        genres: ['psychedelic funk'],
        popularity: 80,
        trend: 'consistent',
        timeRange: 'short_term',
      },
      {
        id: 'artist-3',
        name: 'Tame Impala',
        rank: 3,
        imageUrl: null,
        spotifyUrl: 'https://open.spotify.com/artist/3',
        genres: ['psychedelic rock'],
        popularity: 85,
        trend: 'fading',
        timeRange: 'short_term',
      },
    ];

    const mockPreferences: UserArtistPreference[] = [
      {
        id: 'pref-1',
        userId: 'user-1',
        artistId: null,
        archivedArtistId: null,
        artistName: 'Khruangbin',
        normalizedArtistName: 'khruangbin',
        preferenceLevel: 'favorite',
        createdAt: '2026-10-15T00:00:00Z',
        updatedAt: '2026-10-15T00:00:00Z',
      },
    ];

    it('renders time horizon tabs and recency hypothesis banner', () => {
      const onChangeRange = vi.fn();
      render(
        <SpotifyTastePreview
          artists={mockArtists}
          timeRange="short_term"
          onChangeTimeRange={onChangeRange}
          existingPreferences={[]}
          onAddPreference={vi.fn()}
        />,
      );

      expect(screen.getByTestId('spotify-taste-preview')).toBeDefined();
      expect(screen.getByTestId('recency-hypothesis-banner')).toBeDefined();

      const mediumTab = screen.getByTestId('tab-medium-term');
      fireEvent.click(mediumTab);
      expect(onChangeRange).toHaveBeenCalledWith('medium_term');

      const longTab = screen.getByTestId('tab-long-term');
      fireEvent.click(longTab);
      expect(onChangeRange).toHaveBeenCalledWith('long_term');
    });

    it('renders trend badges (rising, consistent, fading) and existing preference indicators', () => {
      render(
        <SpotifyTastePreview
          artists={mockArtists}
          timeRange="short_term"
          onChangeTimeRange={vi.fn()}
          existingPreferences={mockPreferences}
          onAddPreference={vi.fn()}
        />,
      );

      expect(screen.getByTestId('trend-badge-rising')).toBeDefined();
      expect(screen.getByTestId('trend-badge-consistent')).toBeDefined();
      expect(screen.getByTestId('trend-badge-fading')).toBeDefined();

      // Khruangbin is already saved as favorite
      const savedBadge = screen.getByTestId('already-saved-badge-artist-2');
      expect(savedBadge.textContent).toContain('★ Favorite');
    });

    it('allows user to intentionally add an unselected Spotify artist to live preferences', async () => {
      const onAdd = vi.fn().mockResolvedValue(undefined);

      render(
        <SpotifyTastePreview
          artists={mockArtists}
          timeRange="short_term"
          onChangeTimeRange={vi.fn()}
          existingPreferences={mockPreferences}
          onAddPreference={onAdd}
        />,
      );

      // Chappell Roan is not saved yet
      const importBtn = screen.getByTestId('import-artist-btn-artist-1');
      await React.act(async () => {
        fireEvent.click(importBtn);
      });

      const confirmBtn = screen.getByTestId('confirm-import-btn-artist-1');
      await React.act(async () => {
        fireEvent.click(confirmBtn);
      });

      expect(onAdd).toHaveBeenCalledWith('Chappell Roan', 'favorite');
    });
  });
});
