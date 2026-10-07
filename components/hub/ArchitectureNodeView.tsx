'use client';

import React from 'react';
import type { ArchitectureNode, ZoomLevel } from '@/lib/hub/architecture-model';
import { CATEGORIES } from '@/lib/hub/architecture-data';

interface ArchitectureNodeViewProps {
  node: ArchitectureNode;
  isSelected: boolean;
  isConnected: boolean;
  isDimmed: boolean;
  currentZoomLevel: ZoomLevel;
  onSelect: (node: ArchitectureNode) => void;
}

export function ArchitectureNodeView({
  node,
  isSelected,
  isConnected,
  isDimmed,
  currentZoomLevel,
  onSelect,
}: ArchitectureNodeViewProps) {
  const categoryMeta = CATEGORIES[node.category];
  const isPlanned = node.status === 'planned';

  // Node dimensions based on zoom level and content
  const width = 210;
  const height = currentZoomLevel >= 2 ? 80 : 64;

  const nodeColor = categoryMeta.colorDark;

  return (
    <g
      transform={`translate(${node.position.x}, ${node.position.y})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
      className={`cursor-pointer select-none transition-all duration-200 ${
        isDimmed ? 'opacity-30 hover:opacity-80' : 'opacity-100'
      }`}
      role="button"
      tabIndex={0}
      aria-label={`${node.name} (${node.status})`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(node);
        }
      }}
    >
      {/* Outer Glow on Selection or Connection */}
      {isSelected && (
        <rect
          x={-4}
          y={-4}
          width={width + 8}
          height={height + 8}
          rx={12}
          fill="none"
          stroke={nodeColor}
          strokeWidth={3}
          strokeOpacity={0.8}
          className="animate-pulse"
        />
      )}

      {isConnected && !isSelected && (
        <rect
          x={-2}
          y={-2}
          width={width + 4}
          height={height + 4}
          rx={10}
          fill="none"
          stroke={nodeColor}
          strokeWidth={1.5}
          strokeDasharray="4 2"
          strokeOpacity={0.9}
        />
      )}

      {/* Main Node Card Body */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={8}
        className={`fill-white transition-colors dark:fill-zinc-900 ${
          isSelected
            ? 'stroke-indigo-500 shadow-md'
            : isPlanned
              ? 'stroke-amber-500/60 dark:stroke-amber-400/50'
              : 'stroke-zinc-300 hover:stroke-zinc-400 dark:stroke-zinc-700/80 dark:hover:stroke-zinc-500'
        }`}
        strokeWidth={isPlanned ? 1.5 : 1}
        strokeDasharray={isPlanned ? '4 3' : 'none'}
      />

      {/* Left Semantic Category Color Bar */}
      <rect x={0} y={0} width={5} height={height} rx={3} fill={nodeColor} />

      {/* Status Pill Badge (Top Right) */}
      <g transform={`translate(${width - (isPlanned ? 68 : 46)}, 8)`}>
        <rect
          x={0}
          y={0}
          width={isPlanned ? 62 : 40}
          height={16}
          rx={4}
          className={
            isPlanned
              ? 'fill-amber-500/15 stroke-amber-500/30'
              : 'fill-emerald-500/10 stroke-emerald-500/20'
          }
          strokeWidth={1}
        />
        <text
          x={isPlanned ? 31 : 20}
          y={11}
          textAnchor="middle"
          className={`text-[9px] font-bold uppercase tracking-wider ${
            isPlanned
              ? 'fill-amber-600 dark:fill-amber-400'
              : 'fill-emerald-600 dark:fill-emerald-400'
          }`}
        >
          {isPlanned ? 'PLANNED' : 'ACTIVE'}
        </text>
      </g>

      {/* Category Mini Label */}
      <text
        x={14}
        y={19}
        className="fill-zinc-400 text-[9px] font-semibold uppercase tracking-wider dark:fill-zinc-400"
      >
        {categoryMeta.name}
      </text>

      {/* Node Display Name */}
      <text
        x={14}
        y={38}
        className="fill-zinc-900 text-[12px] font-semibold dark:fill-zinc-100"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        {node.name.length > 24 ? `${node.name.slice(0, 22)}…` : node.name}
      </text>

      {/* Progressive Detail: Short Description (Visible at Zoom >= 1) */}
      {currentZoomLevel >= 1 && (
        <text
          x={14}
          y={53}
          className="fill-zinc-500 text-[10px] dark:fill-zinc-400"
        >
          {node.shortDescription.length > 30
            ? `${node.shortDescription.slice(0, 28)}…`
            : node.shortDescription}
        </text>
      )}

      {/* Progressive Detail: Table / Function Indicator (Visible at Zoom >= 2) */}
      {currentZoomLevel >= 2 && node.technical.tableNames && (
        <g transform="translate(14, 62)">
          <text
            x={0}
            y={10}
            className="fill-indigo-600 font-mono text-[9px] font-medium dark:fill-indigo-400"
          >
            table: {node.technical.tableNames[0]}
          </text>
        </g>
      )}
    </g>
  );
}
