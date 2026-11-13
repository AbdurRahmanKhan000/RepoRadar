// Hardening — Build 6 (spec §13, Build 6; §14 unit list).
// Three layers: (1) URL parsing never produces a repo ref from a
// hostile or malformed URL; (2) the GitHub client maps 403/429 to
// FORBIDDEN / RATE_LIMITED with the rate-limit state attached;
// (3) the service propagates those errors (and the archived /
// truncated-sample states) instead of swallowing them.
import { describe, expect, it, vi } from 'vitest';

import { isRateLimitExhausted, msUntilReset, resetInLabel } from '../../src/api/rate-limit';
import { ProviderError, type RepoRef } from '../../src/domain/repository';
import { GitHubApiClient } from '../../src/providers/github/client';
import { GitHubRepositorySchema } from '../../src/providers/github/schemas';
import { RepositoryService } from '../../src/services/repository-service';
import { parseRepoFromUrl } from '../../src/shared/repo-url';
import { InMemoryCache } from '../../src/storage/cache';
import { FIXED_NOW, archivedRepo } from './scoring-fixtures';

describe('parseRepoFromUrl — hostile and malformed input', () => {
  it('rejects non-http(s) schemes', () => {
    expect(parseRepoFromUrl('javascript:alert(1)')).toBeNull();
    expect(parseRepoFromUrl('data:text/html,<h1>x</h1>')).toBeNull();
    expect(parseRepoFromUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects lookalike hosts', () => {
    expect(parseRepoFromUrl('https://evilgithub.com/owner/repo')).toBeNull();
    expect(parseRepoFromUrl('https://github.com.evil.com/owner/repo')).toBeNull();
    // Cyrillic "і" (U+0456) in the host — a unicode homograph that
    // does NOT fold to ASCII (hostname stays xn--gthub-n2e.com).
    expect(parseRepoFromUrl('https://gіthub.com/owner/repo')).toBeNull();
  });

  it('resolves a fullwidth host the way the browser does', () => {
    // Fullwidth "ｂ" (U+FF42) folds to ASCII "b" under IDNA, so the
    // URL parser — like the browser itself — sees github.com.
    // Resolving here is correct, not a bypass.
    expect(parseRepoFromUrl('https://githuｂ.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('rejects percent-encoded traversal and separators', () => {
    expect(parseRepoFromUrl('https://github.com/%2e%2e/react')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/owner/repo%2Fevil')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/owner/repo%00evil')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/%2e%2e/%2e%2e')).toBeNull();
  });

  it('rejects names outside GitHub rules (length, charset, shape)', () => {
    expect(parseRepoFromUrl(`https://github.com/${'a'.repeat(40)}/repo`)).toBeNull();
    expect(parseRepoFromUrl(`https://github.com/owner/${'a'.repeat(101)}`)).toBeNull();
    expect(parseRepoFromUrl('https://github.com/owner.with.dots/repo')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/-owner-/repo')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/owner/repo with space')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/owner/.')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/owner/..')).toBeNull();
  });

  it('still resolves legitimate edge-case names', () => {
    // ".github" is a real repository name (community health files).
    expect(parseRepoFromUrl('https://github.com/facebook/.github')).toEqual({
      owner: 'facebook',
      repo: '.github',
    });
    expect(parseRepoFromUrl('https://github.com/owner/repo-with-dots.js')).toEqual({
      owner: 'owner',
      repo: 'repo-with-dots.js',
    });
    expect(parseRepoFromUrl('https://github.com/owner/repo?tab=readme-ov-file#readme')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRepoFromUrl('HTTPS://GITHUB.COM/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });
});

describe('GitHubApiClient — 403 / 429 mapping', () => {
  function stubFetch(status: number, remaining: number, retryAfterSec: number | null) {
    const headers = new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': String(remaining),
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800),
    });
    if (retryAfterSec !== null) headers.set('retry-after', String(retryAfterSec));
    return async () => new Response(JSON.stringify({ message: 'denied' }), { status, headers });
  }

  it('maps 403 with budget left to FORBIDDEN (never retried)', async () => {
    const client = new GitHubApiClient(stubFetch(403, 50, null));
    let caught: unknown;
    try {
      await client.request('/repos/o/r', GitHubRepositorySchema);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const err = caught as ProviderError;
    expect(err.code).toBe('FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.rateLimit?.remaining).toBe(50);
  });

  it('maps 403 with no budget left to RATE_LIMITED', async () => {
    // retry-after: 0 keeps the client's bounded retry loop instant.
    const client = new GitHubApiClient(stubFetch(403, 0, 0));
    await expect(client.request('/repos/o/r', GitHubRepositorySchema)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 403,
    });
  });

  it('maps 429 to RATE_LIMITED with the reset time attached', async () => {
    const client = new GitHubApiClient(stubFetch(429, 0, 0));
    let caught: unknown;
    try {
      await client.request('/repos/o/r', GitHubRepositorySchema);
    } catch (error) {
      caught = error;
    }
    const err = caught as ProviderError;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(err.rateLimit?.remaining).toBe(0);
    expect(err.rateLimit?.resetAtMs).not.toBeNull();
  });
});

describe('rate-limit helpers — exhausted state', () => {
  const exhausted = {
    limit: 60,
    remaining: 0,
    resetAtMs: FIXED_NOW + 12 * 60_000,
    retryAfterMs: null,
    source: 'test',
  };

  it('detects an exhausted window and labels the reset time', () => {
    expect(isRateLimitExhausted(exhausted)).toBe(true);
    expect(isRateLimitExhausted({ ...exhausted, remaining: 1 })).toBe(false);
    expect(isRateLimitExhausted(null)).toBe(false);
    expect(resetInLabel(exhausted, FIXED_NOW)).toBe('12m');
    expect(msUntilReset(exhausted, FIXED_NOW)).toBe(12 * 60_000);
  });

  it('never guesses when the reset time is unknown', () => {
    expect(resetInLabel({ ...exhausted, resetAtMs: null }, FIXED_NOW)).toBe('unknown');
    expect(msUntilReset({ ...exhausted, resetAtMs: null }, FIXED_NOW)).toBeNull();
    expect(msUntilReset(exhausted, FIXED_NOW + 60 * 60_000)).toBe(0);
  });
});

// Service-level tests reuse the registry-stub pattern from
// report-service.test.ts.
const fakeProvider = vi.hoisted(() => ({
  platform: 'github',
  hosts: ['github.com'],
  label: 'GitHub',
  parseRepoFromUrl: () => ref,
  getRepository: vi.fn(),
  getLanguages: vi.fn(),
  getContributors: vi.fn(),
  getCommits: vi.fn(),
  getReleases: vi.fn(),
  getIssues: vi.fn(),
  getPulls: vi.fn(),
  getCommunityProfile: vi.fn(),
  getCiPresence: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  getProviderForHost: () => fakeProvider,
  getProviderForRef: () => fakeProvider,
}));

const ref: RepoRef = { platform: 'github', host: 'github.com', owner: 'test', repo: 'repo' };

const rateLimit = {
  limit: 60,
  remaining: 50,
  resetAtMs: null,
  retryAfterMs: null,
  source: 'test',
};

function fetchResult<T>(data: T, extra: Record<string, unknown> = {}) {
  return {
    data,
    etag: null,
    rateLimit,
    notModified: false,
    fetchedAt: new Date(FIXED_NOW).toISOString(),
    ...extra,
  };
}

function resetMocks() {
  for (const fn of Object.values(fakeProvider)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as { mockReset(): void }).mockReset();
  }
}

function setupArchived() {
  const { facts, activity } = archivedRepo();
  const languages = {
    entries: [{ name: 'TypeScript', bytes: 100, percent: 100 }],
    totalBytes: 100,
    fetchedAt: new Date(FIXED_NOW).toISOString(),
  };
  resetMocks();
  fakeProvider.getRepository.mockResolvedValue(fetchResult(facts));
  fakeProvider.getLanguages.mockResolvedValue(fetchResult(languages));
  fakeProvider.getContributors.mockResolvedValue(fetchResult(activity.contributors));
  fakeProvider.getCommits.mockResolvedValue(fetchResult(activity.commits));
  fakeProvider.getReleases.mockResolvedValue(fetchResult(activity.releases));
  fakeProvider.getIssues.mockResolvedValue(fetchResult(activity.issues));
  fakeProvider.getPulls.mockResolvedValue(fetchResult(activity.pulls));
  fakeProvider.getCommunityProfile.mockResolvedValue(fetchResult(activity.communityProfile));
  fakeProvider.getCiPresence.mockResolvedValue(fetchResult(activity.ciWorkflowsPresent));
  return new RepositoryService(new InMemoryCache());
}

describe('RepositoryService — private / rate-limited / archived', () => {
  it('propagates FORBIDDEN with its rate-limit state when the repo fetch is refused', async () => {
    resetMocks();
    const forbiddenLimit = { ...rateLimit, remaining: 50 };
    fakeProvider.getRepository.mockRejectedValue(
      new ProviderError('FORBIDDEN', 'GitHub refused this request (403).', {
        rateLimit: forbiddenLimit,
        status: 403,
      }),
    );
    const service = new RepositoryService(new InMemoryCache());
    let caught: unknown;
    try {
      await service.getOverview(ref);
    } catch (error) {
      caught = error;
    }
    const err = caught as ProviderError;
    expect(err.code).toBe('FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.rateLimit?.remaining).toBe(50);
  });

  it('propagates RATE_LIMITED with remaining 0 and the reset time', async () => {
    resetMocks();
    const exhaustedLimit = {
      limit: 60,
      remaining: 0,
      resetAtMs: FIXED_NOW + 12 * 60_000,
      retryAfterMs: null,
      source: 'test',
    };
    fakeProvider.getRepository.mockRejectedValue(
      new ProviderError('RATE_LIMITED', 'GitHub API rate limit reached.', {
        rateLimit: exhaustedLimit,
        status: 429,
      }),
    );
    const service = new RepositoryService(new InMemoryCache());
    let caught: unknown;
    try {
      await service.getOverview(ref);
    } catch (error) {
      caught = error;
    }
    const err = caught as ProviderError;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.rateLimit?.remaining).toBe(0);
    expect(isRateLimitExhausted(err.rateLimit)).toBe(true);
  });

  it('flags an archived repo prominently in the report', async () => {
    const service = setupArchived();
    const { overview, report } = await service.getReport(ref, { nowMs: FIXED_NOW });
    expect(overview.facts.archived).toBe(true);
    expect(report.observations.caution).toContain(
      'Archived — no longer maintained. The repository is read-only on GitHub.',
    );
    expect(report.overallScore).toBeCloseTo(18.1, 0);
  });

  it('caps confidence at Medium and notes the sample when a page is truncated', async () => {
    const service = setupArchived();
    // The contributor page returned exactly its 100-item limit.
    fakeProvider.getContributors.mockResolvedValue(
      fetchResult(archivedRepo().activity.contributors, { truncated: true }),
    );
    const { report } = await service.getReport(ref, { nowMs: FIXED_NOW });
    expect(report.confidence).toBe('medium');
    expect(report.sampleNotes).toContain(
      'Contributor sample capped at its page limit — the sample may not represent the whole repository.',
    );
  });
});
