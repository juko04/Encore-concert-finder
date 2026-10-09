'use client';

import React from 'react';
import type {
  ArchitectureNode,
  DetailLevel,
  ZoomLevel,
} from '@/lib/hub/architecture-model';
import { CATEGORIES } from '@/lib/hub/architecture-data';

interface ArchitectureNodeViewProps {
  node: ArchitectureNode;
  isSelected: boolean;
  isConnected: boolean;
  isDimmed: boolean;
  currentZoomLevel: ZoomLevel | DetailLevel;
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

  // Node dimensions based on detail level
  const width = 210;
  const height = currentZoomLevel >= 2 ? 80 : 64;

  const nodeColor = categoryMeta.colorDark;
  const isLevelVisible = node.minZoomLevel <= currentZoomLevel;

  return (
    <g
      transform={`translate(${node.position.x}, ${node.position.y})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
      className={`group cursor-pointer select-none outline-none transition-all duration-300 ease-in-out focus:outline-none ${
        !isLevelVisible
          ? 'pointer-events-none opacity-0'
          : isDimmed
            ? 'opacity-30 hover:opacity-80'
            : 'opacity-100'
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
      {/* Keyboard Focus-Visible Ring (Visible ONLY for keyboard Tab users, never mouse clicks) */}
      <rect
        x={-5}
        y={-5}
        width={width + 10}
        height={height + 10}
        rx={13}
        fill="none"
        stroke="#6366f1"
        strokeWidth={2}
        strokeDasharray="4 3"
        className="pointer-events-none opacity-0 transition-opacity group-focus-visible:opacity-100"
      />

      {/* Category-Specific Selection Outer Glow */}
      {isSelected && (
        <rect
          x={-3}
          y={-3}
          width={width + 6}
          height={height + 6}
          rx={11}
          fill="none"
          stroke={nodeColor}
          strokeWidth={2}
          strokeOpacity={0.6}
        />
      )}

      {/* Connected Node Subtle Indicator */}
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
          strokeOpacity={0.8}
        />
      )}

      {/* Main Node Card Body - Strictly uses nodeColor on selection (NO generic blue outline) */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={8}
        className={`fill-white transition-colors dark:fill-zinc-900 ${
          !isSelected && !isPlanned
            ? 'stroke-zinc-300 hover:stroke-zinc-400 dark:stroke-zinc-700/80 dark:hover:stroke-zinc-500'
            : ''
        }`}
        stroke={
          isSelected
            ? nodeColor
            : isPlanned
              ? 'rgba(245, 158, 11, 0.6)'
              : undefined
        }
        strokeWidth={isSelected ? 2 : isPlanned ? 1.5 : 1}
        strokeDasharray={isPlanned && !isSelected ? '4 3' : 'none'}
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

      {/* Progressive Detail: Short Description (Visible at Detail Level >= 1) */}
      <text
        x={14}
        y={53}
        className={`fill-zinc-500 text-[10px] transition-opacity duration-300 dark:fill-zinc-400 ${
          currentZoomLevel >= 1 ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {node.shortDescription.length > 30
          ? `${node.shortDescription.slice(0, 28)}…`
          : node.shortDescription}
      </text>

      {/* Progressive Detail: Table / Function Indicator (Visible at Detail Level >= 2) */}
      {node.technical.tableNames && (
        <g
          transform="translate(14, 62)"
          className={`transition-opacity duration-300 ${
            currentZoomLevel >= 2 ? 'opacity-100' : 'opacity-0'
          }`}
        >
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
