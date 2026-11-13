// RepositoryReport — the scored, evidence-backed result of an
// analysis (spec §16.1, refined). This is L2: deterministic category
// scores + observations built on L0 facts and L1 metrics, with the
// coverage/confidence that says how much the numbers can be trusted.
// A score is an evidence-based heuristic, never proof of code
// quality, security, or safety (spec §5.1) — the UI repeats that
// next to every report.

import type { EvidenceItem } from './repository';
import type { CategoryKey } from '../analysis/model-v1';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type Confidence = 'high' | 'medium' | 'low';

export type CategoryStatus = 'available' | 'partial' | 'unknown';

/** One scored signal inside a category. `score` is null when the
 *  evidence for this signal is missing — missing is never silently
 *  0. `value` is the raw metric the score was computed from, for
 *  the evidence trail. */
export interface SignalScore {
  key: string;
  label: string;
  score: number | null;
  /** Raw metric value (days, count, ratio, share), or null. */
  value: number | string | boolean | null;
  /** Human-readable statement of the metric, e.g. "Pushed 4 days ago". */
  detail: string;
}

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  /** Mean of the category's available signals, 0–100, or null when
   *  no signal in the category could be scored. */
  score: number | null;
  /** Weight in the overall score (0–1), before renormalization. */
  weight: number;
  evidenceKeys: string[];
  status: CategoryStatus;
  signals: SignalScore[];
}

export interface Observations {
  /** Good signs, each with its exact evidence. */
  good: string[];
  /** Possible concerns, each with its exact evidence. */
  caution: string[];
  /** Things that could not be concluded, and why. */
  unknown: string[];
}

export interface RepositoryReport {
  repoId: string;
  /** Weighted score over available categories only, 0–100.
   *  Null when coverage < 40% — the report is provisional and
   *  there is not enough data to score (spec §6.3). */
  overallScore: number | null;
  grade: Grade | null;
  /** 0–100: weight of available signals / total signal weight. */
  coverage: number;
  confidence: Confidence;
  /** True when coverage < 40%: overallScore is null. */
  provisional: boolean;
  scoreModelVersion: string;
  categories: CategoryScore[];
  observations: Observations;
  evidence: EvidenceItem[];
  generatedAt: string;
  /** Sampling caveats, e.g. "Contributor sample capped at 100". */
  sampleNotes: string[];
  /** True when any part of the underlying data is stale cached data. */
  stale: boolean;
}
