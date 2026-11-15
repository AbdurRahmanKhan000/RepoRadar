// Supply-chain risk signals — 0.3.0 ("Trust" release).
// The 0–100 health score (model 1.0.0) does NOT change because of
// anything in this module: supply-chain data feeds the verdict
// only. The language here is deliberate — "supply-chain risk
// signals", never "secure" or "safe". A dependency with a known
// vulnerability is a risk signal from a public database, not a
// verdict on the repository's own code.

import type { ProviderErrorData } from '../domain/repository';

/** Package ecosystems RepoRadar reads in 0.3.0. */
export type Ecosystem = 'npm' | 'pypi' | 'go' | 'cargo' | 'rubygems';

/** OSV ecosystem names, which differ from ours in two cases. */
export const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  go: 'Go',
  cargo: 'crates.io',
  rubygems: 'RubyGems',
};

/** deps.dev system names. */
export const DEPS_DEV_SYSTEM: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'pypi',
  go: 'go',
  cargo: 'cargo',
  rubygems: 'rubygems',
};

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

/** One direct dependency found in a manifest. `checkVersion` is
 *  the concrete version OSV is queried with (the base version of
 *  the declared range); null when the manifest pins no version at
 *  all — that dependency is never claimed vulnerability-free, it
 *  is counted as unchecked (`osvChecked: false`). */
export interface DependencyInfo {
  name: string;
  ecosystem: Ecosystem;
  /** Raw version spec from the manifest, e.g. "^4.17.21". */
  versionSpec: string | null;
  checkVersion: string | null;
  dev: boolean;
  manifestPath: string;
  osvChecked: boolean;
  /** ISO timestamp of the dependency's latest release, or null
   *  when deps.dev had no record of it (unknown, never abandoned). */
  latestReleaseAt: string | null;
  /** True when the latest release is older than 24 months; null
   *  when the release date is unknown. */
  abandoned: boolean | null;
}

export interface VulnerabilityInfo {
  /** CVE / GHSA / OSV id, e.g. "CVE-2020-8203". */
  id: string;
  packageName: string;
  ecosystem: Ecosystem;
  /** The version that was checked, when one was known. */
  version: string | null;
  severity: SeverityLevel;
  /** Highest CVSS score OSV reported, null when OSV gave none. */
  cvssScore: number | null;
  summary: string;
}

export interface ManifestInfo {
  path: string;
  ecosystem: Ecosystem;
  depCount: number;
}

export type SupplyChainStatus = 'ok' | 'no-manifest' | 'unknown';

export type RiskLabel = 'low' | 'moderate' | 'elevated' | 'high';

/** The supply-chain result for one repository. `status` is
 *  'unknown' when the vulnerability check itself failed (OSV or
 *  manifest discovery) — the risk score is then null, never a
 *  guess. 'no-manifest' means the repository has no supported
 *  dependency manifest at the root: there is nothing to check,
 *  which is information, not an error. */
export interface SupplyChainData {
  status: SupplyChainStatus;
  manifests: ManifestInfo[];
  dependencies: DependencyInfo[];
  vulnerabilities: VulnerabilityInfo[];
  /** 0–100 risk score, null when unknown. See
   *  src/supply-chain/scoring.ts for the deterministic formula. */
  riskScore: number | null;
  riskLabel: RiskLabel | null;
  depsScanned: number;
  vulnerableDeps: number;
  totalVulnerabilities: number;
  /** Count of abandoned direct dependencies; null when deps.dev
   *  lookups all failed, so abandonment is entirely unknown. */
  abandonedDeps: number | null;
  /** True when a package-lock.json exists at the repo root. */
  hasLockfile: boolean;
  /** True when the 50-dependency cap was hit (more exist). */
  truncated: boolean;
  /** The failure that made this result unknown, if any. */
  error: ProviderErrorData | null;
  fetchedAt: string;
}
