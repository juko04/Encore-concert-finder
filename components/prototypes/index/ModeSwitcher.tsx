'use client';

import React, { useState } from 'react';
import { UserViewMode } from '@/lib/prototypes/store';
import { SparklesIcon, CompassIcon, InfoIcon, XIcon } from './icons';

interface ModeSwitcherProps {
  viewMode: UserViewMode;
  onToggleMode: (mode: UserViewMode) => void;
}

export function ModeSwitcher({ viewMode, onToggleMode }: ModeSwitcherProps) {
  const [showInfo, setShowInfo] = useState(false);
  const isAuth = viewMode === 'authenticated';

  return (
    <div className="relative inline-flex items-center">
      {/* Switcher Pill */}
      <div className="shadow-xs flex items-center rounded-full border border-zinc-200/90 bg-white/90 p-1 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => onToggleMode('authenticated')}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 ease-out active:scale-[0.97] ${
            isAuth
              ? 'shadow-xs bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-100/60 hover:text-zinc-900'
          }`}
          aria-pressed={isAuth}
        >
          <SparklesIcon className="h-3 w-3" />
          <span>Member</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleMode('guest')}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 ease-out active:scale-[0.97] ${
            !isAuth
              ? 'shadow-xs bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-100/60 hover:text-zinc-900'
          }`}
          aria-pressed={!isAuth}
        >
          <CompassIcon className="h-3 w-3" />
          <span>Guest</span>
        </button>

        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          aria-label="Explain viewer modes"
          className="ml-1 rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          <InfoIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Info Popover Modal */}
      {showInfo && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="mode-comparison-title"
          className="animate-in fade-in zoom-in-95 absolute right-0 top-11 z-50 w-80 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_36px_rgba(0,0,0,0.12)] duration-150"
        >
          <div className="flex items-start justify-between border-b border-zinc-100 pb-2">
            <h3
              id="mode-comparison-title"
              className="text-sm font-semibold text-zinc-900"
            >
              Prototype Mode Comparison
            </h3>
            <button
              onClick={() => setShowInfo(false)}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"
              aria-label="Close mode information"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 space-y-3 text-xs leading-relaxed text-zinc-600">
            <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 p-2.5">
              <div className="mb-1 flex items-center gap-1 font-semibold text-zinc-900">
                <SparklesIcon className="h-3.5 w-3.5 text-indigo-600" />
                <span>Member Mode (Personalized)</span>
              </div>
              <p>
                Matches are scored (0–100) using taste preferences. Ignored
                artists are suppressed (Invariant 11). Favorite artists
                highlight presales and top billing.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 p-2.5">
              <div className="mb-1 flex items-center gap-1 font-semibold text-zinc-900">
                <CompassIcon className="h-3.5 w-3.5 text-zinc-600" />
                <span>Guest Mode (Neutral Index)</span>
              </div>
              <p>
                Unbiased, objective live-music directory. No synthetic taste
                scores or hidden listings. Ranks solely by curation, upcoming
                dates, and price transparency.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
