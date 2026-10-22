'use client';

import React, { useState } from 'react';
import type { SpotifyConnectionStatus } from '@/lib/domain/spotify';

interface SpotifyConnectionCardProps {
  connected: boolean;
  spotifyAccountId?: string;
  status?: SpotifyConnectionStatus;
  lastSyncedAt?: string | null;
  isConfigured: boolean;
  isSyntheticDemo: boolean;
  onToggleDemoMode: () => void;
  onDisconnect: () => void;
  isDisconnecting?: boolean;
}

export function SpotifyConnectionCard({
  connected,
  spotifyAccountId,
  status = 'disconnected',
  lastSyncedAt,
  isConfigured,
  isSyntheticDemo,
  onToggleDemoMode,
  onDisconnect,
  isDisconnecting = false,
}: SpotifyConnectionCardProps) {
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);

  const hasStoredConnection =
    connected ||
    (status && status !== 'disconnected') ||
    Boolean(spotifyAccountId);

  return (
    <div
      data-testid="spotify-connection-card"
      className="overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-950 p-6 backdrop-blur"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {/* Spotify Green Icon */}
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[#1DB954]/10 ring-1 ring-[#1DB954]/20">
            <svg
              className="h-6 w-6 text-[#1DB954]"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.306c-.218.358-.684.47-1.042.254-2.856-1.745-6.452-2.14-10.686-1.172-.41.093-.815-.164-.908-.573-.093-.41.164-.816.573-.909 4.636-1.06 8.608-.614 11.808 1.345.358.216.472.684.255 1.055zm1.468-3.264c-.274.444-.858.587-1.302.313-3.268-2.008-8.252-2.592-12.118-1.417-.5.152-1.026-.134-1.178-.633-.153-.5.134-1.026.634-1.178 4.417-1.34 9.914-.688 13.65 1.613.445.274.588.858.314 1.302zm.126-3.41c-3.918-2.327-10.379-2.541-14.127-1.403-.6.183-1.23-.162-1.413-.762-.183-.6.162-1.23.762-1.413 4.303-1.306 11.433-1.056 15.937 1.618.54.32.715 1.02.395 1.56-.32.54-1.02.716-1.554.4z" />
            </svg>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-white">
                Spotify Music Taste Explorer
              </h2>
              {connected ? (
                <span
                  data-testid="spotify-connected-badge"
                  className="rounded-full border border-emerald-800/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400"
                >
                  ● Connected
                </span>
              ) : status === 'expired' ? (
                <span
                  data-testid="spotify-expired-badge"
                  className="rounded-full border border-amber-800/40 bg-amber-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400"
                >
                  ⚠ Reauthorization Required
                </span>
              ) : status === 'revoked' ? (
                <span
                  data-testid="spotify-revoked-badge"
                  className="rounded-full border border-red-800/40 bg-red-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-red-400"
                >
                  ⚠ Connection Revoked
                </span>
              ) : isSyntheticDemo ? (
                <span
                  data-testid="spotify-demo-badge"
                  className="rounded-full border border-indigo-800/40 bg-indigo-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-400"
                >
                  ✦ Preview Mode
                </span>
              ) : (
                <span
                  data-testid="spotify-disconnected-badge"
                  className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400"
                >
                  {isConfigured ? 'Optional Integration' : 'Preview / Demo'}
                </span>
              )}
            </div>

            <p className="mt-1 text-xs text-zinc-400">
              {connected
                ? 'Your Spotify account is connected. Inspect your listening history below and intentionally add artists to your live concert interests.'
                : status === 'expired'
                  ? 'Your Spotify authorization has expired. Reconnect your account to refresh listening preferences, or disconnect to remove your stored credentials.'
                  : status === 'revoked'
                    ? 'Your Spotify connection was revoked. Reconnect your account, or disconnect to clear stored credentials.'
                    : 'Connect your Spotify account to inspect your top listening history across recent and historical windows, or test with our interactive preview.'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start">
          {showConfirmDisconnect ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="confirm-disconnect-btn"
                onClick={() => {
                  setShowConfirmDisconnect(false);
                  onDisconnect();
                }}
                disabled={isDisconnecting}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-500 disabled:opacity-50"
              >
                {isDisconnecting ? 'Disconnecting...' : 'Yes, Disconnect'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmDisconnect(false)}
                disabled={isDisconnecting}
                className="rounded-lg border border-zinc-700 bg-transparent px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          ) : hasStoredConnection ? (
            <div className="flex flex-wrap items-center gap-2">
              {!connected && (
                <a
                  href="/api/integrations/spotify/connect"
                  data-testid="connect-spotify-btn"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1DB954] px-3.5 py-2 text-xs font-bold text-black shadow-sm transition hover:bg-[#1ed760] focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:ring-offset-2 focus:ring-offset-zinc-950"
                >
                  Reconnect Spotify
                </a>
              )}
              <button
                type="button"
                data-testid="disconnect-spotify-btn"
                onClick={() => setShowConfirmDisconnect(true)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-300"
              >
                Disconnect
              </button>
              {!connected && (
                <button
                  type="button"
                  data-testid="toggle-preview-mode-btn"
                  onClick={onToggleDemoMode}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    isSyntheticDemo
                      ? 'border-indigo-600 bg-indigo-950/50 text-indigo-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-white'
                  }`}
                >
                  {isSyntheticDemo ? 'Exit Preview' : 'Interactive Preview'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/api/integrations/spotify/connect"
                data-testid="connect-spotify-btn"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1DB954] px-3.5 py-2 text-xs font-bold text-black shadow-sm transition hover:bg-[#1ed760] focus:outline-none focus:ring-2 focus:ring-[#1DB954] focus:ring-offset-2 focus:ring-offset-zinc-950"
              >
                Connect Spotify
              </a>
              <button
                type="button"
                data-testid="toggle-preview-mode-btn"
                onClick={onToggleDemoMode}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  isSyntheticDemo
                    ? 'border-indigo-600 bg-indigo-950/50 text-indigo-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-white'
                }`}
              >
                {isSyntheticDemo ? 'Exit Preview' : 'Interactive Preview'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stored Account Details */}
      {hasStoredConnection && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 text-xs text-zinc-400">
          <div>
            <span className="text-zinc-500">Spotify Account: </span>
            <span
              data-testid="spotify-account-id-label"
              className="font-mono font-medium text-zinc-200"
            >
              {spotifyAccountId || 'Connected Account'}
            </span>
          </div>
          {lastSyncedAt && (
            <div>
              <span className="text-zinc-500">Last Synced: </span>
              <span className="text-zinc-300">
                {new Date(lastSyncedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          )}
          {status === 'expired' && (
            <span className="text-[11px] font-medium text-amber-400">
              (Authorization expired — disconnect to remove stored credentials)
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-testid="switch-to-preview-btn"
              onClick={onToggleDemoMode}
              className="text-[11px] text-zinc-400 underline-offset-2 hover:text-indigo-400 hover:underline"
            >
              {isSyntheticDemo ? 'Show Live Taste' : 'View Synthetic Preview'}
            </button>
          </div>
        </div>
      )}

      {/* Disconnected / Policy Disclosures */}
      {!connected && (
        <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-3.5 text-xs text-zinc-400 sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span>
            <span>
              <strong className="text-zinc-300">
                Authoritative Manual Choice:
              </strong>{' '}
              Spotify data never overrides your manual concert preferences.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span>
            <span>
              <strong className="text-zinc-300">Minimal Permissions:</strong>{' '}
              Requests only top-artist reading (`user-top-read`). Zero listening
              telemetry stored without your confirmation.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
