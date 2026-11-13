import { describe, expect, it } from 'vitest';

import { parseThemeChoice, resolveTheme } from '../../src/shared/theme';

describe('parseThemeChoice', () => {
  it('keeps an explicit light or dark choice', () => {
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
  });

  it('falls back to system for system, missing, and invalid values', () => {
    expect(parseThemeChoice('system')).toBe('system');
    expect(parseThemeChoice(undefined)).toBe('system');
    expect(parseThemeChoice(null)).toBe('system');
    expect(parseThemeChoice('')).toBe('system');
    expect(parseThemeChoice('sepia')).toBe('system');
    expect(parseThemeChoice(42)).toBe('system');
    expect(parseThemeChoice({ theme: 'dark' })).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('a stored choice wins over the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('system follows the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
