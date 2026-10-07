// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HubThemeProvider } from '@/components/hub/HubThemeProvider';
import { HubHeader } from '@/components/hub/HubHeader';
import { SystemStatsGrid } from '@/components/hub/SystemStatsGrid';
import { NodeInspector } from '@/components/hub/NodeInspector';
import { ArchitectureNodeView } from '@/components/hub/ArchitectureNodeView';
import { CATEGORIES, NODES } from '@/lib/hub/architecture-data';
import { HUB_STATS } from '@/lib/hub/hub-stats';

describe('Project Hub Components', () => {
  describe('HubHeader', () => {
    it('renders observatory branding and search input', () => {
      const onSearchChange = vi.fn();
      const onCategorySelect = vi.fn();
      const categories = Object.values(CATEGORIES).map((c) => ({
        id: c.id,
        name: c.name,
      }));

      render(
        <HubThemeProvider>
          <HubHeader
            searchQuery=""
            onSearchChange={onSearchChange}
            selectedCategory={null}
            onCategorySelect={onCategorySelect}
            categories={categories}
          />
        </HubThemeProvider>,
      );

      expect(screen.getByText('Encore Observatory')).toBeInTheDocument();
      expect(screen.getByText('2D Map')).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText('Search architecture...'),
      ).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText('Search architecture...');
      fireEvent.change(searchInput, { target: { value: 'ticketmaster' } });
      expect(onSearchChange).toHaveBeenCalledWith('ticketmaster');
    });

    it('renders category filter chips and handles selection', () => {
      const onCategorySelect = vi.fn();
      const categories = Object.values(CATEGORIES).map((c) => ({
        id: c.id,
        name: c.name,
      }));

      render(
        <HubThemeProvider>
          <HubHeader
            searchQuery=""
            onSearchChange={vi.fn()}
            selectedCategory={null}
            onCategorySelect={onCategorySelect}
            categories={categories}
          />
        </HubThemeProvider>,
      );

      const sourcesButton = screen.getByRole('button', {
        name: 'External Sources',
      });
      fireEvent.click(sourcesButton);
      expect(onCategorySelect).toHaveBeenCalledWith('sources');
    });
  });

  describe('SystemStatsGrid', () => {
    it('renders verified CI suite and clearly labels illustrative preview counters', () => {
      render(<SystemStatsGrid stats={HUB_STATS} />);

      // Verified Health
      expect(
        screen.getByText('Verified Pipeline & Health'),
      ).toBeInTheDocument();
      expect(screen.getByText('VERIFIED IN CI')).toBeInTheDocument();
      expect(screen.getByText('86 / 86 PASS')).toBeInTheDocument();
      expect(screen.getByText('21 / 21 PASS')).toBeInTheDocument();

      // Illustrative previews
      expect(screen.getByText('Canonical Catalog')).toBeInTheDocument();
      expect(screen.getAllByText('SAMPLE PREVIEW').length).toBe(2);
    });
  });

  describe('NodeInspector', () => {
    const testNode = NODES.find((n) => n.id === 'artist_resolver')!;

    it('renders overview tab and docReference for selected node', () => {
      const onClose = vi.fn();
      render(
        <NodeInspector
          node={testNode}
          allNodes={NODES}
          onClose={onClose}
          onSelectNode={vi.fn()}
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'ArtistResolver' }),
      ).toBeInTheDocument();
      expect(screen.getByText('What is this?')).toBeInTheDocument();
      expect(
        screen.getByText(testNode.overview.plainEnglish),
      ).toBeInTheDocument();
      expect(
        screen.getByText(testNode.technical.docReference),
      ).toBeInTheDocument();
    });

    it('switches tabs and displays relationships, technical, and history information', () => {
      render(
        <NodeInspector
          node={testNode}
          allNodes={NODES}
          onClose={vi.fn()}
          onSelectNode={vi.fn()}
        />,
      );

      // Switch to Technical tab
      const techTab = screen.getByRole('button', { name: 'Technical' });
      fireEvent.click(techTab);
      expect(screen.getByText('Technical Summary')).toBeInTheDocument();
      expect(
        screen.getByText('lib/entity-resolution/artist-resolver.ts'),
      ).toBeInTheDocument();

      // Switch to Relationships tab
      const relTab = screen.getByRole('button', { name: /Relationships/ });
      fireEvent.click(relTab);
      expect(screen.getByText(/Upstream Inputs/)).toBeInTheDocument();
      expect(screen.getByText('Event Candidate Store')).toBeInTheDocument();

      // Switch to History tab
      const histTab = screen.getByRole('button', { name: 'History' });
      fireEvent.click(histTab);
      expect(screen.getByText('Introduced Milestone')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(
        <NodeInspector
          node={testNode}
          allNodes={NODES}
          onClose={onClose}
          onSelectNode={vi.fn()}
        />,
      );

      const closeBtn = screen.getByRole('button', { name: 'Close inspector' });
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('ArchitectureNodeView', () => {
    it('renders active status badge for implemented node and planned badge for planned node', () => {
      const implementedNode = NODES.find((n) => n.status === 'implemented')!;
      const plannedNode = NODES.find((n) => n.status === 'planned')!;

      const { container, rerender } = render(
        <svg>
          <ArchitectureNodeView
            node={implementedNode}
            isSelected={false}
            isConnected={false}
            isDimmed={false}
            currentZoomLevel={1}
            onSelect={vi.fn()}
          />
        </svg>,
      );

      expect(container.querySelector('text')?.textContent).toBeDefined();
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();

      rerender(
        <svg>
          <ArchitectureNodeView
            node={plannedNode}
            isSelected={false}
            isConnected={false}
            isDimmed={false}
            currentZoomLevel={1}
            onSelect={vi.fn()}
          />
        </svg>,
      );

      expect(screen.getByText('PLANNED')).toBeInTheDocument();
    });
  });
});
