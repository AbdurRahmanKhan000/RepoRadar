// Build 5: compare table rows, best-in-row marking, and the
// 3-repo cap — all pure, all deterministic on fixture reports.

import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/analysis/scoring';
import type { OverviewResult } from '../../src/domain/repository';
import {
  buildCompareRows,
  canAddToCompare,
  contributorCount,
  daysSincePush,
  issueClosureRatio,
  MAX_COMPARE_REPOS,
  type CompareEntry,
} from '../../src/compare/compare';
import { activeRepo, archivedRepo, FIXED_NOW, makeFacts, tinyRepo } from './scoring-fixtures';

function makeEntry(factsOverrides: ReturnType<typeof makeFacts>, activity: ReturnType<typeof activeRepo>['activity'], owner = 'test', repo = 'repo'): CompareEntry {
  const facts = factsOverrides;
  const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });
  const overview: OverviewResult = {
    ref: { platform: 'github', host: 'github.com', owner, repo },
    facts,
    languages: null,
    languagesError: null,
    liveError: null,
    evidence: [],
    rateLimit: null,
    fromCache: false,
    stale: false,
    fetchedAt: new Date(FIXED_NOW).toISOString(),
  };
  return { repoId: report.repoId, overview, report, activity };
}

describe('compare table', () => {
  it('builds one row per metric with values in entry order', () => {
    const a = activeRepo();
    const b = archivedRepo();
    const entries = [makeEntry(a.facts, a.activity, 'test', 'active'), makeEntry(b.facts, b.activity, 'test', 'old')];
    const rows = buildCompareRows(entries);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain('overall');
    expect(keys).toContain('grade');
    expect(keys).toContain('coverage');
    expect(keys).toContain('confidence');
    expect(keys).toContain('category:maintenance');
    expect(keys).toContain('category:community');
    expect(keys).toContain('category:issues');
    expect(keys).toContain('category:releases');
    expect(keys).toContain('category:docs');
    expect(keys).toContain('category:adoption');
    expect(keys).toContain('stars');
    expect(keys).toContain('forks');
    expect(keys).toContain('daysSincePush');
    expect(keys).toContain('contributors');
    expect(keys).toContain('issueClosure');

    const overall = rows.find((r) => r.key === 'overall') as (typeof rows)[number];
    expect(overall.values).toEqual([94.2, 18.1]);
    const stars = rows.find((r) => r.key === 'stars') as (typeof rows)[number];
    expect(stars.values).toEqual([250000, 500]);
  });

  it('marks the best value in each row, with a text marker — never a null', () => {
    const a = activeRepo();
    const b = archivedRepo();
    const entries = [makeEntry(a.facts, a.activity), makeEntry(b.facts, b.activity)];
    const rows = buildCompareRows(entries);
    const overall = rows.find((r) => r.key === 'overall') as (typeof rows)[number];
    expect(overall.best).toEqual([true, false]);
    const grade = rows.find((r) => r.key === 'grade') as (typeof rows)[number];
    expect(grade.values).toEqual(['A', 'F']);
    expect(grade.best).toEqual([true, false]);
    // Days since push: lower is better — the archived repo (900
    // days) must NOT win; the active repo (1 day) must.
    const push = rows.find((r) => r.key === 'daysSincePush') as (typeof rows)[number];
    expect(push.values).toEqual([1, 900]);
    expect(push.best).toEqual([true, false]);
    // Issue closure: active repo closes 80/100 = 80%.
    const closure = rows.find((r) => r.key === 'issueClosure') as (typeof rows)[number];
    expect(closure.values[0]).toBe(80);
    expect(closure.best[0]).toBe(true);
  });

  it('marks ties as best in every tied column and never lets a null win', () => {
    const a = tinyRepo();
    const entries = [
      makeEntry(a.facts, a.activity, 'test', 'tiny-a'),
      makeEntry(a.facts, a.activity, 'test', 'tiny-b'),
    ];
    const rows = buildCompareRows(entries);
    const overall = rows.find((r) => r.key === 'overall') as (typeof rows)[number];
    expect(overall.values).toEqual([30.8, 30.8]);
    expect(overall.best).toEqual([true, true]);
    // Tiny repo has no issues in the sample: closure is null in
    // both columns, so neither is best.
    const closure = rows.find((r) => r.key === 'issueClosure') as (typeof rows)[number];
    expect(closure.values).toEqual([null, null]);
    expect(closure.best).toEqual([false, false]);
  });

  it('derives days since push, contributor count and issue closure from the entries', () => {
    const a = activeRepo();
    const entry = makeEntry(a.facts, a.activity);
    expect(daysSincePush(entry)).toBe(1);
    expect(contributorCount(entry)).toBe(200);
    expect(issueClosureRatio(entry)).toBe(80);
  });
});

describe('compare cap', () => {
  it('is 3 repositories', () => {
    expect(MAX_COMPARE_REPOS).toBe(3);
  });

  it('allows the first three, refuses a fourth', () => {
    const selected = ['github:a/a', 'github:b/b'];
    expect(canAddToCompare(selected, 'github:c/c')).toEqual({ allowed: true });
    const three = ['github:a/a', 'github:b/b', 'github:c/c'];
    expect(canAddToCompare(three, 'github:d/d')).toEqual({ allowed: false, reason: 'cap' });
  });

  it('refuses a repo that is already selected', () => {
    expect(canAddToCompare(['github:a/a'], 'github:a/a')).toEqual({
      allowed: false,
      reason: 'already-selected',
    });
  });
});
