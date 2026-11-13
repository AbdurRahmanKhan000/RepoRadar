// L2 observations — spec §5.1. Deterministic, evidence-bound
// good / caution / unknown lists. Every observation states its exact
// evidence ("Pushed 4 days ago", "Top contributor wrote 62% of
// commits"). Language rules (spec §5.1, §6.1):
//   - say "repository health indicators" / "maintenance signals";
//   - NEVER say secure / safe / production-ready / bug-free /
//     high-quality code — metadata alone cannot prove any of those.
//   - an observation is an "indicator" or a "possible concern",
//     never a verdict.

import type { ActivityData } from '../domain/activity';
import type { RepositoryFacts } from '../domain/repository';
import type { Observations, SignalScore } from '../domain/report';
import { daysSince } from './metrics';
import { WINDOWS } from './model-v1';

function findSignal(signals: SignalScore[], key: string): SignalScore | undefined {
  return signals.find((s) => s.key === key);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function generateObservations(
  facts: RepositoryFacts,
  activity: ActivityData,
  signals: SignalScore[],
  nowMs: number,
): Observations {
  const good: string[] = [];
  const caution: string[] = [];
  const unknown: string[] = [];

  // Archived is a hard observation, independent of the numbers:
  // an archived repo is no longer maintained, whatever its history.
  if (facts.archived) {
    caution.push('Archived — no longer maintained. The repository is read-only on GitHub.');
  }

  // --- Maintenance ---
  const days = daysSince(facts.pushedAt, nowMs);
  if (days === null) {
    unknown.push('Last push date is unknown — maintenance recency could not be assessed.');
  } else if (days <= 30) {
    good.push(`Pushed ${days} ${plural(days, 'day', 'days')} ago — recent maintenance activity is visible.`);
  } else if (days <= 180) {
    caution.push(`Last push was ${days} days ago — maintenance activity is not recent.`);
  } else {
    caution.push(`No push in ${days} days — the repository looks inactive.`);
  }

  const commitsSignal = findSignal(signals, 'recentCommits');
  if (!commitsSignal || commitsSignal.score === null) {
    unknown.push('Recent commit activity is unknown — the commit sample could not be collected.');
  } else if (typeof commitsSignal.value === 'number') {
    if (commitsSignal.value >= 10) {
      good.push(`${commitsSignal.value} commits in the last ${WINDOWS.recentCommitDays} days.`);
    } else if (commitsSignal.value === 0) {
      caution.push(`No commits in the last ${WINDOWS.recentCommitDays} days (90-day sample).`);
    }
  }

  // --- Community ---
  const concentration = findSignal(signals, 'concentration');
  if (!concentration || concentration.score === null) {
    unknown.push('Contributor concentration is unknown — the contributor sample could not be collected.');
  } else if (typeof concentration.value === 'number') {
    const pct = Math.round(concentration.value * 100);
    if (concentration.value > 0.5) {
      caution.push(`Top contributor wrote ${pct}% of commits — contribution is concentrated in one person.`);
    } else if (concentration.value <= 0.2) {
      good.push(`Top contributor wrote ${pct}% of commits — contributions are spread out.`);
    }
  }

  const recentContributors = findSignal(signals, 'recentContributors');
  if (!recentContributors || recentContributors.score === null) {
    unknown.push('Recent contributor activity is unknown — the commit sample could not be collected.');
  } else if (typeof recentContributors.value === 'number' && recentContributors.value >= 10) {
    good.push(`${recentContributors.value} distinct contributors in the last 90 days.`);
  } else if (typeof recentContributors.value === 'number' && recentContributors.value === 0) {
    caution.push('No distinct contributors in the last 90 days.');
  }

  const contributorCount = findSignal(signals, 'contributorCount');
  if (!contributorCount || contributorCount.score === null) {
    unknown.push('Contributor count is unknown — the contributor sample could not be collected.');
  }

  // --- Issue & PR workflow ---
  const closure = findSignal(signals, 'issueClosureRatio');
  if (!closure || closure.score === null) {
    unknown.push('Issue closure ratio is unknown — no issues in the sample, or the issue sample could not be collected.');
  } else if (typeof closure.value === 'number') {
    const pct = Math.round(closure.value * 100);
    if (closure.value >= 0.7) {
      good.push(`${pct}% of sampled issues are closed.`);
    } else if (closure.value < 0.3) {
      caution.push(`Only ${pct}% of sampled issues are closed — many issues stay open.`);
    }
  }

  const issueAge = findSignal(signals, 'openIssueAge');
  if (!issueAge || issueAge.score === null) {
    if (activity.issues !== null && activity.issues.filter((i) => !i.isPullRequest && i.state === 'open').length === 0) {
      good.push('No open issues in the sample.');
    } else {
      unknown.push('Open-issue age is unknown — the issue sample could not be collected.');
    }
  } else if (typeof issueAge.value === 'number') {
    const medianDays = Math.round(issueAge.value);
    if (medianDays > 180) {
      caution.push(`Median open issue is ${medianDays} days old — open issues linger.`);
    } else if (medianDays <= 30) {
      good.push(`Median open issue is ${medianDays} days old.`);
    }
  }

  const prMerge = findSignal(signals, 'prMergeRatio');
  if (!prMerge || prMerge.score === null) {
    unknown.push('Pull-request merge behaviour is unknown — no pull requests in the sample.');
  } else if (typeof prMerge.value === 'number') {
    const pct = Math.round(prMerge.value * 100);
    if (prMerge.value >= 0.7) {
      good.push(`${pct}% of sampled pull requests were merged.`);
    } else if (prMerge.value < 0.3) {
      caution.push(`Only ${pct}% of sampled pull requests were merged.`);
    }
  }

  // --- Releases ---
  const releaseRecency = findSignal(signals, 'releaseRecency');
  const releaseFrequency = findSignal(signals, 'releaseFrequency');
  if ((!releaseRecency || releaseRecency.score === null) && releaseFrequency && releaseFrequency.score !== null) {
    caution.push('No releases published — release recency cannot be assessed.');
  } else if (releaseRecency && typeof releaseRecency.value === 'number') {
    const daysSinceRelease = Math.round(releaseRecency.value);
    if (daysSinceRelease <= 90) {
      good.push(`Latest release was ${daysSinceRelease} ${plural(daysSinceRelease, 'day', 'days')} ago.`);
    } else if (daysSinceRelease > 365) {
      const months = Math.round(daysSinceRelease / 30);
      caution.push(`No release in ${months} months.`);
    }
  }
  if (!releaseFrequency || releaseFrequency.score === null) {
    unknown.push('Release frequency is unknown — the release sample could not be collected.');
  } else if (typeof releaseFrequency.value === 'number' && releaseFrequency.value >= 4) {
    good.push(`${releaseFrequency.value} releases in the last 12 months.`);
  }

  // --- Documentation & hygiene ---
  const docKeys = ['readme', 'license', 'contributing', 'codeOfConduct', 'issueTemplate', 'prTemplate', 'ci'] as const;
  const docLabels: Record<(typeof docKeys)[number], string> = {
    readme: 'README',
    license: 'license',
    contributing: 'CONTRIBUTING file',
    codeOfConduct: 'code of conduct',
    issueTemplate: 'issue template',
    prTemplate: 'pull request template',
    ci: 'CI workflows in .github/workflows',
  };
  const missingDocs: string[] = [];
  let docsUnknown = false;
  for (const key of docKeys) {
    const signal = findSignal(signals, key);
    if (!signal || signal.score === null) {
      docsUnknown = true;
    } else if (signal.value === 0 || signal.value === false) {
      missingDocs.push(docLabels[key]);
    }
  }
  if (missingDocs.length > 0) {
    caution.push(`No ${missingDocs.join(', ')} found.`);
  }
  if (missingDocs.length === 0 && !docsUnknown) {
    good.push('README, license, contributing guide, templates and CI workflows are all present.');
  }
  if (docsUnknown) {
    unknown.push('Some documentation signals could not be checked — the community profile or CI check failed.');
  }

  // --- Adoption ---
  const stars = findSignal(signals, 'stars');
  if (stars && stars.score !== null && typeof stars.value === 'number' && stars.value >= 1000) {
    good.push(`Widely adopted: ${stars.value.toLocaleString('en-US')} stars.`);
  }

  return { good, caution, unknown };
}
