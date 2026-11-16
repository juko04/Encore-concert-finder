'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

export interface TickerAlertItem {
  id: string;
  type:
    | 'presale'
    | 'low_inventory'
    | 'top_match'
    | 'spontaneous'
    | 'sold_out'
    | 'free';
  tag: string;
  artist: string;
  venue: string;
  detail: string;
  metric: string;
  href: string;
  badgeClass: string;
  colorHex: string;
}

const TICKER_ITEMS: TickerAlertItem[] = [
  {
    id: 'ticker-cure',
    type: 'presale',
    tag: 'PRESALE ALERT',
    artist: 'The Cure',
    venue: 'Red Rocks Amphitheatre',
    detail: 'Artist Presale opens Thursday 10:00 AM MT',
    metric: '2d left · 98% Match',
    href: '/prototypes/signal/concerts/proto-ev-103',
    badgeClass: 'bg-violet-950/80 text-violet-300 border-violet-700/60',
    colorHex: '#8B5CF6',
  },
  {
    id: 'ticker-hania',
    type: 'low_inventory',
    tag: 'LOW INVENTORY',
    artist: 'Hania Rani',
    venue: 'Bluebird Theater',
    detail: 'Less than 35 tickets remaining before sellout',
    metric: '<35 left · $32',
    href: '/prototypes/signal/concerts/proto-ev-102',
    badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-700/60',
    colorHex: '#0D9488',
  },
  {
    id: 'ticker-jbrekkie',
    type: 'top_match',
    tag: 'TOP SIGNAL',
    artist: 'Japanese Breakfast',
    venue: 'Mission Ballroom',
    detail: 'Ranked 96% match for your indie pop profile',
    metric: 'Sun Nov 15 · 96% Match',
    href: '/prototypes/signal/concerts/proto-ev-104',
    badgeClass: 'bg-pink-950/80 text-pink-300 border-pink-700/60',
    colorHex: '#F59E0B',
  },
  {
    id: 'ticker-silver-lake',
    type: 'spontaneous',
    tag: 'WEEKEND VALUE',
    artist: 'Silver Lake Dreamers',
    venue: 'Larimer Lounge',
    detail: 'Under $20 intimate club show this Saturday',
    metric: '$18 GA · Sat Nov 14',
    href: '/prototypes/signal/concerts/proto-ev-101',
    badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-700/60',
    colorHex: '#3B82F6',
  },
  {
    id: 'ticker-civic',
    type: 'free',
    tag: 'FREE ($0)',
    artist: 'Civic Center Beats',
    venue: 'Civic Center Park',
    detail: 'Sunset Funk & Soul outdoor lawn session',
    metric: '$0 Free · Sat 2 PM',
    href: '/prototypes/signal/concerts/proto-ev-105',
    badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60',
    colorHex: '#10B981',
  },
  {
    id: 'ticker-fontaines',
    type: 'sold_out',
    tag: 'WATCHLIST ACTIVE',
    artist: 'Fontaines D.C.',
    venue: 'Mission Ballroom',
    detail: 'Primary sold out; radar monitoring for production ticket drops',
    metric: 'Sold Out · Radar Alert',
    href: '/prototypes/signal/concerts/proto-ev-108',
    badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-700/60',
    colorHex: '#EF4444',
  },
];

export function SignalTicker() {
  const [isPaused, setIsPaused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check for prefers-reduced-motion
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) =>
        setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, []);

  // Cycle active item automatically when not paused
  useEffect(() => {
    if (isPaused || isHovered || prefersReducedMotion) return;

    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % TICKER_ITEMS.length);
    }, 4500);

    return () => clearInterval(timer);
  }, [isPaused, isHovered, prefersReducedMotion]);

  const handlePrev = () => {
    setActiveIndex(
      (prev) => (prev - 1 + TICKER_ITEMS.length) % TICKER_ITEMS.length,
    );
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % TICKER_ITEMS.length);
  };

  const currentItem = TICKER_ITEMS[activeIndex];

  return (
    <div
      role="region"
      aria-label="Live Concert Signal Ticker"
      className="relative z-30 w-full border-b border-zinc-800/80 bg-zinc-950/95 text-zinc-100 backdrop-blur-md transition-colors"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mx-auto flex h-11 max-w-7xl items-center justify-between px-3 sm:px-6">
        {/* Left Live Badge */}
        <div className="flex shrink-0 items-center gap-2 border-r border-zinc-800/80 pr-3 sm:pr-4">
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isPaused ? 'bg-zinc-500' : 'animate-ping bg-emerald-400'
              }`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isPaused ? 'bg-zinc-500' : 'bg-emerald-500'
              }`}
            />
          </span>
          <span className="hidden font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300 sm:inline-block">
            Signal Ticker
          </span>
          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {activeIndex + 1}/{TICKER_ITEMS.length}
          </span>
        </div>

        {/* Center Active Alert Stream */}
        <div
          ref={tickerRef}
          className="flex-1 overflow-hidden px-2 sm:px-4"
          aria-live="polite"
        >
          <Link
            href={currentItem.href}
            className="group flex items-center justify-between gap-3 py-1 text-xs transition-colors duration-150 hover:text-white sm:text-sm"
          >
            <div className="flex items-center gap-2 truncate">
              <span
                className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${currentItem.badgeClass}`}
              >
                {currentItem.tag}
              </span>

              <span className="font-semibold text-white transition-colors group-hover:text-violet-300">
                {currentItem.artist}
              </span>
              <span className="hidden text-zinc-500 md:inline">@</span>
              <span className="hidden truncate text-zinc-400 md:inline">
                {currentItem.venue}
              </span>
              <span className="hidden text-zinc-500 lg:inline">—</span>
              <span className="hidden truncate text-zinc-300 lg:inline">
                {currentItem.detail}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                {currentItem.metric}
              </span>
              <span className="hidden font-mono text-xs text-zinc-500 transition-colors group-hover:text-violet-400 sm:inline">
                View &rarr;
              </span>
            </div>
          </Link>
        </div>

        {/* Right Controls: Step Prev/Next & Play/Pause */}
        <div className="flex shrink-0 items-center gap-1 border-l border-zinc-800/80 pl-3 sm:pl-4">
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous concert signal"
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 active:scale-[0.95]"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleNext}
            aria-label="Next concert signal"
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 active:scale-[0.95]"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            aria-label={
              isPaused
                ? 'Resume live ticker rotation'
                : 'Pause live ticker rotation'
            }
            aria-pressed={isPaused}
            className={`rounded p-1 transition-colors active:scale-[0.95] ${
              isPaused
                ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
            title={isPaused ? 'Play' : 'Pause'}
          >
            {isPaused ? (
              // Play Icon
              <svg
                className="h-3.5 w-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
            ) : (
              // Pause Icon
              <svg
                className="h-3.5 w-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75V3.75A.75.75 0 008.25 3h-2.5zm6 0a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-2.5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
