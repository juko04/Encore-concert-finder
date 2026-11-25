import React from 'react';
import {
  displayGenreLabel,
  genreBadgeClasses,
} from '@/lib/genres/catalog-genres';

export interface GenreBadgeProps {
  /** Raw source genre string(s); resolved through the shared genre vocabulary. */
  genre?: string | readonly string[] | null;
  className?: string;
}

/**
 * Genre badge: one color per genre, "Mixed" for multi-genre shows, nothing for unknown or
 * non-genre values (e.g. "Live Music").
 */
export function GenreBadge({ genre, className = '' }: GenreBadgeProps) {
  const label = displayGenreLabel(genre);
  if (!label) return null;
  return (
    <span
      data-testid="genre-badge"
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${genreBadgeClasses(label)} ${className}`}
    >
      {label}
    </span>
  );
}
