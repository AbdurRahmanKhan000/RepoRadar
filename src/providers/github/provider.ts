// GitHub provider — the only RepoProvider in Build 2.
// Normalization rules (spec §5.1, §9.3):
//   - API fields map 1:1 to RepositoryFacts; nothing is invented.
//   - Null stays null. `open_issues_count` is carried with an
//     evidence limitation: GitHub counts open issues AND open PRs.
//   - Language bytes become percentages; rounding is documented
//     (1 decimal) and tested in Build 3's metrics work.
// Evidence: every normalized value is traceable to its endpoint,
// collection time and limitation. The scoring engine (Build 3)
// consumes these EvidenceItems, never raw API objects.

import {
  type CommitSample,
  type CommunityProfileSample,
  type ContributorSample,
  type IssueSample,
  type PullSample,
  type ReleaseSample,
} from '../../domain/activity';
import {
  ProviderError,
  type EvidenceItem,
  type LanguageBreakdown,
  type LanguageEntry,
  type RepoRef,
  type RepositoryFacts,
} from '../../domain/repository';
import { parseRepoFromUrl } from '../../shared/repo-url';
import type { ProviderFetchOptions, ProviderFetchResult, RepoProvider } from '../types';
import { GitHubApiClient } from './client';
import {
  GitHubCommitsSchema,
  GitHubCommunityProfileSchema,
  GitHubContentsSchema,
  GitHubContributorsSchema,
  GitHubIssuesSchema,
  GitHubLanguagesSchema,
  GitHubPullsSchema,
  GitHubReleasesSchema,
  GitHubRepositorySchema,
  type GitHubCommit,
  type GitHubCommunityProfile,
  type GitHubContributor,
  type GitHubContents,
  type GitHubIssue,
  type GitHubPull,
  type GitHubRelease,
  type GitHubRepository,
} from './schemas';

export const GITHUB_REPO_SOURCE = 'GET /repos/{owner}/{repo}';
export const GITHUB_LANGUAGES_SOURCE = 'GET /repos/{owner}/{repo}/languages';

export function normalizeRepository(api: GitHubRepository, ref: RepoRef, fetchedAt: string): RepositoryFacts {
  return {
    id: `github:${api.full_name}`,
    platform: 'github',
    owner: ref.owner,
    name: api.name,
    fullName: api.full_name,
    htmlUrl: api.html_url,
    description: api.description,
    stars: api.stargazers_count,
    forks: api.forks_count,
    watchers: api.watchers_count,
    openIssuesCount: api.open_issues_count,
    primaryLanguage: api.language,
    licenseSpdxId: api.license?.spdx_id ?? null,
    licenseName: api.license?.name ?? null,
    createdAt: api.created_at,
    updatedAt: api.updated_at,
    pushedAt: api.pushed_at,
    archived: api.archived,
    isFork: api.fork,
    defaultBranch: api.default_branch,
    fetchedAt,
  };
}

export function repositoryEvidence(facts: RepositoryFacts): EvidenceItem[] {
  const at = facts.fetchedAt;
  return [
    { key: 'stars', value: facts.stars, source: GITHUB_REPO_SOURCE, observedAt: at },
    { key: 'forks', value: facts.forks, source: GITHUB_REPO_SOURCE, observedAt: at },
    { key: 'watchers', value: facts.watchers, source: GITHUB_REPO_SOURCE, observedAt: at },
    {
      key: 'openIssuesCount',
      value: facts.openIssuesCount,
      source: GITHUB_REPO_SOURCE,
      observedAt: at,
      limitation: 'GitHub counts open issues and open pull requests together in this field.',
    },
    { key: 'pushedAt', value: facts.pushedAt, source: GITHUB_REPO_SOURCE, observedAt: at },
    { key: 'license', value: facts.licenseSpdxId, source: GITHUB_REPO_SOURCE, observedAt: at },
    { key: 'archived', value: facts.archived, source: GITHUB_REPO_SOURCE, observedAt: at },
    { key: 'isFork', value: facts.isFork, source: GITHUB_REPO_SOURCE, observedAt: at },
  ];
}

export function normalizeLanguages(
  api: Record<string, number>,
  fetchedAt: string,
): LanguageBreakdown {
  const totalBytes = Object.values(api).reduce((sum, bytes) => sum + bytes, 0);
  const entries: LanguageEntry[] = Object.entries(api)
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: totalBytes === 0 ? 0 : Math.round((bytes / totalBytes) * 1000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  return { entries, totalBytes, fetchedAt };
}

// --- Activity normalizers (Build 3). API objects become the bounded
// domain samples in src/domain/activity.ts. Nulls stay null; the
// issues endpoint's PRs are flagged, not dropped, so the service
// can count them separately.

export function normalizeContributors(api: GitHubContributor[]): ContributorSample[] {
  return api.map((c) => ({ login: c.login, contributions: c.contributions }));
}

export function normalizeCommits(api: GitHubCommit[]): CommitSample[] {
  return api.map((c) => ({
    sha: c.sha,
    authorLogin: c.author?.login ?? c.committer?.login ?? null,
    committedAt: c.commit.committer?.date ?? c.commit.author?.date ?? null,
  }));
}

export function normalizeReleases(api: GitHubRelease[]): ReleaseSample[] {
  // Drafts are not published releases — exclude them from recency
  // and frequency. Pre-releases count: they are published.
  return api
    .filter((r) => !r.draft)
    .map((r) => ({ tagName: r.tag_name, publishedAt: r.published_at }));
}

export function normalizeIssues(api: GitHubIssue[]): IssueSample[] {
  return api.map((i) => ({
    number: i.number,
    state: i.state,
    createdAt: i.created_at,
    closedAt: i.closed_at,
    isPullRequest: i.pull_request !== undefined,
  }));
}

export function normalizePulls(api: GitHubPull[]): PullSample[] {
  return api.map((p) => ({
    number: p.number,
    state: p.state,
    mergedAt: p.merged_at,
    closedAt: p.closed_at,
  }));
}

export function normalizeCommunityProfile(api: GitHubCommunityProfile): CommunityProfileSample {
  const has = (file: { url: string; html_url: string } | null | undefined): boolean =>
    file !== null && file !== undefined;
  return {
    readme: has(api.files.readme),
    license: has(api.files.license),
    contributing: has(api.files.contributing),
    codeOfConduct: has(api.files.code_of_conduct),
    issueTemplate: has(api.files.issue_template),
    pullRequestTemplate: has(api.files.pull_request_template),
    healthPercentage: api.health_percentage ?? null,
  };
}

/** A workflows directory listing is "CI present" when it contains
 *  at least one entry. An empty directory means no workflows. */
export function normalizeCiPresence(api: GitHubContents): boolean {
  return api.length > 0;
}

export class GitHubProvider implements RepoProvider {
  readonly platform = 'github' as const;
  readonly hosts = ['github.com', 'www.github.com'] as const;
  readonly label = 'GitHub';
  private readonly client: GitHubApiClient;

  constructor(client: GitHubApiClient = new GitHubApiClient()) {
    this.client = client;
  }

  parseRepoFromUrl(url: string | URL): RepoRef | null {
    // Reuse the tested GitHub URL parser from Build 1.
    const parsed = parseRepoFromUrl(url);
    if (!parsed) return null;
    const host = typeof url === 'string' ? new URL(url).hostname : url.hostname;
    return { platform: 'github', host, owner: parsed.owner, repo: parsed.repo };
  }

  async getRepository(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<RepositoryFacts>> {
    const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
    const res = await this.client.request(path, GitHubRepositorySchema, options);
    const facts = normalizeRepository(res.data, ref, res.fetchedAt);
    return { data: facts, etag: res.etag, rateLimit: res.rateLimit, notModified: false, fetchedAt: res.fetchedAt };
  }

  async getLanguages(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<LanguageBreakdown>> {
    const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/languages`;
    const res = await this.client.request(path, GitHubLanguagesSchema, options);
    return {
      data: normalizeLanguages(res.data, res.fetchedAt),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
    };
  }

  private repoPath(ref: RepoRef, suffix: string): string {
    return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${suffix}`;
  }

  async getContributors(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<ContributorSample[]>> {
    const res = await this.client.request(
      this.repoPath(ref, '/contributors?per_page=100'),
      GitHubContributorsSchema,
      options,
    );
    return {
      data: normalizeContributors(res.data),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
      truncated: res.data.length === 100,
    };
  }

  async getCommits(
    ref: RepoRef,
    options: ProviderFetchOptions & { sinceIso?: string } = {},
  ): Promise<ProviderFetchResult<CommitSample[]>> {
    const query = options.sinceIso
      ? `?per_page=100&since=${encodeURIComponent(options.sinceIso)}`
      : '?per_page=100';
    const res = await this.client.request(this.repoPath(ref, `/commits${query}`), GitHubCommitsSchema, options);
    return {
      data: normalizeCommits(res.data),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
      truncated: res.data.length === 100,
    };
  }

  async getReleases(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<ReleaseSample[]>> {
    const res = await this.client.request(
      this.repoPath(ref, '/releases?per_page=20'),
      GitHubReleasesSchema,
      options,
    );
    return {
      data: normalizeReleases(res.data),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
      truncated: res.data.length === 20,
    };
  }

  async getIssues(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<IssueSample[]>> {
    const res = await this.client.request(
      this.repoPath(ref, '/issues?state=all&per_page=100'),
      GitHubIssuesSchema,
      options,
    );
    return {
      data: normalizeIssues(res.data),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
      truncated: res.data.length === 100,
    };
  }

  async getPulls(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<PullSample[]>> {
    const res = await this.client.request(
      this.repoPath(ref, '/pulls?state=all&per_page=100'),
      GitHubPullsSchema,
      options,
    );
    return {
      data: normalizePulls(res.data),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
      truncated: res.data.length === 100,
    };
  }

  async getCommunityProfile(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<CommunityProfileSample>> {
    const res = await this.client.request(
      this.repoPath(ref, '/community/profile'),
      GitHubCommunityProfileSchema,
      options,
    );
    return {
      data: normalizeCommunityProfile(res.data),
      etag: res.etag,
      rateLimit: res.rateLimit,
      notModified: false,
      fetchedAt: res.fetchedAt,
    };
  }

  async getCiPresence(
    ref: RepoRef,
    options: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult<boolean>> {
    try {
      const res = await this.client.request(
        this.repoPath(ref, '/contents/.github/workflows'),
        GitHubContentsSchema,
        options,
      );
      return {
        data: normalizeCiPresence(res.data),
        etag: res.etag,
        rateLimit: res.rateLimit,
        notModified: false,
        fetchedAt: res.fetchedAt,
      };
    } catch (error) {
      // A missing .github/workflows directory (404) means "no CI
      // workflows", not an error — the CI signal scores 0.
      if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
        return {
          data: false,
          etag: null,
          rateLimit: error.rateLimit,
          notModified: false,
          fetchedAt: new Date().toISOString(),
        };
      }
      throw error;
    }
  }
}
