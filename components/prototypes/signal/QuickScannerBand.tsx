'use client';

import React from 'react';
import Link from 'next/link';

interface ScannerPreset {
  id: string;
  icon: string;
  label: string;
  sublabel: string;
  href: string;
  borderHover: string;
  accentColor: string;
}

const PRESETS: ScannerPreset[] = [
  {
    id: 'weekend',
    icon: '🌙',
    label: 'A Great Night Out This Weekend',
    sublabel: 'Spontaneous shows, local bar/clubs & high venue fit',
    href: '/prototypes/signal/explore?context=weekend',
    borderHover: 'hover:border-blue-500/50',
    accentColor: '#3B82F6',
  },
  {
    id: 'inexpensive',
    icon: '💸',
    label: 'Inexpensive & Unfamiliar (<$25)',
    sublabel: 'Low risk, great value discoveries under $25 & free entry',
    href: '/prototypes/signal/explore?context=inexpensive',
    borderHover: 'hover:border-emerald-500/50',
    accentColor: '#10B981',
  },
  {
    id: 'travel',
    icon: '✈️',
    label: 'Concerts Worth Traveling For',
    sublabel: 'Multi-day festivals, iconic venues & bucket list tours',
    href: '/prototypes/signal/explore?context=travel',
    borderHover: 'hover:border-pink-500/50',
    accentColor: '#EC4899',
  },
  {
    id: 'surprise',
    icon: '🎲',
    label: 'Surprise Me',
    sublabel: 'Algorithmic unexpected picks with 80%+ aesthetic fit',
    href: '/prototypes/signal/explore?context=surprise',
    borderHover: 'hover:border-violet-500/50',
    accentColor: '#8B5CF6',
  },
];

export function QuickScannerBand() {
  return (
    <section aria-label="Contextual Quick Scanners" className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
          Contextual Radar Scanners
        </h3>
        <span className="text-[11px] text-zinc-500">
          Pick an intent to tune the signal
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRESETS.map((preset) => (
          <Link
            key={preset.id}
            href={preset.href}
            className={`group relative flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition-all duration-200 hover:bg-zinc-800/80 active:scale-[0.98] ${preset.borderHover}`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xl">{preset.icon}</span>
                <span className="font-mono text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
                  Scan &rarr;
                </span>
              </div>
              <h4 className="mt-2.5 text-sm font-bold text-white transition-colors group-hover:text-violet-300">
                {preset.label}
              </h4>
              <p className="mt-1 text-xs leading-snug text-zinc-400">
                {preset.sublabel}
              </p>
            </div>

            <div className="mt-3 border-t border-zinc-800/50 pt-2">
              <span className="font-mono text-[10px] text-zinc-400">
                Live stream ready
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
