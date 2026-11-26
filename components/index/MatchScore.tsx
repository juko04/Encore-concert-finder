'use client';

import React from 'react';
import Link from 'next/link';
import { Popover } from '@base-ui/react/popover';
import type { IndexPersonalScore } from './types';
import { formatMatchScoreLabel } from './formatters';

/**
 * Compact match score: a small ring plus the number. The ring is split into the points each factor
 * contributes (artist, distance, price), so where the score comes from is visible at a glance.
 * Hovering or clicking opens the per-factor detail.
 */

const FACTORS = [
  { key: 'artist', label: 'Artist', color: '#18181b' }, // zinc-900
  { key: 'distance', label: 'Distance', color: '#71717a' }, // zinc-500
  { key: 'price', label: 'Price', color: '#d4d4d8' }, // zinc-300
] as const;

type FactorKey = (typeof FACTORS)[number]['key'];

interface FactorRow {
  key: FactorKey;
  label: string;
  color: string;
  score: number;
  weight: number | null;
  /** Points this factor adds to the match; null when the weight is unknown. */
  points: number | null;
  explanation: string;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function matchFactorRows(score: IndexPersonalScore): FactorRow[] {
  return FACTORS.flatMap(({ key, label, color }) => {
    const factor = score.factors?.[key];
    if (!factor) return [];
    const weight =
      typeof factor.weight === 'number' && Number.isFinite(factor.weight)
        ? factor.weight
        : null;
    // Same rounding as the scoring engine's weighted contribution.
    const points =
      weight === null ? null : Math.round((factor.score * weight) / 10) / 10;
    return [
      {
        key,
        label,
        color,
        score: factor.score,
        weight,
        points,
        explanation: factor.explanation,
      },
    ];
  });
}

function ScoreRing({
  rows,
  score,
  suppressed,
  size,
}: {
  rows: FactorRow[];
  score: number;
  suppressed: boolean;
  size: number;
}) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const hasPoints = rows.length > 0 && rows.every((row) => row.points !== null);
  const segments = suppressed
    ? []
    : hasPoints
      ? rows.map((row) => ({ color: row.color, value: row.points ?? 0 }))
      : [{ color: '#18181b', value: score }];

  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="shrink-0 -rotate-90"
    >
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="#f4f4f5"
        strokeWidth="3"
      />
      {segments.map((segment, index) => {
        const length = Math.max(0, Math.min(100, segment.value)) / 100;
        const dash = length * c;
        const el = (
          <circle
            key={index}
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke={segment.color}
            strokeWidth="3"
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-offset * c}
          />
        );
        offset += length;
        return el;
      })}
    </svg>
  );
}

export interface MatchScoreProps {
  personalScore: IndexPersonalScore;
  /** `md` for the concert page hero, `sm` for cards. */
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
}

export function MatchScore({
  personalScore,
  size = 'sm',
  className = '',
  'data-testid': testId = 'match-score',
}: MatchScoreProps) {
  const score = personalScore.score;
  const suppressed = Boolean(personalScore.isDisliked);
  const favorite = Boolean(personalScore.isFavorite);
  const rows = matchFactorRows(personalScore);
  const label = suppressed ? 'Hidden' : formatMatchScoreLabel(score);

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={100}
        data-testid={testId}
        className={`inline-flex items-center gap-1.5 rounded-full border bg-white font-semibold tabular-nums outline-none transition-[border-color,background-color,transform] duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-zinc-900/15 active:scale-[0.97] data-[popup-open]:border-zinc-400 [@media(hover:hover)]:hover:border-zinc-400 ${
          suppressed
            ? 'border-rose-200 text-rose-700'
            : favorite
              ? 'border-amber-200 text-amber-900'
              : 'border-zinc-200 text-zinc-800'
        } ${size === 'md' ? 'py-1 pl-1.5 pr-3 text-xs' : 'py-0.5 pl-1 pr-2 text-[11px]'} ${className}`}
        onClick={(e) => {
          // Cards are often wrapped in links; the score opens its details, not the card.
          e.stopPropagation();
        }}
      >
        <ScoreRing
          rows={rows}
          score={score}
          suppressed={suppressed}
          size={size === 'md' ? 18 : 15}
        />
        <span className="sr-only">Personalized match: </span>
        <span>{label}</span>
        <span className="sr-only">
          {suppressed ? ' (you disliked an artist on this bill)' : ''}. Show
          details
        </span>
        {favorite && !suppressed && (
          <span className="text-amber-600" aria-hidden="true">
            ★
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          className="z-[60]"
        >
          <Popover.Popup className="w-[18rem] max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-[0_8px_30px_rgba(0,0,0,0.08)] outline-none transition-[transform,opacity] duration-150 ease-out-strong data-[ending-style]:scale-[0.97] data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
            <Popover.Title className="flex items-baseline justify-between text-sm font-bold text-zinc-900">
              <span>
                {suppressed ? 'Hidden from your picks' : 'Your match'}
              </span>
              {!suppressed && (
                <span className="font-mono tabular-nums">{fmt(score)}%</span>
              )}
            </Popover.Title>

            {suppressed && (
              <p className="mt-1 text-xs text-zinc-500">
                You disliked an artist on this bill, so it scores 0.
              </p>
            )}
            {favorite && !suppressed && (
              <p className="mt-1 text-xs text-amber-800">
                A favorite artist headlines, so this is a top match.
              </p>
            )}

            {rows.length > 0 && (
              <ul
                className="mt-3 space-y-2.5"
                data-testid="match-score-factors"
              >
                {rows.map((row) => (
                  <li key={row.key}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800">
                        <span
                          className="h-2 w-2 rounded-full ring-1 ring-inset ring-black/5"
                          style={{ backgroundColor: row.color }}
                          aria-hidden="true"
                        />
                        {row.label}
                      </span>
                      <span className="font-mono tabular-nums text-zinc-900">
                        {row.points !== null
                          ? `+${fmt(row.points)}`
                          : `${row.score}/100`}
                      </span>
                    </div>
                    <p className="mt-0.5 pl-3.5 text-[11px] leading-snug text-zinc-500">
                      {row.explanation}
                      {row.weight !== null && (
                        <span className="text-zinc-400">
                          {' '}
                          · {row.score}/100 × {row.weight}%
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 border-t border-zinc-100 pt-2.5">
              <Link
                href="/preferences"
                className="text-[11px] font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                Change what counts →
              </Link>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
