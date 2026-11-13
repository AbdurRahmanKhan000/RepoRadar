// Theme choice — Build 4 (spec §8.4, FR-13).
// Dark is the initial default; a stored choice wins over the OS
// preference; anything invalid or absent falls back to the OS
// preference ("system"). The resolved theme is applied by setting
// `data-theme` on <html>; the design tokens in src/shared/design.css
// read that attribute (and, when it is absent, prefers-color-scheme).
// Pure logic lives here so it is unit-testable; the hook below is
// the only part that touches chrome.storage / matchMedia.

import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

/** Storage key for the persisted theme choice. */
export const THEME_STORAGE_KEY = 'reporadar:theme';

/** Parse a stored value. Anything that is not an explicit
 *  'light' or 'dark' choice — including 'system', null, garbage —
 *  means "follow the OS". */
export function parseThemeChoice(value: unknown): ThemeChoice {
  if (value === 'light' || value === 'dark') return value;
  return 'system';
}

/** Resolve a choice to the theme actually rendered. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

function osPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

export interface UseThemeResult {
  /** The theme actually rendered right now. */
  resolved: ResolvedTheme;
  /** The stored choice ('system' when nothing is stored). */
  choice: ThemeChoice;
  /** Persist an explicit choice and apply it. */
  setChoice: (choice: ThemeChoice) => void;
  /** Flip between light and dark, persisting the explicit choice. */
  toggle: () => void;
}

/** Read the stored choice, apply the resolved theme, and keep it
 *  in sync with the OS while the choice is 'system'. */
export function useTheme(): UseThemeResult {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme('system', osPrefersDark()));

  useEffect(() => {
    let cancelled = false;
    void browser.storage.local.get(THEME_STORAGE_KEY).then((result) => {
      if (cancelled) return;
      const stored = parseThemeChoice(result[THEME_STORAGE_KEY]);
      setChoiceState(stored);
      const next = resolveTheme(stored, osPrefersDark());
      setResolved(next);
      applyTheme(next);
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      setChoiceState((current) => {
        if (current !== 'system') return current;
        const next = resolveTheme('system', media.matches);
        setResolved(next);
        applyTheme(next);
        return current;
      });
    };
    media.addEventListener('change', onChange);
    return () => {
      cancelled = true;
      media.removeEventListener('change', onChange);
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    const nextResolved = resolveTheme(next, osPrefersDark());
    setResolved(nextResolved);
    applyTheme(nextResolved);
    void browser.storage.local.set({ [THEME_STORAGE_KEY]: next });
  }, []);

  const toggle = useCallback(() => {
    setResolved((current) => {
      const next: ResolvedTheme = current === 'dark' ? 'light' : 'dark';
      setChoiceState(next);
      applyTheme(next);
      void browser.storage.local.set({ [THEME_STORAGE_KEY]: next });
      return next;
    });
  }, []);

  return { resolved, choice, setChoice, toggle };
}
