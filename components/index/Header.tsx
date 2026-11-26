'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SearchIcon,
  HeartIcon,
  CompassIcon,
  CalendarIcon,
  XIcon,
  SlidersIcon,
  MenuIcon,
  SparklesIcon,
  UserIcon,
} from './icons';
import { signOutAction } from '@/app/login/actions';
import { LocationPicker } from '@/components/location/LocationPicker';
import { TimezoneCookie } from '@/components/location/TimezoneCookie';

export interface HeaderProps {
  savedCount?: number;
  alertCount?: number;
  routes?: {
    shows?: string;
    search?: string;
    saved?: string;
    calendar?: string;
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
    calendar: '/calendar',
    preferences: '/preferences',
  },
  isAuthenticated = false,
  userEmail,
}: HeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);

  // Close account dropdown when clicking outside or pressing Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAccountMenuOpen(false);
        setMobileMenuOpen((open) => {
          if (open) menuToggleRef.current?.focus();
          return false;
        });
      }
    }
    function handleClickOutside(e: MouseEvent) {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const navLinks = [
    {
      href: routes.shows || '/',
      label: 'Discover',
      icon: CompassIcon,
      matchExact: true,
    },
    {
      href: routes.search || '/search',
      label: 'Search',
      icon: SearchIcon,
    },
    {
      href: routes.calendar || '/calendar',
      label: 'Calendar',
      icon: CalendarIcon,
    },
    ...(isAuthenticated
      ? [
          {
            href: routes.saved || '/saved',
            label: 'Saved',
            icon: HeartIcon,
            badge: savedCount,
            alertIndicator: alertCount > 0,
          },
          {
            // Your taste, Spotify and settings. Highlighted on /profile/* and /preferences.
            href: '/profile/taste',
            label: 'You',
            icon: UserIcon,
            alsoActive: ['/profile', '/preferences'],
          },
        ]
      : []),
  ] as Array<{
    href: string;
    label: string;
    icon: typeof CompassIcon;
    matchExact?: boolean;
    badge?: number;
    alertIndicator?: boolean;
    target?: string;
    alsoActive?: string[];
  }>;

  // The login page already shows the sign-in form; avoid a redundant button.
  const hideSignIn = Boolean(pathname?.startsWith('/login'));

  const isLinkActive = (
    href: string,
    matchExact?: boolean,
    alsoActive?: string[],
  ) => {
    if (!pathname) return false;
    if (matchExact) return pathname === href;
    return (
      pathname.startsWith(href) ||
      Boolean(alsoActive?.some((p) => pathname.startsWith(p)))
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/95 backdrop-blur-md">
      <TimezoneCookie />
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
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
                <span className="hidden font-light text-zinc-400 sm:inline">
                  {'// INDEX'}
                </span>
              </span>
              <span className="mt-0.5 hidden font-mono text-[10px] uppercase tracking-widest text-zinc-400 sm:block">
                Curated Live Music
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav
            className="ml-4 hidden items-center gap-1 md:flex"
            aria-label="Primary"
          >
            {navLinks.map((link) => {
              const active = isLinkActive(
                link.href,
                link.matchExact,
                link.alsoActive,
              );
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.target ?? link.href}
                  aria-current={active ? 'page' : undefined}
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

        {/* Right Section / Account / Mobile Menu Toggle */}
        <div className="flex items-center gap-2 sm:gap-3">
          <LocationPicker />
          {isAuthenticated && (
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
          )}

          {isAuthenticated ? (
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="true"
                className="flex min-h-10 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                title={userEmail || 'Account Menu'}
              >
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[9px] font-bold text-white">
                  {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="max-w-[120px] truncate text-[11px] font-semibold text-zinc-800">
                  Account
                </span>
              </button>

              {/* Account Dropdown */}
              {accountMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-xl border border-zinc-200 bg-white py-1.5 text-xs shadow-lg">
                  <div className="border-b border-zinc-100 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-400">
                      Signed In As
                    </p>
                    <p className="truncate font-medium text-zinc-900">
                      {userEmail || 'Member'}
                    </p>
                  </div>

                  <Link
                    href="/profile/taste"
                    onClick={() => setAccountMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <SparklesIcon className="h-3.5 w-3.5 text-indigo-500" />
                    <span>Taste & Spotify Settings</span>
                  </Link>

                  <Link
                    href="/preferences"
                    onClick={() => setAccountMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <SlidersIcon className="h-3.5 w-3.5 text-zinc-500" />
                    <span>Preferences</span>
                  </Link>

                  <Link
                    href="/saved"
                    onClick={() => setAccountMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <HeartIcon className="h-3.5 w-3.5 text-rose-500" />
                    <span>Watchlist & Alerts</span>
                  </Link>

                  <div className="border-t border-zinc-100 pt-1">
                    <form action={signOutAction}>
                      <button
                        type="submit"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-rose-600 hover:bg-rose-50"
                      >
                        <UserIcon className="h-3.5 w-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          ) : hideSignIn ? null : (
            <Link
              href="/login"
              className="whitespace-nowrap rounded-full bg-zinc-900 px-3.5 py-1 text-xs font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
            >
              Sign In
            </Link>
          )}

          {/* Mobile Menu Button */}
          <button
            type="button"
            ref={menuToggleRef}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 md:hidden"
            aria-label={
              mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'
            }
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
          >
            {mobileMenuOpen ? (
              <XIcon className="h-4 w-4" />
            ) : (
              <MenuIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="animate-in fade-in slide-in-from-top-2 space-y-1 border-b border-zinc-200 bg-white px-4 pb-4 pt-2 duration-150 motion-reduce:animate-none md:hidden"
        >
          {navLinks.map((link) => {
            const active = isLinkActive(
              link.href,
              link.matchExact,
              link.alsoActive,
            );
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.target ?? link.href}
                aria-current={active ? 'page' : undefined}
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

          {isAuthenticated ? (
            <div className="border-t border-zinc-100 pt-2">
              <Link
                href="/profile/taste"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <SparklesIcon className="h-4 w-4 text-indigo-500" />
                <span>Taste Profile</span>
              </Link>
              <Link
                href="/preferences"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <SlidersIcon className="h-4 w-4 text-zinc-500" />
                <span>Preferences</span>
              </Link>
              <form action={signOutAction} className="mt-1">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <UserIcon className="h-4 w-4" />
                  <span>Sign Out</span>
                </button>
              </form>
            </div>
          ) : hideSignIn ? null : (
            <div className="border-t border-zinc-100 pt-3">
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="flex w-full items-center justify-center rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white"
              >
                Sign In
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
