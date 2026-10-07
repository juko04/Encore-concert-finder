'use client';

import React from 'react';
import type { HubStatsData } from '@/lib/hub/architecture-model';
import { DatabaseIcon, InfoIcon, LayersIcon, ShieldCheckIcon } from './icons';

interface SystemStatsGridProps {
  stats: HubStatsData;
}

export function SystemStatsGrid({ stats }: SystemStatsGridProps) {
  const healthStats = stats.items.filter((item) => item.category === 'health');
  const catalogStats = stats.items.filter(
    (item) => item.category === 'catalog',
  );
  const ingestionStats = stats.items.filter(
    (item) => item.category === 'ingestion',
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* Card 1: Verified System Health */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm transition dark:border-zinc-800/80 dark:bg-zinc-900/60">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheckIcon className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Verified Pipeline & Health
            </h2>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            VERIFIED IN CI
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {healthStats.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-zinc-500 dark:text-zinc-400">
                {item.label}
              </span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                <span>{item.value}</span>
                {item.change && (
                  <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                    ({item.change})
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-400 dark:border-zinc-800/40 dark:text-zinc-500">
            <span>Runtime Engine:</span>
            <span className="font-mono text-zinc-600 dark:text-zinc-300">
              Next.js {stats.runtimeInfo.nextVersion} • React{' '}
              {stats.runtimeInfo.reactVersion}
            </span>
          </div>
        </div>
      </div>

      {/* Card 2: Catalog Summary (Illustrative Data) */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm transition dark:border-zinc-800/80 dark:bg-zinc-900/60">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <DatabaseIcon className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Canonical Catalog
            </h2>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            title="Sample numbers for offline observatory preview. Real database metrics connect in Slice B."
          >
            <InfoIcon className="h-3 w-3" />
            SAMPLE PREVIEW
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {catalogStats.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-zinc-500 dark:text-zinc-400">
                {item.label}
              </span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                <span>{item.value}</span>
                {item.change && (
                  <span className="text-[10px] font-normal text-indigo-600 dark:text-indigo-400">
                    ({item.change})
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-400 dark:border-zinc-800/40 dark:text-zinc-500">
            <span>Deduplication Strategy:</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              Deterministic Entity Match
            </span>
          </div>
        </div>
      </div>

      {/* Card 3: Ingestion & Observations (Illustrative Data) */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-sm transition dark:border-zinc-800/80 dark:bg-zinc-900/60 sm:col-span-2 lg:col-span-1">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <LayersIcon className="h-3.5 w-3.5" />
            </div>
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Observation Pipeline
            </h2>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            title="Sample numbers for offline observatory preview. Real database metrics connect in Slice B."
          >
            <InfoIcon className="h-3 w-3" />
            SAMPLE PREVIEW
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {ingestionStats.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-zinc-500 dark:text-zinc-400">
                {item.label}
              </span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                <span>{item.value}</span>
                {item.change && (
                  <span className="text-[10px] font-normal text-purple-600 dark:text-purple-400">
                    ({item.change})
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-400 dark:border-zinc-800/40 dark:text-zinc-500">
            <span>Storage Invariant:</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              Immutable Append-Only Audit
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
