'use client';

/**
 * Shared Prototype Client Store & Local State
 *
 * Invariants & Boundaries:
 * 1. Prototype-only client state stored in browser localStorage with in-memory fallbacks.
 * 2. Provides deterministic test actions: save/unsave event, toggle alerts,
 *    update artist preferences with one-click unfavorite/ignore and Undo history.
 * 3. Supports instant toggle between Authenticated and Guest viewer mode
 *    without requiring a real login session or network calls.
 * 4. Completely isolated from production Supabase database.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  PROTOTYPE_EVENTS,
  PROTOTYPE_INITIAL_PREFERENCES,
  type PrototypeUserPreference,
} from './fixtures';

export type UserViewMode = 'authenticated' | 'guest';

export interface PrototypeState {
  savedEventIds: string[];
  alertEventIds: string[];
  preferences: PrototypeUserPreference[];
  viewMode: UserViewMode;
  undoStack: Array<{
    description: string;
    action: () => void;
  }>;
}

const STORAGE_KEY = 'encore_prototype_state_v1';

export function getInitialState(): PrototypeState {
  return {
    savedEventIds: ['proto-ev-103'], // The Cure pre-saved in watchlist for demo
    alertEventIds: ['proto-ev-103'], // The Cure presale alert enabled
    preferences: [...PROTOTYPE_INITIAL_PREFERENCES],
    viewMode: 'authenticated',
    undoStack: [],
  };
}

export function usePrototypeStore() {
  const [state, setState] = useState<PrototypeState>(getInitialState);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setState((prev) => ({
          ...prev,
          ...parsed,
          undoStack: [], // Don't persist closures
        }));
      }
    } catch {
      // Fallback to default
    }
    setIsHydrated(true);
  }, []);

  const saveToStorage = useCallback(
    (updater: (prev: PrototypeState) => PrototypeState) => {
      setState((prev) => {
        const next = updater(prev);
        try {
          const { undoStack: _ignored, ...persistable } = next;
          void _ignored;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
        } catch {
          // LocalStorage quota or blocked
        }
        return next;
      });
    },
    [],
  );

  const toggleSaveEvent = useCallback(
    (eventId: string) => {
      saveToStorage((prev) => {
        const isSaved = prev.savedEventIds.includes(eventId);
        const nextSaved = isSaved
          ? prev.savedEventIds.filter((id) => id !== eventId)
          : [...prev.savedEventIds, eventId];

        // If removing from saved, also clear alert if present
        const nextAlerts = isSaved
          ? prev.alertEventIds.filter((id) => id !== eventId)
          : prev.alertEventIds;

        return {
          ...prev,
          savedEventIds: nextSaved,
          alertEventIds: nextAlerts,
        };
      });
    },
    [saveToStorage],
  );

  const toggleAlertEvent = useCallback(
    (eventId: string) => {
      saveToStorage((prev) => {
        const hasAlert = prev.alertEventIds.includes(eventId);
        const nextAlerts = hasAlert
          ? prev.alertEventIds.filter((id) => id !== eventId)
          : [...prev.alertEventIds, eventId];

        // Setting an alert also ensures the event is in the watchlist
        const nextSaved =
          !hasAlert && !prev.savedEventIds.includes(eventId)
            ? [...prev.savedEventIds, eventId]
            : prev.savedEventIds;

        return {
          ...prev,
          savedEventIds: nextSaved,
          alertEventIds: nextAlerts,
        };
      });
    },
    [saveToStorage],
  );

  const setViewMode = useCallback(
    (mode: UserViewMode) => {
      saveToStorage((prev) => ({ ...prev, viewMode: mode }));
    },
    [saveToStorage],
  );

  const setArtistPreference = useCallback(
    (
      artistId: string,
      artistName: string,
      level: 'favorite' | 'like' | 'interested' | 'ignore',
    ) => {
      saveToStorage((prev) => {
        const existing = prev.preferences.find((p) => p.artistId === artistId);
        const prevLevel = existing?.level;

        const nextPrefs = prev.preferences.filter(
          (p) => p.artistId !== artistId,
        );
        nextPrefs.push({
          artistId,
          artistName,
          level,
          source: 'explicit',
          addedAt: new Date().toISOString(),
        });

        const undoAction = () => {
          saveToStorage((current) => {
            const reverted = current.preferences.filter(
              (p) => p.artistId !== artistId,
            );
            if (prevLevel) {
              reverted.push({
                artistId,
                artistName,
                level: prevLevel,
                source: existing?.source || 'explicit',
                addedAt: existing?.addedAt || new Date().toISOString(),
              });
            }
            return {
              ...current,
              preferences: reverted,
              undoStack: current.undoStack.slice(1),
            };
          });
        };

        return {
          ...prev,
          preferences: nextPrefs,
          undoStack: [
            {
              description: `Changed ${artistName} to ${level}`,
              action: undoAction,
            },
            ...prev.undoStack.slice(0, 4), // Keep max 5 undos
          ],
        };
      });
    },
    [saveToStorage],
  );

  const removeArtistPreference = useCallback(
    (artistId: string) => {
      saveToStorage((prev) => {
        const existing = prev.preferences.find((p) => p.artistId === artistId);
        if (!existing) return prev;

        const nextPrefs = prev.preferences.filter(
          (p) => p.artistId !== artistId,
        );

        const undoAction = () => {
          saveToStorage((current) => ({
            ...current,
            preferences: [...current.preferences, existing],
            undoStack: current.undoStack.slice(1),
          }));
        };

        return {
          ...prev,
          preferences: nextPrefs,
          undoStack: [
            {
              description: `Restored ${existing.artistName}`,
              action: undoAction,
            },
            ...prev.undoStack.slice(0, 4),
          ],
        };
      });
    },
    [saveToStorage],
  );

  const executeUndo = useCallback(() => {
    if (state.undoStack.length === 0) return;
    const nextUndo = state.undoStack[0];
    nextUndo.action();
  }, [state.undoStack]);

  const resetToDemoDefaults = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setState(getInitialState());
  }, []);

  return {
    events: PROTOTYPE_EVENTS,
    savedEventIds: state.savedEventIds,
    alertEventIds: state.alertEventIds,
    preferences: state.preferences,
    viewMode: state.viewMode,
    undoStack: state.undoStack,
    isHydrated,
    toggleSaveEvent,
    toggleAlertEvent,
    setViewMode,
    setArtistPreference,
    removeArtistPreference,
    executeUndo,
    resetToDemoDefaults,
  };
}
