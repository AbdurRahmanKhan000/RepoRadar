// Provider abstraction — the multi-platform spine of RepoRadar.
// The owner requires GitHub, GitLab and other Git-hosting platforms,
// and nothing else. Every platform implements this interface; the UI
// and the scoring engine (Build 3) only ever talk to RepoProvider,
// never to a platform API directly. Adding a platform means:
//   1. implement RepoProvider for it,
//   2. register it in src/providers/registry.ts,
//   3. add its host permission + content-script match.
// GitHub is the only implementation in Build 2. GitLab is next;
// its URL shape (nested groups) is why `owner` here is a path
// segment string, not a single GitHub-style login.

import type {
  CommitSample,
  CommunityProfileSample,
  ContributorSample,
  IssueSample,
  PullSample,
  ReleaseSample,
} from '../domain/activity';
import type {
  LanguageBreakdown,
  RateLimitInfo,
  RepoRef,
  RepositoryFacts,
} from '../domain/repository';

export interface ProviderFetchOptions {
  /** Send If-None-Match with this ETag; a 304 returns cached data. */
  etag?: string;
  /** AbortSignal for cancellation (not yet wired to UI). */
  signal?: AbortSignal;
}

export interface ProviderFetchResult<T> {
  data: T;
  /** ETag the API returned, for conditional requests next time. */
  etag: string | null;
  rateLimit: RateLimitInfo | null;
  /** True when the API answered 304 Not Modified. */
  notModified: boolean;
  fetchedAt: string;
  /** True when a list endpoint returned exactly its page limit —
   *  the sample is capped and may not represent the whole repo.
   *  Only set for list endpoints. */
  truncated?: boolean;
}

export interface RepoProvider {
  readonly platform: import('../domain/repository').Platform;
  /** Hostnames this provider serves, e.g. ["github.com", "www.github.com"]. */
  readonly hosts: readonly string[];
  /** Human label for the UI, e.g. "GitHub". */
  readonly label: string;

  /** Parse a URL on this provider's hosts into a RepoRef, or null. */
  parseRepoFromUrl(url: string | URL): RepoRef | null;

  getRepository(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<RepositoryFacts>>;

  getLanguages(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<LanguageBreakdown>>;

  // --- Activity samples (Build 3). Each is ONE bounded page; the
  // service fetches them in parallel and treats a failure as "that
  // sample is unknown", never as a reason to fail the whole report.
  // A page returning exactly its limit sets `truncated: true`.

  /** Contributors, 1 page of 100. */
  getContributors(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<ContributorSample[]>>;

  /** Commits since `sinceIso` (90 days), 1 page of 100. */
  getCommits(
    ref: RepoRef,
    options?: ProviderFetchOptions & { sinceIso?: string },
  ): Promise<ProviderFetchResult<CommitSample[]>>;

  /** Releases, 1 page of 20 (drafts excluded). */
  getReleases(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<ReleaseSample[]>>;

  /** Issues, state=all, 1 page of 100 — PRs included, flagged via
   *  `isPullRequest` so issue-only metrics can exclude them. */
  getIssues(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<IssueSample[]>>;

  /** Pull requests, state=all, 1 page of 100. */
  getPulls(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<PullSample[]>>;

  /** Community profile: which hygiene files the repo has. */
  getCommunityProfile(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<CommunityProfileSample>>;

  /** True when .github/workflows contains at least one workflow.
   *  A missing directory (404) means false, not an error; other
   *  failures throw and the service records the signal as unknown. */
  getCiPresence(
    ref: RepoRef,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<boolean>>;
}

