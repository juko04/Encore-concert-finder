'use client';

import React from 'react';
import type {
  ArchitectureEdge,
  ArchitectureNode,
  DetailLevel,
  ZoomLevel,
} from '@/lib/hub/architecture-model';

interface ArchitectureEdgeViewProps {
  edge: ArchitectureEdge;
  sourceNode: ArchitectureNode;
  targetNode: ArchitectureNode;
  isHighlighted: boolean;
  isDimmed: boolean;
  currentZoomLevel: ZoomLevel | DetailLevel;
  renderMode?: 'all' | 'path' | 'label';
  onSelect?: (edge: ArchitectureEdge) => void;
}

export function ArchitectureEdgeView({
  edge,
  sourceNode,
  targetNode,
  isHighlighted,
  isDimmed,
  currentZoomLevel,
  renderMode = 'all',
  onSelect,
}: ArchitectureEdgeViewProps) {
  const nodeWidth = 210;
  const nodeHeight = currentZoomLevel >= 2 ? 80 : 64;

  const isVertical =
    Math.abs(sourceNode.position.x - targetNode.position.x) < 40;

  // Source & Target coordinates
  let sx: number;
  let sy: number;
  let tx: number;
  let ty: number;
  let pathD: string;
  let arrowPoints: string;

  if (isVertical) {
    // Top-to-bottom connection in same column
    sx = sourceNode.position.x + nodeWidth / 2;
    sy = sourceNode.position.y + nodeHeight;
    tx = targetNode.position.x + nodeWidth / 2;
    ty = targetNode.position.y;
    const dy = Math.abs(ty - sy) * 0.5;
    pathD = `M ${sx} ${sy} C ${sx} ${sy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`;
    arrowPoints = `${tx},${ty} ${tx - 4},${ty - 7} ${tx + 4},${ty - 7}`;
  } else {
    // Horizontal connection (left to right)
    sx = sourceNode.position.x + nodeWidth;
    sy = sourceNode.position.y + nodeHeight / 2;
    tx = targetNode.position.x;
    ty = targetNode.position.y + nodeHeight / 2;
    const dx = Math.abs(tx - sx) * 0.5;
    pathD = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
    arrowPoints = `${tx},${ty} ${tx - 7},${ty - 4} ${tx - 7},${ty + 4}`;
  }

  const isPlanned = edge.status === 'planned';
  const isLevelVisible =
    sourceNode.minZoomLevel <= currentZoomLevel &&
    targetNode.minZoomLevel <= currentZoomLevel;

  const labelX = (sx + tx) / 2;
  const labelY = (sy + ty) / 2;
  const labelText = edge.label || '';
  const labelWidth = Math.max(50, labelText.length * 5.5 + 14);

  return (
    <g
      className={`select-none transition-all duration-300 ease-in-out ${
        !isLevelVisible
          ? 'pointer-events-none opacity-0'
          : isDimmed
            ? 'opacity-20'
            : 'opacity-100'
      }`}
      onClick={(e) => {
        if (onSelect) {
          e.stopPropagation();
          onSelect(edge);
        }
      }}
    >
      {/* PATH & ARROW LAYER */}
      {(renderMode === 'all' || renderMode === 'path') && (
        <>
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
            points={arrowPoints}
            className={
              isHighlighted
                ? 'fill-indigo-500 dark:fill-indigo-400'
                : isPlanned
                  ? 'fill-amber-400 dark:fill-amber-500'
                  : 'fill-zinc-400 dark:fill-zinc-600'
            }
          />
        </>
      )}

      {/* LABEL LAYER (Renders above paths and nodes for 100% legibility) */}
      {(renderMode === 'all' || renderMode === 'label') &&
        currentZoomLevel >= 1 &&
        labelText && (
          <g
            transform={`translate(${labelX}, ${labelY})`}
            className="pointer-events-auto cursor-pointer"
          >
            {/* Pill Background with subtle border and crisp fill to mask underlying paths */}
            <rect
              x={-(labelWidth / 2)}
              y={-9}
              width={labelWidth}
              height={18}
              rx={4}
              className={`transition-colors ${
                isHighlighted
                  ? 'fill-indigo-50 stroke-indigo-400 shadow-sm dark:fill-zinc-900 dark:stroke-indigo-500'
                  : 'fill-white stroke-zinc-200/90 shadow-sm dark:fill-zinc-950 dark:stroke-zinc-800'
              }`}
              strokeWidth={1}
            />
            <text
              x={0}
              y={3.5}
              textAnchor="middle"
              className={`font-mono text-[8.5px] font-medium tracking-tight ${
                isHighlighted
                  ? 'fill-indigo-600 font-semibold dark:fill-indigo-300'
                  : 'fill-zinc-600 dark:fill-zinc-300'
              }`}
            >
              {labelText}
            </text>
          </g>
        )}
    </g>
  );
}
