// Display formulas for the evidence drawer — Build 4.
// These strings describe the formulas in src/analysis/scoring.ts
// (score model 1.0.0) for the UI only. They never compute anything:
// the numbers always come from the report. If a formula changes in
// scoring.ts, the model version must change and this map with it.

export const SIGNAL_FORMULAS: Record<string, string> = {
  daysSincePush: '100 × exp(−days since last push / 120)',
  recentCommits: '100 × log₁₀(1 + commits in last 30 days) / log₁₀(21), capped at 100',
  contributorCount: '100 × log₁₀(1 + contributors in sample) / log₁₀(101), capped at 100',
  concentration: '100 × (1 − top contributor share of contributions)',
  recentContributors: 'Distinct committers in 90 days: 0 → 0, 1 → 30, 2–3 → 60, 4–9 → 85, 10+ → 100',
  issueClosureRatio: '100 × closed issues / (open + closed issues in the sample)',
  openIssueAge: '100 × exp(−median open-issue age in days / 180)',
  prMergeRatio: '100 × merged pull requests / (merged + closed-unmerged pull requests in the sample)',
  releaseRecency: '100 × exp(−days since latest release / 180); no score when there are no releases',
  releaseFrequency: 'Releases in 12 months: 0 → 10, 1 → 50, 2–3 → 75, 4+ → 100',
  readme: 'README present → 100, absent → 0, could not be checked → no score',
  license: 'License present → 100, absent → 0, could not be checked → no score',
  contributing: 'CONTRIBUTING present → 100, absent → 0, could not be checked → no score',
  codeOfConduct: 'Code of conduct present → 100, absent → 0, could not be checked → no score',
  issueTemplate: 'Issue template present → 100, absent → 0, could not be checked → no score',
  prTemplate: 'Pull request template present → 100, absent → 0, could not be checked → no score',
  ci: 'CI workflows in .github/workflows present → 100, absent → 0, could not be checked → no score',
  stars: '100 × log₁₀(1 + stars) / log₁₀(10001), capped at 100',
  forks: '100 × log₁₀(1 + forks) / log₁₀(1001), capped at 100',
};

export function formulaFor(signalKey: string): string {
  return SIGNAL_FORMULAS[signalKey] ?? 'Formula not documented for this signal.';
}
