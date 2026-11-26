import React from 'react';
import {
  displayGenreLabel,
  genreBadgeClasses,
  genreLabelsOf,
  MIXED_GENRE_LABEL,
} from '@/lib/genres/catalog-genres';

export interface GenreBadgeProps {
  /** Raw source genre string(s); resolved through the shared genre vocabulary. */
  genre?: string | readonly string[] | null;
  /** True when the genre was inferred (e.g. from the show title), not supplied by the source. */
  inferred?: boolean;
  className?: string;
}

/** Genres named on a multi-genre bill before the rest collapse into "+N". */
const MAX_NAMED_GENRES = 2;

/**
 * Genre badge: one color per genre. A multi-genre bill names its first two genres plus a "+N"
 * count instead of a vague "Mixed"; nothing renders for unknown or non-genre values (e.g.
 * "Live Music"). An inferred genre gets a dashed border and a tooltip.
 */
export function GenreBadge({
  genre,
  inferred = false,
  className = '',
}: GenreBadgeProps) {
  const label = displayGenreLabel(genre);
  if (!label) return null;
  const labels = label === MIXED_GENRE_LABEL ? genreLabelsOf(genre) : [label];
  const named = labels.slice(0, MAX_NAMED_GENRES);
  const extra = labels.length - named.length;
  const badgeClass = `inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${inferred ? 'border-dashed' : ''}`;
  return (
    <span
      data-testid="genre-badge"
      data-inferred={inferred ? 'true' : undefined}
      title={inferred ? 'Genre inferred from the show title' : undefined}
      className={`inline-flex flex-wrap items-center gap-1 ${className}`}
    >
      {named.map((l) => (
        <span key={l} className={`${badgeClass} ${genreBadgeClasses(l)}`}>
          {l}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[11px] font-medium text-zinc-500">+{extra}</span>
      )}
      {inferred && <span className="sr-only"> (inferred)</span>}
    </span>
  );
}
