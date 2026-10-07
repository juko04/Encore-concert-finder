'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

interface HubThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const HubThemeContext = createContext<HubThemeContextValue | undefined>(
  undefined,
);

const THEME_STORAGE_KEY = 'encore-hub-theme';

export function HubThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage?.getItem(
          THEME_STORAGE_KEY,
        ) as Theme | null;
        if (stored === 'dark' || stored === 'light') {
          setThemeState(stored);
        } else if (window.matchMedia) {
          const prefersDark = window.matchMedia(
            '(prefers-color-scheme: dark)',
          ).matches;
          setThemeState(prefersDark ? 'dark' : 'light');
        }
      } catch {
        // Fallback gracefully if localStorage is restricted
      }
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Fallback gracefully if localStorage is restricted
      }
    }

    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.remove('dark');
        root.classList.add('light');
      }
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <HubThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      <div
        className={`encore-hub-root ${theme === 'dark' ? 'dark' : ''} min-h-screen`}
        data-theme={theme}
      >
        {children}
      </div>
    </HubThemeContext.Provider>
  );
}

export function useHubTheme() {
  const context = useContext(HubThemeContext);
  if (!context) {
    throw new Error('useHubTheme must be used within a HubThemeProvider');
  }
  return context;
}
