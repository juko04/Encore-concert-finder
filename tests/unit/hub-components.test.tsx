// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HubThemeProvider } from '@/components/hub/HubThemeProvider';
import { HubHeader } from '@/components/hub/HubHeader';
import { SystemStatsGrid } from '@/components/hub/SystemStatsGrid';
import { NodeInspector } from '@/components/hub/NodeInspector';
import { ArchitectureNodeView } from '@/components/hub/ArchitectureNodeView';
import { ArchitectureMap } from '@/components/hub/ArchitectureMap';
import {
  CATEGORIES,
  CLUSTERS,
  EDGES,
  NODES,
} from '@/lib/hub/architecture-data';
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

      expect(
        screen.getByRole('heading', { name: 'Encore Project Hub' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Observatory')).toBeInTheDocument();
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

    it('constrains desktop width to supporting contextual panel (~380px)', () => {
      const { container } = render(
        <NodeInspector
          node={testNode}
          allNodes={NODES}
          onClose={vi.fn()}
          onSelectNode={vi.fn()}
        />,
      );

      const aside = container.querySelector('aside');
      expect(aside?.className).toContain('sm:w-[380px]');
      expect(aside?.className).toContain('sm:max-w-[400px]');
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

    it('uses category-specific color on selection without generic blue outline', () => {
      const entityNode = NODES.find((n) => n.category === 'entity_resolution')!;
      const categoryMeta = CATEGORIES[entityNode.category];

      const { container } = render(
        <svg>
          <ArchitectureNodeView
            node={entityNode}
            isSelected={true}
            isConnected={false}
            isDimmed={false}
            currentZoomLevel={1}
            onSelect={vi.fn()}
          />
        </svg>,
      );

      // Card body rect must have stroke matching category color, and not generic stroke-indigo-500
      const rects = container.querySelectorAll('rect');
      const cardBody = Array.from(rects).find(
        (r) => r.getAttribute('rx') === '8',
      );
      expect(cardBody).toBeDefined();
      expect(cardBody?.getAttribute('stroke')).toBe(categoryMeta.colorDark);
      expect(cardBody?.getAttribute('class')).not.toContain(
        'stroke-indigo-500',
      );
    });
  });

  describe('ArchitectureMap', () => {
    it('decouples detail level selection from camera zoom scale', () => {
      render(
        <ArchitectureMap
          nodes={NODES}
          edges={EDGES}
          clusters={CLUSTERS}
          selectedNode={null}
          onSelectNode={vi.fn()}
          searchQuery=""
          selectedCategory={null}
        />,
      );

      // Initial camera zoom percent
      expect(screen.getByText('95%')).toBeInTheDocument();

      // Click L3 Schemas detail level
      const l3Btn = screen.getByRole('button', { name: 'L3 Schemas' });
      fireEvent.click(l3Btn);

      // Camera scale must remain 95% (unchanged by detail level selection)
      expect(screen.getByText('95%')).toBeInTheDocument();

      // Click L0 Systems detail level
      const l0Btn = screen.getByRole('button', { name: 'L0 Systems' });
      fireEvent.click(l0Btn);

      // Camera scale must still remain 95%
      expect(screen.getByText('95%')).toBeInTheDocument();

      // Click Zoom In button
      const zoomInBtn = screen.getByRole('button', { name: 'Zoom in' });
      fireEvent.click(zoomInBtn);

      // Camera scale must update to 120%
      expect(screen.getByText('120%')).toBeInTheDocument();

      // Active detail level button remains L0 Systems
      expect(l0Btn.className).toContain('bg-indigo-600');
    });
  });
});
