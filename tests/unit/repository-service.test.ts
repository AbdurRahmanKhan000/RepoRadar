import { describe, expect, it, vi } from 'vitest';

import { ProviderError, type RepoRef } from '../../src/domain/repository';
import { RepositoryService } from '../../src/services/repository-service';
import { InMemoryCache } from '../../src/storage/cache';

// The service resolves its provider through the registry, which only
// knows GitHub in Build 2. To test the service in isolation we stub
// the registry module with a fake provider. vi.hoisted is required:
// the mock factory runs before this file's top-level code.
const fakeProvider = vi.hoisted(() => ({
  platform: 'github',
  hosts: ['github.com'],
  label: 'GitHub',
  parseRepoFromUrl: () => ref,
  getRepository: vi.fn(),
  getLanguages: vi.fn(),
}));

vi.mock('../../src/providers/registry', () => ({
  getProviderForHost: () => fakeProvider,
  getProviderForRef: () => fakeProvider,
}));

const ref: RepoRef = { platform: 'github', host: 'github.com', owner: 'react', repo: 'react' };

const facts = {
  id: 'github:react/react',
  platform: 'github' as const,
  owner: 'react',
  name: 'react',
  fullName: 'react/react',
  htmlUrl: 'https://github.com/react/react',
  description: 'The library for web and native user interfaces.',
  stars: 252573,
  forks: 52552,
  watchers: 252573,
  openIssuesCount: 1526,
  primaryLanguage: 'JavaScript',
  licenseSpdxId: 'MIT',
  licenseName: 'MIT License',
  createdAt: '2013-05-24T16:15:54Z',
  updatedAt: '2026-11-13T13:36:54Z',
  pushedAt: '2026-11-13T10:28:38Z',
  archived: false,
  isFork: false,
  defaultBranch: 'main',
  fetchedAt: '2026-11-13T14:00:00.000Z',
};

const languages = {
  entries: [{ name: 'JavaScript', bytes: 100, percent: 100 }],
  totalBytes: 100,
  fetchedAt: '2026-11-13T14:00:00.000Z',
};

function setup() {
  fakeProvider.getRepository.mockReset();
  fakeProvider.getLanguages.mockReset();
  // The cache stores the fetch's fetchedAt and judges freshness
  // against the clock, so the mock must report "now" — a fixed
  // fixture timestamp ages out of the 12-minute core TTL and the
  // "fresh cache" test starts refetching.
  const now = new Date().toISOString();
  fakeProvider.getRepository.mockResolvedValue({
    data: facts,
    etag: '"repo-etag"',
    rateLimit: { limit: 60, remaining: 59, resetAtMs: null, retryAfterMs: null, source: 'test' },
    notModified: false,
    fetchedAt: now,
  });
  fakeProvider.getLanguages.mockResolvedValue({
    data: languages,
    etag: '"lang-etag"',
    rateLimit: { limit: 60, remaining: 58, resetAtMs: null, retryAfterMs: null, source: 'test' },
    notModified: false,
    fetchedAt: now,
  });
  return new RepositoryService(new InMemoryCache());
}

describe('RepositoryService', () => {
  it('fetches repo + languages and returns evidence with the open-issues limitation', async () => {
    const service = setup();
    const result = await service.getOverview(ref);
    expect(result.facts.stars).toBe(252573);
    expect(result.languages?.entries[0]?.name).toBe('JavaScript');
    expect(result.fromCache).toBe(false);
    expect(result.languagesError).toBeNull();
    const openIssues = result.evidence.find((e) => e.key === 'openIssuesCount');
    expect(openIssues?.limitation).toMatch(/pull requests/);
  });

  it('serves a fresh cache without calling the provider again', async () => {
    const service = setup();
    await service.getOverview(ref);
    const second = await service.getOverview(ref);
    expect(second.fromCache).toBe(true);
    expect(fakeProvider.getRepository).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getLanguages).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh bypasses the cache', async () => {
    const service = setup();
    await service.getOverview(ref);
    await service.getOverview(ref, { forceRefresh: true });
    expect(fakeProvider.getRepository).toHaveBeenCalledTimes(2);
  });

  it('returns the repo with languages=null when the languages endpoint fails — partial, not blank', async () => {
    const service = setup();
    fakeProvider.getLanguages.mockRejectedValue(
      new ProviderError('NETWORK_ERROR', 'languages unreachable'),
    );
    const result = await service.getOverview(ref);
    expect(result.facts.stars).toBe(252573);
    expect(result.languages).toBeNull();
    expect(result.languagesError?.code).toBe('NETWORK_ERROR');
  });

  it('throws NOT_FOUND when the repository fetch fails and there is no cache', async () => {
    const service = setup();
    fakeProvider.getRepository.mockRejectedValue(
      new ProviderError('NOT_FOUND', 'Repository not found on GitHub.', { status: 404 }),
    );
    await expect(service.getOverview(ref)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns stale cached facts with the live error when the live fetch fails', async () => {
    const cache = new InMemoryCache();
    const service = new RepositoryService(cache);
    // Seed a stale cache entry by hand.
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await cache.set('reporadar:cache:v1:github:react/react:repo', {
      value: { ...facts, fetchedAt: old },
      fetchedAt: old,
      etag: null,
    });
    fakeProvider.getRepository.mockReset();
    fakeProvider.getLanguages.mockReset();
    fakeProvider.getRepository.mockRejectedValue(
      new ProviderError('NETWORK_ERROR', 'offline'),
    );
    fakeProvider.getLanguages.mockResolvedValue({
      data: languages,
      etag: null,
      rateLimit: null,
      notModified: false,
      fetchedAt: languages.fetchedAt,
    });
    const result = await service.getOverview(ref);
    expect(result.stale).toBe(true);
    expect(result.liveError?.code).toBe('NETWORK_ERROR');
    expect(result.facts.stars).toBe(252573);
  });
});
