// Verdict — 0.3.0. Pure, deterministic rule engine (version
// 1.0.0): same inputs → same verdict and same ordered reasons.
// The verdict is an ADOPTION SIGNAL based on public repository
// evidence — never "safe" or "secure". Every reason cites the
// exact evidence key that triggered it, so the UI can open the
// evidence behind it.
//
// Rules, in priority order:
//   1. Not enough data — provisional (coverage < 40%): the score
//      does not exist, so no adoption signal can be given. Reasons
//      list what is missing.
//   2. Stay away — any of:
//      archived; score < 40 with coverage ≥ 65%; ≥1 Critical
//      vulnerability; no push in 365+ days AND no release in 365+
//      days (a repo that never released counts as "no release in
//      365+ days" here); trajectory Declining AND score < 60.
//   3. Use with caution — any of:
//      score 40–74; any High vulnerability; trajectory Declining;
//      coverage < 65%; no release in 12 months — only when the
//      repo HAS released before (a repo that never released gets
//      no penalty from this rule); supply-chain risk Elevated or
//      High; supply-chain check unavailable (vulnerabilities
//      cannot be confirmed absent — see note below); median open
//      issue older than 180 days (supporting reason).
//   4. Use it — score ≥ 75, coverage ≥ 65%, no High/Critical
//      vulnerabilities, trajectory not Declining, and (no prior
//      release OR latest release within 12 months).
//   5. Fallback — defensive only; the rules above are exhaustive
//      for any non-provisional report.
//
// Interpretation notes (documented, not silent): when the
// supply-chain check failed (status 'unknown'), "no High/Critical
// vulnerabilities" cannot be asserted, so 'Use it' is withheld
// and the verdict is 'Use with caution' with that reason. When
// there is no manifest at all ('no-manifest'), there are no
// dependencies to check, so "no High/Critical" holds by vacuity.
// The same principle applies to releases: when the releases
// endpoint failed (releasesKnown false), neither "has released
// before" nor "no release in 12 months" can be asserted — the
// release axis contributes no Stay-away/Caution trigger, and
// 'Use it' is withheld (with a reason) because its release
// condition cannot be confirmed. An unknown trajectory does NOT
// block 'Use it': the rule says "trajectory not Declining", and
// unknown is not Declining — missing data is already accounted
// for by coverage.

import type { Confidence, Grade } from '../domain/report';
import type { RiskLabel } from '../supply-chain/types';
import type { TrajectoryClassification } from './trajectory';

export const VERDICT_MODEL_VERSION = '1.0.0';

export type VerdictLabel = 'use' | 'caution' | 'avoid' | 'not-enough-data';

export interface VerdictReason {
  /** Plain-words reason, e.g. "No push in 410 days and no release in 500 days." */
  text: string;
  /** Evidence key the reason cites — the UI maps it to the
   *  category drawer or the section that holds the evidence. */
  evidenceKey: string;
}

export interface Verdict {
  label: VerdictLabel;
  title: string;
  subtitle: string;
  reasons: VerdictReason[];
  modelVersion: string;
}

export type SupplyChainVerdictInput = {
  status: 'ok' | 'no-manifest' | 'unknown';
  riskLabel: RiskLabel | null;
  criticalCount: number;
  highCount: number;
  totalVulnerabilities: number;
  depsScanned: number;
};

export interface VerdictInput {
  overallScore: number | null;
  grade: Grade | null;
  coverage: number;
  confidence: Confidence;
  provisional: boolean;
  archived: boolean;
  daysSincePush: number | null;
  daysSinceLatestRelease: number | null;
  hasEverReleased: boolean;
  /** False when the releases endpoint failed — the release axis
   *  is then unknown, not "never released". */
  releasesKnown: boolean;
  medianOpenIssueAgeDays: number | null;
  trajectory: TrajectoryClassification;
  supplyChain: SupplyChainVerdictInput | null;
  /** Labels of categories that could not be scored (for the
   *  "not enough data" reasons). */
  unknownCategories: string[];
}

const RELEASE_STALE_DAYS = 365;
const PUSH_STALE_DAYS = 365;
const OLD_OPEN_ISSUE_DAYS = 180;

function labelTitle(label: VerdictLabel): string {
  switch (label) {
    case 'use':
      return 'Use it';
    case 'caution':
      return 'Use with caution';
    case 'avoid':
      return 'Stay away';
    case 'not-enough-data':
      return 'Not enough data';
  }
}

export function buildVerdict(input: VerdictInput): Verdict {
  const subtitle = 'Adoption signal based on public repository evidence';
  const sc = input.supplyChain;
  const critical = sc?.criticalCount ?? 0;
  const high = sc?.highCount ?? 0;
  const score = input.overallScore;

  // --- 1. Not enough data (provisional) ---
  if (input.provisional) {
    const reasons: VerdictReason[] = [
      {
        text: `Coverage is only ${input.coverage}% — at least 40% is needed to score this repository.`,
        evidenceKey: 'coverage',
      },
    ];
    for (const label of input.unknownCategories) {
      reasons.push({
        text: `${label} could not be scored — its evidence is missing.`,
        evidenceKey: 'coverage',
      });
    }
    if (input.trajectory === 'unknown') {
      reasons.push({
        text: 'Activity trend could not be measured.',
        evidenceKey: 'trajectory',
      });
    }
    if (sc?.status === 'unknown') {
      reasons.push({
        text: 'Supply-chain risk could not be checked.',
        evidenceKey: 'supplyChain',
      });
    }
    return {
      label: 'not-enough-data',
      title: labelTitle('not-enough-data'),
      subtitle,
      reasons,
      modelVersion: VERDICT_MODEL_VERSION,
    };
  }

  // --- 2. Stay away ---
  const avoidReasons: VerdictReason[] = [];
  if (input.archived) {
    avoidReasons.push({
      text: 'This repository is archived — it is no longer maintained.',
      evidenceKey: 'archived',
    });
  }
  if (score !== null && score < 40 && input.coverage >= 65) {
    avoidReasons.push({
      text: `Health score ${score} is below 40, with ${input.coverage}% coverage.`,
      evidenceKey: 'overallScore',
    });
  }
  if (critical >= 1) {
    avoidReasons.push({
      text: `${critical} critical ${critical === 1 ? 'vulnerability' : 'vulnerabilities'} in its dependencies.`,
      evidenceKey: 'supplyChain',
    });
  }
  const noPushYear =
    input.daysSincePush !== null && input.daysSincePush >= PUSH_STALE_DAYS;
  // "No release in 365+ days" only counts when the release
  // history is actually known: an empty known history means
  // never released (counts); a failed endpoint means unknown
  // (does not count — unknown evidence never triggers Stay away).
  const noReleaseYear =
    input.releasesKnown &&
    (input.daysSinceLatestRelease === null
      ? true
      : input.daysSinceLatestRelease >= RELEASE_STALE_DAYS);
  if (noPushYear && noReleaseYear) {
    avoidReasons.push({
      text: input.daysSinceLatestRelease === null
        ? `No push in ${input.daysSincePush} days, and this repository has never had a release.`
        : `No push in ${input.daysSincePush} days and no release in ${input.daysSinceLatestRelease} days.`,
      evidenceKey: 'daysSincePush',
    });
  }
  if (input.trajectory === 'declining' && score !== null && score < 60) {
    avoidReasons.push({
      text: `Activity is declining and the health score is below 60 (${score}).`,
      evidenceKey: 'trajectory',
    });
  }
  if (avoidReasons.length > 0) {
    return {
      label: 'avoid',
      title: labelTitle('avoid'),
      subtitle,
      reasons: avoidReasons,
      modelVersion: VERDICT_MODEL_VERSION,
    };
  }

  // --- 3. Use with caution ---
  const cautionReasons: VerdictReason[] = [];
  if (score !== null && score >= 40 && score <= 74) {
    cautionReasons.push({
      text: `Health score ${score} is middling — solid in places, weak in others.`,
      evidenceKey: 'overallScore',
    });
  }
  if (high >= 1) {
    cautionReasons.push({
      text: `${high} high-severity ${high === 1 ? 'vulnerability' : 'vulnerabilities'} in its dependencies.`,
      evidenceKey: 'supplyChain',
    });
  }
  if (input.trajectory === 'declining') {
    cautionReasons.push({
      text: 'Commit activity is declining.',
      evidenceKey: 'trajectory',
    });
  }
  if (input.coverage < 65) {
    cautionReasons.push({
      text: `Coverage is ${input.coverage}% — some evidence is missing.`,
      evidenceKey: 'coverage',
    });
  }
  if (
    input.hasEverReleased &&
    input.daysSinceLatestRelease !== null &&
    input.daysSinceLatestRelease >= RELEASE_STALE_DAYS
  ) {
    cautionReasons.push({
      text: `No release in over a year — the latest was ${input.daysSinceLatestRelease} days ago.`,
      evidenceKey: 'daysSinceLatestRelease',
    });
  }
  if (input.hasEverReleased && input.daysSinceLatestRelease === null) {
    cautionReasons.push({
      text: 'This repository has releases, but the latest release date is unknown.',
      evidenceKey: 'daysSinceLatestRelease',
    });
  }
  if (!input.releasesKnown) {
    cautionReasons.push({
      text: 'Release history could not be checked.',
      evidenceKey: 'daysSinceLatestRelease',
    });
  }
  if (sc?.riskLabel === 'elevated' || sc?.riskLabel === 'high') {
    cautionReasons.push({
      text: `Supply-chain risk is ${sc.riskLabel}.`,
      evidenceKey: 'supplyChain',
    });
  }
  if (sc?.status === 'unknown') {
    cautionReasons.push({
      text: 'Supply-chain risk could not be checked — vulnerabilities are unknown.',
      evidenceKey: 'supplyChain',
    });
  }
  if (input.medianOpenIssueAgeDays !== null && input.medianOpenIssueAgeDays > OLD_OPEN_ISSUE_DAYS) {
    cautionReasons.push({
      text: `The median open issue is ${Math.round(input.medianOpenIssueAgeDays)} days old.`,
      evidenceKey: 'openIssueAge',
    });
  }
  if (cautionReasons.length > 0) {
    return {
      label: 'caution',
      title: labelTitle('caution'),
      subtitle,
      reasons: cautionReasons,
      modelVersion: VERDICT_MODEL_VERSION,
    };
  }

  // --- 4. Use it ---
  const useReasons: VerdictReason[] = [];
  if (score !== null) {
    useReasons.push({
      text: `Health score ${score}${input.grade ? ` (grade ${input.grade})` : ''} with ${input.coverage}% coverage.`,
      evidenceKey: 'overallScore',
    });
  }
  if (sc?.status === 'no-manifest') {
    useReasons.push({
      text: 'No dependencies to check — this repository ships no dependency manifest.',
      evidenceKey: 'supplyChain',
    });
  } else if (sc) {
    useReasons.push({
      text:
        sc.totalVulnerabilities === 0
          ? `No known vulnerabilities in ${sc.depsScanned} ${sc.depsScanned === 1 ? 'dependency' : 'dependencies'} checked.`
          : `No high or critical vulnerabilities in ${sc.depsScanned} ${sc.depsScanned === 1 ? 'dependency' : 'dependencies'} checked.`,
      evidenceKey: 'supplyChain',
    });
  }
  if (input.trajectory === 'growing') {
    useReasons.push({ text: 'Commit activity is growing.', evidenceKey: 'trajectory' });
  } else if (input.trajectory === 'stable') {
    useReasons.push({ text: 'Commit activity is stable.', evidenceKey: 'trajectory' });
  }
  if (!input.hasEverReleased) {
    useReasons.push({
      text: 'No releases yet — a young project, judged on its activity instead.',
      evidenceKey: 'daysSinceLatestRelease',
    });
  } else if (input.daysSinceLatestRelease !== null) {
    useReasons.push({
      text: `Latest release was ${input.daysSinceLatestRelease} days ago.`,
      evidenceKey: 'daysSinceLatestRelease',
    });
  }
  return {
    label: 'use',
    title: labelTitle('use'),
    subtitle,
    reasons: useReasons,
    modelVersion: VERDICT_MODEL_VERSION,
  };
}
