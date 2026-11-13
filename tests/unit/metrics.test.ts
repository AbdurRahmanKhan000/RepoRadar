import { describe, expect, it } from 'vitest';

import {
  closureRatio,
  commitsInWindow,
  daysSince,
  daysSinceLatestRelease,
  distinctCommitters,
  expDecay,
  logScale,
  median,
  recentContributorsScore,
  releaseFrequencyScore,
  releasesInWindow,
  round1,
  topContributorShare,
} from '../../src/analysis/metrics';
import { FIXED_NOW, isoDaysAgo } from './scoring-fixtures';

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(isoDaysAgo(1), FIXED_NOW)).toBe(1);
    expect(daysSince(isoDaysAgo(0), FIXED_NOW)).toBe(0);
    expect(daysSince(isoDaysAgo(900), FIXED_NOW)).toBe(900);
  });
  it('returns null for missing or unparseable dates, 0 for future dates', () => {
    expect(daysSince(null, FIXED_NOW)).toBeNull();
    expect(daysSince('not-a-date', FIXED_NOW)).toBeNull();
    expect(daysSince(new Date(FIXED_NOW + 86_400_000).toISOString(), FIXED_NOW)).toBe(0);
  });
});

describe('expDecay', () => {
  it('is 100 today and decays', () => {
    expect(expDecay(0, 120)).toBe(100);
    expect(expDecay(120, 120)).toBeCloseTo(100 / Math.E, 5);
    expect(expDecay(900, 120)).toBeCloseTo(0.055, 3);
  });
});

describe('logScale', () => {
  it('is 0 at zero, 100 at the base, and capped above it', () => {
    expect(logScale(0, 100)).toBe(0);
    expect(logScale(100, 100)).toBe(100);
    expect(logScale(10_000, 100)).toBe(100);
    expect(logScale(9, 100)).toBeCloseTo(49.9, 1);
    expect(logScale(3, 10_000)).toBeCloseTo(15.1, 1);
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('closureRatio', () => {
  it('is closed/(open+closed), null when there are no issues', () => {
    expect(closureRatio(20, 80)).toBe(0.8);
    expect(closureRatio(0, 0)).toBeNull();
  });
});

describe('topContributorShare', () => {
  it('is the top share of all contributions, null when empty', () => {
    expect(topContributorShare([60, 40])).toBe(0.6);
    expect(topContributorShare([])).toBeNull();
    expect(topContributorShare([0, 0])).toBeNull();
  });
});

describe('commit windows', () => {
  const commits = [
    { authorLogin: 'a', committedAt: isoDaysAgo(2) },
    { authorLogin: 'a', committedAt: isoDaysAgo(5) },
    { authorLogin: 'b', committedAt: isoDaysAgo(40) },
    { authorLogin: 'c', committedAt: isoDaysAgo(100) },
    { authorLogin: null, committedAt: isoDaysAgo(1) },
    { authorLogin: 'd', committedAt: null },
  ];
  it('counts commits inside the window only', () => {
    expect(commitsInWindow(commits, 30, FIXED_NOW)).toBe(3);
    expect(commitsInWindow(commits, 90, FIXED_NOW)).toBe(4);
  });
  it('counts distinct attributed committers inside the window only', () => {
    expect(distinctCommitters(commits, 90, FIXED_NOW)).toBe(2);
    expect(distinctCommitters(commits, 30, FIXED_NOW)).toBe(1);
  });
});

describe('release windows', () => {
  const releases = [
    { publishedAt: isoDaysAgo(30) },
    { publishedAt: isoDaysAgo(400) },
    { publishedAt: null },
  ];
  it('counts releases in the window and finds the latest', () => {
    expect(releasesInWindow(releases, 365, FIXED_NOW)).toBe(1);
    expect(daysSinceLatestRelease(releases, FIXED_NOW)).toBe(30);
    expect(daysSinceLatestRelease([], FIXED_NOW)).toBeNull();
    expect(daysSinceLatestRelease([{ publishedAt: null }], FIXED_NOW)).toBeNull();
  });
});

describe('bucket scores', () => {
  it('recent contributors: 0→0, 1→30, 2–3→60, 4–9→85, 10+→100', () => {
    expect(recentContributorsScore(0)).toBe(0);
    expect(recentContributorsScore(1)).toBe(30);
    expect(recentContributorsScore(2)).toBe(60);
    expect(recentContributorsScore(3)).toBe(60);
    expect(recentContributorsScore(4)).toBe(85);
    expect(recentContributorsScore(9)).toBe(85);
    expect(recentContributorsScore(10)).toBe(100);
    expect(recentContributorsScore(200)).toBe(100);
  });
  it('release frequency: 0→10, 1→50, 2–3→75, 4+→100', () => {
    expect(releaseFrequencyScore(0)).toBe(10);
    expect(releaseFrequencyScore(1)).toBe(50);
    expect(releaseFrequencyScore(2)).toBe(75);
    expect(releaseFrequencyScore(3)).toBe(75);
    expect(releaseFrequencyScore(4)).toBe(100);
  });
});

describe('round1', () => {
  it('rounds to 1 decimal', () => {
    expect(round1(99.17)).toBe(99.2);
    expect(round1(100)).toBe(100);
  });
});
