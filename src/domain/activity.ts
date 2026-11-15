// Activity samples — spec §10.1 / §16.1 (refined into strict types).
// L0/L1 raw material for the scoring engine (Build 3). Everything is
// a bounded SAMPLE with a stated window, never "the full history":
//   contributors: 1 page of 100 (GitHub's cap for this endpoint use)
//   commits:      1 page of 100, since 90 days ago
//   releases:     1 page of 20
//   issues:       1 page of 100, state=all, PRs split out
//   pulls:        1 page of 100, state=all
// A null sample means the endpoint failed or was unavailable — never
// "zero". `truncated` records a page that returned exactly its limit,
// which caps confidence at Medium (spec §6.3, §14.1).

import type { ProviderErrorData } from './repository';

export interface ContributorSample {
  login: string;
  contributions: number;
}

export interface CommitSample {
  sha: string;
  /** GitHub login of the author, when the commit is linked to one. */
  authorLogin: string | null;
  committedAt: string | null;
}

export interface ReleaseSample {
  tagName: string;
  publishedAt: string | null;
}

export type IssueState = 'open' | 'closed';

export interface IssueSample {
  number: number;
  state: IssueState;
  createdAt: string;
  closedAt: string | null;
  /** True when the issues endpoint returned a pull request, not an
   *  issue — PRs are excluded from issue-only metrics. */
  isPullRequest: boolean;
}

export interface PullSample {
  number: number;
  state: IssueState;
  mergedAt: string | null;
  closedAt: string | null;
}

/** One week of commit activity, from GET /repos/{owner}/{repo}/
 *  stats/commit_activity (0.3.0, trajectory). `week` is the Unix
 *  timestamp (seconds) of the week start; `total` is the week's
 *  commit count; `days` is the per-day breakdown (Sunday first).
 *  The endpoint returns 52 weeks when GitHub has them. */
export interface CommitActivitySample {
  week: number;
  total: number;
  days: number[];
}

/** What the community profile endpoint reports as present/absent.
 *  Each flag is a file the repository does or does not have — a
 *  missing file is evidence of absence (score 0 for that signal),
 *  not missing data. */
export interface CommunityProfileSample {
  readme: boolean;
  license: boolean;
  contributing: boolean;
  codeOfConduct: boolean;
  issueTemplate: boolean;
  pullRequestTemplate: boolean;
  healthPercentage: number | null;
}

export type ActivityEndpoint =
  | 'contributors'
  | 'commits'
  | 'releases'
  | 'issues'
  | 'pulls'
  | 'communityProfile'
  | 'ci'
  | 'commitActivity';

export interface ActivityData {
  contributors: ContributorSample[] | null;
  commits: CommitSample[] | null;
  releases: ReleaseSample[] | null;
  issues: IssueSample[] | null;
  pulls: PullSample[] | null;
  communityProfile: CommunityProfileSample | null;
  /** GET /contents/.github/workflows: true = at least one workflow
   *  file, false = directory missing/empty (404 or empty listing),
   *  null = the check itself failed (unknown, not absent). */
  ciWorkflowsPresent: boolean | null;
  /** 52-week commit activity for the trajectory (0.3.0). Null when
   *  the stats endpoint was unavailable (e.g. GitHub still
   *  computing it, 202) — unknown, never zero. */
  commitActivity: CommitActivitySample[] | null;
  /** True per endpoint when its page returned exactly its limit —
   *  the sample is capped and may not represent the whole repo. */
  truncated: Record<
    'contributors' | 'commits' | 'releases' | 'issues' | 'pulls',
    boolean
  >;
  /** Per-endpoint failures, message-safe, so the report can say
   *  exactly which evidence is missing and why. */
  errors: Partial<Record<ActivityEndpoint, ProviderErrorData>>;
  fetchedAt: string;
}

/** An empty ActivityData: every endpoint unknown. Used when the
 *  activity fetch is skipped entirely (e.g. overview came from a
 *  stale cache and the live endpoints all failed). */
export function emptyActivityData(fetchedAt: string): ActivityData {
  return {
    contributors: null,
    commits: null,
    releases: null,
    issues: null,
    pulls: null,
    communityProfile: null,
    ciWorkflowsPresent: null,
    commitActivity: null,
    truncated: {
      contributors: false,
      commits: false,
      releases: false,
      issues: false,
      pulls: false,
    },
    errors: {},
    fetchedAt,
  };
}

/** Normalize a cached ActivityData into the current shape. Cache
 *  entries written before 0.3.0 have no `commitActivity` key, and
 *  entries written by an older build may lack other fields — a
 *  missing field is `undefined`, not null, and downstream code
 *  that only guards null would crash on it (the 0.3.0 regression
 *  that broke the Build 4–6 browser checks: `weeks.map` on
 *  undefined). Every missing sample becomes null (unknown, never
 *  zero); missing truncation/error maps become the empty defaults.
 *  The service applies this to every cached activity it reads, so
 *  no consumer has to defend against old cache shapes. */
export function normalizeActivityData(value: unknown): ActivityData {
  const v = (value ?? {}) as Partial<ActivityData>;
  const empty = emptyActivityData(
    typeof v.fetchedAt === 'string' ? v.fetchedAt : new Date().toISOString(),
  );
  return {
    contributors: v.contributors ?? null,
    commits: v.commits ?? null,
    releases: v.releases ?? null,
    issues: v.issues ?? null,
    pulls: v.pulls ?? null,
    communityProfile: v.communityProfile ?? null,
    ciWorkflowsPresent: v.ciWorkflowsPresent ?? null,
    commitActivity: v.commitActivity ?? null,
    truncated: {
      contributors: v.truncated?.contributors ?? false,
      commits: v.truncated?.commits ?? false,
      releases: v.truncated?.releases ?? false,
      issues: v.truncated?.issues ?? false,
      pulls: v.truncated?.pulls ?? false,
    },
    errors: v.errors ?? {},
    fetchedAt: empty.fetchedAt,
  };
}
