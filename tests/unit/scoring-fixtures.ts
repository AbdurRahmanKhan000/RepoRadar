// Shared fixture builders for the Build 3 scoring tests.
// All dates are relative to FIXED_NOW so every test is
// deterministic — the scoring engine never reads the real clock.

import type {
  ActivityData,
  CommitSample,
  ContributorSample,
  IssueSample,
  PullSample,
  ReleaseSample,
} from '../../src/domain/activity';
import type { RepositoryFacts } from '../../src/domain/repository';

export const FIXED_NOW = Date.parse('2026-11-13T12:00:00Z');

export function isoDaysAgo(days: number, nowMs: number = FIXED_NOW): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export function makeFacts(overrides: Partial<RepositoryFacts> = {}): RepositoryFacts {
  return {
    id: 'github:test/repo',
    platform: 'github',
    owner: 'test',
    name: 'repo',
    fullName: 'test/repo',
    htmlUrl: 'https://github.com/test/repo',
    description: 'Test repo.',
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssuesCount: 0,
    primaryLanguage: 'TypeScript',
    licenseSpdxId: 'MIT',
    licenseName: 'MIT License',
    createdAt: isoDaysAgo(365),
    updatedAt: isoDaysAgo(1),
    pushedAt: isoDaysAgo(1),
    archived: false,
    isFork: false,
    defaultBranch: 'main',
    fetchedAt: new Date(FIXED_NOW).toISOString(),
    ...overrides,
  };
}

export function makeActivity(overrides: Partial<ActivityData> = {}): ActivityData {
  return {
    contributors: [],
    commits: [],
    releases: [],
    issues: [],
    pulls: [],
    communityProfile: {
      readme: true,
      license: true,
      contributing: true,
      codeOfConduct: true,
      issueTemplate: true,
      pullRequestTemplate: true,
      healthPercentage: 100,
    },
    ciWorkflowsPresent: true,
    truncated: {
      contributors: false,
      commits: false,
      releases: false,
      issues: false,
      pulls: false,
    },
    errors: {},
    fetchedAt: new Date(FIXED_NOW).toISOString(),
    ...overrides,
  };
}

/** `count` commits spread over the last `daysSpan` days, cycling
 *  through `authorCount` distinct logins. */
export function commitSamples(count: number, daysSpan: number, authorCount: number): CommitSample[] {
  const commits: CommitSample[] = [];
  for (let i = 0; i < count; i++) {
    const day = daysSpan === 0 ? 0 : (i % daysSpan) + 0.5;
    commits.push({
      sha: `sha${i}`,
      authorLogin: authorCount === 0 ? null : `dev${i % authorCount}`,
      committedAt: isoDaysAgo(day),
    });
  }
  return commits;
}

/** `total` contributors whose top contributor holds ~`topShare` of
 *  all contributions. */
export function contributorSamples(total: number, topShare: number): ContributorSample[] {
  const totalContributions = total * 10;
  const top = Math.max(1, Math.round(totalContributions * topShare));
  const rest = totalContributions - top;
  const perOther = total > 1 ? Math.floor(rest / (total - 1)) : 0;
  const contributors: ContributorSample[] = [{ login: 'lead', contributions: top }];
  for (let i = 1; i < total; i++) {
    contributors.push({ login: `dev${i}`, contributions: perOther });
  }
  // Remainder goes to the second contributor so the total is exact.
  if (total > 1) {
    const sum = contributors.reduce((s, c) => s + c.contributions, 0);
    (contributors[1] as ContributorSample).contributions += totalContributions - sum;
  }
  return contributors;
}

/** Issues: `open` open issues all `medianOpenAgeDays` old (so the
 *  median is exact), plus `closed` closed issues. */
export function issueSamples(open: number, closed: number, medianOpenAgeDays: number): IssueSample[] {
  const issues: IssueSample[] = [];
  for (let i = 0; i < open; i++) {
    issues.push({
      number: i + 1,
      state: 'open',
      createdAt: isoDaysAgo(medianOpenAgeDays),
      closedAt: null,
      isPullRequest: false,
    });
  }
  for (let i = 0; i < closed; i++) {
    issues.push({
      number: open + i + 1,
      state: 'closed',
      createdAt: isoDaysAgo(medianOpenAgeDays + 10),
      closedAt: isoDaysAgo(5),
      isPullRequest: false,
    });
  }
  return issues;
}

export function pullSamples(merged: number, closedUnmerged: number, open = 0): PullSample[] {
  const pulls: PullSample[] = [];
  for (let i = 0; i < merged; i++) {
    pulls.push({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) });
  }
  for (let i = 0; i < closedUnmerged; i++) {
    pulls.push({ number: merged + i + 1, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) });
  }
  for (let i = 0; i < open; i++) {
    pulls.push({ number: merged + closedUnmerged + i + 1, state: 'open', mergedAt: null, closedAt: null });
  }
  return pulls;
}

export function releaseSamples(daysAgoList: number[]): ReleaseSample[] {
  return daysAgoList.map((days, i) => ({
    tagName: `v1.${i}.0`,
    publishedAt: isoDaysAgo(days),
  }));
}

/** Active, mature repo (react-like). Expected: overall ~94, grade A,
 *  coverage 100%, confidence high. */
export function activeRepo(): { facts: RepositoryFacts; activity: ActivityData } {
  return {
    facts: makeFacts({ stars: 250_000, forks: 50_000, pushedAt: isoDaysAgo(1), openIssuesCount: 20 }),
    activity: makeActivity({
      contributors: contributorSamples(200, 0.12),
      commits: commitSamples(50, 30, 12),
      releases: releaseSamples([30, 60, 90, 150, 210, 300]),
      issues: issueSamples(20, 80, 20),
      pulls: pullSamples(15, 5),
    }),
  };
}

/** Archived, long-inactive repo. Expected: overall ~18, grade F. */
export function archivedRepo(): { facts: RepositoryFacts; activity: ActivityData } {
  return {
    facts: makeFacts({
      stars: 500,
      forks: 40,
      pushedAt: isoDaysAgo(900),
      archived: true,
      openIssuesCount: 8,
    }),
    activity: makeActivity({
      contributors: contributorSamples(5, 0.6),
      commits: [],
      releases: releaseSamples([800]),
      issues: issueSamples(8, 2, 400),
      pulls: [],
      communityProfile: {
        readme: true,
        license: true,
        contributing: false,
        codeOfConduct: false,
        issueTemplate: false,
        pullRequestTemplate: false,
        healthPercentage: 30,
      },
      ciWorkflowsPresent: false,
    }),
  };
}

/** Tiny new repo: 1 contributor, no issues/PRs/releases.
 *  Expected: overall ~31, grade F, coverage 72.5%, medium. */
export function tinyRepo(): { facts: RepositoryFacts; activity: ActivityData } {
  return {
    facts: makeFacts({ stars: 3, forks: 0, pushedAt: isoDaysAgo(2), openIssuesCount: 0 }),
    activity: makeActivity({
      contributors: contributorSamples(1, 1),
      commits: commitSamples(3, 30, 1),
      releases: [],
      issues: [],
      pulls: [],
      communityProfile: {
        readme: true,
        license: false,
        contributing: false,
        codeOfConduct: false,
        issueTemplate: false,
        pullRequestTemplate: false,
        healthPercentage: 15,
      },
      ciWorkflowsPresent: false,
    }),
  };
}

/** Active repo with no releases at all. Expected: overall ~82, grade B. */
export function noReleaseRepo(): { facts: RepositoryFacts; activity: ActivityData } {
  const { facts, activity } = activeRepo();
  return { facts, activity: { ...activity, releases: [] } };
}
