'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePrototypeStore } from '@/lib/prototypes/store';
import { SignalCard } from '@/components/prototypes/signal/SignalCard';

export default function WatchlistPage() {
  const { events, savedEventIds, alertEventIds } = usePrototypeStore();

  const [activeTab, setActiveTab] = useState<
    'all' | 'alerts' | 'presale' | 'inventory'
  >('all');

  const savedEvents = useMemo(() => {
    return events.filter((ev) => savedEventIds.includes(ev.id));
  }, [events, savedEventIds]);

  const alertedEvents = useMemo(() => {
    return events.filter((ev) => alertEventIds.includes(ev.id));
  }, [events, alertEventIds]);

  const displayedEvents = useMemo(() => {
    if (activeTab === 'alerts') {
      return alertedEvents;
    }
    if (activeTab === 'presale') {
      return savedEvents.filter((ev) => ev.ticketStatus === 'presale');
    }
    if (activeTab === 'inventory') {
      return savedEvents.filter(
        (ev) =>
          ev.ticketStatus === 'low_inventory' || ev.ticketStatus === 'sold_out',
      );
    }
    return savedEvents;
  }, [activeTab, savedEvents, alertedEvents]);

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-zinc-800/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-wider text-rose-400">
              Personal Watchlist & Active Radar
            </span>
            <span className="text-zinc-600">•</span>
            <span className="font-mono text-xs text-zinc-400">
              Real-Time Inventory & Drop Alerts
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Watchlist & Alerts
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Track shows you care about. Receive automated alerts on upcoming
            artist presales, low ticket inventory notices, and unexpected
            production ticket drops.
          </p>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-3 self-start rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs sm:self-auto">
          <div className="border-r border-zinc-800 pr-3">
            <span className="block text-[10px] text-zinc-500">
              Watched Shows
            </span>
            <span className="text-base font-bold text-white">
              {savedEvents.length}
            </span>
          </div>
          <div>
            <span className="block text-[10px] text-zinc-500">
              Active Alerts
            </span>
            <span className="text-base font-bold text-violet-400">
              {alertedEvents.length}
            </span>
          </div>
        </div>
      </div>

      {/* Live Ticker Alert Broadcast Preview */}
      <section className="rounded-2xl border border-violet-800/50 bg-gradient-to-r from-violet-950/40 via-zinc-900/70 to-zinc-900/40 p-4 backdrop-blur-md sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs font-bold text-violet-300">
            <span className="h-2 w-2 animate-ping rounded-full bg-violet-400" />
            <span>RADAR BROADCAST PREVIEW</span>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            Broadcasting on omnipresent top ticker
          </span>
        </div>

        <p className="mt-2 text-sm text-zinc-200">
          Shows marked with{' '}
          <strong className="text-violet-300">Active Alert</strong>{' '}
          automatically feed into the omnipresent ticker at the top of your
          screen, notifying you of time-sensitive presale registrations and
          inventory thresholds before general onsale.
        </p>
      </section>

      {/* Tabs */}
      <div className="scrollbar-none flex items-center gap-2 overflow-x-auto border-b border-zinc-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-mono text-xs font-medium transition-all active:scale-95 ${
            activeTab === 'all'
              ? 'bg-white font-bold text-zinc-950 shadow'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>All Watched</span>
          <span className="py-0.2 rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-300">
            {savedEvents.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('alerts')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-mono text-xs font-medium transition-all active:scale-95 ${
            activeTab === 'alerts'
              ? 'bg-violet-600 font-bold text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>🔔 Active Alerts</span>
          <span className="py-0.2 rounded-full border border-violet-800 bg-violet-950 px-1.5 text-[10px] text-violet-300">
            {alertedEvents.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('presale')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-mono text-xs font-medium transition-all active:scale-95 ${
            activeTab === 'presale'
              ? 'bg-amber-600 font-bold text-white shadow'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>⚡ Presale Watch</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-mono text-xs font-medium transition-all active:scale-95 ${
            activeTab === 'inventory'
              ? 'bg-rose-600 font-bold text-white shadow'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>⚠️ Low Inventory / Sold Out</span>
        </button>
      </div>

      {/* List of Shows */}
      {displayedEvents.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {displayedEvents.map((event) => (
            <SignalCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <span className="text-4xl">❤️</span>
          <h3 className="mt-3 text-lg font-bold text-white">
            No Watched Shows in this View
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            {savedEvents.length === 0
              ? 'You have not saved any concerts to your watchlist yet. Browse the Signal feed to find worthwhile shows.'
              : 'None of your saved shows currently match this filter tab.'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/prototypes/signal/explore"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-bold text-white shadow transition-all hover:bg-violet-500 active:scale-95"
            >
              <span>Explore Concerts</span>
              <span>&rarr;</span>
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
