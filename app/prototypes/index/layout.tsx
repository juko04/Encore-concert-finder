'use client';

import React from 'react';
import Link from 'next/link';
import { usePrototypeStore } from '@/lib/prototypes/store';
import { Header } from '@/components/prototypes/index/Header';
import { UndoToast } from '@/components/prototypes/index/UndoToast';

export default function EncoreIndexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    viewMode,
    setViewMode,
    savedEventIds,
    alertEventIds,
    undoStack,
    executeUndo,
    resetToDemoDefaults,
  } = usePrototypeStore();

  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf9] font-sans text-zinc-900 antialiased selection:bg-zinc-900 selection:text-white">
      {/* Editorial Header */}
      <Header
        viewMode={viewMode}
        onToggleMode={setViewMode}
        savedCount={savedEventIds.length}
        alertCount={alertEventIds.length}
      />

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>

      {/* Global Undo Toast Banner */}
      <UndoToast undoStack={undoStack} onUndo={executeUndo} />

      {/* Minimal Editorial Footer */}
      <footer className="border-t border-zinc-200/80 bg-white py-8 text-xs text-zinc-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-800">ENCORE INDEX</span>
            <span>·</span>
            <span>Independent Live-Music Search & Discovery Prototype</span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/prototypes/index/preferences"
              className="hover:text-zinc-900 hover:underline"
            >
              Taste Profile Rules
            </Link>
            <span>·</span>
            <button
              type="button"
              onClick={resetToDemoDefaults}
              className="hover:text-zinc-900 hover:underline"
            >
              Reset Demo State
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
