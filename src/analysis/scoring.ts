// Scoring engine — spec §6.1 (L2). Pure and deterministic: every
// function takes `nowMs` explicitly and never reads the clock, the
// network, or randomness. Same inputs → same report, byte for byte.
//
// FORMULAS (score model 1.0.0) — every signal 0–100, null when its
// evidence is missing (missing is never silently 0):
//   Maintenance (25%)
//     daysSincePush      100*exp(-days/120)
//     recentCommits      100*log10(1+n)/log10(21), n = commits in 30d, capped 100
//   Community (20%)
//     contributorCount   100*log10(1+n)/log10(101), capped 100
//     concentration      100*(1 - topContributorShare)
//     recentContributors 0→0, 1→30, 2–3→60, 4–9→85, 10+→100 distinct committers in 90d
//   Issue & PR (20%)
//     issueClosureRatio  closed/(open+closed) in the issue sample * 100
//     openIssueAge       100*exp(-medianOpenIssueAgeDays/180)
//     prMergeRatio       merged/(merged+closed-unmerged) in the PR sample * 100
//   Release hygiene (15%)
//     releaseRecency     100*exp(-daysSinceLatestRelease/180); null when no releases
//     releaseFrequency   0→10, 1→50, 2–3→75, 4+→100 releases in 12 months
//                        (0 releases is evidence of poor hygiene, not missing data)
//   Documentation & hygiene (10%) — each present 100 / absent 0 / unknown null
//     readme, license, contributing, codeOfConduct, issueTemplate,
//     prTemplate (from the community profile), ci (from .github/workflows)
//   Adoption context (10%) — log-scaled so popularity cannot dominate
//     stars 100*log10(1+stars)/log10(10001), capped 100
//     forks 100*log10(1+forks)/log10(1001), capped 100
//
// Category score = mean of its available signals. Overall = weighted
// sum over AVAILABLE categories only, weights renormalized to 100%.
// Coverage = weight of available signals / total signal weight.

import type { ActivityData } from '../domain/activity';
import type { EvidenceItem, RepositoryFacts } from '../domain/repository';
import type {
  CategoryScore,
  Grade,
  RepositoryReport,
  SignalScore,
} from '../domain/report';
import { confidenceFor } from './confidence';
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
} from './metrics';
import {
  CATEGORIES,
  GRADE_BANDS,
  SCORE_MODEL_VERSION,
  WINDOWS,
  signalWeight,
} from './model-v1';
import { generateObservations } from './observations';

const REPO_SOURCE = 'GET /repos/{owner}/{repo}';
const CONTRIBUTORS_SOURCE = 'GET /repos/{owner}/{repo}/contributors';
const COMMITS_SOURCE = 'GET /repos/{owner}/{repo}/commits';
const RELEASES_SOURCE = 'GET /repos/{owner}/{repo}/releases';
const ISSUES_SOURCE = 'GET /repos/{owner}/{repo}/issues';
const PULLS_SOURCE = 'GET /repos/{owner}/{repo}/pulls';
const COMMUNITY_SOURCE = 'GET /repos/{owner}/{repo}/community/profile';
const CI_SOURCE = 'GET /repos/{owner}/{repo}/contents/.github/workflows';

/** Source endpoint per signal, for the evidence trail. */
export const SIGNAL_SOURCES: Record<string, string> = {
  daysSincePush: REPO_SOURCE,
  recentCommits: COMMITS_SOURCE,
  contributorCount: CONTRIBUTORS_SOURCE,
  concentration: CONTRIBUTORS_SOURCE,
  recentContributors: COMMITS_SOURCE,
  issueClosureRatio: ISSUES_SOURCE,
  openIssueAge: ISSUES_SOURCE,
  prMergeRatio: PULLS_SOURCE,
  releaseRecency: RELEASES_SOURCE,
  releaseFrequency: RELEASES_SOURCE,
  readme: COMMUNITY_SOURCE,
  license: COMMUNITY_SOURCE,
  contributing: COMMUNITY_SOURCE,
  codeOfConduct: COMMUNITY_SOURCE,
  issueTemplate: COMMUNITY_SOURCE,
  prTemplate: COMMUNITY_SOURCE,
  ci: CI_SOURCE,
};

function nullSignal(key: string, label: string, detail: string): SignalScore {
  return { key, label, score: null, value: null, detail };
}

export function scoreSignals(
  facts: RepositoryFacts,
  activity: ActivityData,
  nowMs: number,
): SignalScore[] {
  const signals: SignalScore[] = [];

  // --- Maintenance ---
  const pushDays = daysSince(facts.pushedAt, nowMs);
  signals.push(
    pushDays === null
      ? nullSignal('daysSincePush', 'Days since last push', 'Last push date is unknown.')
      : {
          key: 'daysSincePush',
          label: 'Days since last push',
          score: round1(expDecay(pushDays, 120)),
          value: pushDays,
          detail: pushDays === 0 ? 'Pushed today.' : `Pushed ${pushDays} days ago.`,
        },
  );

  if (activity.commits === null) {
    signals.push(nullSignal('recentCommits', 'Commits in last 30 days', 'Commit sample unavailable.'));
  } else {
    const count = commitsInWindow(activity.commits, WINDOWS.recentCommitDays, nowMs);
    signals.push({
      key: 'recentCommits',
      label: 'Commits in last 30 days',
      score: round1(logScale(count, 20)),
      value: count,
      detail: `${count} commits in the last ${WINDOWS.recentCommitDays} days.`,
    });
  }

  // --- Community ---
  if (activity.contributors === null) {
    signals.push(nullSignal('contributorCount', 'Contributor count', 'Contributor sample unavailable.'));
    signals.push(nullSignal('concentration', 'Top contributor share', 'Contributor sample unavailable.'));
  } else {
    const count = activity.contributors.length;
    signals.push({
      key: 'contributorCount',
      label: 'Contributor count',
      score: round1(logScale(count, 100)),
      value: count,
      detail: `${count} contributors in the sample.`,
    });
    const share = topContributorShare(activity.contributors.map((c) => c.contributions));
    signals.push(
      share === null
        ? nullSignal('concentration', 'Top contributor share', 'No contributions in the sample.')
        : {
            key: 'concentration',
            label: 'Top contributor share',
            score: round1(100 * (1 - share)),
            value: share,
            detail: `Top contributor wrote ${Math.round(share * 100)}% of commits.`,
          },
    );
  }

  if (activity.commits === null) {
    signals.push(nullSignal('recentContributors', 'Distinct contributors in 90 days', 'Commit sample unavailable.'));
  } else {
    const distinct = distinctCommitters(activity.commits, WINDOWS.commitSampleDays, nowMs);
    signals.push({
      key: 'recentContributors',
      label: 'Distinct contributors in 90 days',
      score: recentContributorsScore(distinct),
      value: distinct,
      detail: `${distinct} distinct contributors in the last ${WINDOWS.commitSampleDays} days.`,
    });
  }

  // --- Issue & PR workflow (issues endpoint also returns PRs —
  // split them out via the pull_request field, spec §10.1). ---
  if (activity.issues === null) {
    signals.push(nullSignal('issueClosureRatio', 'Issue closure ratio', 'Issue sample unavailable.'));
    signals.push(nullSignal('openIssueAge', 'Median open issue age', 'Issue sample unavailable.'));
  } else {
    const issues = activity.issues.filter((i) => !i.isPullRequest);
    const open = issues.filter((i) => i.state === 'open');
    const closed = issues.filter((i) => i.state === 'closed');
    const ratio = closureRatio(open.length, closed.length);
    signals.push(
      ratio === null
        ? nullSignal('issueClosureRatio', 'Issue closure ratio', 'No issues in the sample.')
        : {
            key: 'issueClosureRatio',
            label: 'Issue closure ratio',
            score: round1(ratio * 100),
            value: ratio,
            detail: `${closed.length} of ${issues.length} sampled issues are closed.`,
          },
    );
    const openAges = open
      .map((i) => daysSince(i.createdAt, nowMs))
      .filter((d): d is number => d !== null);
    const medianAge = median(openAges);
    signals.push(
      medianAge === null
        ? nullSignal('openIssueAge', 'Median open issue age', 'No open issues in the sample.')
        : {
            key: 'openIssueAge',
            label: 'Median open issue age',
            score: round1(expDecay(medianAge, 180)),
            value: medianAge,
            detail: `Median open issue is ${Math.round(medianAge)} days old.`,
          },
    );
  }

  if (activity.pulls === null) {
    signals.push(nullSignal('prMergeRatio', 'Pull request merge ratio', 'Pull request sample unavailable.'));
  } else {
    const merged = activity.pulls.filter((p) => p.mergedAt !== null).length;
    const closedUnmerged = activity.pulls.filter(
      (p) => p.state === 'closed' && p.mergedAt === null,
    ).length;
    const denominator = merged + closedUnmerged;
    signals.push(
      denominator === 0
        ? nullSignal('prMergeRatio', 'Pull request merge ratio', 'No closed or merged pull requests in the sample.')
        : {
            key: 'prMergeRatio',
            label: 'Pull request merge ratio',
            score: round1((merged / denominator) * 100),
            value: merged / denominator,
            detail: `${merged} of ${denominator} decided pull requests were merged.`,
          },
    );
  }

  // --- Release hygiene ---
  if (activity.releases === null) {
    signals.push(nullSignal('releaseRecency', 'Days since latest release', 'Release sample unavailable.'));
    signals.push(nullSignal('releaseFrequency', 'Releases in last 12 months', 'Release sample unavailable.'));
  } else {
    const recencyDays = daysSinceLatestRelease(activity.releases, nowMs);
    signals.push(
      recencyDays === null
        ? nullSignal('releaseRecency', 'Days since latest release', 'No releases published.')
        : {
            key: 'releaseRecency',
            label: 'Days since latest release',
            score: round1(expDecay(recencyDays, 180)),
            value: recencyDays,
            detail: `Latest release was ${recencyDays} days ago.`,
          },
    );
    const count12mo = releasesInWindow(activity.releases, WINDOWS.releaseFrequencyDays, nowMs);
    signals.push({
      key: 'releaseFrequency',
      label: 'Releases in last 12 months',
      score: releaseFrequencyScore(count12mo),
      value: count12mo,
      detail: `${count12mo} releases in the last 12 months.`,
    });
  }

  // --- Documentation & hygiene ---
  const docSignals: { key: string; label: string; present: boolean | null }[] = [
    { key: 'readme', label: 'README present', present: activity.communityProfile?.readme ?? null },
    { key: 'license', label: 'License present', present: activity.communityProfile?.license ?? null },
    { key: 'contributing', label: 'CONTRIBUTING present', present: activity.communityProfile?.contributing ?? null },
    { key: 'codeOfConduct', label: 'Code of conduct present', present: activity.communityProfile?.codeOfConduct ?? null },
    { key: 'issueTemplate', label: 'Issue template present', present: activity.communityProfile?.issueTemplate ?? null },
    { key: 'prTemplate', label: 'Pull request template present', present: activity.communityProfile?.pullRequestTemplate ?? null },
    { key: 'ci', label: 'CI workflows present', present: activity.ciWorkflowsPresent },
  ];
  for (const doc of docSignals) {
    signals.push(
      doc.present === null
        ? nullSignal(doc.key, doc.label, `${doc.label} could not be checked.`)
        : {
            key: doc.key,
            label: doc.label,
            score: doc.present ? 100 : 0,
            value: doc.present,
            detail: doc.present ? `${doc.label}.` : `No ${doc.label.toLowerCase()} found.`,
          },
    );
  }

  // --- Adoption context (log-scaled; popularity never dominates) ---
  signals.push({
    key: 'stars',
    label: 'Stars',
    score: round1(logScale(facts.stars, 10000)),
    value: facts.stars,
    detail: `${facts.stars.toLocaleString('en-US')} stars.`,
  });
  signals.push({
    key: 'forks',
    label: 'Forks',
    score: round1(logScale(facts.forks, 1000)),
    value: facts.forks,
    detail: `${facts.forks.toLocaleString('en-US')} forks.`,
  });

  return signals;
}

export function scoreCategories(signals: SignalScore[]): CategoryScore[] {
  return CATEGORIES.map((def) => {
    const catSignals = def.signals.map(
      (key) => signals.find((s) => s.key === key) as SignalScore,
    );
    const available = catSignals.filter((s) => s.score !== null);
    const score =
      available.length === 0
        ? null
        : round1(available.reduce((sum, s) => sum + (s.score as number), 0) / available.length);
    return {
      key: def.key,
      label: def.label,
      score,
      weight: def.weight,
      evidenceKeys: catSignals.map((s) => s.key),
      status: available.length === catSignals.length ? 'available' : available.length === 0 ? 'unknown' : 'partial',
      signals: catSignals,
    };
  });
}

/** Coverage 0–100: weight of scored signals / total signal weight. */
export function coverageFor(signals: SignalScore[]): number {
  let total = 0;
  let available = 0;
  for (const category of CATEGORIES) {
    for (const key of category.signals) {
      const weight = signalWeight(category.key, key);
      total += weight;
      if (signals.find((s) => s.key === key)?.score !== null) available += weight;
    }
  }
  return total === 0 ? 0 : round1((100 * available) / total);
}

/** Weighted score over available categories only, weights
 *  renormalized. Null when no category could be scored. */
export function overallFor(categories: CategoryScore[]): number | null {
  const available = categories.filter((c) => c.score !== null);
  if (available.length === 0) return null;
  const weighted = available.reduce((sum, c) => sum + (c.score as number) * c.weight, 0);
  const weightSum = available.reduce((sum, c) => sum + c.weight, 0);
  return round1(weighted / weightSum);
}

export function gradeFor(score: number | null): Grade | null {
  if (score === null) return null;
  const band = GRADE_BANDS.find((b) => score >= b.min);
  return (band?.grade ?? 'F') as Grade;
}

export function gradeLabel(grade: Grade | null): string {
  if (grade === null) return 'Not scored';
  const band = GRADE_BANDS.find((b) => b.grade === grade);
  return band?.label ?? '';
}

export interface BuildReportOptions {
  nowMs: number;
  /** Evidence from the overview (repo + languages) — the report
   *  appends one evidence item per scored signal. */
  evidence: EvidenceItem[];
  stale?: boolean;
}

/** Build the full report from L0 facts + L1 activity. Pure given
 *  its inputs (nowMs included) — the service passes Date.now(). */
export function buildReport(
  facts: RepositoryFacts,
  activity: ActivityData,
  options: BuildReportOptions,
): RepositoryReport {
  const { nowMs, evidence } = options;
  const signals = scoreSignals(facts, activity, nowMs);
  const categories = scoreCategories(signals);
  const coverage = coverageFor(signals);
  const anyTruncated = Object.values(activity.truncated).some(Boolean);
  const { confidence, provisional } = confidenceFor(coverage, anyTruncated);
  const overallScore = provisional ? null : overallFor(categories);

  const signalEvidence: EvidenceItem[] = signals.map((signal) => ({
    key: `signal:${signal.key}`,
    value: signal.value,
    source: SIGNAL_SOURCES[signal.key] ?? 'unknown',
    observedAt: activity.fetchedAt,
    window:
      signal.key === 'recentCommits'
        ? `last ${WINDOWS.recentCommitDays} days`
        : signal.key === 'recentContributors'
          ? `last ${WINDOWS.commitSampleDays} days`
          : signal.key === 'releaseFrequency'
            ? `last ${WINDOWS.releaseFrequencyDays} days`
            : undefined,
    limitation:
      signal.score === null ? 'Evidence missing — this signal lowered coverage instead of scoring 0.' : undefined,
  }));

  const sampleNotes: string[] = [];
  const truncatedLabels: Record<string, string> = {
    contributors: 'Contributor',
    commits: 'Commit',
    releases: 'Release',
    issues: 'Issue',
    pulls: 'Pull request',
  };
  for (const [endpoint, truncated] of Object.entries(activity.truncated)) {
    if (!truncated) continue;
    const label = truncatedLabels[endpoint] ?? endpoint;
    sampleNotes.push(`${label} sample capped at its page limit — the sample may not represent the whole repository.`);
  }
  const failedEndpoints = Object.keys(activity.errors);
  if (failedEndpoints.length > 0) {
    sampleNotes.push(
      `Some endpoints could not be collected (${failedEndpoints.join(', ')}) — affected signals are unknown, not zero.`,
    );
  }
  if (
    activity.contributors === null &&
    activity.commits === null &&
    activity.releases === null &&
    activity.issues === null &&
    activity.pulls === null &&
    activity.communityProfile === null &&
    activity.ciWorkflowsPresent === null
  ) {
    sampleNotes.push('Activity data could not be collected — scores are based on repository metadata only.');
  }

  return {
    repoId: facts.id,
    overallScore,
    grade: gradeFor(overallScore),
    coverage,
    confidence,
    provisional,
    scoreModelVersion: SCORE_MODEL_VERSION,
    categories,
    observations: generateObservations(facts, activity, signals, nowMs),
    evidence: [...evidence, ...signalEvidence],
    generatedAt: new Date(nowMs).toISOString(),
    sampleNotes,
    stale: options.stale ?? false,
  };
}
