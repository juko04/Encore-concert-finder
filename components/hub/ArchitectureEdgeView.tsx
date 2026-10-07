'use client';

import React from 'react';
import type {
  ArchitectureEdge,
  ArchitectureNode,
  ZoomLevel,
} from '@/lib/hub/architecture-model';

interface ArchitectureEdgeViewProps {
  edge: ArchitectureEdge;
  sourceNode: ArchitectureNode;
  targetNode: ArchitectureNode;
  isHighlighted: boolean;
  isDimmed: boolean;
  currentZoomLevel: ZoomLevel;
  onSelect?: (edge: ArchitectureEdge) => void;
}

export function ArchitectureEdgeView({
  edge,
  sourceNode,
  targetNode,
  isHighlighted,
  isDimmed,
  currentZoomLevel,
  onSelect,
}: ArchitectureEdgeViewProps) {
  const nodeWidth = 210;
  const nodeHeight = currentZoomLevel >= 2 ? 80 : 64;

  // Source attaches at right-middle of source node
  const sx = sourceNode.position.x + nodeWidth;
  const sy = sourceNode.position.y + nodeHeight / 2;

  // Target attaches at left-middle of target node
  const tx = targetNode.position.x;
  const ty = targetNode.position.y + nodeHeight / 2;

  // Horizontal cubic Bezier curve
  const dx = Math.abs(tx - sx) * 0.5;
  const pathD = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

  const isPlanned = edge.status === 'planned';

  return (
    <g
      className={`select-none transition-opacity duration-200 ${
        isDimmed ? 'opacity-20' : 'opacity-100'
      }`}
      onClick={(e) => {
        if (onSelect) {
          e.stopPropagation();
          onSelect(edge);
        }
      }}
    >
      {/* Background Wider Hit Area for Hover/Click */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        className="cursor-pointer"
      />

      {/* Main Connection Path Line */}
      <path
        d={pathD}
        fill="none"
        className={
          isHighlighted
            ? 'stroke-indigo-500 dark:stroke-indigo-400'
            : isPlanned
              ? 'stroke-amber-400/50 dark:stroke-amber-500/40'
              : 'stroke-zinc-300 hover:stroke-zinc-400 dark:stroke-zinc-700/80 dark:hover:stroke-zinc-500'
        }
        strokeWidth={isHighlighted ? 2.5 : 1.5}
        strokeDasharray={isPlanned ? '4 3' : 'none'}
      />

      {/* Directional Arrow Head at Target */}
      <polygon
        points={`${tx},${ty} ${tx - 7},${ty - 4} ${tx - 7},${ty + 4}`}
        className={
          isHighlighted
            ? 'fill-indigo-500 dark:fill-indigo-400'
            : isPlanned
              ? 'fill-amber-400 dark:fill-amber-500'
              : 'fill-zinc-400 dark:fill-zinc-600'
        }
      />

      {/* Edge Relationship Label (Visible at Zoom >= 1) */}
      {currentZoomLevel >= 1 && edge.label && (
        <g transform={`translate(${(sx + tx) / 2}, ${(sy + ty) / 2})`}>
          <rect
            x={-(edge.label.length * 2.8 + 6)}
            y={-9}
            width={edge.label.length * 5.6 + 12}
            height={16}
            rx={4}
            className="fill-white/90 stroke-zinc-200 dark:fill-zinc-950/90 dark:stroke-zinc-800"
            strokeWidth={1}
          />
          <text
            x={0}
            y={3}
            textAnchor="middle"
            className={`font-mono text-[8.5px] font-medium tracking-tight ${
              isHighlighted
                ? 'fill-indigo-600 font-semibold dark:fill-indigo-400'
                : 'fill-zinc-500 dark:fill-zinc-400'
            }`}
          >
            {edge.label}
          </text>
        </g>
      )}
    </g>
  );
}
