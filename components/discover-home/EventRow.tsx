import React from 'react';
import Link from 'next/link';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import { toIndexEventItem } from '@/components/index/types';
import { DiscoverEventCard } from './DiscoverEventCard';

export interface EventRowProps {
  id: string;
  title: string;
  subtitle?: string;
  events: Array<CanonicalEventSummary | ScoredEvent>;
  seeAllHref: string;
}

export function EventRow({
  id,
  title,
  subtitle,
  events,
  seeAllHref,
}: EventRowProps) {
  if (events.length === 0) return null;

  return (
    <section
      aria-labelledby={`row-${id}`}
      data-testid={`discover-row-${id}`}
      className="space-y-3"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2
            id={`row-${id}`}
            className="text-lg font-bold tracking-tight text-zinc-900 sm:text-xl"
          >
            {title}
          </h2>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
        <Link
          href={seeAllHref}
          className="shrink-0 text-xs font-semibold text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
        >
          See all →
        </Link>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:scroll-pl-6 sm:px-6 lg:-mx-8 lg:scroll-pl-8 lg:px-8">
        {events.map((event) => {
          const item = toIndexEventItem(event);
          return <DiscoverEventCard key={item.id} event={item} />;
        })}
      </div>
    </section>
  );
}
