'use client';

import React, { useState } from 'react';
import { GuestGate } from '@/components/auth/GuestGate';
import { HeartIcon } from './icons';

export interface SaveHeartButtonProps {
  eventId: string;
  title: string;
  isSaved: boolean;
  onToggle: (id: string, title?: string) => void;
  /**
   * `overlay`: round white button floating on a card image.
   * `plain`: borderless button in a card's top row.
   */
  variant?: 'overlay' | 'plain';
  /** Classes for the positioning wrapper (e.g. `absolute right-2.5 top-2.5`). */
  className?: string;
}

/**
 * Heart toggle that saves a show to Saved. Filled pink once saved, on every card that shows the
 * same show (the watchlist store is shared). Visitors see it greyed out with a sign-in pop-out.
 */
export function SaveHeartButton({
  eventId,
  title,
  isSaved,
  onToggle,
  variant = 'plain',
  className = 'relative z-10',
}: SaveHeartButtonProps) {
  // Pop only in response to the click that saves, never when a saved card first renders.
  const [popping, setPopping] = useState(false);

  const base =
    'flex items-center justify-center rounded-full transition-[background-color,color,border-color,transform] duration-150 ease-out-strong active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300';
  const look =
    variant === 'overlay'
      ? `h-9 w-9 border shadow-sm backdrop-blur ${
          isSaved
            ? 'border-rose-100 bg-white text-rose-500'
            : 'border-white/60 bg-white/90 text-zinc-500 [@media(hover:hover)]:hover:text-rose-500'
        }`
      : `h-10 w-10 border ${
          isSaved
            ? 'border-rose-100 bg-rose-50 text-rose-500'
            : 'border-transparent text-zinc-400 [@media(hover:hover)]:hover:border-zinc-200 [@media(hover:hover)]:hover:bg-zinc-50 [@media(hover:hover)]:hover:text-rose-500'
        }`;

  return (
    <GuestGate
      message="Sign in to save this show"
      placement="bottom"
      align="end"
      className={className}
    >
      <button
        type="button"
        data-testid="save-heart"
        onClick={(e) => {
          // Cards are links; the heart saves, it does not open the show.
          e.preventDefault();
          e.stopPropagation();
          setPopping(!isSaved);
          onToggle(eventId, title);
        }}
        aria-label={
          isSaved ? `Remove ${title} from Saved` : `Save ${title} to Saved`
        }
        aria-pressed={isSaved}
        className={`${base} ${look}`}
      >
        <HeartIcon
          className={`h-4 w-4 ${popping ? 'motion-safe:animate-heart-pop' : ''}`}
          filled={isSaved}
          onAnimationEnd={() => setPopping(false)}
        />
      </button>
    </GuestGate>
  );
}
