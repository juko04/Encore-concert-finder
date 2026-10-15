import React from 'react';
import type { PreferenceLevel } from '@/lib/domain/user-preference';

interface PreferenceLevelBadgeProps {
  level: PreferenceLevel;
  className?: string;
}

export function PreferenceLevelBadge({
  level,
  className = '',
}: PreferenceLevelBadgeProps) {
  switch (level) {
    case 'favorite':
      return (
        <span
          data-testid="badge-favorite"
          className={`inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300 ${className}`}
        >
          <span>★</span> Favorite
        </span>
      );
    case 'like':
      return (
        <span
          data-testid="badge-like"
          className={`inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-300 ${className}`}
        >
          <span>♥</span> Like
        </span>
      );
    case 'interested':
      return (
        <span
          data-testid="badge-interested"
          className={`inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-300 ${className}`}
        >
          <span>✦</span> Interested
        </span>
      );
    case 'dislike':
      return (
        <span
          data-testid="badge-dislike"
          className={`inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-xs font-semibold text-zinc-400 ${className}`}
        >
          <span>⊘</span> Dislike
        </span>
      );
    default:
      return null;
  }
}
