import { describe, expect, it } from 'vitest';

import { normalizeLanguages, normalizeRepository } from '../../src/providers/github/provider';
import { GitHubLanguagesSchema, GitHubRepositorySchema } from '../../src/providers/github/schemas';
import reactFixture from '../fixtures/github-repo-react.json';

describe('GitHub repository schema', () => {
  it('accepts a real-shaped repository payload and ignores extra fields', () => {
    const parsed = GitHubRepositorySchema.safeParse(reactFixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.full_name).toBe('react/react');
    expect(parsed.data.stargazers_count).toBe(252573);
  });

  it('normalizes to RepositoryFacts with nulls preserved', () => {
    const parsed = GitHubRepositorySchema.parse(reactFixture);
    const facts = normalizeRepository(parsed, { platform: 'github', host: 'github.com', owner: 'react', repo: 'react' }, '2026-11-13T14:00:00.000Z');
    expect(facts.stars).toBe(252573);
    expect(facts.forks).toBe(52552);
    expect(facts.licenseSpdxId).toBe('MIT');
    expect(facts.primaryLanguage).toBe('JavaScript');
    expect(facts.archived).toBe(false);
    expect(facts.isFork).toBe(false);
    expect(facts.fetchedAt).toBe('2026-11-13T14:00:00.000Z');
  });

  it('keeps null description, license and pushedAt as null — never zero or invented', () => {
    const parsed = GitHubRepositorySchema.parse({
      ...reactFixture,
      description: null,
      license: null,
      pushed_at: null,
      language: null,
    });
    const facts = normalizeRepository(parsed, { platform: 'github', host: 'github.com', owner: 'react', repo: 'react' }, '2026-11-13T14:00:00.000Z');
    expect(facts.description).toBeNull();
    expect(facts.licenseSpdxId).toBeNull();
    expect(facts.pushedAt).toBeNull();
    expect(facts.primaryLanguage).toBeNull();
  });

  it('rejects a payload missing a required field', () => {
    const { stargazers_count: _removed, ...rest } = reactFixture as Record<string, unknown>;
    void _removed;
    expect(GitHubRepositorySchema.safeParse(rest).success).toBe(false);
  });
});

describe('GitHub languages normalization', () => {
  it('converts byte counts to percentages summing to ~100, sorted by bytes', () => {
    const parsed = GitHubLanguagesSchema.parse({ JavaScript: 5629897, Rust: 3025843, TypeScript: 2609522 });
    const breakdown = normalizeLanguages(parsed, '2026-11-13T14:00:00.000Z');
    expect(breakdown.entries[0]?.name).toBe('JavaScript');
    expect(breakdown.entries[0]?.percent).toBeCloseTo(50, 0);
    const total = breakdown.entries.reduce((sum, e) => sum + e.percent, 0);
    // 1-decimal rounding can make the displayed total 99.9–100.1.
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThanOrEqual(100.2);
  });

  it('handles an empty languages object without dividing by zero', () => {
    const breakdown = normalizeLanguages({}, '2026-11-13T14:00:00.000Z');
    expect(breakdown.entries).toEqual([]);
    expect(breakdown.totalBytes).toBe(0);
  });
});
