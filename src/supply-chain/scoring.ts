// Supply-chain risk scoring — 0.3.0. Pure and deterministic:
// same inputs → same score. The health score (model 1.0.0) is
// untouched by this module; this score feeds the verdict only.
//
// FORMULA (supply-chain risk model 1.0.0) — start at 100:
//   per vulnerability, by severity:
//     Critical −25, High −15, Medium −7, Low −3
//     (unknown severity counts as Medium, −7 — a vulnerability
//     with no CVSS score is never silently discounted)
//     Total vulnerability deduction capped at −60.
//   per abandoned dependency (latest release > 24 months ago): −5,
//     capped at −20. Dependencies whose release date is unknown
//     are never counted as abandoned.
//   npm repository with a package.json but no package-lock.json: −5
//     (unpinned versions — what is installed is not what was
//     reviewed). Other ecosystems have no lockfile concept here.
//   Score is clamped at 0. Labels: Low ≥80, Moderate 60–79,
//   Elevated 40–59, High <40.

import { round1 } from '../analysis/metrics';
import type { RiskLabel, SeverityLevel } from './types';

export const SUPPLY_CHAIN_MODEL_VERSION = '1.0.0';

/** Months without a release after which a dependency counts as
 *  abandoned. */
export const ABANDONED_AFTER_MONTHS = 24;

/** Maximum deps.dev lookups per analysis (the rest keep their
 *  release date unknown — never abandoned). */
export const MAX_DEPS_DEV_LOOKUPS = 10;

const VULN_DEDUCTION: Record<SeverityLevel, number> = {
  critical: 25,
  high: 15,
  medium: 7,
  low: 3,
  unknown: 7,
};

const MAX_VULN_DEDUCTION = 60;
const ABANDONED_DEDUCTION_EACH = 5;
const MAX_ABANDONED_DEDUCTION = 20;
const NO_LOCKFILE_DEDUCTION = 5;

export function riskLabelFor(score: number): RiskLabel {
  if (score >= 80) return 'low';
  if (score >= 60) return 'moderate';
  if (score >= 40) return 'elevated';
  return 'high';
}

export function riskLabelText(label: RiskLabel): string {
  switch (label) {
    case 'low':
      return 'Low';
    case 'moderate':
      return 'Moderate';
    case 'elevated':
      return 'Elevated';
    case 'high':
      return 'High';
  }
}

export interface RiskScoreInput {
  /** Severity of every known vulnerability. */
  severities: SeverityLevel[];
  /** Abandoned direct dependencies; null when abandonment is
   *  entirely unknown (every deps.dev lookup failed). */
  abandonedCount: number | null;
  /** True when a package.json was found. */
  hasNpmManifest: boolean;
  /** True when a package-lock.json was found at the repo root. */
  hasLockfile: boolean;
}

export interface RiskScore {
  score: number;
  label: RiskLabel;
}

export function scoreSupplyChainRisk(input: RiskScoreInput): RiskScore {
  const vulnTotal = input.severities.reduce((sum, s) => sum + VULN_DEDUCTION[s], 0);
  const vulnDeduction = Math.min(vulnTotal, MAX_VULN_DEDUCTION);
  const abandonedDeduction = Math.min(
    (input.abandonedCount ?? 0) * ABANDONED_DEDUCTION_EACH,
    MAX_ABANDONED_DEDUCTION,
  );
  const lockfileDeduction = input.hasNpmManifest && !input.hasLockfile ? NO_LOCKFILE_DEDUCTION : 0;
  const score = Math.max(0, round1(100 - vulnDeduction - abandonedDeduction - lockfileDeduction));
  return { score, label: riskLabelFor(score) };
}
