import React from 'react';
import Link from 'next/link';
import type { DiscoverChip } from '@/lib/discover/home-data';

export function VenueChips({ chips }: { chips: DiscoverChip[] }) {
  if (chips.length === 0) return null;

  return (
    <section
      aria-labelledby="row-venues"
      data-testid="discover-venues"
      className="space-y-3"
    >
      <h2
        id="row-venues"
        className="text-lg font-bold tracking-tight text-zinc-900 sm:text-xl"
      >
        Browse by venue
      </h2>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Link
            key={chip.href}
            href={chip.href}
            className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
