'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SearchIcon,
  HeartIcon,
  SlidersIcon,
  SparklesIcon,
  CompassIcon,
  XIcon,
} from './icons';

export interface HeaderProps {
  savedCount?: number;
  alertCount?: number;
  routes?: {
    shows?: string;
    search?: string;
    saved?: string;
    preferences?: string;
  };
  isAuthenticated?: boolean;
  userEmail?: string | null;
}

export function Header({
  savedCount = 0,
  alertCount = 0,
  routes = {
    shows: '/',
    search: '/search',
    saved: '/saved',
    preferences: '/preferences',
  },
  isAuthenticated = false,
  userEmail,
}: HeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    {
      href: routes.shows || '/',
      label: 'Shows',
      icon: CompassIcon,
      matchExact: true,
    },
    {
      href: routes.search || '/search',
      label: 'Search',
      icon: SearchIcon,
    },
    {
      href: routes.saved || '/saved',
      label: 'Saved',
      icon: HeartIcon,
      badge: savedCount,
      alertIndicator: alertCount > 0,
    },
    {
      href: routes.preferences || '/preferences',
      label: 'Preferences',
      icon: SparklesIcon,
    },
  ];

  const isLinkActive = (href: string, matchExact?: boolean) => {
    if (!pathname) return false;
    if (matchExact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand / Title */}
        <div className="flex items-center gap-6">
          <Link
            href={routes.shows || '/'}
            className="group flex items-center gap-2.5 transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            <div className="shadow-xs flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 font-mono text-sm font-bold text-white">
              E
            </div>
            <div className="flex flex-col">
              <span className="text-base font-semibold leading-none tracking-tight text-zinc-900">
                ENCORE{' '}
                <span className="font-light text-zinc-400">{'// INDEX'}</span>
              </span>
              <span className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                Curated Live Music
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav
            className="ml-4 hidden items-center gap-1 md:flex"
            aria-label="Main Navigation"
          >
            {navLinks.map((link) => {
              const active = isLinkActive(link.href, link.matchExact);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-out active:scale-[0.97] ${
                    active
                      ? 'bg-zinc-100 font-semibold text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 text-zinc-500" />
                  <span>{link.label}</span>
                  {typeof link.badge === 'number' && link.badge > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-900 px-1 text-[10px] font-bold tabular-nums text-white">
                      {link.badge}
                    </span>
                  )}
                  {link.alertIndicator && (
                    <span
                      title={`${alertCount} active alerts`}
                      className="flex h-1.5 w-1.5 rounded-full bg-violet-600"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Section / Mobile Menu Toggle */}
        <div className="flex items-center gap-3">
          <Link
            href={routes.saved || '/saved'}
            className="hidden items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 sm:flex"
          >
            <HeartIcon
              className="h-3.5 w-3.5 text-rose-500"
              filled={savedCount > 0}
            />
            <span>Watchlist</span>
            {savedCount > 0 && (
              <span className="ml-1 font-mono text-[11px] font-bold text-zinc-900">
                ({savedCount})
              </span>
            )}
          </Link>

          {isAuthenticated ? (
            <Link
              href="/preferences"
              className="hidden items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 sm:flex"
              title={userEmail || 'Account Preferences'}
            >
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-600 text-[8px] font-bold text-white">
                {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
              </div>
              <span className="max-w-[100px] truncate text-[11px]">
                {userEmail || 'Profile'}
              </span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-full bg-zinc-900 px-3.5 py-1 text-xs font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97] sm:inline-flex"
            >
              Sign In
            </Link>
          )}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-100 md:hidden"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <XIcon className="h-4 w-4" />
            ) : (
              <SlidersIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="animate-in fade-in slide-in-from-top-2 space-y-1 border-b border-zinc-200 bg-white px-4 pb-4 pt-2 duration-150 md:hidden">
          {navLinks.map((link) => {
            const active = isLinkActive(link.href, link.matchExact);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-zinc-100 font-semibold text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-zinc-500" />
                  <span>{link.label}</span>
                </div>
                {typeof link.badge === 'number' && link.badge > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-xs font-bold tabular-nums text-white">
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
