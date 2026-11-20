'use client';

import React, { useState, useEffect, useRef } from 'react';
import { PlayIcon, PauseIcon, Volume2Icon } from './icons';

export interface AudioPreviewPlayerProps {
  track: {
    title: string;
    duration?: string;
    previewUrl?: string;
  };
  artistName: string;
  posterColor?: string;
}

export function AudioPreviewPlayer({
  track,
  artistName,
  posterColor = '#18181b',
}: AudioPreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100%
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fallback timer simulation when real audio element is not playing or in test env
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPlaying && (!track.previewUrl || !audioRef.current)) {
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 2;
        });
      }, 300);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, track.previewUrl]);

  const handleToggle = () => {
    if (progress >= 100) setProgress(0);

    if (track.previewUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => {
            // Browser autoplay policy blocked or test mock: continue in simulated mode
            setIsPlaying(true);
          });
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      const current = audioRef.current.currentTime;
      const duration = audioRef.current.duration;
      setProgress((current / duration) * 100);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  return (
    <div className="shadow-xs rounded-2xl border border-zinc-200 bg-white p-4">
      {track.previewUrl && (
        <audio
          ref={audioRef}
          src={track.previewUrl}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          preload="none"
        />
      )}

      <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
        <div className="flex items-center gap-2">
          {/* Spotify Green Logo Indicator */}
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1DB954] text-white">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Preview Track
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-400">
          <Volume2Icon className="h-3.5 w-3.5" />
          <span>30s Sample</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={handleToggle}
          className="shadow-xs flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.94]"
          aria-label={isPlaying ? 'Pause preview' : 'Play preview track'}
        >
          {isPlaying ? (
            <PauseIcon className="h-4 w-4" />
          ) : (
            <PlayIcon className="ml-0.5 h-4 w-4" />
          )}
        </button>

        {/* Track Details & Visual Waveform */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {track.title}
            </p>
            {track.duration && (
              <span className="ml-2 font-mono text-xs tabular-nums text-zinc-400">
                {track.duration}
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-zinc-500">{artistName}</p>

          {/* Scrub / Progress Bar */}
          <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                backgroundColor: posterColor,
              }}
            />
          </div>
        </div>

        {/* Equalizer animation simulation */}
        <div className="hidden h-6 shrink-0 items-end gap-1 pl-1 sm:flex">
          {[40, 70, 100, 60, 85].map((height, i) => (
            <span
              key={i}
              className={`w-1 rounded-full bg-zinc-300 transition-all duration-200 ${
                isPlaying ? 'animate-pulse' : 'opacity-40'
              }`}
              style={{
                height: isPlaying
                  ? `${Math.max(25, (height * ((progress % 20) + 5)) / 20)}%`
                  : '30%',
                backgroundColor: isPlaying ? posterColor : undefined,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
