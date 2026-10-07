'use client';

import React from 'react';
import Link from 'next/link';
import { useHubTheme } from './HubThemeProvider';
import { CompassIcon, MoonIcon, SearchIcon, SunIcon, XIcon } from './icons';

interface HubHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategory: string | null;
  onCategorySelect: (category: string | null) => void;
  categories: Array<{ id: string; name: string }>;
}

export function HubHeader({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategorySelect,
  categories,
}: HubHeaderProps) {
  const { theme, toggleTheme } = useHubTheme();

  return (
    <header className="border-b border-zinc-200/80 bg-white/90 backdrop-blur-md transition-colors dark:border-zinc-800/80 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Title */}
          <div className="flex items-center gap-3">
            <Link
              href="/discover"
              className="group flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              title="Return to consumer catalog"
            >
              <span>←</span>
              <span>Discover</span>
            </Link>

            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-500/20">
                <CompassIcon className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Encore Observatory
                  </h1>
                  <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                    Internal Hub
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Interactive Architecture Topology & Pipeline Metrics
                </p>
              </div>
            </div>
          </div>

          {/* Right Controls: Mode Badge, Search, Theme Toggle */}
          <div className="flex items-center gap-2.5">
            {/* View Mode Switcher */}
            <div className="hidden items-center rounded-lg border border-zinc-200 bg-zinc-100/70 p-0.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900 sm:flex">
              <span className="rounded-md bg-white px-2.5 py-1 text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
                2D Map
              </span>
              <span
                className="flex cursor-not-allowed items-center gap-1 px-2.5 py-1 text-zinc-400 dark:text-zinc-500"
                title="3D Constellation is planned for future release"
              >
                <span>3D Constellation</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-500">
                  (Planned)
                </span>
              </span>
            </div>

            {/* Search Input */}
            <div className="relative w-44 sm:w-64">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-zinc-400 dark:text-zinc-500">
                <SearchIcon className="h-3.5 w-3.5" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search architecture..."
                className="h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-8 pr-7 text-xs text-zinc-900 placeholder-zinc-400 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-indigo-400 dark:focus:bg-zinc-900"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  title="Clear search"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <SunIcon className="h-4 w-4 text-amber-400" />
              ) : (
                <MoonIcon className="h-4 w-4 text-indigo-600" />
              )}
            </button>
          </div>
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
          <span className="mr-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            Filter:
          </span>
          <button
            type="button"
            onClick={() => onCategorySelect(null)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
              selectedCategory === null
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            All Systems
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() =>
                onCategorySelect(selectedCategory === cat.id ? null : cat.id)
              }
              className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                selectedCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
