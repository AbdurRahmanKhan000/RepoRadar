// Scoring model v1.0.0 — spec §6.1 (versioned config).
// Weights are a proposed baseline, NOT scientifically validated
// (spec §6.1); they live here so they can be tuned only after a
// representative benchmark, and every saved report carries the
// version that produced it. Changing any weight, threshold or
// formula here requires a new SCORE_MODEL_VERSION.
//
// Coverage accounting: each signal's weight is its category weight
// divided by the number of signals in that category, so coverage =
// (weight of available signals) / (total signal weight). A missing
// signal lowers coverage; it never silently becomes 0 or 100.

import { SCORE_MODEL_VERSION } from '../shared/constants';

export { SCORE_MODEL_VERSION };

export type CategoryKey =
  | 'maintenance'
  | 'community'
  | 'issues'
  | 'releases'
  | 'docs'
  | 'adoption';

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  /** Weight in the overall score (0–1). Sums to 1.0. */
  weight: number;
  /** Signal keys in this category, in display order. */
  signals: readonly string[];
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    key: 'maintenance',
    label: 'Maintenance',
    weight: 0.25,
    signals: ['daysSincePush', 'recentCommits'],
  },
  {
    key: 'community',
    label: 'Community',
    weight: 0.2,
    signals: ['contributorCount', 'concentration', 'recentContributors'],
  },
  {
    key: 'issues',
    label: 'Issue & PR workflow',
    weight: 0.2,
    signals: ['issueClosureRatio', 'openIssueAge', 'prMergeRatio'],
  },
  {
    key: 'releases',
    label: 'Release hygiene',
    weight: 0.15,
    signals: ['releaseRecency', 'releaseFrequency'],
  },
  {
    key: 'docs',
    label: 'Documentation & hygiene',
    weight: 0.1,
    signals: [
      'readme',
      'license',
      'contributing',
      'codeOfConduct',
      'issueTemplate',
      'prTemplate',
      'ci',
    ],
  },
  {
    key: 'adoption',
    label: 'Adoption context',
    weight: 0.1,
    signals: ['stars', 'forks'],
  },
];

/** Total signal weight (= 1.0 by construction). */
export const TOTAL_SIGNAL_WEIGHT = CATEGORIES.reduce(
  (sum, c) => sum + c.weight,
  0,
);

/** Weight of one signal = its category weight / signals in category. */
export function signalWeight(categoryKey: CategoryKey, signalKey: string): number {
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  if (!category || !category.signals.includes(signalKey)) return 0;
  return category.weight / category.signals.length;
}

export function categoryDef(key: CategoryKey): CategoryDef {
  const def = CATEGORIES.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown scoring category: ${key}`);
  return def;
}

/** Grade bands (spec §6.1, brief). Labels are about observable
 *  maintenance signals only — never "high-quality code". */
export const GRADE_BANDS = [
  { min: 90, grade: 'A', label: 'Excellent' },
  { min: 75, grade: 'B', label: 'Strong' },
  { min: 60, grade: 'C', label: 'Fair' },
  { min: 40, grade: 'D', label: 'Weak' },
  { min: 0, grade: 'F', label: 'Poor' },
] as const;

/** Confidence thresholds on coverage (0–100). */
export const CONFIDENCE_THRESHOLDS = {
  high: 85,
  medium: 65,
  /** Below this, the report is provisional and has no overall score. */
  provisionalBelow: 40,
} as const;

/** Fixed observation windows, in days. */
export const WINDOWS = {
  /** Commit sample window (commits endpoint `since`). */
  commitSampleDays: 90,
  /** "Recent" commit activity window. */
  recentCommitDays: 30,
  /** Release frequency window. */
  releaseFrequencyDays: 365,
} as const;

/** Sample limits per endpoint (1 page each). A page returning
 *  exactly its limit is recorded as truncated. */
export const SAMPLE_LIMITS = {
  contributors: 100,
  commits: 100,
  releases: 20,
  issues: 100,
  pulls: 100,
} as const;
