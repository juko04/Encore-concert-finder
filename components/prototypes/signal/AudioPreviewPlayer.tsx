'use client';

import React, { useState, useEffect } from 'react';

interface AudioPreviewPlayerProps {
  trackTitle: string;
  duration?: string;
  artistName?: string;
  accentColor?: string;
  compact?: boolean;
}

export function AudioPreviewPlayer({
  trackTitle,
  duration = '0:30',
  artistName,
  accentColor = '#8B5CF6',
  compact = false,
}: AudioPreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => {
          if (prev >= 30) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      setSecondsElapsed(0);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPlaying(!isPlaying);
  };

  const formattedElapsed = `0:${secondsElapsed.toString().padStart(2, '0')}`;

  if (compact) {
    return (
      <button
        type="button"
        onClick={togglePlay}
        aria-label={
          isPlaying
            ? `Pause preview of ${trackTitle}`
            : `Play preview of ${trackTitle}`
        }
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:text-white active:scale-95"
      >
        <span
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: isPlaying ? accentColor : '#52525B' }}
        >
          {isPlaying ? (
            <svg className="h-2 w-2" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75V3.75A.75.75 0 008.25 3h-2.5zm6 0a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-2.5z" />
            </svg>
          ) : (
            <svg className="h-2 w-2" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          )}
        </span>
        <span className="max-w-[100px] truncate">{trackTitle}</span>
        {isPlaying && (
          <span className="flex h-2.5 items-end gap-0.5">
            <span className="h-2 w-0.5 animate-pulse bg-emerald-400" />
            <span className="h-3 w-0.5 animate-pulse bg-emerald-400 delay-75" />
            <span className="h-1.5 w-0.5 animate-pulse bg-emerald-400 delay-150" />
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 shadow-md backdrop-blur">
      <div className="flex items-center gap-3">
        {/* Play / Pause Circular Button */}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={
            isPlaying
              ? `Pause preview of ${trackTitle}`
              : `Play preview of ${trackTitle}`
          }
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{
            backgroundColor: accentColor,
            boxShadow: `0 0 16px ${accentColor}66`,
          }}
        >
          {isPlaying ? (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75V3.75A.75.75 0 008.25 3h-2.5zm6 0a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h2.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-2.5z" />
            </svg>
          ) : (
            <svg
              className="ml-0.5 h-4 w-4"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          )}
        </button>

        {/* Track Metadata & Equalizer */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white sm:text-sm">
              {trackTitle}
            </span>
            {isPlaying && (
              <span className="flex h-3 items-end gap-0.5">
                <span className="h-2 w-1 animate-bounce rounded-full bg-emerald-400" />
                <span className="h-3.5 w-1 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
                <span className="h-3 w-1 animate-bounce rounded-full bg-emerald-400 [animation-delay:75ms]" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span>Spotify 30s Audio Preview</span>
            {artistName && <span>• {artistName}</span>}
          </div>
        </div>
      </div>

      {/* Progress & Duration */}
      <div className="shrink-0 text-right font-mono text-xs text-zinc-400">
        <span
          className={
            isPlaying ? 'font-semibold text-emerald-400' : 'text-zinc-400'
          }
        >
          {isPlaying ? formattedElapsed : '0:00'}
        </span>
        <span className="text-zinc-600"> / {duration}</span>
      </div>
    </div>
  );
}
