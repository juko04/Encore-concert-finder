'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

export function useWatchlist(
  initialSavedIds: string[] = [],
  initialAlertIds: string[] = [],
): UseWatchlistReturn {
  const [savedIds, setSavedIds] = useState<string[]>(initialSavedIds);
  const [alertIds, setAlertIds] = useState<string[]>(initialAlertIds);
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const isHydratedRef = useRef(false);

  // Load from localStorage on client mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const storedSaved = localStorage.getItem(WATCHLIST_STORAGE_KEY);
        if (storedSaved) {
          const parsed = JSON.parse(storedSaved);
          if (Array.isArray(parsed)) {
            setSavedIds(parsed);
          }
        }
        const storedAlerts = localStorage.getItem(ALERTS_STORAGE_KEY);
        if (storedAlerts) {
          const parsed = JSON.parse(storedAlerts);
          if (Array.isArray(parsed)) {
            setAlertIds(parsed);
          }
        }
      }
    } catch {
      // Ignore storage errors in test or sandbox environments
    } finally {
      isHydratedRef.current = true;
    }
  }, []);

  // Sync savedIds to localStorage
  useEffect(() => {
    if (!isHydratedRef.current) return;
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(savedIds));
      }
    } catch {
      // Ignore storage quota/permission errors
    }
  }, [savedIds]);

  // Sync alertIds to localStorage
  useEffect(() => {
    if (!isHydratedRef.current) return;
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alertIds));
      }
    } catch {
      // Ignore storage errors
    }
  }, [alertIds]);

  const isSaved = useCallback(
    (id: string) => savedIds.includes(id),
    [savedIds],
  );

  const hasAlert = useCallback(
    (id: string) => alertIds.includes(id),
    [alertIds],
  );

  const addSaved = useCallback((id: string, title?: string) => {
    setSavedIds((prev) => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
    setUndoStack((prev) => [
      {
        description: title
          ? `Saved "${title}" to watchlist`
          : 'Saved show to watchlist',
        action: () => {
          setSavedIds((current) => current.filter((x) => x !== id));
        },
      },
      ...prev.slice(0, 9),
    ]);
  }, []);

  const removeSaved = useCallback((id: string, title?: string) => {
    setSavedIds((prev) => prev.filter((x) => x !== id));
    setUndoStack((prev) => [
      {
        description: title
          ? `Removed "${title}" from watchlist`
          : 'Removed show from watchlist',
        action: () => {
          setSavedIds((current) =>
            current.includes(id) ? current : [...current, id],
          );
        },
      },
      ...prev.slice(0, 9),
    ]);
  }, []);

  const toggleSave = useCallback(
    (id: string, title?: string) => {
      if (savedIds.includes(id)) {
        removeSaved(id, title);
      } else {
        addSaved(id, title);
      }
    },
    [savedIds, addSaved, removeSaved],
  );

  const toggleAlert = useCallback((id: string, title?: string) => {
    setAlertIds((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
      setUndoStack((undoPrev) => [
        {
          description: exists
            ? title
              ? `Turned off alerts for "${title}"`
              : 'Turned off alerts'
            : title
              ? `Turned on alerts for "${title}"`
              : 'Turned on alerts',
          action: () => {
            setAlertIds((current) =>
              exists
                ? current.includes(id)
                  ? current
                  : [...current, id]
                : current.filter((x) => x !== id),
            );
          },
        },
        ...undoPrev.slice(0, 9),
      ]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const [top, ...rest] = prev;
      top.action();
      return rest;
    });
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
