import React from 'react';
import {
  sortArtistsByAffinity,
  type ArtistAffinity,
} from '@/lib/recommendation/artist-affinity';

interface SupportAct {
  name: string;
  affinity?: ArtistAffinity | null;
}

const LEVEL_LABEL: Record<ArtistAffinity['level'], string> = {
  favorite: 'a favorite',
  like: 'an artist you like',
  interested: 'an artist you are interested in',
  spotify: 'in your Spotify listening',
};

/**
 * "with A, B, C" lineup text. Artists the user likes are listed first (highest rated first) and
 * marked with a heart; the rest keep their billing order. Plain text for guests.
 */
export function SupportActsLine({
  acts,
  className,
}: {
  acts: readonly SupportAct[];
  className?: string;
}) {
  const visibleActs = acts.filter((a) => Boolean(a.name?.trim()));
  if (visibleActs.length === 0) return null;
  const sorted = sortArtistsByAffinity(visibleActs);
  return (
    <p className={className} data-testid="support-acts">
      with{' '}
      {sorted.map((a, i) => {
        const label = a.affinity
          ? (LEVEL_LABEL[a.affinity.level] ?? 'an artist you like')
          : null;
        return (
          <React.Fragment key={`${a.name}-${i}`}>
            {i > 0 && ', '}
            {a.affinity && label ? (
              <span
                data-testid="liked-artist"
                data-affinity-level={a.affinity.level}
                title={`${a.name} is ${label}`}
                className="font-semibold text-rose-700"
              >
                <span aria-hidden="true">♥ </span>
                {a.name}
                <span className="sr-only"> ({label})</span>
              </span>
            ) : (
              a.name
            )}
          </React.Fragment>
        );
      })}
    </p>
  );
}
