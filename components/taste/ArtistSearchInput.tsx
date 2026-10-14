/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface SelectedArtist {
  id: string | null;
  name: string;
  imageUrl?: string | null;
}

interface ArtistSearchInputProps {
  onSelectArtist: (artist: SelectedArtist) => void;
  disabled?: boolean;
}

interface SearchResult {
  id: string;
  name: string;
  imageUrl?: string | null;
}

export function ArtistSearchInput({
  onSelectArtist,
  disabled = false,
}: ArtistSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search effect
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/artists/search?q=${encodeURIComponent(trimmed)}&limit=8`,
        );
        if (res.ok) {
          const json = await res.json();
          setResults(json.artists || []);
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(artist: SelectedArtist) {
    onSelectArtist(artist);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  }

  const trimmedQuery = query.trim();
  const hasExactMatch = results.some(
    (r) => r.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={query}
          disabled={disabled}
          data-testid="artist-search-input"
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (trimmedQuery) setIsOpen(true);
          }}
          placeholder="Search catalog or type custom artist name..."
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 pl-10 text-sm text-zinc-100 placeholder-zinc-500 shadow-inner backdrop-blur transition-all focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-500">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {query && (
          <button
            type="button"
            data-testid="clear-search-btn"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Clear
          </button>
        )}
      </div>

      {isOpen && trimmedQuery && (
        <div
          data-testid="search-results-dropdown"
          className="absolute z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur"
        >
          {isLoading && (
            <div className="px-4 py-2.5 text-xs text-zinc-400">
              Searching catalog...
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-0.5">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                In Concert Catalog
              </div>
              {results.map((artist) => (
                <button
                  key={artist.id}
                  type="button"
                  data-testid={`artist-result-${artist.id}`}
                  onClick={() =>
                    handleSelect({
                      id: artist.id,
                      name: artist.name,
                      imageUrl: artist.imageUrl,
                    })
                  }
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none"
                >
                  <div className="flex items-center gap-3">
                    {artist.imageUrl ? (
                      <img
                        src={artist.imageUrl}
                        alt=""
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-900/50 text-xs font-bold text-indigo-300">
                        {artist.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="font-medium text-white">
                      {artist.name}
                    </span>
                  </div>
                  <span className="rounded border border-indigo-800/40 bg-indigo-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                    In Catalog
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Option to add custom artist (uncataloged) */}
          <div className="mt-1 border-t border-zinc-800/80 pt-1">
            <button
              type="button"
              data-testid="add-custom-artist-btn"
              onClick={() =>
                handleSelect({
                  id: null,
                  name: trimmedQuery,
                })
              }
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-indigo-300 transition-colors hover:bg-indigo-950/40 focus:bg-indigo-950/40 focus:outline-none"
            >
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">＋</span>
                <span>
                  Add &ldquo;
                  <span className="font-semibold text-white">
                    {trimmedQuery}
                  </span>
                  &rdquo; as uncataloged artist
                </span>
              </div>
              {!hasExactMatch && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  Custom
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
