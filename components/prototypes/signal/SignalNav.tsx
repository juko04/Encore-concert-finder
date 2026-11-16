'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePrototypeStore } from '@/lib/prototypes/store';

export function SignalNav() {
  const pathname = usePathname();
  const { viewMode, setViewMode, savedEventIds, alertEventIds } =
    usePrototypeStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '/prototypes/signal', label: 'Signal Feed', icon: '⚡' },
    {
      href: '/prototypes/signal/explore',
      label: 'Explore & Scanner',
      icon: '🔍',
    },
    {
      href: '/prototypes/signal/watchlist',
      label: 'Watchlist & Alerts',
      icon: '🔔',
      badge: savedEventIds.length > 0 ? savedEventIds.length : undefined,
      alertCount: alertEventIds.length > 0 ? alertEventIds.length : undefined,
    },
    { href: '/prototypes/signal/taste', label: 'Taste Radar', icon: '🎛️' },
  ];

  const toggleViewMode = () => {
    setViewMode(viewMode === 'authenticated' ? 'guest' : 'authenticated');
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand & Concept Title */}
        <div className="flex items-center gap-6">
          <Link
            href="/prototypes/signal"
            className="group flex items-center gap-2.5 focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 shadow-[0_0_16px_rgba(139,92,246,0.5)] transition-transform duration-200 active:scale-95 group-hover:scale-105">
              <span className="text-base text-white">📡</span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm font-extrabold tracking-wider text-white">
                  ENCORE
                </span>
                <span className="py-0.2 rounded border border-violet-500/30 bg-violet-500/20 px-1.5 font-mono text-[10px] font-bold text-violet-300">
                  SIGNAL
                </span>
              </div>
              <p className="font-mono text-[10px] text-zinc-400">
                Proactive Live Music Radar
              </p>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.98] ${
                    isActive
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <span>{link.label}</span>
                  {link.badge !== undefined && (
                    <span className="py-0.2 ml-1 inline-flex items-center rounded-full border border-violet-800 bg-violet-950 px-1.5 font-mono text-[10px] text-violet-300">
                      {link.badge}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute -bottom-[17px] left-3 right-3 h-[2px] rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Actions: Mode Switcher & Hub Backlink */}
        <div className="flex items-center gap-3">
          {/* View Mode Switcher Pill */}
          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 shadow-inner">
            <button
              type="button"
              onClick={toggleViewMode}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
                viewMode === 'authenticated'
                  ? 'bg-violet-600 text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Personalized based on Julian's taste profile"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span>Personal Radar</span>
            </button>

            <button
              type="button"
              onClick={toggleViewMode}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
                viewMode === 'guest'
                  ? 'bg-zinc-700 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Neutral, non-personalized signal discovery"
            >
              <span>Guest Scanner</span>
            </button>
          </div>

          {/* Hub Backlink */}
          <Link
            href="/prototypes"
            className="hidden items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white active:scale-[0.98] sm:inline-flex"
          >
            <span>&larr; Hub</span>
          </Link>

          {/* Mobile Menu Trigger */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white md:hidden"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="space-y-1 border-t border-zinc-800 bg-zinc-950 px-4 pb-4 pt-2 md:hidden">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{link.icon}</span>
                  <span>{link.label}</span>
                </div>
                {link.badge !== undefined && (
                  <span className="rounded-full bg-violet-950 px-2 py-0.5 font-mono text-xs text-violet-300">
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}

          <div className="border-t border-zinc-800 pt-2">
            <Link
              href="/prototypes"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900"
            >
              <span>&larr; Return to Prototypes Hub</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
