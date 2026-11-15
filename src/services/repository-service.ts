// Repository service — spec §9.4 data flow, steps 3–7.
// The side panel never fetches GitHub directly; it asks this service
// (via the background worker, which owns the service instance).
//   1. Check the local cache; fetch only what is stale or missing.
//   2. Fetch repository metadata + languages in parallel.
//   3. One failed endpoint must NOT prevent the other from rendering
//      (spec §7.1): a languages failure returns the repo with
//      languages=null and a recorded error, never a blank panel.
//   4. A repository failure is fatal for this overview — but if a
//      stale cached copy exists, return it labelled stale instead
//      of failing outright, and surface the live error alongside it.
//   5. Every value returned carries evidence (source, observedAt,
//      limitation) — the scoring engine and the UI consume evidence,
//      never bare numbers.

import { buildReport } from '../analysis/scoring';
import { analyzeTrajectory, type TrajectoryResult } from '../analysis/trajectory';
import { buildVerdict, type Verdict } from '../analysis/verdict';
import { daysSince, daysSinceLatestRelease, median } from '../analysis/metrics';
import type { ActivityData, ActivityEndpoint } from '../domain/activity';
import { normalizeActivityData } from '../domain/activity';
import type { RepositoryReport } from '../domain/report';
import {
  ProviderError,
  toErrorData,
  type EvidenceItem,
  type LanguageBreakdown,
  type OverviewResult,
  type ProviderErrorData,
  type RateLimitInfo,
  type RepoRef,
  type RepositoryFacts,
} from '../domain/repository';
import { NotModifiedError } from '../providers/github/client';
import { repositoryEvidence } from '../providers/github/provider';
import { getProviderForRef } from '../providers/registry';
import type { ProviderFetchResult } from '../providers/types';
import {
  ACTIVITY_TTL_MS,
  CORE_TTL_MS,
  LANGUAGES_TTL_MS,
  SUPPLY_CHAIN_TTL_MS,
  cacheKeyForActivity,
  cacheKeyForLanguages,
  cacheKeyForRepo,
  cacheKeyForSupplyChain,
  type CacheStore,
} from '../storage/cache';
import { SupplyChainService, unknownSupplyChain } from '../supply-chain/service';
import type { SupplyChainData } from '../supply-chain/types';

export interface GetOverviewOptions {
  forceRefresh?: boolean;
  onProgress?: (stage: string) => void;
}

export interface GetReportOptions extends GetOverviewOptions {
  /** Epoch ms the report is scored "as of". Defaults to Date.now().
   *  Tests pass a fixed time so reports are deterministic. */
  nowMs?: number;
}

export interface ReportResult {
  overview: OverviewResult;
  report: RepositoryReport;
  /** The bounded activity samples the report was scored from.
   *  Build 4 passes this through to the UI for the activity chart
   *  (weekly commits) — the UI never re-fetches it. */
  activity: ActivityData;
  /** Per-endpoint activity failures, for the UI's "what's missing" notes. */
  activityErrors: Partial<Record<ActivityEndpoint, ProviderErrorData>>;
  /** 0.3.0 — trajectory & forecast, computed from the 52-week
   *  commit activity (pure; the health score is untouched). */
  trajectory: TrajectoryResult;
  /** 0.3.0 — supply-chain risk signals. Feeds the verdict only;
   *  it never changes the 0–100 health score. */
  supplyChain: SupplyChainData;
  /** 0.3.0 — adoption signal ("Use it" / "Use with caution" /
   *  "Stay away" / "Not enough data"), a deterministic function
   *  of the report + trajectory + supply chain. */
  verdict: Verdict;
}

export class RepositoryService {
  private readonly cache: CacheStore;

  constructor(cache: CacheStore) {
    this.cache = cache;
  }

  async getOverview(ref: RepoRef, options: GetOverviewOptions = {}): Promise<OverviewResult> {
    const provider = getProviderForRef(ref);
    const repoKey = cacheKeyForRepo(ref.platform, ref.owner, ref.repo);
    const langKey = cacheKeyForLanguages(ref.platform, ref.owner, ref.repo);

    const cachedRepo = options.forceRefresh
      ? null
      : await this.cache.getWithTtl<RepositoryFacts>(repoKey, CORE_TTL_MS);
    const cachedLang = options.forceRefresh
      ? null
      : await this.cache.getWithTtl<LanguageBreakdown>(langKey, LANGUAGES_TTL_MS);

    const repoFresh = cachedRepo !== null && !cachedRepo.stale;
    const langFresh = cachedLang !== null && !cachedLang.stale;

    if (repoFresh && langFresh) {
      return this.buildResult(ref, cachedRepo.entry.value, cachedLang.entry.value, {
        fromCache: true,
        stale: false,
        languagesError: null,
        liveError: null,
        rateLimit: null,
      });
    }

    options.onProgress?.('repository');
    let facts: RepositoryFacts | null = repoFresh ? cachedRepo.entry.value : null;
    let rateLimit: RateLimitInfo | null = null;
    let repoError: ProviderError | null = null;
    let usedStaleRepo = false;
    let usedStaleLang = false;

    if (!repoFresh) {
      try {
        const etag = cachedRepo?.entry.etag ?? undefined;
        const res = await provider.getRepository(ref, { etag });
        facts = res.data;
        rateLimit = res.rateLimit;
        await this.cache.set(repoKey, { value: facts, fetchedAt: res.fetchedAt, etag: res.etag });
      } catch (error) {
        if (error instanceof NotModifiedError && cachedRepo) {
          // 304: the cached body is still current.
          facts = cachedRepo.entry.value;
          rateLimit = error.rateLimit;
          usedStaleRepo = cachedRepo.stale;
        } else if (error instanceof ProviderError) {
          repoError = error;
          rateLimit = error.rateLimit;
        } else {
          throw error;
        }
      }
    }

    if (facts === null) {
      // No live facts. With a stale cached copy, return it labelled
      // stale with the live error attached — the UI shows cached data
      // with a warning instead of failing outright. Without one, fail.
      if (cachedRepo && repoError) {
        return this.buildResult(ref, cachedRepo.entry.value, cachedLang?.entry.value ?? null, {
          fromCache: true,
          stale: true,
          languagesError: null,
          liveError: toErrorData(repoError),
          rateLimit,
        });
      }
      throw repoError ?? new ProviderError('UNKNOWN', 'Repository could not be loaded.');
    }

    options.onProgress?.('languages');
    let languages: LanguageBreakdown | null = langFresh ? cachedLang.entry.value : null;
    let languagesError: ProviderErrorData | null = null;
    if (!langFresh) {
      try {
        const etag = cachedLang?.entry.etag ?? undefined;
        const res = await provider.getLanguages(ref, { etag });
        languages = res.data;
        rateLimit = res.rateLimit ?? rateLimit;
        await this.cache.set(langKey, { value: languages, fetchedAt: res.fetchedAt, etag: res.etag });
      } catch (error) {
        if (error instanceof NotModifiedError && cachedLang) {
          languages = cachedLang.entry.value;
          rateLimit = error.rateLimit ?? rateLimit;
          usedStaleLang = cachedLang.stale;
        } else if (error instanceof ProviderError) {
          languagesError = toErrorData(error);
          // Keep any stale cached languages as a labelled fallback.
          if (cachedLang) {
            languages = cachedLang.entry.value;
            usedStaleLang = cachedLang.stale;
          }
        } else {
          throw error;
        }
      }
    }

    options.onProgress?.('done');
    return this.buildResult(ref, facts, languages, {
      fromCache: repoFresh && langFresh,
      stale: usedStaleRepo || usedStaleLang,
      languagesError,
      liveError: null,
      rateLimit,
    });
  }

  /**
   * Full analysis: the Build 2 overview plus the Build 3 scored
   * report, plus the 0.3.0 trust layers (trajectory + supply
   * chain + verdict). Activity endpoints are fetched in parallel;
   * each one is independent — a failure yields null signals for
   * the signals it feeds (coverage drops, the report never goes
   * blank). A repo failure still throws unless getOverview
   * returned stale cached facts, in which case the report is
   * built on them and labelled stale. The scoring itself is pure
   * (buildReport takes nowMs). The trust layers are pure too —
   * and they NEVER change the 0–100 health score: supply chain
   * and trajectory feed the verdict only.
   *
   * Per-analysis request budget (fresh, no cache):
   *   GitHub (60/hour unauthenticated): repo 1 + languages 1 +
   *     activity 7 + commit_activity 1 + git tree 1 + manifest
   *     contents ≤ 5 = at most 16.
   *   OSV (free, no auth): 1 batch request for all dependencies
   *     + at most 20 detail fetches (one per vulnerability found;
   *     the batch reply carries only the id — severity and
   *     summary live in the detail record).
   *   deps.dev (free, no auth): at most 10 lookups.
   * Activity + supply chain are cached 45 min, so a second
   * analysis inside the window costs 0 new requests.
   */
  async getReport(ref: RepoRef, options: GetReportOptions = {}): Promise<ReportResult> {
    const overview = await this.getOverview(ref, options);
    const nowMs = options.nowMs ?? Date.now();
    const [activity, supplyChain] = await Promise.all([
      this.getActivity(ref, options),
      this.getSupplyChain(ref, options, overview.facts.defaultBranch, nowMs),
    ]);
    const report = buildReport(overview.facts, activity, {
      nowMs,
      evidence: overview.evidence,
      stale: overview.stale,
    });
    const trajectory = analyzeTrajectory(activity.commitActivity, activity.releases, nowMs);
    const verdict = buildVerdict(verdictInput(overview.facts, activity, report, supplyChain, trajectory, nowMs));
    return { overview, report, activity, activityErrors: activity.errors, trajectory, supplyChain, verdict };
  }

  /**
   * Supply-chain risk signals, cache-first (45 min) like
   * activity. NEVER throws for network/API failures: any failure
   * returns an 'unknown' result, so the panel shows "could not
   * be checked" instead of failing the whole report. Public so
   * the background worker can retry just this section.
   */
  async getSupplyChain(
    ref: RepoRef,
    options: GetOverviewOptions,
    defaultBranch: string,
    nowMs: number,
  ): Promise<SupplyChainData> {
    const provider = getProviderForRef(ref);
    const supplyKey = cacheKeyForSupplyChain(ref.platform, ref.owner, ref.repo);

    if (!options.forceRefresh) {
      const cached = await this.cache.getWithTtl<SupplyChainData>(supplyKey, SUPPLY_CHAIN_TTL_MS);
      if (cached && !cached.stale) return cached.entry.value;
    }

    options.onProgress?.('supplyChain');
    let data: SupplyChainData;
    try {
      const service = new SupplyChainService(provider);
      data = await service.analyze(ref, defaultBranch, nowMs);
    } catch (error) {
      // A bug or an unexpected failure in the supply-chain path
      // must still not blank the report — unknown, with the error
      // recorded, is the honest result.
      data = unknownSupplyChain(new Date(nowMs).toISOString(), {
        code: 'UNKNOWN',
        message: 'Supply-chain risk could not be checked.',
        status: null,
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
    await this.cache.set(supplyKey, { value: data, fetchedAt: data.fetchedAt, etag: null });
    return data;
  }

  /** Fetch the activity samples, from cache when fresh, else live.
   *  Every endpoint is attempted independently and in parallel;
   *  failures are recorded per endpoint in `errors` and the sample
   *  stays null. The combined result is cached for ACTIVITY_TTL_MS.
   *  ETags are not used for activity: the combined entry is one
   *  cache value, and per-endpoint conditional requests would need
   *  per-endpoint cache entries (a Build 5 storage refinement). */
  private async getActivity(ref: RepoRef, options: GetOverviewOptions): Promise<ActivityData> {
    const provider = getProviderForRef(ref);
    const activityKey = cacheKeyForActivity(ref.platform, ref.owner, ref.repo);

    if (!options.forceRefresh) {
      const cached = await this.cache.getWithTtl<ActivityData>(activityKey, ACTIVITY_TTL_MS);
      // Normalize: entries cached before 0.3.0 lack commitActivity
      // (and possibly other fields) — undefined, not null — and
      // would crash downstream code that only guards null.
      if (cached && !cached.stale) return normalizeActivityData(cached.entry.value);
    }

    options.onProgress?.('activity');
    const sinceIso = new Date(Date.now() - 90 * 86_400_000).toISOString();

    const results = await Promise.all([
      this.fetchActivityPart('contributors', () => provider.getContributors(ref)),
      this.fetchActivityPart('commits', () => provider.getCommits(ref, { sinceIso })),
      this.fetchActivityPart('releases', () => provider.getReleases(ref)),
      this.fetchActivityPart('issues', () => provider.getIssues(ref)),
      this.fetchActivityPart('pulls', () => provider.getPulls(ref)),
      this.fetchActivityPart('communityProfile', () => provider.getCommunityProfile(ref)),
      this.fetchActivityPart('ci', () => provider.getCiPresence(ref)),
      // 0.3.0 — 52-week commit activity for the trajectory. Same
      // failure isolation: a 202 that never resolves, or any other
      // failure, yields a null sample (trajectory "unknown").
      this.fetchActivityPart('commitActivity', () => provider.getCommitActivity(ref)),
    ]);

    const fetchedAt = new Date().toISOString();
    const activity: ActivityData = {
      contributors: results[0].data as ActivityData['contributors'],
      commits: results[1].data as ActivityData['commits'],
      releases: results[2].data as ActivityData['releases'],
      issues: results[3].data as ActivityData['issues'],
      pulls: results[4].data as ActivityData['pulls'],
      communityProfile: results[5].data as ActivityData['communityProfile'],
      ciWorkflowsPresent: results[6].data as ActivityData['ciWorkflowsPresent'],
      commitActivity: results[7].data as ActivityData['commitActivity'],
      truncated: {
        contributors: results[0].truncated,
        commits: results[1].truncated,
        releases: results[2].truncated,
        issues: results[3].truncated,
        pulls: results[4].truncated,
      },
      errors: Object.fromEntries(
        results.filter((r) => r.error).map((r) => [r.endpoint, r.error as ProviderErrorData]),
      ) as ActivityData['errors'],
      fetchedAt,
    };

    await this.cache.set(activityKey, { value: activity, fetchedAt, etag: null });
    return activity;
  }

  /** One activity endpoint, failure-isolated. Non-ProviderError
   *  failures (bugs, aborts) still propagate — they are not API
   *  failures the report can label. */
  private async fetchActivityPart<T>(
    endpoint: ActivityEndpoint,
    fetchFn: () => Promise<ProviderFetchResult<T>>,
  ): Promise<{ endpoint: ActivityEndpoint; data: T | null; truncated: boolean; error: ProviderErrorData | null }> {
    try {
      const res = await fetchFn();
      return { endpoint, data: res.data, truncated: res.truncated ?? false, error: null };
    } catch (error) {
      if (error instanceof ProviderError) {
        return { endpoint, data: null, truncated: false, error: toErrorData(error) };
      }
      throw error;
    }
  }

  private buildResult(
    ref: RepoRef,
    facts: RepositoryFacts,
    languages: LanguageBreakdown | null,
    opts: {
      fromCache: boolean;
      stale: boolean;
      languagesError: ProviderErrorData | null;
      liveError: ProviderErrorData | null;
      rateLimit: RateLimitInfo | null;
    },
  ): OverviewResult {
    const evidence: EvidenceItem[] = repositoryEvidence(facts);
    if (languages) {
      evidence.push({
        key: 'languages',
        value: languages.entries.map((e) => `${e.name} ${e.percent}%`).join(', ') || 'none reported',
        source: 'GET /repos/{owner}/{repo}/languages',
        observedAt: languages.fetchedAt,
        limitation: 'Byte counts from GitHub; percentages are rounded to 1 decimal.',
      });
    }
    return {
      ref,
      facts,
      languages,
      languagesError: opts.languagesError,
      liveError: opts.liveError,
      evidence,
      rateLimit: opts.rateLimit,
      fromCache: opts.fromCache,
      stale: opts.stale,
      fetchedAt: facts.fetchedAt,
    };
  }
}

export { toErrorData } from '../domain/repository';

/** Assemble the verdict's inputs from the scored report and the
 *  0.3.0 trust layers. Pure given its inputs — the only clock
 *  read is the nowMs the caller passes in. */
export function verdictInput(
  facts: RepositoryFacts,
  activity: ActivityData,
  report: RepositoryReport,
  supplyChain: SupplyChainData,
  trajectory: TrajectoryResult,
  nowMs: number,
): Parameters<typeof buildVerdict>[0] {
  const issues = (activity.issues ?? []).filter((i) => !i.isPullRequest && i.state === 'open');
  const openAges = issues
    .map((i) => daysSince(i.createdAt, nowMs))
    .filter((d): d is number => d !== null);
  const medianOpenIssueAgeDays = median(openAges);
  const releasesKnown = activity.releases !== null;
  const hasEverReleased = releasesKnown && (activity.releases?.length ?? 0) > 0;
  return {
    overallScore: report.overallScore,
    grade: report.grade,
    coverage: report.coverage,
    confidence: report.confidence,
    provisional: report.provisional,
    archived: facts.archived,
    daysSincePush: daysSince(facts.pushedAt, nowMs),
    daysSinceLatestRelease: daysSinceLatestRelease(activity.releases ?? [], nowMs),
    hasEverReleased,
    releasesKnown,
    medianOpenIssueAgeDays,
    trajectory: trajectory.classification,
    supplyChain: {
      status: supplyChain.status,
      riskLabel: supplyChain.riskLabel,
      criticalCount: supplyChain.vulnerabilities.filter((v) => v.severity === 'critical').length,
      highCount: supplyChain.vulnerabilities.filter((v) => v.severity === 'high').length,
      totalVulnerabilities: supplyChain.totalVulnerabilities,
      depsScanned: supplyChain.depsScanned,
    },
    unknownCategories: report.categories
      .filter((c) => c.status === 'unknown')
      .map((c) => c.label),
  };
}
