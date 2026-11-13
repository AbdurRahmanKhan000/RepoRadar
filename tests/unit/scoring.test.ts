import { describe, expect, it } from 'vitest';

import { buildReport, gradeFor, scoreCategories, scoreSignals } from '../../src/analysis/scoring';
import {
  FIXED_NOW,
  activeRepo,
  archivedRepo,
  makeActivity,
  makeFacts,
  noReleaseRepo,
  tinyRepo,
} from './scoring-fixtures';

function category(report: ReturnType<typeof buildReport>, key: string) {
  const found = report.categories.find((c) => c.key === key);
  if (!found) throw new Error(`missing category ${key}`);
  return found;
}

function signal(report: ReturnType<typeof buildReport>, key: string) {
  for (const c of report.categories) {
    const found = c.signals.find((s) => s.key === key);
    if (found) return found;
  }
  throw new Error(`missing signal ${key}`);
}

describe('scoring — active repo (react-like)', () => {
  const { facts, activity } = activeRepo();
  const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });

  it('scores ~94, grade A, full coverage, high confidence', () => {
    expect(report.overallScore).toBeCloseTo(94.2, 0);
    expect(report.grade).toBe('A');
    expect(report.coverage).toBe(100);
    expect(report.confidence).toBe('high');
    expect(report.provisional).toBe(false);
    expect(report.scoreModelVersion).toBe('1.0.0');
  });

  it('scores each category from its signals', () => {
    expect(category(report, 'maintenance').score).toBeCloseTo(99.6, 0);
    expect(category(report, 'community').score).toBeCloseTo(96, 0);
    expect(category(report, 'issues').score).toBeCloseTo(81.5, 0);
    expect(category(report, 'releases').score).toBeCloseTo(92.3, 0);
    expect(category(report, 'docs').score).toBe(100);
    expect(category(report, 'adoption').score).toBe(100);
    for (const c of report.categories) expect(c.status).toBe('available');
  });

  it('scores individual signals from their formulas', () => {
    expect(signal(report, 'daysSincePush').score).toBeCloseTo(99.2, 1);
    expect(signal(report, 'recentCommits').score).toBe(100);
    expect(signal(report, 'concentration').score).toBeCloseTo(88, 0);
    expect(signal(report, 'issueClosureRatio').score).toBe(80);
    expect(signal(report, 'prMergeRatio').score).toBe(75);
    expect(signal(report, 'releaseFrequency').score).toBe(100);
  });

  it('observes the evidence in plain language', () => {
    expect(report.observations.good).toContain('Pushed 1 day ago — recent maintenance activity is visible.');
    expect(report.observations.good).toContain('50 commits in the last 30 days.');
    expect(report.observations.good).toContain('12 distinct contributors in the last 90 days.');
    expect(report.observations.good).toContain('6 releases in the last 12 months.');
    expect(report.observations.caution).toHaveLength(0);
  });

  it('never claims security, safety, or code quality', () => {
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/secure|safe|production-ready|high-quality code|bug-free/i);
  });
});

describe('scoring — archived repo', () => {
  const { facts, activity } = archivedRepo();
  const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });

  it('scores ~18, grade F, with the archived observation', () => {
    expect(report.overallScore).toBeCloseTo(18.1, 0);
    expect(report.grade).toBe('F');
    expect(report.coverage).toBeCloseTo(93.3, 1);
    expect(report.confidence).toBe('high');
    expect(report.observations.caution).toContain(
      'Archived — no longer maintained. The repository is read-only on GitHub.',
    );
    expect(report.observations.caution).toContain('No push in 900 days — the repository looks inactive.');
    expect(report.observations.caution).toContain('Top contributor wrote 60% of commits — contribution is concentrated in one person.');
  });

  it('keeps the missing PR signal null instead of scoring it 0', () => {
    expect(signal(report, 'prMergeRatio').score).toBeNull();
    expect(category(report, 'issues').status).toBe('partial');
  });
});

describe('scoring — tiny new repo', () => {
  const { facts, activity } = tinyRepo();
  const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });

  it('scores ~31, grade F, medium confidence at 72.5% coverage', () => {
    expect(report.overallScore).toBeCloseTo(30.8, 0);
    expect(report.grade).toBe('F');
    expect(report.coverage).toBeCloseTo(72.5, 1);
    expect(report.confidence).toBe('medium');
    expect(report.provisional).toBe(false);
  });

  it('marks the issue category unknown and the release category partial', () => {
    expect(category(report, 'issues').status).toBe('unknown');
    expect(category(report, 'issues').score).toBeNull();
    expect(category(report, 'releases').status).toBe('partial');
    // No releases: recency is null, but frequency 0 is evidence (scores 10).
    expect(signal(report, 'releaseRecency').score).toBeNull();
    expect(signal(report, 'releaseFrequency').score).toBe(10);
    expect(category(report, 'releases').score).toBe(10);
  });

  it('renormalizes weights over available categories only', () => {
    // Issues (20%) is unknown, so the overall is the weighted mean
    // over the other 80% of weight — not dragged down by a silent 0.
    expect(report.overallScore).toBeGreaterThan(25);
  });
});

describe('scoring — active repo with no releases', () => {
  const { facts, activity } = noReleaseRepo();
  const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });

  it('scores ~82, grade B, and says plainly that no releases exist', () => {
    expect(report.overallScore).toBeCloseTo(81.9, 0);
    expect(report.grade).toBe('B');
    expect(report.coverage).toBeCloseTo(92.5, 1);
    expect(report.observations.caution).toContain('No releases published — release recency cannot be assessed.');
  });
});

describe('scoring — truncated sample caps confidence', () => {
  it('caps confidence at medium when the contributor page is full', () => {
    const { facts, activity } = activeRepo();
    const truncated = {
      ...activity,
      truncated: { ...activity.truncated, contributors: true },
    };
    const report = buildReport(facts, truncated, { nowMs: FIXED_NOW, evidence: [] });
    expect(report.coverage).toBe(100);
    expect(report.confidence).toBe('medium');
    expect(report.sampleNotes).toContain(
      'Contributor sample capped at its page limit — the sample may not represent the whole repository.',
    );
  });
});

describe('scoring — provisional report', () => {
  it('withholds the score when coverage is below 40%', () => {
    const facts = makeFacts({ stars: 10, forks: 2, pushedAt: null });
    const activity = makeActivity({
      contributors: null,
      commits: null,
      releases: null,
      issues: null,
      pulls: null,
      communityProfile: null,
      ciWorkflowsPresent: null,
    });
    const report = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });
    // Only daysSincePush (null), stars and forks score: 10% coverage.
    expect(report.coverage).toBeCloseTo(10, 1);
    expect(report.provisional).toBe(true);
    expect(report.overallScore).toBeNull();
    expect(report.grade).toBeNull();
    expect(report.confidence).toBe('low');
    expect(report.observations.unknown.length).toBeGreaterThan(0);
  });
});

describe('scoring — determinism and grades', () => {
  it('produces byte-identical reports for the same inputs', () => {
    const { facts, activity } = activeRepo();
    const a = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });
    const b = buildReport(facts, activity, { nowMs: FIXED_NOW, evidence: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('applies the grade bands', () => {
    expect(gradeFor(95)).toBe('A');
    expect(gradeFor(90)).toBe('A');
    expect(gradeFor(89.9)).toBe('B');
    expect(gradeFor(75)).toBe('B');
    expect(gradeFor(74.9)).toBe('C');
    expect(gradeFor(60)).toBe('C');
    expect(gradeFor(59.9)).toBe('D');
    expect(gradeFor(40)).toBe('D');
    expect(gradeFor(39.9)).toBe('F');
    expect(gradeFor(0)).toBe('F');
    expect(gradeFor(null)).toBeNull();
  });

  it('scoreSignals and scoreCategories agree on categories', () => {
    const { facts, activity } = activeRepo();
    const signals = scoreSignals(facts, activity, FIXED_NOW);
    const categories = scoreCategories(signals);
    expect(categories).toHaveLength(6);
    expect(categories.map((c) => c.signals).flat()).toHaveLength(signals.length);
  });
});
