'use client';

import React, { useEffect, useState } from 'react';
import { UndoIcon, XIcon, CheckIcon } from './icons';

interface UndoToastProps {
  undoStack: Array<{
    description: string;
    action: () => void;
  }>;
  onUndo: () => void;
}

export function UndoToast({ undoStack, onUndo }: UndoToastProps) {
  const [visible, setVisible] = useState(false);
  const [lastItemDesc, setLastItemDesc] = useState<string | null>(null);

  const currentUndo = undoStack[0];

  useEffect(() => {
    if (currentUndo) {
      setLastItemDesc(currentUndo.description);
      setVisible(true);

      const timer = setTimeout(() => {
        setVisible(false);
      }, 6500);

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [currentUndo]);

  if (!visible || !lastItemDesc) return null;

  return (
    <aside
      aria-label="Notification with undo option"
      className="animate-in fade-in slide-in-from-bottom-3 fixed bottom-6 right-6 z-50 max-w-md duration-200"
    >
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
          <CheckIcon className="h-3.5 w-3.5" />
        </div>

        <div className="pr-2 text-sm font-medium text-zinc-900">
          {lastItemDesc}
        </div>

        <button
          onClick={() => {
            onUndo();
            setVisible(false);
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
        >
          <UndoIcon className="h-3.5 w-3.5" />
          <span>Undo</span>
        </button>

        <button
          onClick={() => setVisible(false)}
          className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          aria-label="Dismiss notification"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}
