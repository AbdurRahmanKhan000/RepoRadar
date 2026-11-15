// 0.3.0 — trajectory: regression, momentum, classification,
// forecast, and release cadence. All dates relative to FIXED_NOW.

import { describe, expect, it } from 'vitest';

import {
  analyzeTrajectory,
  classificationLabel,
  leastSquares,
  releaseCadence,
  slopeWords,
} from '../../src/analysis/trajectory';
import type { CommitActivitySample, ReleaseSample } from '../../src/domain/activity';
import { FIXED_NOW, isoDaysAgo, releaseSamples } from './scoring-fixtures';

function weeks(totals: number[]): CommitActivitySample[] {
  return totals.map((total, i) => ({
    week: Math.floor((FIXED_NOW - (totals.length - 1 - i) * 7 * 86_400_000) / 1000),
    total,
    days: [total, 0, 0, 0, 0, 0, 0],
  }));
}

function risingWeeks(): CommitActivitySample[] {
  // Accelerating activity: 20 weeks at 2, 12 at 5, 12 at 12,
  // 8 at 40. Slope ≈ +0.69, momentum = 40/26 ≈ 1.54 — Growing
  // needs slope > +0.5 AND momentum > 1.2; a plain linear ramp
  // (2, 3, 4, …) only reaches momentum ≈ 1.13, so it would be
  // Stable, not Growing.
  const totals = [...Array.from({ length: 20 }, () => 2), ...Array.from({ length: 12 }, () => 5), ...Array.from({ length: 12 }, () => 12), ...Array.from({ length: 8 }, () => 40)];
  return weeks(totals);
}

function fallingWeeks(): CommitActivitySample[] {
  return weeks(Array.from({ length: 52 }, (_, i) => 60 - i));
}

function flatWeeks(): CommitActivitySample[] {
  return weeks(Array.from({ length: 52 }, () => 10));
}

describe('leastSquares', () => {
  it('recovers the slope of a linear series', () => {
    const { slope, intercept } = leastSquares([2, 4, 6, 8, 10]);
    expect(slope).toBeCloseTo(2, 6);
    expect(intercept).toBeCloseTo(2, 6);
  });
  it('returns slope 0 for a flat series', () => {
    expect(leastSquares([5, 5, 5, 5]).slope).toBe(0);
  });
});

describe('analyzeTrajectory', () => {
  it('classifies a rising repo as Growing with a forecast', () => {
    const result = analyzeTrajectory(risingWeeks(), [], FIXED_NOW);
    expect(result.status).toBe('ok');
    expect(result.classification).toBe('growing');
    expect(result.slope).toBeCloseTo(0.69, 1);
    expect(result.momentum).toBeCloseTo(1.54, 1);
    // Display safety: the rounded values must print as clean
    // decimals, never 0.6940000000000001 (the old
    // Math.round(v*100)/100 leaked float noise into the UI).
    expect(String(result.slope)).toBe('0.69');
    expect(String(result.momentum)).toBe('1.54');
    // Level 40 + slope 0.69 × 12 weeks ≈ 48.3.
    expect(result.forecastWeekly).toBeCloseTo(48.3, 0);
    expect(result.weeksUsed).toBe(52);
    expect(result.trendLine).toHaveLength(52);
  });
  it('classifies a falling repo as Declining', () => {
    const result = analyzeTrajectory(fallingWeeks(), [], FIXED_NOW);
    expect(result.classification).toBe('declining');
    expect(result.slope).toBeCloseTo(-1, 1);
    expect(result.forecastWeekly).toBeGreaterThanOrEqual(0);
  });
  it('classifies a flat repo as Stable', () => {
    const result = analyzeTrajectory(flatWeeks(), [], FIXED_NOW);
    expect(result.classification).toBe('stable');
    expect(result.slope).toBeCloseTo(0, 6);
    expect(result.momentum).toBeCloseTo(1, 6);
    expect(result.forecastWeekly).toBeCloseTo(10, 0);
  });
  it('returns unknown when the stats endpoint was unavailable', () => {
    const result = analyzeTrajectory(null, [], FIXED_NOW);
    expect(result.status).toBe('unknown');
    expect(result.classification).toBe('unknown');
    expect(result.slope).toBeNull();
    expect(result.forecastWeekly).toBeNull();
  });
  it('returns unknown for undefined weeks — a pre-0.3.0 cache entry', () => {
    // Cache entries written by 0.2.x have no commitActivity key:
    // undefined, not null. A strict `=== null` guard let that
    // fall through to `weeks.map` and crash the whole report.
    const result = analyzeTrajectory(undefined, [], FIXED_NOW);
    expect(result.status).toBe('unknown');
    expect(result.classification).toBe('unknown');
    expect(result.weeks).toEqual([]);
  });
  it('returns insufficient with fewer than 12 weeks', () => {
    const result = analyzeTrajectory(weeks([5, 6, 7, 8, 9, 10]), [], FIXED_NOW);
    expect(result.status).toBe('insufficient');
    expect(result.classification).toBe('insufficient');
  });
  it('returns insufficient when every week is zero', () => {
    const result = analyzeTrajectory(weeks(Array.from({ length: 52 }, () => 0)), [], FIXED_NOW);
    expect(result.status).toBe('insufficient');
    expect(result.classification).toBe('insufficient');
  });
  it('clamps the forecast at zero for a steep decline', () => {
    // 60 commits a week falling to 0: level is ~1.5, slope −1 →
    // forecast would be negative without the clamp.
    const result = analyzeTrajectory(fallingWeeks(), [], FIXED_NOW);
    expect(result.forecastWeekly).toBeGreaterThanOrEqual(0);
  });
  it('reports momentum Infinity when activity restarts after silence', () => {
    const totals = [...Array.from({ length: 48 }, () => 0), 5, 5, 5, 5];
    const result = analyzeTrajectory(weeks(totals), [], FIXED_NOW);
    expect(result.momentum).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('releaseCadence', () => {
  it('counts releases per quarter, oldest first', () => {
    const releases: ReleaseSample[] = releaseSamples([10, 40, 100, 130, 200, 260, 340]);
    const cadence = releaseCadence(releases, FIXED_NOW);
    // 10d → Q3, 40d → Q3, 100d → Q2, 130d → Q2, 200d → Q1,
    // 260d → Q1, 340d → Q0 → [1, 2, 2, 2].
    expect(cadence.quarters).toEqual([1, 2, 2, 2]);
    expect(cadence.total12mo).toBe(7);
    expect(cadence.trend).toBe('up');
  });
  it('reports none when there were no releases in 12 months', () => {
    expect(releaseCadence([], FIXED_NOW)).toEqual({
      quarters: [0, 0, 0, 0],
      total12mo: 0,
      trend: 'none',
    });
    expect(releaseCadence(undefined, FIXED_NOW)).toEqual({
      quarters: [0, 0, 0, 0],
      total12mo: 0,
      trend: 'none',
    });
  });
  it('ignores releases older than 12 months', () => {
    const cadence = releaseCadence(releaseSamples([400, 500]), FIXED_NOW);
    expect(cadence.total12mo).toBe(0);
    expect(cadence.trend).toBe('none');
  });
  it('detects a down trend', () => {
    const cadence = releaseCadence(releaseSamples([10, 300, 320, 340]), FIXED_NOW);
    expect(cadence.trend).toBe('down');
  });
});

describe('labels', () => {
  it('describes the slope in plain words', () => {
    expect(slopeWords(2)).toContain('Growing by about 2 commits a week');
    expect(slopeWords(-1.5)).toContain('Falling by about 1.5 commits a week');
    expect(slopeWords(0)).toContain('Roughly flat');
    expect(slopeWords(null)).toContain('could not be measured');
  });
  it('labels every classification', () => {
    expect(classificationLabel('growing')).toBe('Growing');
    expect(classificationLabel('declining')).toBe('Declining');
    expect(classificationLabel('stable')).toBe('Stable');
    expect(classificationLabel('insufficient')).toBe('Not enough data');
    expect(classificationLabel('unknown')).toBe('Unknown');
  });
  it('uses FIXED_NOW-adjacent dates without leaking the clock', () => {
    // Sanity: the fixture helper agrees with the trajectory math.
    expect(isoDaysAgo(0, FIXED_NOW)).toBe(new Date(FIXED_NOW).toISOString());
  });
});
