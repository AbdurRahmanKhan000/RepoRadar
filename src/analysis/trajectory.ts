// Trajectory & forecast — 0.3.0. Pure and deterministic: every
// function takes its inputs explicitly (nowMs included) and never
// reads the clock or the network.
//
// The question this answers is not "how healthy is the repo
// today?" (the health score) but "where is it heading?" —
// trajectory is a direction, computed from the 52 weeks of
// commit activity GitHub reports, plus the release cadence from
// the releases sample the report already fetched.
//
//   slope: least-squares linear regression on weekly commit
//     totals (commits/week gained or lost per week).
//   momentum: mean(last 4 weeks) / mean(prior 8 weeks). Null
//     when there is no prior activity to compare against.
//   classification:
//     Growing   — slope > +0.5 AND momentum > 1.2
//     Declining — slope < −0.5 OR momentum < 0.7
//     Stable    — everything else
//     Insufficient — fewer than 12 weeks of data, or all zeros
//   forecast: level (mean of the last 4 weeks) + slope × 12
//     weeks, clamped at ≥ 0. It is a linear projection, labelled
//     as one in the UI — never a promise.

import type { CommitActivitySample, ReleaseSample } from '../domain/activity';
import { releasesInWindow, round1 } from './metrics';

export type TrajectoryClassification = 'growing' | 'declining' | 'stable' | 'insufficient' | 'unknown';

export type TrajectoryStatus = 'ok' | 'insufficient' | 'unknown';

export interface ReleaseCadence {
  /** Releases per quarter, oldest first, over the last 12 months. */
  quarters: [number, number, number, number];
  total12mo: number;
  trend: 'up' | 'flat' | 'down' | 'none';
}

export interface TrajectoryResult {
  status: TrajectoryStatus;
  /** 'unknown' when the stats endpoint was unavailable; the other
   *  classifications are only set when data was actually measured. */
  classification: TrajectoryClassification;
  /** Weeks of data the analysis used (0 when unknown). */
  weeksUsed: number;
  /** Least-squares slope, commits/week per week; null when
   *  insufficient/unknown. */
  slope: number | null;
  /** Mean(last 4 weeks) / mean(prior 8 weeks); null when there is
   *  no prior activity to compare against. Infinity when activity
   *  restarted after a quiet period. */
  momentum: number | null;
  /** Mean weekly commits over the last 4 weeks; null when
   *  insufficient/unknown. */
  level: number | null;
  /** Projected weekly commits 12 weeks out (linear projection,
   *  clamped ≥ 0); null when insufficient/unknown. */
  forecastWeekly: number | null;
  /** Fitted trend-line value per week, same length as `weeks`
   *  (for the chart). Empty when insufficient/unknown. */
  trendLine: number[];
  /** The weekly totals the analysis used (for the chart). */
  weeks: { week: number; total: number }[];
  releaseCadence: ReleaseCadence;
}

const MIN_WEEKS = 12;
const GROWING_SLOPE = 0.5;
const DECLINING_SLOPE = -0.5;
const GROWING_MOMENTUM = 1.2;
const DECLINING_MOMENTUM = 0.7;
const FORECAST_WEEKS = 12;
const DAY_MS = 86_400_000;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Round to 2 decimals without float noise: `Math.round(v * 100) /
 *  100` can print as 0.6940000000000001 (69.4 / 100 is not exact
 *  in binary), which leaked into the UI's slope sentence.
 *  toFixed produces the clean decimal string; Number() parses it
 *  back to the nearest double, which prints as the clean decimal. */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Least-squares slope and intercept of y against x = 0..n-1. */
export function leastSquares(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * ((values[i] as number) - yMean);
    denominator += (i - xMean) * (i - xMean);
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

export function analyzeTrajectory(
  // `undefined` is accepted as well as null: activity entries
  // cached before 0.3.0 have no `commitActivity` key at all, and
  // a strict `=== null` check let `undefined` fall through to
  // `.map` and crash the whole report (0.3.0 regression, caught
  // by the verify-build4/5/6/fixes rerun).
  weeks: CommitActivitySample[] | null | undefined,
  releases: ReleaseSample[] | null | undefined,
  nowMs: number,
): TrajectoryResult {
  const cadence = releaseCadence(releases, nowMs);
  if (weeks == null) {
    return {
      status: 'unknown',
      classification: 'unknown',
      weeksUsed: 0,
      slope: null,
      momentum: null,
      level: null,
      forecastWeekly: null,
      trendLine: [],
      weeks: [],
      releaseCadence: cadence,
    };
  }

  const totals = weeks.map((w) => w.total);
  const allZero = totals.every((t) => t === 0);
  if (totals.length < MIN_WEEKS || allZero) {
    return {
      status: 'insufficient',
      classification: 'insufficient',
      weeksUsed: totals.length,
      slope: null,
      momentum: null,
      level: null,
      forecastWeekly: null,
      trendLine: [],
      weeks: weeks.map((w) => ({ week: w.week, total: w.total })),
      releaseCadence: cadence,
    };
  }

  const { slope, intercept } = leastSquares(totals);
  const last4 = totals.slice(-4);
  const prior8 = totals.slice(-12, -4);
  const level = mean(last4);
  const priorMean = mean(prior8);
  const momentum =
    priorMean === 0 ? (level > 0 ? Number.POSITIVE_INFINITY : null) : level / priorMean;
  const forecastWeekly = Math.max(0, round1(level + slope * FORECAST_WEEKS));
  const trendLine = totals.map((_, i) => Math.max(0, round1(intercept + slope * i)));

  let classification: TrajectoryClassification = 'stable';
  if (slope > GROWING_SLOPE && momentum !== null && momentum > GROWING_MOMENTUM) {
    classification = 'growing';
  } else if (slope < DECLINING_SLOPE || (momentum !== null && momentum < DECLINING_MOMENTUM)) {
    classification = 'declining';
  }

  return {
    status: 'ok',
    classification,
    weeksUsed: totals.length,
    slope: round2(slope),
    momentum: momentum === null ? null : round2(momentum),
    level: round1(level),
    forecastWeekly,
    trendLine,
    weeks: weeks.map((w) => ({ week: w.week, total: w.total })),
    releaseCadence: cadence,
  };
}

/** Releases per quarter over the last 12 months, oldest first.
 *  Trend compares the recent half (last 2 quarters) with the prior
 *  half: up / flat / down; 'none' when there were no releases. */
export function releaseCadence(
  // `undefined` accepted like `analyzeTrajectory` above — a
  // pre-0.3.0 cached activity may lack the field entirely.
  releases: ReleaseSample[] | null | undefined,
  nowMs: number,
): ReleaseCadence {
  const quarters: [number, number, number, number] = [0, 0, 0, 0];
  if (releases != null) {
    for (const release of releases) {
      if (!release.publishedAt) continue;
      const ms = Date.parse(release.publishedAt);
      if (Number.isNaN(ms) || ms > nowMs) continue;
      const ageDays = (nowMs - ms) / DAY_MS;
      if (ageDays > 365) continue;
      const quarter = Math.min(3, Math.floor(ageDays / (365 / 4)));
      // ageDays 0–91 → quarter 3 (most recent); 274–365 → 0.
      quarters[3 - quarter] = (quarters[3 - quarter] as number) + 1;
    }
  }
  const total12mo = releases == null ? 0 : releasesInWindow(releases, 365, nowMs);
  const prior = (quarters[0] as number) + (quarters[1] as number);
  const recent = (quarters[2] as number) + (quarters[3] as number);
  const trend =
    total12mo === 0 ? 'none' : recent > prior ? 'up' : recent < prior ? 'down' : 'flat';
  return { quarters, total12mo, trend };
}

/** Plain-words slope, for the UI. */
export function slopeWords(slope: number | null): string {
  if (slope === null) return 'Trend could not be measured.';
  if (slope > GROWING_SLOPE) return `Growing by about ${Math.abs(slope)} commits a week, every week.`;
  if (slope < DECLINING_SLOPE) return `Falling by about ${Math.abs(slope)} commits a week, every week.`;
  return 'Roughly flat — weekly commits are holding steady.';
}

export function classificationLabel(classification: TrajectoryClassification): string {
  switch (classification) {
    case 'growing':
      return 'Growing';
    case 'declining':
      return 'Declining';
    case 'stable':
      return 'Stable';
    case 'insufficient':
      return 'Not enough data';
    case 'unknown':
      return 'Unknown';
  }
}
