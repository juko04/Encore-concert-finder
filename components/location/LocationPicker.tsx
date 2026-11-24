'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MapPinIcon } from '@/components/index/icons';
import { searchCities, type CityEntry } from '@/lib/location/cities';
import {
  readHomeLocationFromCookieString,
  resolveHomeLocation,
  roundCoordinate,
  serializeHomeLocation,
  type HomeLocation,
} from '@/lib/location/home-location';
import {
  clearHomeLocationAction,
  saveHomeLocationAction,
} from '@/lib/location/actions';

interface LocationPickerProps {
  /** "desktop" opens a popover; "mobile" expands inline inside the drawer. */
  variant?: 'desktop' | 'mobile';
}

/**
 * City picker for the top bar. Privacy: no IP lookup and no third-party calls.
 * "Use my location" asks the browser for permission and only the rounded
 * (about 0.7 mile) coordinate is sent to our server action.
 */
export function LocationPicker({ variant = 'desktop' }: LocationPickerProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [current, setCurrent] = useState<HomeLocation | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Read the cookie after mount so server and client markup match on first paint.
  useEffect(() => {
    const fromCookie = readHomeLocationFromCookieString(document.cookie);
    setCurrent(fromCookie);
    setMounted(true);
    if (fromCookie) return;

    // No cookie (new browser/device): restore the signed-in user's saved location from their
    // profile. The route sets the cookie; guests get 401 and simply stay without a location.
    const controller = new AbortController();
    fetch('/api/location', {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(() => {
        const restored = readHomeLocationFromCookieString(document.cookie);
        if (!restored) return;
        setCurrent(restored);
        router.refresh();
      })
      .catch(() => {
        // Offline/aborted: keep the empty state; the user can still pick a city.
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const results = searchCities(query);

  function applyResult(
    ok: boolean,
    next: HomeLocation | null,
    error?: string,
  ): void {
    if (!ok || !next) {
      setMessage(error ?? 'Could not save your location.');
      return;
    }
    setCurrent(next);
    setMessage(null);
    setOpen(false);
    setQuery('');
    router.refresh();
  }

  function chooseCity(c: CityEntry) {
    startTransition(async () => {
      const res = await saveHomeLocationAction({ kind: 'city', slug: c.slug });
      applyResult(
        res.ok,
        resolveHomeLocation(
          serializeHomeLocation({ kind: 'city', slug: c.slug }),
        ),
        res.ok ? undefined : res.error,
      );
    });
  }

  function useMyLocation() {
    setMessage(null);
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setMessage('Your browser cannot share a location. Pick a city instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = roundCoordinate(pos.coords.latitude);
        const lng = roundCoordinate(pos.coords.longitude);
        startTransition(async () => {
          const res = await saveHomeLocationAction({ kind: 'geo', lat, lng });
          applyResult(
            res.ok,
            resolveHomeLocation(
              serializeHomeLocation({ kind: 'geo', lat, lng }),
            ),
            res.ok ? undefined : res.error,
          );
        });
      },
      (err) => {
        setMessage(
          err.code === 1
            ? 'Location permission was declined. You can pick a city instead.'
            : "Couldn't determine your location. Pick a city instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  function clearLocation() {
    startTransition(async () => {
      await clearHomeLocationAction();
      setCurrent(null);
      setMessage(null);
      setOpen(false);
      router.refresh();
    });
  }

  const buttonLabel = !mounted
    ? ' '
    : current
      ? `Near: ${current.label}`
      : 'Set your city';

  const panelClasses =
    variant === 'desktop'
      ? 'absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-lg'
      : 'mt-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm';

  return (
    <div className="relative" ref={containerRef} data-testid="location-picker">
      <button
        type="button"
        data-testid="location-picker-button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          current ? `Your location: ${current.label}. Change` : 'Set your city'
        }
        className={`flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 ${
          variant === 'mobile' ? 'w-full justify-between py-2 text-sm' : ''
        }`}
      >
        <span className="flex items-center gap-1.5">
          <MapPinIcon className="h-3.5 w-3.5 text-zinc-500" />
          <span className="min-w-[4.5rem] truncate">{buttonLabel}</span>
        </span>
        <span aria-hidden="true" className="text-zinc-400">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose your city"
          data-testid="location-picker-panel"
          className={panelClasses}
        >
          <label
            htmlFor={`location-search-${variant}`}
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
          >
            Choose your city
          </label>
          <input
            id={`location-search-${variant}`}
            data-testid="location-search-input"
            type="text"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                chooseCity(results[0]);
              }
            }}
            placeholder="Search cities, e.g. Boulder"
            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-900 placeholder-zinc-400 focus:border-zinc-900 focus:outline-none"
          />

          <ul
            className="mt-2 max-h-56 space-y-0.5 overflow-y-auto"
            aria-label="Cities"
          >
            {results.length === 0 && (
              <li className="px-2 py-2 text-zinc-500">No matching cities.</li>
            )}
            {results.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  data-testid={`location-option-${c.slug}`}
                  disabled={isPending}
                  onClick={() => chooseCity(c)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 ${
                    current?.kind === 'city' &&
                    current.city === c.name &&
                    current.state === c.state
                      ? 'bg-zinc-100 font-semibold text-zinc-900'
                      : 'text-zinc-700'
                  }`}
                >
                  <span>{c.name}</span>
                  <span className="text-zinc-400">{c.state}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
            <button
              type="button"
              data-testid="location-use-my-location"
              disabled={isPending}
              onClick={useMyLocation}
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Use my location
            </button>
            <p className="text-[11px] leading-snug text-zinc-500">
              Your browser will ask first. We keep only an approximate spot
              (about a mile) to rank shows by distance, and never look you up by
              IP address.
            </p>
            {current && (
              <button
                type="button"
                data-testid="location-clear"
                disabled={isPending}
                onClick={clearLocation}
                className="w-full text-left text-[11px] font-medium text-zinc-500 underline hover:text-zinc-800"
              >
                Clear my location
              </button>
            )}
            {message && (
              <p
                role="status"
                data-testid="location-message"
                className="text-[11px] text-amber-700"
              >
                {message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
