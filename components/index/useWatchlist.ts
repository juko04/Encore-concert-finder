'use client';

import { useState, useCallback, useRef, useSyncExternalStore } from 'react';

const WATCHLIST_STORAGE_KEY = 'encore_watchlist_ids';
const ALERTS_STORAGE_KEY = 'encore_alert_ids';

export interface UndoItem {
  description: string;
  action: () => void;
}

export interface UseWatchlistReturn {
  savedIds: string[];
  alertIds: string[];
  isSaved: (id: string) => boolean;
  hasAlert: (id: string) => boolean;
  toggleSave: (id: string, title?: string) => void;
  toggleAlert: (id: string, title?: string) => void;
  addSaved: (id: string, title?: string) => void;
  removeSaved: (id: string, title?: string) => void;
  undoStack: UndoItem[];
  undo: () => void;
  clearUndo: () => void;
}

/*
 * One shared store for saved shows and alerts, persisted in localStorage.
 *
 * Every card, page and ticker reads the same lists, so saving a show on one card shows up on every
 * other card at once, and two components can never overwrite each other's saves. Changes made in
 * another tab arrive through the `storage` event.
 */

interface WatchlistSnapshot {
  saved: string[];
  alerts: string[];
}

let snapshot: WatchlistSnapshot | null = null;
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function readList(key: string): string[] | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : null;
  } catch {
    // Ignore storage errors in test or sandbox environments
    return null;
  }
}

function loadSnapshot(
  initialSaved: string[],
  initialAlerts: string[],
): WatchlistSnapshot {
  if (!snapshot) {
    snapshot = {
      saved: readList(WATCHLIST_STORAGE_KEY) ?? initialSaved,
      alerts: readList(ALERTS_STORAGE_KEY) ?? initialAlerts,
    };
  }
  return snapshot;
}

function emit() {
  for (const listener of listeners) listener();
}

function writeSnapshot(next: WatchlistSnapshot) {
  snapshot = next;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        WATCHLIST_STORAGE_KEY,
        JSON.stringify(next.saved),
      );
      window.localStorage.setItem(
        ALERTS_STORAGE_KEY,
        JSON.stringify(next.alerts),
      );
    }
  } catch {
    // Ignore storage quota/permission errors; the in-memory store still updates.
  }
  emit();
}

function updateSnapshot(
  change: (current: WatchlistSnapshot) => WatchlistSnapshot,
) {
  const current = loadSnapshot([], []);
  const next = change(current);
  if (next !== current) writeSnapshot(next);
}

function onStorage(event: StorageEvent) {
  if (
    event.key !== null &&
    event.key !== WATCHLIST_STORAGE_KEY &&
    event.key !== ALERTS_STORAGE_KEY
  ) {
    return;
  }
  snapshot = {
    saved: readList(WATCHLIST_STORAGE_KEY) ?? [],
    alerts: readList(ALERTS_STORAGE_KEY) ?? [],
  };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    storageListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useWatchlist(
  initialSavedIds: string[] = [],
  initialAlertIds: string[] = [],
): UseWatchlistReturn {
  // The server (and the first hydration pass) renders the initial lists; the client then switches
  // to the stored lists without a hydration mismatch.
  const serverSnapshotRef = useRef<WatchlistSnapshot>({
    saved: initialSavedIds,
    alerts: initialAlertIds,
  });
  const current = useSyncExternalStore(
    subscribe,
    () =>
      loadSnapshot(
        serverSnapshotRef.current.saved,
        serverSnapshotRef.current.alerts,
      ),
    () => serverSnapshotRef.current,
  );
  const savedIds = current.saved;
  const alertIds = current.alerts;
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);

  const isSaved = useCallback(
    (id: string) => savedIds.includes(id),
    [savedIds],
  );

  const hasAlert = useCallback(
    (id: string) => alertIds.includes(id),
    [alertIds],
  );

  const pushUndo = useCallback((item: UndoItem) => {
    setUndoStack((prev) => [item, ...prev.slice(0, 9)]);
  }, []);

  const addSaved = useCallback(
    (id: string, title?: string) => {
      updateSnapshot((s) =>
        s.saved.includes(id) ? s : { ...s, saved: [...s.saved, id] },
      );
      pushUndo({
        description: title
          ? `Saved "${title}" to watchlist`
          : 'Saved show to watchlist',
        action: () =>
          updateSnapshot((s) =>
            s.saved.includes(id)
              ? { ...s, saved: s.saved.filter((x) => x !== id) }
              : s,
          ),
      });
    },
    [pushUndo],
  );

  const removeSaved = useCallback(
    (id: string, title?: string) => {
      updateSnapshot((s) =>
        s.saved.includes(id)
          ? { ...s, saved: s.saved.filter((x) => x !== id) }
          : s,
      );
      pushUndo({
        description: title
          ? `Removed "${title}" from watchlist`
          : 'Removed show from watchlist',
        action: () =>
          updateSnapshot((s) =>
            s.saved.includes(id) ? s : { ...s, saved: [...s.saved, id] },
          ),
      });
    },
    [pushUndo],
  );

  const toggleSave = useCallback(
    (id: string, title?: string) => {
      if (loadSnapshot([], []).saved.includes(id)) {
        removeSaved(id, title);
      } else {
        addSaved(id, title);
      }
    },
    [addSaved, removeSaved],
  );

  const toggleAlert = useCallback(
    (id: string, title?: string) => {
      const exists = loadSnapshot([], []).alerts.includes(id);
      const setAlert = (on: boolean) =>
        updateSnapshot((s) => {
          const has = s.alerts.includes(id);
          if (has === on) return s;
          return {
            ...s,
            alerts: on ? [...s.alerts, id] : s.alerts.filter((x) => x !== id),
          };
        });
      setAlert(!exists);
      pushUndo({
        description: exists
          ? title
            ? `Turned off alerts for "${title}"`
            : 'Turned off alerts'
          : title
            ? `Turned on alerts for "${title}"`
            : 'Turned on alerts',
        action: () => setAlert(exists),
      });
    },
    [pushUndo],
  );

  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;
  const undo = useCallback(() => {
    // Run the store change outside a state updater: it notifies other components.
    const [top, ...rest] = undoStackRef.current;
    if (!top) return;
    undoStackRef.current = rest;
    setUndoStack(rest);
    top.action();
  }, []);

  const clearUndo = useCallback(() => {
    setUndoStack([]);
  }, []);

  return {
    savedIds,
    alertIds,
    isSaved,
    hasAlert,
    toggleSave,
    toggleAlert,
    addSaved,
    removeSaved,
    undoStack,
    undo,
    clearUndo,
  };
}
