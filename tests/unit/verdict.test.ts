// 0.3.0 — verdict: all four states, rule priority, and the
// evidence key on every reason.

import { describe, expect, it } from 'vitest';

import { buildVerdict, type VerdictInput } from '../../src/analysis/verdict';

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    overallScore: 94,
    grade: 'A',
    coverage: 92,
    confidence: 'high',
    provisional: false,
    archived: false,
    daysSincePush: 1,
    daysSinceLatestRelease: 30,
    hasEverReleased: true,
    releasesKnown: true,
    medianOpenIssueAgeDays: 20,
    trajectory: 'stable',
    supplyChain: {
      status: 'ok',
      riskLabel: 'low',
      criticalCount: 0,
      highCount: 0,
      totalVulnerabilities: 0,
      depsScanned: 12,
    },
    unknownCategories: [],
    ...overrides,
  };
}

describe('buildVerdict — Use it', () => {
  it('says Use it for a healthy repo with clean dependencies', () => {
    const verdict = buildVerdict(input());
    expect(verdict.label).toBe('use');
    expect(verdict.title).toBe('Use it');
    expect(verdict.subtitle).toContain('Adoption signal');
    expect(verdict.modelVersion).toBe('1.0.0');
    expect(verdict.reasons.map((r) => r.evidenceKey)).toContain('overallScore');
    expect(verdict.reasons.map((r) => r.evidenceKey)).toContain('supplyChain');
  });
  it('says Use it for a repo that never released, judged on activity', () => {
    const verdict = buildVerdict(
      input({ hasEverReleased: false, daysSinceLatestRelease: null }),
    );
    expect(verdict.label).toBe('use');
    expect(verdict.reasons.some((r) => r.text.includes('No releases yet'))).toBe(true);
  });
  it('says Use it when there is no manifest to check', () => {
    const verdict = buildVerdict(
      input({ supplyChain: { status: 'no-manifest', riskLabel: null, criticalCount: 0, highCount: 0, totalVulnerabilities: 0, depsScanned: 0 } }),
    );
    expect(verdict.label).toBe('use');
    expect(verdict.reasons.some((r) => r.text.includes('No dependencies to check'))).toBe(true);
  });
  it('says Use it with a growing trajectory', () => {
    const verdict = buildVerdict(input({ trajectory: 'growing' }));
    expect(verdict.label).toBe('use');
    expect(verdict.reasons.some((r) => r.text.includes('growing'))).toBe(true);
  });
});

describe('buildVerdict — Stay away', () => {
  it('says Stay away for an archived repo, even with a good score', () => {
    const verdict = buildVerdict(input({ archived: true }));
    expect(verdict.label).toBe('avoid');
    expect(verdict.title).toBe('Stay away');
    expect(verdict.reasons[0]?.text).toContain('archived');
    expect(verdict.reasons[0]?.evidenceKey).toBe('archived');
  });
  it('says Stay away for a low score with good coverage', () => {
    const verdict = buildVerdict(input({ overallScore: 18, grade: 'F', coverage: 90 }));
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons.some((r) => r.text.includes('below 40'))).toBe(true);
  });
  it('says Stay away on one critical vulnerability', () => {
    const verdict = buildVerdict(
      input({
        supplyChain: { status: 'ok', riskLabel: 'high', criticalCount: 1, highCount: 0, totalVulnerabilities: 1, depsScanned: 8 },
      }),
    );
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons.some((r) => r.text.includes('1 critical vulnerability'))).toBe(true);
  });
  it('says Stay away when nothing moved in a year', () => {
    const verdict = buildVerdict(input({ daysSincePush: 400, daysSinceLatestRelease: 500 }));
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons.some((r) => r.text.includes('No push in 400 days'))).toBe(true);
  });
  it('counts a never-released repo as having no release in a year', () => {
    const verdict = buildVerdict(
      input({ daysSincePush: 400, daysSinceLatestRelease: null, hasEverReleased: false }),
    );
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons.some((r) => r.text.includes('never had a release'))).toBe(true);
  });
  it('says Stay away for a declining repo with a low score', () => {
    const verdict = buildVerdict(input({ overallScore: 55, grade: 'D', trajectory: 'declining' }));
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons.some((r) => r.text.includes('declining'))).toBe(true);
  });
  it('archived beats every other rule (priority order)', () => {
    const verdict = buildVerdict(
      input({
        archived: true,
        overallScore: 18,
        trajectory: 'declining',
        supplyChain: { status: 'ok', riskLabel: 'high', criticalCount: 2, highCount: 1, totalVulnerabilities: 3, depsScanned: 5 },
      }),
    );
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons[0]?.evidenceKey).toBe('archived');
  });
});

describe('buildVerdict — Use with caution', () => {
  it('says caution for a middling score', () => {
    const verdict = buildVerdict(input({ overallScore: 60, grade: 'C' }));
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('middling'))).toBe(true);
  });
  it('says caution on a high vulnerability (not critical)', () => {
    const verdict = buildVerdict(
      input({
        supplyChain: { status: 'ok', riskLabel: 'moderate', criticalCount: 0, highCount: 2, totalVulnerabilities: 2, depsScanned: 10 },
      }),
    );
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('2 high-severity'))).toBe(true);
  });
  it('says caution for a declining trajectory alone', () => {
    const verdict = buildVerdict(input({ trajectory: 'declining' }));
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.evidenceKey === 'trajectory')).toBe(true);
  });
  it('says caution for low coverage', () => {
    const verdict = buildVerdict(input({ coverage: 55 }));
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('Coverage is 55%'))).toBe(true);
  });
  it('says caution when the last release is over a year old', () => {
    const verdict = buildVerdict(input({ daysSinceLatestRelease: 400 }));
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('No release in over a year'))).toBe(true);
  });
  it('does NOT penalise a never-released repo for having no release', () => {
    const verdict = buildVerdict(
      input({ hasEverReleased: false, daysSinceLatestRelease: null }),
    );
    expect(verdict.label).toBe('use');
    expect(verdict.reasons.some((r) => r.text.includes('No release in over a year'))).toBe(false);
  });
  it('says caution for elevated supply-chain risk', () => {
    const verdict = buildVerdict(
      input({
        supplyChain: { status: 'ok', riskLabel: 'elevated', criticalCount: 0, highCount: 0, totalVulnerabilities: 1, depsScanned: 6 },
      }),
    );
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('Supply-chain risk is elevated'))).toBe(true);
  });
  it('withholds Use it when the supply-chain check failed', () => {
    const verdict = buildVerdict(
      input({
        supplyChain: { status: 'unknown', riskLabel: null, criticalCount: 0, highCount: 0, totalVulnerabilities: 0, depsScanned: 0 },
      }),
    );
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('could not be checked'))).toBe(true);
  });
  it('withholds Use it when release history is unknown', () => {
    const verdict = buildVerdict(input({ releasesKnown: false }));
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('Release history could not be checked'))).toBe(true);
  });
  it('adds a supporting reason for very old open issues', () => {
    const verdict = buildVerdict(input({ overallScore: 60, grade: 'C', medianOpenIssueAgeDays: 240 }));
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.some((r) => r.text.includes('median open issue is 240 days old'))).toBe(true);
  });
  it('lists every triggered caution reason, in rule order', () => {
    const verdict = buildVerdict(
      input({ overallScore: 60, grade: 'C', trajectory: 'declining', coverage: 55 }),
    );
    expect(verdict.label).toBe('caution');
    expect(verdict.reasons.map((r) => r.evidenceKey)).toEqual([
      'overallScore',
      'trajectory',
      'coverage',
    ]);
  });
});

describe('buildVerdict — Not enough data', () => {
  it('says Not enough data when provisional', () => {
    const verdict = buildVerdict(
      input({
        provisional: true,
        overallScore: null,
        grade: null,
        coverage: 22,
        confidence: 'low',
        unknownCategories: ['Community', 'Release hygiene'],
        trajectory: 'unknown',
        supplyChain: { status: 'unknown', riskLabel: null, criticalCount: 0, highCount: 0, totalVulnerabilities: 0, depsScanned: 0 },
      }),
    );
    expect(verdict.label).toBe('not-enough-data');
    expect(verdict.title).toBe('Not enough data');
    expect(verdict.reasons[0]?.text).toContain('Coverage is only 22%');
    expect(verdict.reasons.some((r) => r.text.includes('Community could not be scored'))).toBe(true);
    expect(verdict.reasons.some((r) => r.text.includes('Activity trend could not be measured'))).toBe(true);
    expect(verdict.reasons.some((r) => r.text.includes('Supply-chain risk could not be checked'))).toBe(true);
  });
  it('provisional beats Stay away (an archived repo with no data)', () => {
    const verdict = buildVerdict(
      input({ provisional: true, overallScore: null, grade: null, coverage: 10, archived: true }),
    );
    expect(verdict.label).toBe('not-enough-data');
  });
});
