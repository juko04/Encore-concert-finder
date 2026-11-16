import React from 'react';
import type { Metadata } from 'next';
import { SignalTicker } from '@/components/prototypes/signal/SignalTicker';
import { SignalNav } from '@/components/prototypes/signal/SignalNav';
import { UndoToast } from '@/components/prototypes/signal/UndoToast';

export const metadata: Metadata = {
  title: 'Encore Signal — Proactive Concert Discovery Companion',
  description:
    'An expressive, atmospheric concert recommendation and radar experience that spots worthwhile live music opportunities before they sell out.',
};

export default function SignalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 selection:bg-violet-600 selection:text-white">
      {/* 1. Omnipresent Interactive Concert Ticker */}
      <SignalTicker />

      {/* 2. Top Navigation */}
      <SignalNav />

      {/* 3. Main Page Content with Atmospheric Ambient Gradients */}
      <div className="relative flex-1">
        {/* Ambient Top Glow */}
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-96 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(139,92,246,0.18),rgba(255,255,255,0))]" />

        {children}
      </div>

      {/* 4. Global Undo Toast */}
      <UndoToast />

      {/* 5. Prototype Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950/80 py-8 text-xs text-zinc-500 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-zinc-300">
              ENCORE SIGNAL
            </span>
            <span>•</span>
            <span>Concept 2 Prototype Exploration</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span className="text-zinc-400">Strict Invariants Enforced</span>
            <span>•</span>
            <span className="text-emerald-400">Isolated Prototype Sandbox</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
