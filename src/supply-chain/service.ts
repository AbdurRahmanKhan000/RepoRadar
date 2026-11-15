// Supply-chain orchestration — 0.3.0.
// One analysis, step by step, each step failure-isolated so a
// failed endpoint yields "unknown" for its part only — never a
// blank report and never a guessed score:
//   1. One git-tree request finds the manifests (cap 5) and
//      whether a package-lock.json exists.
//   2. Each manifest is fetched (contents API) and parsed;
//      a failed manifest is skipped, the others still count.
//   3. ONE OSV querybatch covers every dependency that pins a
//      version. An OSV failure makes the whole result 'unknown'
//      (vulnerabilities cannot be claimed absent when the check
//      never ran) — the parsed dependencies are kept for display.
//   4. deps.dev is asked about the first 10 dependencies, one
//      request each, failure-isolated per dependency.
//   5. The deterministic risk score is computed from what is
//      known. Unknown release dates never count as abandoned.

import {
  ProviderError,
  toErrorData,
  type ProviderErrorData,
  type RepoRef,
} from '../domain/repository';
import type { RepoProvider } from '../providers/types';
import { DepsDevClient } from './depsdev-client';
import {
  MAX_DEPENDENCIES,
  MAX_MANIFESTS,
  findManifests,
  hasNpmLockfile,
  parseManifest,
} from './manifests';
import { OsvClient } from './osv-client';
import { ABANDONED_AFTER_MONTHS, MAX_DEPS_DEV_LOOKUPS, scoreSupplyChainRisk } from './scoring';
import type { DependencyInfo, SupplyChainData, VulnerabilityInfo } from './types';

const ABANDONED_AFTER_MS = ABANDONED_AFTER_MONTHS * 30 * 86_400_000;

export function unknownSupplyChain(
  fetchedAt: string,
  error: ProviderErrorData | null,
): SupplyChainData {
  return {
    status: 'unknown',
    manifests: [],
    dependencies: [],
    vulnerabilities: [],
    riskScore: null,
    riskLabel: null,
    depsScanned: 0,
    vulnerableDeps: 0,
    totalVulnerabilities: 0,
    abandonedDeps: null,
    hasLockfile: false,
    truncated: false,
    error,
    fetchedAt,
  };
}

export class SupplyChainService {
  private readonly provider: RepoProvider;
  private readonly osv: OsvClient;
  private readonly depsDev: DepsDevClient;

  constructor(provider: RepoProvider, osv?: OsvClient, depsDev?: DepsDevClient) {
    this.provider = provider;
    this.osv = osv ?? new OsvClient();
    this.depsDev = depsDev ?? new DepsDevClient();
  }

  async analyze(ref: RepoRef, defaultBranch: string, nowMs: number): Promise<SupplyChainData> {
    const fetchedAt = new Date(nowMs).toISOString();

    // --- 1. Manifest discovery: one recursive tree request. ---
    let treePaths: string[];
    try {
      const tree = await this.provider.getRepoTree(ref, defaultBranch);
      treePaths = tree.data.entries.filter((e) => e.type === 'blob').map((e) => e.path);
    } catch (error) {
      if (error instanceof ProviderError) {
        return unknownSupplyChain(fetchedAt, toErrorData(error));
      }
      throw error;
    }

    const manifests = findManifests(treePaths).slice(0, MAX_MANIFESTS);
    const hasLockfile = hasNpmLockfile(treePaths);
    if (manifests.length === 0) {
      return {
        status: 'no-manifest',
        manifests: [],
        dependencies: [],
        vulnerabilities: [],
        riskScore: null,
        riskLabel: null,
        depsScanned: 0,
        vulnerableDeps: 0,
        totalVulnerabilities: 0,
        abandonedDeps: null,
        hasLockfile,
        truncated: false,
        error: null,
        fetchedAt,
      };
    }

    // --- 2. Fetch + parse each manifest, failure-isolated. ---
    const dependencies: DependencyInfo[] = [];
    let truncated = false;
    for (const manifest of manifests) {
      try {
        const res = await this.provider.getFileContent(ref, manifest.path);
        const parsed = parseManifest(manifest.ecosystem, res.data, manifest.path);
        manifest.depCount = parsed.length;
        for (const dep of parsed) {
          if (dependencies.length >= MAX_DEPENDENCIES) {
            truncated = true;
            break;
          }
          dependencies.push(dep);
        }
        if (truncated) break;
      } catch {
        // One unreadable manifest never blocks the others.
        manifest.depCount = 0;
        continue;
      }
    }

    // --- 3. ONE OSV batch for every dependency with a version. ---
    let vulnerabilities: VulnerabilityInfo[] = [];
    const checkable = dependencies.filter((d) => d.osvChecked && d.checkVersion !== null);
    try {
      vulnerabilities = await this.osv.queryBatch(
        checkable.map((d) => ({
          name: d.name,
          ecosystem: d.ecosystem,
          version: d.checkVersion as string,
        })),
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        return {
          status: 'unknown',
          manifests,
          dependencies,
          vulnerabilities: [],
          riskScore: null,
          riskLabel: null,
          depsScanned: dependencies.length,
          vulnerableDeps: 0,
          totalVulnerabilities: 0,
          abandonedDeps: null,
          hasLockfile,
          truncated,
          error: toErrorData(error),
          fetchedAt,
        };
      }
      throw error;
    }

    // --- 4. deps.dev: latest release per dependency, cap 10,
    //     failure-isolated per dependency. ---
    let abandonedKnown = 0;
    let abandonedCount = 0;
    let lookupsAttempted = 0;
    for (const dep of dependencies.slice(0, MAX_DEPS_DEV_LOOKUPS)) {
      lookupsAttempted++;
      try {
        const latest = await this.depsDev.getLatestRelease(dep.ecosystem, dep.name);
        dep.latestReleaseAt = latest;
        if (latest === null) {
          dep.abandoned = null;
          continue;
        }
        abandonedKnown++;
        const ageMs = nowMs - Date.parse(latest);
        dep.abandoned = ageMs > ABANDONED_AFTER_MS;
        if (dep.abandoned) abandonedCount++;
      } catch {
        dep.latestReleaseAt = null;
        dep.abandoned = null;
      }
    }
    // Abandonment is "entirely unknown" only when every lookup
    // failed to produce a date — a single known date makes the
    // count meaningful (unknown deps simply do not add to it).
    const abandonedDeps =
      lookupsAttempted > 0 && abandonedKnown === 0 && dependencies.length > 0
        ? null
        : abandonedCount;

    // --- 5. Deterministic risk score from what is known. ---
    const hasNpmManifest = manifests.some((m) => m.ecosystem === 'npm');
    const { score, label } = scoreSupplyChainRisk({
      severities: vulnerabilities.map((v) => v.severity),
      abandonedCount: abandonedDeps,
      hasNpmManifest,
      hasLockfile,
    });
    const vulnerableDeps = new Set(
      vulnerabilities.map((v) => `${v.ecosystem}:${v.packageName}`),
    ).size;

    return {
      status: 'ok',
      manifests,
      dependencies,
      vulnerabilities,
      riskScore: score,
      riskLabel: label,
      depsScanned: dependencies.length,
      vulnerableDeps,
      totalVulnerabilities: vulnerabilities.length,
      abandonedDeps,
      hasLockfile,
      truncated,
      error: null,
      fetchedAt,
    };
  }
}
