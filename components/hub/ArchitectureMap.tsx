'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ArchitectureCluster,
  ArchitectureEdge,
  ArchitectureNode,
  ZoomLevel,
} from '@/lib/hub/architecture-model';
import { CATEGORIES } from '@/lib/hub/architecture-data';
import { ArchitectureNodeView } from './ArchitectureNodeView';
import { ArchitectureEdgeView } from './ArchitectureEdgeView';
import { LayersIcon, ResetViewIcon, ZoomInIcon, ZoomOutIcon } from './icons';

interface ArchitectureMapProps {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  clusters: ArchitectureCluster[];
  selectedNode: ArchitectureNode | null;
  onSelectNode: (node: ArchitectureNode | null) => void;
  searchQuery: string;
  selectedCategory: string | null;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.4;
const HYSTERESIS = 0.04;

export function ArchitectureMap({
  nodes,
  edges,
  clusters,
  selectedNode,
  onSelectNode,
  searchQuery,
  selectedCategory,
}: ArchitectureMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(0.95);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 10, y: 10 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Progressive Zoom level with hysteresis to prevent edge flickering
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1);

  useEffect(() => {
    // Thresholds: L0 < 0.75, L1 in [0.75, 1.25), L2 in [1.25, 1.85), L3 >= 1.85
    let newLevel: ZoomLevel = zoomLevel;

    if (zoomLevel === 0) {
      if (zoom >= 0.75 + HYSTERESIS) newLevel = 1;
    } else if (zoomLevel === 1) {
      if (zoom < 0.75 - HYSTERESIS) newLevel = 0;
      else if (zoom >= 1.25 + HYSTERESIS) newLevel = 2;
    } else if (zoomLevel === 2) {
      if (zoom < 1.25 - HYSTERESIS) newLevel = 1;
      else if (zoom >= 1.85 + HYSTERESIS) newLevel = 3;
    } else if (zoomLevel === 3) {
      if (zoom < 1.85 - HYSTERESIS) newLevel = 2;
    }

    if (newLevel !== zoomLevel) {
      setZoomLevel(newLevel);
    }
  }, [zoom, zoomLevel]);

  // Compute connected nodes for selection illumination
  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const ids = new Set<string>();
    edges.forEach((edge) => {
      if (edge.sourceId === selectedNode.id) ids.add(edge.targetId);
      if (edge.targetId === selectedNode.id) ids.add(edge.sourceId);
    });
    return ids;
  }, [selectedNode, edges]);

  // Filter nodes based on search and category
  const filteredNodeIds = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q && !selectedCategory) return null;

    const ids = new Set<string>();
    nodes.forEach((n) => {
      const matchesCategory =
        !selectedCategory || n.category === selectedCategory;
      const matchesSearch =
        !q ||
        n.name.toLowerCase().includes(q) ||
        n.shortDescription.toLowerCase().includes(q) ||
        n.technical.tableNames?.some((t) => t.toLowerCase().includes(q)) ||
        n.technical.relevantFiles?.some((f) => f.toLowerCase().includes(q));

      if (matchesCategory && matchesSearch) {
        ids.add(n.id);
      }
    });
    return ids;
  }, [nodes, searchQuery, selectedCategory]);

  // Node lookup map
  const nodeMap = useMemo(() => {
    const map = new Map<string, ArchitectureNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  // Reset to default viewport
  const handleResetView = useCallback(() => {
    setZoom(0.95);
    setPan({ x: 10, y: 10 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, Number((z + 0.25).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, Number((z - 0.25).toFixed(2))));
  }, []);

  // Set explicit preset zoom level
  const handleSetPresetLevel = (level: ZoomLevel) => {
    const presets: Record<ZoomLevel, number> = {
      0: 0.65,
      1: 0.95,
      2: 1.45,
      3: 1.95,
    };
    setZoom(presets[level]);
  };

  // Pointer event handlers for panning
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only primary mouse button
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Wheel handling: ONLY zoom if Ctrl/Meta is pressed to avoid trapping standard page scrolling
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      setZoom((z) =>
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((z + delta).toFixed(2)))),
      );
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative h-[620px] w-full overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50/70 shadow-inner transition-colors dark:border-zinc-800 dark:bg-zinc-950/80"
      onWheel={handleWheel}
      onClick={() => onSelectNode(null)}
    >
      {/* Top Floating Control Bar */}
      <div
        className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Zoom In / Out / Reset */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomIn}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomInIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOutIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Reset / Fit View"
            aria-label="Reset view"
          >
            <ResetViewIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

        {/* Current Zoom Percent */}
        <span className="px-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {Math.round(zoom * 100)}%
        </span>

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

        {/* Progressive Zoom Level Selector */}
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase text-zinc-400 dark:text-zinc-500">
            <LayersIcon className="h-3 w-3" />
            Detail:
          </span>
          {[
            { level: 0 as ZoomLevel, label: 'L0 Systems' },
            { level: 1 as ZoomLevel, label: 'L1 Services' },
            { level: 2 as ZoomLevel, label: 'L2 Entities' },
            { level: 3 as ZoomLevel, label: 'L3 Schemas' },
          ].map((item) => (
            <button
              key={item.level}
              type="button"
              onClick={() => handleSetPresetLevel(item.level)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                zoomLevel === item.level
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Right Scroll Hint */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-lg border border-zinc-200/80 bg-white/90 px-2.5 py-1 text-[10px] text-zinc-500 shadow-sm backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:text-zinc-400">
        Drag to pan • Hold{' '}
        <kbd className="font-mono font-semibold">Ctrl / ⌘</kbd> + scroll to zoom
      </div>

      {/* Main SVG Pan/Zoom Canvas */}
      <svg
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Visual Grid Lines in Canvas Background */}
        <defs>
          <pattern
            id="hub-grid"
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 30 0 L 0 0 0 30"
              fill="none"
              className="stroke-zinc-200/50 dark:stroke-zinc-800/40"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hub-grid)" />

        {/* Viewport Transform Group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* 1. Cluster Region Backgrounds */}
          {clusters.map((cluster) => {
            const cat = CATEGORIES[cluster.category];
            return (
              <g key={cluster.id}>
                <rect
                  x={cluster.bounds.x}
                  y={cluster.bounds.y}
                  width={cluster.bounds.width}
                  height={cluster.bounds.height}
                  rx={16}
                  fill={cat.accentBgDark}
                  stroke={cat.borderColorDark}
                  strokeWidth={1}
                  strokeDasharray="6 4"
                  className="transition-colors"
                />
                <text
                  x={cluster.bounds.x + 14}
                  y={cluster.bounds.y + 24}
                  className="select-none fill-zinc-500 text-[12px] font-bold uppercase tracking-wider dark:fill-zinc-400"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                >
                  {cluster.name}
                </text>
              </g>
            );
          })}

          {/* 2. Edges / Relationship Paths */}
          {edges.map((edge) => {
            const sNode = nodeMap.get(edge.sourceId);
            const tNode = nodeMap.get(edge.targetId);
            if (!sNode || !tNode) return null;

            // Only show edge if both nodes are visible at current zoom level
            if (
              sNode.minZoomLevel > zoomLevel ||
              tNode.minZoomLevel > zoomLevel
            ) {
              return null;
            }

            const isHighlighted =
              selectedNode !== null &&
              (edge.sourceId === selectedNode.id ||
                edge.targetId === selectedNode.id);

            const isDimmed = selectedNode !== null && !isHighlighted;

            return (
              <ArchitectureEdgeView
                key={edge.id}
                edge={edge}
                sourceNode={sNode}
                targetNode={tNode}
                isHighlighted={isHighlighted}
                isDimmed={isDimmed}
                currentZoomLevel={zoomLevel}
              />
            );
          })}

          {/* 3. Nodes */}
          {nodes.map((node) => {
            // Progressive disclosure check: hide node if its minZoomLevel exceeds current level
            if (node.minZoomLevel > zoomLevel) {
              return null;
            }

            const isSelected = selectedNode?.id === node.id;
            const isConnected = connectedNodeIds.has(node.id);
            const isMatchesFilter = filteredNodeIds
              ? filteredNodeIds.has(node.id)
              : true;

            const isDimmed =
              (selectedNode !== null && !isSelected && !isConnected) ||
              !isMatchesFilter;

            return (
              <ArchitectureNodeView
                key={node.id}
                node={node}
                isSelected={isSelected}
                isConnected={isConnected}
                isDimmed={isDimmed}
                currentZoomLevel={zoomLevel}
                onSelect={(clicked) => onSelectNode(clicked)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
