'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import type { IndexEventItem } from './types';
import { toIndexEventItem } from './types';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import { EventCard } from './EventCard';
import { UndoToast } from './UndoToast';
import { useWatchlist } from './useWatchlist';
import { HeartIcon, BellIcon, ArrowRightIcon } from './icons';

export interface SavedWatchlistClientProps {
  events: Array<CanonicalEventSummary | ScoredEvent | IndexEventItem>;
  exploreHref?: string;
}

export function SavedWatchlistClient({
  events: rawEvents,
  exploreHref = '/search',
}: SavedWatchlistClientProps) {
  const normalizedEvents = useMemo(() => {
    return rawEvents.map(toIndexEventItem);
  }, [rawEvents]);

  const {
    savedIds,
    alertIds,
    isSaved,
    hasAlert,
    toggleSave,
    toggleAlert,
    undoStack,
    undo,
  } = useWatchlist();

  const [activeTab, setActiveTab] = useState<'saved' | 'alerts'>('saved');

  // Filter into saved vs alerted events
  const savedEvents = useMemo(() => {
    return normalizedEvents.filter((e) => savedIds.includes(e.id));
  }, [normalizedEvents, savedIds]);

  const alertEvents = useMemo(() => {
    return normalizedEvents.filter((e) => alertIds.includes(e.id));
  }, [normalizedEvents, alertIds]);

  const displayedEvents = activeTab === 'saved' ? savedEvents : alertEvents;

  // Presale and low-inventory count metrics
  const presaleAlertCount = useMemo(() => {
    return alertEvents.filter(
      (e) => Boolean(e.presaleDate) || e.inventoryStatus === 'low_inventory',
    ).length;
  }, [alertEvents]);

  const lowInventoryCount = useMemo(() => {
    return alertEvents.filter((e) => e.inventoryStatus === 'low_inventory')
      .length;
  }, [alertEvents]);

  return (
    <div className="space-y-8 pb-16">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
            <HeartIcon className="h-3.5 w-3.5 text-rose-500" filled />
            <span>Personal Watchlist & Alert Desk</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
            Saved Shows & Ticket Alerts
          </h1>
          <p className="mt-1 max-w-xl text-xs text-zinc-500 sm:text-sm">
            Track touring announcements, manage presale reminders, and keep tabs
            on low-inventory events before prices jump.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="shadow-2xs flex items-center self-start rounded-xl border border-zinc-200 bg-white p-1 sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
              activeTab === 'saved'
                ? 'shadow-xs bg-zinc-900 text-white'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <HeartIcon className="h-3.5 w-3.5" filled={activeTab === 'saved'} />
            <span>All Saved Shows ({savedEvents.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('alerts')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
              activeTab === 'alerts'
                ? 'shadow-xs bg-zinc-900 text-white'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <BellIcon className="h-3.5 w-3.5" filled={activeTab === 'alerts'} />
            <span>Active Alerts ({alertEvents.length})</span>
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="shadow-xs rounded-2xl border border-zinc-200/90 bg-white p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Total Watchlisted
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-zinc-900">
              {savedEvents.length}
            </span>
            <span className="text-xs text-zinc-500">shows pinned</span>
          </div>
        </div>

        <div className="shadow-xs rounded-2xl border border-zinc-200/90 bg-white p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Upcoming Presales
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-violet-700">
              {presaleAlertCount}
            </span>
            <span className="text-xs text-zinc-500">
              with notifications active
            </span>
          </div>
        </div>

        <div className="shadow-xs rounded-2xl border border-zinc-200/90 bg-white p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Low Inventory Notices
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-amber-700">
              {lowInventoryCount}
            </span>
            <span className="text-xs text-zinc-500">
              under 50 tickets remaining
            </span>
          </div>
        </div>
      </div>

      {/* Alert Notices Bar (when viewing alerts tab) */}
      {activeTab === 'alerts' && alertEvents.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 text-xs text-violet-900">
          <BellIcon
            className="mt-0.5 h-4 w-4 shrink-0 text-violet-600"
            filled
          />
          <div className="leading-relaxed">
            <span className="font-semibold">
              Automated Notification Status:{' '}
            </span>
            You will receive push reminders 30 minutes before artist presales
            launch and instant alerts if sold-out events release production
            tickets or partner holds.
          </div>
        </div>
      )}

      {/* Event Cards Display */}
      {displayedEvents.length === 0 ? (
        <div className="space-y-4 rounded-3xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
            {activeTab === 'saved' ? (
              <HeartIcon className="h-6 w-6" />
            ) : (
              <BellIcon className="h-6 w-6" />
            )}
          </div>
          <h2 className="text-base font-semibold text-zinc-900">
            {activeTab === 'saved'
              ? 'Your Watchlist is Empty'
              : 'No Active Alerts'}
          </h2>
          <p className="mx-auto max-w-sm text-xs text-zinc-500">
            {activeTab === 'saved'
              ? 'Click the heart button on any concert in the index to track it here.'
              : 'Click the bell icon on any concert to track presale dates and ticket availability.'}
          </p>
          <Link
            href={exploreHref}
            className="shadow-xs inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800"
          >
            <span>Explore Concert Catalog</span>
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={isSaved(event.id)}
              hasAlert={hasAlert(event.id)}
              onToggleSave={toggleSave}
              onToggleAlert={toggleAlert}
            />
          ))}
        </div>
      )}

      {/* Watchlist Undo Toast */}
      <UndoToast undoStack={undoStack} onUndo={undo} />
    </div>
  );
}
