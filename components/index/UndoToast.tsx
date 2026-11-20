'use client';

import React, { useEffect, useState } from 'react';
import { UndoIcon, XIcon, CheckIcon } from './icons';

export interface UndoToastItem {
  description: string;
  action?: () => void;
}

export interface UndoToastProps {
  undoStack: UndoToastItem[];
  onUndo: () => void;
  onDismiss?: () => void;
  durationMs?: number;
}

export function UndoToast({
  undoStack,
  onUndo,
  onDismiss,
  durationMs = 6500,
}: UndoToastProps) {
  const [visible, setVisible] = useState(false);
  const [currentDescription, setCurrentDescription] = useState<string | null>(
    null,
  );

  const currentUndo = undoStack[0];

  useEffect(() => {
    if (currentUndo) {
      setCurrentDescription(currentUndo.description);
      setVisible(true);

      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, durationMs);

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [currentUndo, durationMs, onDismiss]);

  if (!visible || !currentDescription) return null;

  return (
    <aside
      aria-label="Notification with undo option"
      role="status"
      className="animate-in fade-in slide-in-from-bottom-3 fixed bottom-6 right-6 z-50 max-w-md duration-200"
    >
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-all">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
          <CheckIcon className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0 pr-2 text-sm font-medium text-zinc-900">
          {currentDescription}
        </div>

        <button
          type="button"
          onClick={() => {
            onUndo();
            setVisible(false);
          }}
          className="shadow-xs ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
        >
          <UndoIcon className="h-3.5 w-3.5" />
          <span>Undo</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setVisible(false);
            onDismiss?.();
          }}
          className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          aria-label="Dismiss notification"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}
