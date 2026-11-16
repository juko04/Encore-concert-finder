'use client';

import React from 'react';
import Link from 'next/link';
import type { PrototypeEvent } from '@/lib/prototypes/fixtures';
import { SignalCard } from './SignalCard';

interface SignalStreamProps {
  title: string;
  subtitle: string;
  badge: string;
  icon: string;
  badgeColorClass?: string;
  events: PrototypeEvent[];
  exploreHref?: string;
}

export function SignalStream({
  title,
  subtitle,
  badge,
  icon,
  badgeColorClass = 'border-violet-500/40 bg-violet-950/60 text-violet-300',
  events,
  exploreHref,
}: SignalStreamProps) {
  if (events.length === 0) return null;

  return (
    <section className="space-y-4">
      {/* Stream Header */}
      <div className="flex flex-col gap-2 border-b border-zinc-800/80 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-tight ${badgeColorClass}`}
            >
              <span>{icon}</span>
              <span>{badge}</span>
            </span>
            <span className="font-mono text-xs text-zinc-500">
              {events.length} {events.length === 1 ? 'signal' : 'signals'} found
            </span>
          </div>

          <h3 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">{subtitle}</p>
        </div>

        {exploreHref && (
          <Link
            href={exploreHref}
            className="inline-flex shrink-0 items-center gap-1 font-mono text-xs font-medium text-violet-400 transition-colors hover:text-violet-300"
          >
            <span>Scan entire stream</span>
            <span>&rarr;</span>
          </Link>
        )}
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <SignalCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}
