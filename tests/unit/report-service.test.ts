import { describe, expect, it, vi } from 'vitest';

import { normalizeActivityData } from '../../src/domain/activity';
import { ProviderError, type RepoRef } from '../../src/domain/repository';
import { RepositoryService } from '../../src/services/repository-service';
import { InMemoryCache } from '../../src/storage/cache';
import {
  FIXED_NOW,
  activeRepo,
  archivedRepo,
  isoDaysAgo,
} from './scoring-fixtures';

// Same registry-stub pattern as repository-service.test.ts, extended
// with the Build 3 activity methods and the 0.3.0 methods
// (commit activity, git tree, file contents).
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
  getCommitActivity: vi.fn(),
  getRepoTree: vi.fn(),
  getFileContent: vi.fn(),
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

function fetchResult<T>(data: T) {
  return {
    data,
    etag: null,
    rateLimit,
    notModified: false,
    fetchedAt: new Date(FIXED_NOW).toISOString(),
  };
}

function setupActive() {
  const { facts, activity } = activeRepo();
  const languages = {
    entries: [{ name: 'TypeScript', bytes: 100, percent: 100 }],
    totalBytes: 100,
    fetchedAt: new Date(FIXED_NOW).toISOString(),
  };
  fakeProvider.getRepository.mockReset();
  fakeProvider.getLanguages.mockReset();
  fakeProvider.getContributors.mockReset();
  fakeProvider.getCommits.mockReset();
  fakeProvider.getReleases.mockReset();
  fakeProvider.getIssues.mockReset();
  fakeProvider.getPulls.mockReset();
  fakeProvider.getCommunityProfile.mockReset();
  fakeProvider.getCiPresence.mockReset();
  fakeProvider.getCommitActivity.mockReset();
  fakeProvider.getRepoTree.mockReset();
  fakeProvider.getFileContent.mockReset();
  fakeProvider.getRepository.mockResolvedValue(fetchResult(facts));
  fakeProvider.getLanguages.mockResolvedValue(fetchResult(languages));
  fakeProvider.getContributors.mockResolvedValue(fetchResult(activity.contributors));
  fakeProvider.getCommits.mockResolvedValue(fetchResult(activity.commits));
  fakeProvider.getReleases.mockResolvedValue(fetchResult(activity.releases));
  fakeProvider.getIssues.mockResolvedValue(fetchResult(activity.issues));
  fakeProvider.getPulls.mockResolvedValue(fetchResult(activity.pulls));
  fakeProvider.getCommunityProfile.mockResolvedValue(fetchResult(activity.communityProfile));
  fakeProvider.getCiPresence.mockResolvedValue(fetchResult(activity.ciWorkflowsPresent));
  // 0.3.0 — no commit activity (trajectory unknown) and no
  // manifests (supply chain no-manifest) by default; tests that
  // need them override the mocks after setupActive().
  fakeProvider.getCommitActivity.mockResolvedValue(fetchResult(null));
  fakeProvider.getRepoTree.mockResolvedValue(
    fetchResult({ entries: [], truncated: false }),
  );
  fakeProvider.getFileContent.mockRejectedValue(new ProviderError('NOT_FOUND', 'no file'));
  return new RepositoryService(new InMemoryCache());
}

describe('normalizeActivityData — old cache shapes', () => {
  it('fills missing samples with null and missing maps with defaults', () => {
    const normalized = normalizeActivityData({
      contributors: [{ login: 'a', contributions: 3 }],
      fetchedAt: new Date(FIXED_NOW).toISOString(),
    });
    expect(normalized.contributors).toHaveLength(1);
    expect(normalized.commitActivity).toBeNull();
    expect(normalized.commits).toBeNull();
    expect(normalized.truncated).toEqual({
      contributors: false,
      commits: false,
      releases: false,
      issues: false,
      pulls: false,
    });
    expect(normalized.errors).toEqual({});
  });
  it('keeps present values untouched', () => {
    const { activity } = activeRepo();
    const normalized = normalizeActivityData(activity);
    expect(normalized).toEqual(activity);
  });
});

describe('RepositoryService.getReport', () => {
  it('returns the overview plus a scored report for an active repo', async () => {
    const service = setupActive();
    const { overview, report } = await service.getReport(ref, { nowMs: FIXED_NOW });
    expect(overview.facts.stars).toBe(250_000);
    expect(report.overallScore).toBeCloseTo(94.2, 0);
    expect(report.grade).toBe('A');
    expect(report.coverage).toBe(100);
    expect(report.confidence).toBe('high');
    expect(report.scoreModelVersion).toBe('1.0.0');
    expect(report.generatedAt).toBe(new Date(FIXED_NOW).toISOString());
    expect(report.stale).toBe(false);
  });

  it('keeps getOverview working alongside getReport', async () => {
    const service = setupActive();
    const overview = await service.getOverview(ref);
    expect(overview.facts.stars).toBe(250_000);
    expect(overview.languages?.entries[0]?.name).toBe('TypeScript');
  });

  it('serves a fresh activity cache without calling the activity endpoints again', async () => {
    const service = setupActive();
    await service.getReport(ref, { nowMs: FIXED_NOW });
    await service.getReport(ref, { nowMs: FIXED_NOW });
    // The activity cache entry is stamped with the real clock, so it
    // is fresh on the second call. (The repo cache is stamped with
    // FIXED_NOW in this fixture, so getOverview may refetch — that
    // path is covered by repository-service.test.ts.)
    expect(fakeProvider.getContributors).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getCommits).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getReleases).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getIssues).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getPulls).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getCommunityProfile).toHaveBeenCalledTimes(1);
    expect(fakeProvider.getCiPresence).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh refetches activity', async () => {
    const service = setupActive();
    await service.getReport(ref, { nowMs: FIXED_NOW });
    await service.getReport(ref, { nowMs: FIXED_NOW, forceRefresh: true });
    expect(fakeProvider.getContributors).toHaveBeenCalledTimes(2);
  });

  it('a failed contributors endpoint yields a partial report, never a blank one', async () => {
    const service = setupActive();
    fakeProvider.getContributors.mockRejectedValue(
      new ProviderError('NETWORK_ERROR', 'contributors unreachable'),
    );
    const { report, activityErrors } = await service.getReport(ref, { nowMs: FIXED_NOW });
    expect(report.overallScore).not.toBeNull();
    expect(report.coverage).toBeLessThan(100);
    expect(activityErrors.contributors?.code).toBe('NETWORK_ERROR');
    const community = report.categories.find((c) => c.key === 'community');
    expect(community?.status).toBe('partial');
    expect(report.observations.unknown).toContain(
      'Contributor concentration is unknown — the contributor sample could not be collected.',
    );
  });

  it('returns a stale report labelled stale when the live repo fetch fails', async () => {
    const cache = new InMemoryCache();
    const service = new RepositoryService(cache);
    const { facts } = archivedRepo();
    const old = isoDaysAgo(1, Date.now());
    await cache.set('reporadar:cache:v1:github:test/repo:repo', {
      value: { ...facts, fetchedAt: old },
      fetchedAt: old,
      etag: null,
    });
    const { activity } = archivedRepo();
    fakeProvider.getRepository.mockReset();
    fakeProvider.getLanguages.mockReset();
    fakeProvider.getContributors.mockReset();
    fakeProvider.getCommits.mockReset();
    fakeProvider.getReleases.mockReset();
    fakeProvider.getIssues.mockReset();
    fakeProvider.getPulls.mockReset();
    fakeProvider.getCommunityProfile.mockReset();
    fakeProvider.getCiPresence.mockReset();
    fakeProvider.getCommitActivity.mockReset();
    fakeProvider.getRepoTree.mockReset();
    fakeProvider.getFileContent.mockReset();
    fakeProvider.getRepository.mockRejectedValue(new ProviderError('NETWORK_ERROR', 'offline'));
    fakeProvider.getLanguages.mockResolvedValue(
      fetchResult({ entries: [], totalBytes: 0, fetchedAt: new Date(FIXED_NOW).toISOString() }),
    );
    fakeProvider.getContributors.mockResolvedValue(fetchResult(activity.contributors));
    fakeProvider.getCommits.mockResolvedValue(fetchResult(activity.commits));
    fakeProvider.getReleases.mockResolvedValue(fetchResult(activity.releases));
    fakeProvider.getIssues.mockResolvedValue(fetchResult(activity.issues));
    fakeProvider.getPulls.mockResolvedValue(fetchResult(activity.pulls));
    fakeProvider.getCommunityProfile.mockResolvedValue(fetchResult(activity.communityProfile));
    fakeProvider.getCiPresence.mockResolvedValue(fetchResult(activity.ciWorkflowsPresent));
    fakeProvider.getCommitActivity.mockResolvedValue(fetchResult(null));
    fakeProvider.getRepoTree.mockResolvedValue(fetchResult({ entries: [], truncated: false }));
    fakeProvider.getFileContent.mockRejectedValue(new ProviderError('NOT_FOUND', 'no file'));
    const { overview, report } = await service.getReport(ref, { nowMs: FIXED_NOW });
    expect(overview.stale).toBe(true);
    expect(overview.liveError?.code).toBe('NETWORK_ERROR');
    expect(report.stale).toBe(true);
    expect(report.overallScore).toBeCloseTo(18.1, 0);
  });

  it('returns the 0.3.0 trust layers with the report (health score unchanged)', async () => {
    const service = setupActive();
    const { report, trajectory, supplyChain, verdict } = await service.getReport(ref, {
      nowMs: FIXED_NOW,
    });
    // The score is exactly the Build 3 score — the trust layers
    // never change it.
    expect(report.overallScore).toBeCloseTo(94.2, 0);
    expect(trajectory.status).toBe('unknown');
    expect(trajectory.classification).toBe('unknown');
    expect(supplyChain.status).toBe('no-manifest');
    expect(verdict.label).toBe('use');
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('verdict is Stay away for the archived repo', async () => {
    const service = setupActive();
    const { facts, activity } = archivedRepo();
    fakeProvider.getRepository.mockResolvedValue(fetchResult(facts));
    fakeProvider.getContributors.mockResolvedValue(fetchResult(activity.contributors));
    fakeProvider.getCommits.mockResolvedValue(fetchResult(activity.commits));
    fakeProvider.getReleases.mockResolvedValue(fetchResult(activity.releases));
    fakeProvider.getIssues.mockResolvedValue(fetchResult(activity.issues));
    fakeProvider.getPulls.mockResolvedValue(fetchResult(activity.pulls));
    fakeProvider.getCommunityProfile.mockResolvedValue(fetchResult(activity.communityProfile));
    fakeProvider.getCiPresence.mockResolvedValue(fetchResult(activity.ciWorkflowsPresent));
    const { report, verdict } = await service.getReport(ref, { nowMs: FIXED_NOW, forceRefresh: true });
    expect(report.overallScore).toBeCloseTo(18.1, 0);
    expect(verdict.label).toBe('avoid');
    expect(verdict.reasons[0]?.evidenceKey).toBe('archived');
  });

  it('a failed commit-activity endpoint yields trajectory unknown, never a blank report', async () => {
    const service = setupActive();
    fakeProvider.getCommitActivity.mockRejectedValue(
      new ProviderError('NETWORK_ERROR', 'stats unreachable'),
    );
    const { report, trajectory, activityErrors } = await service.getReport(ref, {
      nowMs: FIXED_NOW,
    });
    expect(report.overallScore).not.toBeNull();
    expect(trajectory.status).toBe('unknown');
    expect(activityErrors.commitActivity?.code).toBe('NETWORK_ERROR');
  });

  it('reads a pre-0.3.0 cached activity without commitActivity (old cache shape)', async () => {
    // Regression: 0.3.0 crashed the whole report on cache entries
    // written by 0.2.x, which have no `commitActivity` key —
    // `undefined`, not null — so `analyzeTrajectory` fell through
    // its `=== null` guard into `weeks.map` and threw. The cached
    // entry must be normalized to the current shape instead.
    const cache = new InMemoryCache();
    const service = new RepositoryService(cache);
    const { facts, activity } = activeRepo();
    const freshAt = new Date().toISOString();
    await cache.set('reporadar:cache:v1:github:test/repo:repo', {
      value: { ...facts, fetchedAt: freshAt },
      fetchedAt: freshAt,
      etag: null,
    });
    await cache.set('reporadar:cache:v1:github:test/repo:languages', {
      value: { entries: [], totalBytes: 0, fetchedAt: freshAt },
      fetchedAt: freshAt,
      etag: null,
    });
    const { commitActivity: _removed, errors: _errorsRemoved, ...oldActivity } = activity;
    void _removed;
    void _errorsRemoved;
    await cache.set('reporadar:cache:v1:github:test/repo:activity', {
      value: { ...oldActivity, fetchedAt: freshAt },
      fetchedAt: freshAt,
      etag: null,
    });
    fakeProvider.getRepoTree.mockResolvedValue(fetchResult({ entries: [], truncated: false }));
    fakeProvider.getFileContent.mockRejectedValue(new ProviderError('NOT_FOUND', 'no file'));
    const { report, trajectory, activity: readBack } = await service.getReport(ref, {
      nowMs: FIXED_NOW,
    });
    expect(report.overallScore).toBeCloseTo(94.2, 0);
    expect(trajectory.status).toBe('unknown');
    expect(trajectory.classification).toBe('unknown');
    expect(readBack.commitActivity).toBeNull();
    expect(readBack.errors).toEqual({});
  });
});
