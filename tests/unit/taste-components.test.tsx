// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PreferenceLevelBadge } from '@/components/taste/PreferenceLevelBadge';
import { ArtistPreferenceCard } from '@/components/taste/ArtistPreferenceCard';
import { GuestTastePrompt } from '@/components/taste/GuestTastePrompt';
import { ArtistSearchInput } from '@/components/taste/ArtistSearchInput';
import { LoginForm } from '@/components/auth/LoginForm';
import { TasteProfileManager } from '@/components/taste/TasteProfileManager';
import type { UserArtistPreference } from '@/lib/domain/user-preference';

vi.mock('@/app/profile/taste/actions', () => ({
  savePreferenceAction: vi.fn(),
  updatePreferenceLevelAction: vi.fn(),
  deletePreferenceAction: vi.fn(),
  searchCatalogArtistsAction: vi.fn().mockResolvedValue({ artists: [] }),
  getSpotifyStatusAction: vi
    .fn()
    .mockResolvedValue({ connected: false, configured: true }),
  disconnectSpotifyAction: vi.fn().mockResolvedValue({ success: true }),
  getSpotifyTopArtistsAction: vi
    .fn()
    .mockImplementation(async (timeRange: string, isDemo?: boolean) => {
      if (isDemo) {
        return {
          artists: [
            {
              id: 'synth-chappell-roan',
              name: 'Chappell Roan',
              genres: ['pop', 'indie pop'],
              imageUrl: 'https://images.example.com/chappell.jpg',
              popularity: 88,
              trend: 'rising',
              timeRange: 'short_term',
            },
          ],
          isSyntheticPreview: true,
        };
      }
      return { artists: [], isSyntheticPreview: false };
    }),
}));

describe('Taste UI Components', () => {
  describe('PreferenceLevelBadge', () => {
    it('renders all four preference levels with distinct badges', () => {
      const { rerender } = render(<PreferenceLevelBadge level="favorite" />);
      expect(screen.getByTestId('badge-favorite')).toHaveTextContent(
        'Favorite',
      );

      rerender(<PreferenceLevelBadge level="like" />);
      expect(screen.getByTestId('badge-like')).toHaveTextContent('Like');

      rerender(<PreferenceLevelBadge level="interested" />);
      expect(screen.getByTestId('badge-interested')).toHaveTextContent(
        'Interested',
      );

      rerender(<PreferenceLevelBadge level="dislike" />);
      expect(screen.getByTestId('badge-dislike')).toHaveTextContent('Dislike');
    });
  });

  describe('ArtistPreferenceCard', () => {
    const mockCanonicalPref: UserArtistPreference = {
      id: 'pref-1',
      userId: 'user-1',
      artistId: 'artist-radiohead',
      artistName: 'Radiohead',
      normalizedArtistName: 'radiohead',
      preferenceLevel: 'favorite',
      createdAt: '2026-10-14T00:00:00Z',
      updatedAt: '2026-10-14T00:00:00Z',
      canonicalArtist: {
        id: 'artist-radiohead',
        name: 'Radiohead',
        imageUrl: 'https://images.example.com/radiohead.jpg',
      },
    };

    const mockUncatalogedPref: UserArtistPreference = {
      id: 'pref-2',
      userId: 'user-1',
      artistId: null,
      artistName: 'My Friends Band',
      normalizedArtistName: 'my friends band',
      preferenceLevel: 'interested',
      createdAt: '2026-10-14T00:00:00Z',
      updatedAt: '2026-10-14T00:00:00Z',
    };

    it('renders canonical artist card with "In Catalog" badge and image', () => {
      const onUpdateLevel = vi.fn();
      const onDelete = vi.fn();

      render(
        <ArtistPreferenceCard
          preference={mockCanonicalPref}
          onUpdateLevel={onUpdateLevel}
          onDelete={onDelete}
        />,
      );

      expect(screen.getByTestId('artist-name-pref-1')).toHaveTextContent(
        'Radiohead',
      );
      expect(screen.getByTestId('catalog-badge-pref-1')).toHaveTextContent(
        'In Catalog',
      );
      expect(screen.getByTestId('badge-favorite')).toBeInTheDocument();
    });

    it('renders uncataloged artist card with "Not in Catalog" badge', () => {
      const onUpdateLevel = vi.fn();
      const onDelete = vi.fn();

      render(
        <ArtistPreferenceCard
          preference={mockUncatalogedPref}
          onUpdateLevel={onUpdateLevel}
          onDelete={onDelete}
        />,
      );

      expect(screen.getByTestId('artist-name-pref-2')).toHaveTextContent(
        'My Friends Band',
      );
      expect(screen.getByTestId('catalog-badge-pref-2')).toHaveTextContent(
        'Not in Catalog',
      );
      expect(screen.getByTestId('badge-interested')).toBeInTheDocument();
    });

    it('triggers onUpdateLevel when preference level is changed in select', () => {
      const onUpdateLevel = vi.fn();
      const onDelete = vi.fn();

      render(
        <ArtistPreferenceCard
          preference={mockCanonicalPref}
          onUpdateLevel={onUpdateLevel}
          onDelete={onDelete}
        />,
      );

      const select = screen.getByTestId('select-level-pref-1');
      fireEvent.change(select, { target: { value: 'like' } });

      expect(onUpdateLevel).toHaveBeenCalledWith(mockCanonicalPref, 'like');
    });

    it('triggers onDelete when trash button is clicked', () => {
      const onUpdateLevel = vi.fn();
      const onDelete = vi.fn();

      render(
        <ArtistPreferenceCard
          preference={mockCanonicalPref}
          onUpdateLevel={onUpdateLevel}
          onDelete={onDelete}
        />,
      );

      const deleteBtn = screen.getByTestId('delete-pref-btn-pref-1');
      fireEvent.click(deleteBtn);

      expect(onDelete).toHaveBeenCalledWith('pref-1');
    });
  });

  describe('GuestTastePrompt', () => {
    it('renders explanation of music taste and link to sign in with redirect', () => {
      render(<GuestTastePrompt />);

      expect(
        screen.getByText('Curate Your Live Music Taste'),
      ).toBeInTheDocument();
      expect(screen.getByText('Favorite')).toBeInTheDocument();
      expect(screen.getByText('Like')).toBeInTheDocument();
      expect(screen.getByText('Interested')).toBeInTheDocument();
      expect(screen.getByText('Dislike')).toBeInTheDocument();

      const signinBtn = screen.getByTestId('guest-signin-btn');
      expect(signinBtn).toHaveAttribute(
        'href',
        '/login?redirectTo=/profile/taste',
      );
    });
  });

  describe('ArtistSearchInput', () => {
    it('renders input and provides custom artist addition when query is typed', () => {
      const onSelect = vi.fn();
      render(<ArtistSearchInput onSelectArtist={onSelect} />);

      const input = screen.getByTestId('artist-search-input');
      fireEvent.change(input, { target: { value: 'New Wave Band' } });

      expect(input).toHaveValue('New Wave Band');
      expect(screen.getByTestId('clear-search-btn')).toBeInTheDocument();

      const customAddBtn = screen.getByTestId('add-custom-artist-btn');
      expect(customAddBtn).toBeInTheDocument();

      fireEvent.click(customAddBtn);
      expect(onSelect).toHaveBeenCalledWith({
        id: null,
        name: 'New Wave Band',
      });
    });

    it('clears query when clear button is clicked', () => {
      const onSelect = vi.fn();
      render(<ArtistSearchInput onSelectArtist={onSelect} />);

      const input = screen.getByTestId('artist-search-input');
      fireEvent.change(input, { target: { value: 'The Cure' } });

      const clearBtn = screen.getByTestId('clear-search-btn');
      fireEvent.click(clearBtn);

      expect(input).toHaveValue('');
    });
  });

  describe('LoginForm', () => {
    it('switches between Sign In and Create Account modes', () => {
      render(<LoginForm redirectTo="/profile/taste" />);

      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Sign In',
      );

      // Click Create Account tab
      fireEvent.click(screen.getByTestId('tab-signup'));

      expect(screen.getByText('Create an Account')).toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Create Account',
      );

      // Click Sign In tab
      fireEvent.click(screen.getByTestId('tab-signin'));

      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
      expect(screen.getByTestId('auth-submit-btn')).toHaveTextContent(
        'Sign In',
      );
    });
  });

  describe('TasteProfileManager', () => {
    it('renders empty view when user has no preferences', () => {
      render(
        <TasteProfileManager
          initialPreferences={[]}
          userEmail="user@example.com"
        />,
      );

      expect(screen.getByTestId('empty-preferences-view')).toBeInTheDocument();
      expect(
        screen.getByText('No artist preferences added yet'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('filter-tab-all')).toHaveTextContent('All (0)');
    });

    it('renders populated preference cards and correct count on filter tabs', () => {
      const mockPref: UserArtistPreference = {
        id: 'pref-foo',
        userId: 'user-foo',
        artistId: null,
        artistName: 'Tycho',
        normalizedArtistName: 'tycho',
        preferenceLevel: 'favorite',
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
      };

      render(
        <TasteProfileManager
          initialPreferences={[mockPref]}
          userEmail="user@example.com"
        />,
      );

      expect(
        screen.queryByTestId('empty-preferences-view'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('artist-name-pref-foo')).toHaveTextContent(
        'Tycho',
      );
      expect(screen.getByTestId('filter-tab-all')).toHaveTextContent('All (1)');
      expect(screen.getByTestId('filter-tab-favorite')).toHaveTextContent(
        'Favorites (1)',
      );
      expect(screen.getByTestId('filter-tab-like')).toHaveTextContent(
        'Liked (0)',
      );
    });

    it('isolates simulated demo preferences into a dedicated container and clears them on exit', async () => {
      const mockPref: UserArtistPreference = {
        id: 'pref-real',
        userId: 'user-foo',
        artistId: null,
        artistName: 'Tycho',
        normalizedArtistName: 'tycho',
        preferenceLevel: 'favorite',
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
      };

      render(
        <TasteProfileManager
          initialPreferences={[mockPref]}
          userEmail="user@example.com"
        />,
      );

      // Open interactive preview
      const previewToggle = screen.getByTestId('toggle-preview-mode-btn');
      fireEvent.click(previewToggle);

      // Verify preview container is visible
      expect(screen.getByTestId('spotify-taste-preview')).toBeInTheDocument();

      // Wait for synthetic artists to load
      await waitFor(() => {
        expect(
          screen.getByTestId('import-artist-btn-synth-chappell-roan'),
        ).toBeInTheDocument();
      });

      // Find and import Chappell Roan
      const importBtn = screen.getByTestId(
        'import-artist-btn-synth-chappell-roan',
      );
      fireEvent.click(importBtn);

      const confirmBtn = screen.getByTestId(
        'confirm-import-btn-synth-chappell-roan',
      );
      fireEvent.click(confirmBtn);

      // Dedicated simulated demo container must now be visible with simulated selection
      const demoContainer = screen.getByTestId(
        'simulated-demo-preferences-container',
      );
      expect(demoContainer).toBeInTheDocument();
      expect(demoContainer).toHaveTextContent('Interactive Preview Simulation');
      expect(demoContainer).toHaveTextContent('Chappell Roan');

      // Real preference count should still be 1 ('All (1)'), keeping real preferences isolated
      expect(screen.getByTestId('filter-tab-all')).toHaveTextContent('All (1)');

      // Toggling preview mode off clears simulated selections
      fireEvent.click(previewToggle);
      expect(
        screen.queryByTestId('simulated-demo-preferences-container'),
      ).not.toBeInTheDocument();
    });
  });
});
