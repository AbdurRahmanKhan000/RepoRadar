// Compare — spec §7 FR-10 (Build 5).
// A comparison is a side-by-side table over the SAME metric
// definitions for up to 3 repositories (spec §4.3). Every row
// marks its best value with a text marker ("★ Best") as well as a
// class — colour is never the only signal (spec §8.4). Null values
// are never "best" and never silently 0: a missing metric shows
// "—" and cannot win its row. This module is pure: it takes the
// already-fetched report + overview + activity for each repo and
// returns rows the UI renders verbatim.

import { closureRatio, daysSince } from '../analysis/metrics';
import { CATEGORIES } from '../analysis/model-v1';
import type { ActivityData } from '../domain/activity';
import type { Confidence, Grade, RepositoryReport } from '../domain/report';
import type { OverviewResult } from '../domain/repository';

/** Compare is limited to 3 repositories (spec §4.3, FR-10). */
export const MAX_COMPARE_REPOS = 3;

export interface CompareEntry {
  repoId: string;
  overview: OverviewResult;
  report: RepositoryReport;
  activity: ActivityData;
}

export type CompareValue = number | string | null;

export interface CompareRow {
  key: string;
  label: string;
  /** Values in the same order as the entries passed in. */
  values: CompareValue[];
  /** Best value per column; false when the value is null or not
   *  the best in its row. A tie marks every tied column best. */
  best: boolean[];
  /** How the value is displayed ('number' | 'percent' | 'days' |
   *  'text'). */
  kind: 'number' | 'percent' | 'days' | 'text';
}

const GRADE_RANK: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Days since the last push, measured against the report's
 *  generatedAt so the number matches the scored report. */
export function daysSincePush(entry: CompareEntry): number | null {
  return daysSince(entry.overview.facts.pushedAt, new Date(entry.report.generatedAt).getTime());
}

/** Contributor count from the (capped) sample, or null when the
 *  contributors endpoint could not be collected. */
export function contributorCount(entry: CompareEntry): number | null {
  return entry.activity.contributors === null ? null : entry.activity.contributors.length;
}

/** Issue closure ratio from the issue sample (PRs excluded — the
 *  sample already splits them out), or null when there are no
 *  issues in the sample or the endpoint failed. */
export function issueClosureRatio(entry: CompareEntry): number | null {
  const issues = entry.activity.issues;
  if (issues === null) return null;
  const real = issues.filter((i) => !i.isPullRequest);
  const open = real.filter((i) => i.state === 'open').length;
  const closed = real.filter((i) => i.state === 'closed').length;
  if (open + closed === 0) return null;
  const ratio = closureRatio(open, closed);
  return ratio === null ? null : Math.round(ratio * 1000) / 10;
}

function rankFor(rowKey: string, value: CompareValue): number | null {
  if (value === null) return null;
  if (rowKey === 'grade') return GRADE_RANK[value as Grade] ?? null;
  if (rowKey === 'confidence') return CONFIDENCE_RANK[value as Confidence] ?? null;
  return typeof value === 'number' ? value : null;
}

/** Best flags for one row. `lowerIsBetter` is true only for
 *  "days since push". Ties all win. */
function bestFlags(rowKey: string, values: CompareValue[], lowerIsBetter: boolean): boolean[] {
  const ranks = values.map((v) => rankFor(rowKey, v));
  const available = ranks.filter((r): r is number => r !== null);
  if (available.length === 0) return values.map(() => false);
  const bestRank = lowerIsBetter ? Math.min(...available) : Math.max(...available);
  return ranks.map((r) => r !== null && r === bestRank);
}

interface RowSpec {
  key: string;
  label: string;
  kind: CompareRow['kind'];
  lowerIsBetter?: boolean;
  valueOf: (entry: CompareEntry) => CompareValue;
}

export function buildCompareRows(entries: CompareEntry[]): CompareRow[] {
  const specs: RowSpec[] = [
    { key: 'overall', label: 'Overall score', kind: 'number', valueOf: (e) => e.report.overallScore },
    { key: 'grade', label: 'Grade', kind: 'text', valueOf: (e) => e.report.grade },
    { key: 'coverage', label: 'Coverage', kind: 'percent', valueOf: (e) => e.report.coverage },
    { key: 'confidence', label: 'Confidence', kind: 'text', valueOf: (e) => e.report.confidence },
    ...CATEGORIES.map(
      (cat): RowSpec => ({
        key: `category:${cat.key}`,
        label: cat.label,
        kind: 'number',
        valueOf: (e) => e.report.categories.find((c) => c.key === cat.key)?.score ?? null,
      }),
    ),
    { key: 'stars', label: 'Stars', kind: 'number', valueOf: (e) => e.overview.facts.stars },
    { key: 'forks', label: 'Forks', kind: 'number', valueOf: (e) => e.overview.facts.forks },
    {
      key: 'daysSincePush',
      label: 'Days since last push',
      kind: 'days',
      lowerIsBetter: true,
      valueOf: daysSincePush,
    },
    { key: 'contributors', label: 'Contributors (sample)', kind: 'number', valueOf: contributorCount },
    { key: 'issueClosure', label: 'Issue closure', kind: 'percent', valueOf: issueClosureRatio },
  ];
  return specs.map((spec) => {
    const values = entries.map((e) => spec.valueOf(e));
    return {
      key: spec.key,
      label: spec.label,
      values,
      best: bestFlags(spec.key, values, spec.lowerIsBetter ?? false),
      kind: spec.kind,
    };
  });
}

/** Can `candidateId` be added to `selectedIds`? The 3-repo cap
 *  is enforced here and in the UI — selecting a 4th is refused
 *  with a clear message, never silently dropped. */
export function canAddToCompare(
  selectedIds: readonly string[],
  candidateId: string,
): { allowed: true } | { allowed: false; reason: 'already-selected' | 'cap' } {
  if (selectedIds.includes(candidateId)) return { allowed: false, reason: 'already-selected' };
  if (selectedIds.length >= MAX_COMPARE_REPOS) return { allowed: false, reason: 'cap' };
  return { allowed: true };
}
