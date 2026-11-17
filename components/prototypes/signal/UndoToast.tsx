'use client';

import React, { useEffect } from 'react';
import { usePrototypeStore } from '@/lib/prototypes/store';

export function UndoToast() {
  const { undoStack, executeUndo } = usePrototypeStore();

  const latestUndo = undoStack[0];

  // Global keydown handler for Ctrl+Z / Cmd+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (undoStack.length > 0) {
          e.preventDefault();
          executeUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, executeUndo]);

  if (!latestUndo) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-in fade-in slide-in-from-bottom-4 fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 text-sm text-zinc-100 shadow-2xl backdrop-blur-xl duration-200"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-2 animate-pulse rounded-full bg-violet-400" />
        <span className="text-xs font-medium text-zinc-200 sm:text-sm">
          {latestUndo.description}
        </span>
      </div>

      <button
        type="button"
        onClick={executeUndo}
        className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-bold text-white shadow-sm transition-all hover:bg-violet-500 active:scale-95"
      >
        Undo
      </button>
    </div>
  );
}
