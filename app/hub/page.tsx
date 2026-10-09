'use client';

import React, { useMemo, useState } from 'react';
import type { ArchitectureNode } from '@/lib/hub/architecture-model';
import {
  CATEGORIES,
  CLUSTERS,
  EDGES,
  NODES,
} from '@/lib/hub/architecture-data';
import { HUB_STATS } from '@/lib/hub/hub-stats';
import { HubHeader } from '@/components/hub/HubHeader';
import { ArchitectureMap } from '@/components/hub/ArchitectureMap';
import { NodeInspector } from '@/components/hub/NodeInspector';
import { SystemStatsGrid } from '@/components/hub/SystemStatsGrid';
import { CompassIcon, InfoIcon, ShieldCheckIcon } from '@/components/hub/icons';

export default function HubPage() {
  const [selectedNode, setSelectedNode] = useState<ArchitectureNode | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categoriesList = useMemo(() => {
    return Object.values(CATEGORIES).map((c) => ({ id: c.id, name: c.name }));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900 transition-colors dark:bg-zinc-950 dark:text-zinc-100">
      {/* 1. Header with Search, Filter & Theme Controls */}
      <HubHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onCategorySelect={setSelectedCategory}
        categories={categoriesList}
      />

      {/* 2. Main Dashboard Content */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
        {/* Observatory Intro Banner */}
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200/90 bg-white/80 p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600/10 text-indigo-600 dark:text-indigo-400">
                <CompassIcon className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                System Topology & Live Invariants
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Phase 1 Verified
              </span>
              <span>•</span>
              <span className="font-mono text-[11px]">
                86 Unit / 21 CI Integration Tests Passing
              </span>
            </div>
          </div>
          <p className="max-w-4xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Explore how raw concerts enter Encore, get normalized into immutable
            candidate observations, undergo deterministic entity resolution, and
            persist into PostgreSQL canonical catalog tables with granular
            field-level provenance evidence. Select any node to inspect its
            technical specification.
          </p>
        </section>

        {/* 3. The Architecture Map (Visual Centerpiece) */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Interactive 2D Architecture Canvas
            </h3>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Click nodes to open inspector • Pan & Zoom to explore detail
              levels
            </span>
          </div>

          <ArchitectureMap
            nodes={NODES}
            edges={EDGES}
            clusters={CLUSTERS}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
          />
        </section>

        {/* 4. Supporting Statistics & System Health */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              System Health & Inventory Preview
            </h3>
            <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <InfoIcon className="h-3 w-3" />
              Counters marked SAMPLE PREVIEW are illustrative for offline
              observatory preview
            </span>
          </div>

          <SystemStatsGrid stats={HUB_STATS} />
        </section>

        {/* 5. Observatory Footer */}
        <footer className="mt-auto flex flex-wrap items-center justify-between border-t border-zinc-200/80 pt-6 text-xs text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="h-4 w-4 text-emerald-500" />
            <span>
              Encore Internal Observatory • Read-Only Diagnostic Surface
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[11px]">
              Next.js {HUB_STATS.runtimeInfo.nextVersion} •{' '}
              {HUB_STATS.runtimeInfo.nodeRunner}
            </span>
            <a
              href="https://github.com/juko04/Encore-concert-finder"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              GitHub Repository
            </a>
          </div>
        </footer>
      </main>

      {/* 6. Sliding Tabbed Node Inspector */}
      <NodeInspector
        node={selectedNode}
        allNodes={NODES}
        onClose={() => setSelectedNode(null)}
        onSelectNode={(node) => setSelectedNode(node)}
      />
    </div>
  );
}
