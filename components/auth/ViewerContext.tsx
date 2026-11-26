'use client';

import React, { createContext, useContext } from 'react';

export interface Viewer {
  isAuthenticated: boolean;
  /** Home city label as the server saw it (cookie/profile), so pickers render it on first paint. */
  homeLabel?: string | null;
}

/**
 * Who is looking at the page, resolved once on the server in the root layout. Defaults to
 * signed-in so components rendered outside the provider (unit tests, isolated previews) keep
 * their full behaviour; the root layout always provides the real value.
 */
const ViewerContext = createContext<Viewer>({ isAuthenticated: true });

export function ViewerProvider({
  isAuthenticated,
  homeLabel = null,
  children,
}: {
  isAuthenticated: boolean;
  homeLabel?: string | null;
  children: React.ReactNode;
}) {
  return (
    <ViewerContext.Provider value={{ isAuthenticated, homeLabel }}>
      {children}
    </ViewerContext.Provider>
  );
}

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}
