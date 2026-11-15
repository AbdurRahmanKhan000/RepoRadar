// Dependency manifest discovery and parsing — 0.3.0.
// Pure functions: text in, dependencies out. No network, no clock.
// Scope (deliberate, documented): only root-level manifests are
// read — a monorepo's nested packages/*/package.json files are not
// scanned in 0.3.0. Only DIRECT dependencies are parsed; lockfiles
// are never parsed for versions (package-lock.json is only noted
// as present/absent for the risk score).

import type { DependencyInfo, Ecosystem, ManifestInfo } from './types';

/** Manifest files RepoRadar recognises, in discovery order. */
export const MANIFEST_DEFS: readonly { path: string; ecosystem: Ecosystem }[] = [
  { path: 'package.json', ecosystem: 'npm' },
  { path: 'requirements.txt', ecosystem: 'pypi' },
  { path: 'go.mod', ecosystem: 'go' },
  { path: 'Cargo.toml', ecosystem: 'cargo' },
  { path: 'Gemfile', ecosystem: 'rubygems' },
];

/** Maximum manifests read per repository, and maximum direct
 *  dependencies parsed across them. */
export const MAX_MANIFESTS = 5;
export const MAX_DEPENDENCIES = 50;

/** The npm lockfile marker — noted, never parsed. */
export const NPM_LOCKFILE_PATH = 'package-lock.json';

/** Which of the known manifest paths are present at the repo root,
 *  in discovery order, capped at MAX_MANIFESTS. `treePaths` are the
 *  blob paths from the recursive git tree. */
export function findManifests(treePaths: string[]): ManifestInfo[] {
  const found: ManifestInfo[] = [];
  for (const def of MANIFEST_DEFS) {
    if (found.length >= MAX_MANIFESTS) break;
    if (treePaths.includes(def.path)) {
      found.push({ path: def.path, ecosystem: def.ecosystem, depCount: 0 });
    }
  }
  return found;
}

export function hasNpmLockfile(treePaths: string[]): boolean {
  return treePaths.includes(NPM_LOCKFILE_PATH);
}

/** Extract the first concrete version from a version spec, e.g.
 *  "^4.17.21" → "4.17.21", ">=2.0,<3" → "2.0", "v1.2.3" →
 *  "v1.2.3", "~1.0" → "1.0". Returns null when the spec pins no
 *  version at all (a bare package name, "*", "latest"). The result
 *  is the MINIMUM version the range allows — OSV is queried with
 *  it, and the UI's evidence says so. */
export function baseVersion(spec: string | null): string | null {
  if (!spec) return null;
  const match = /v?\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/.exec(spec);
  return match ? match[0] : null;
}

interface RawDep {
  name: string;
  versionSpec: string | null;
  dev: boolean;
}

function toDependency(
  raw: RawDep,
  ecosystem: Ecosystem,
  manifestPath: string,
): DependencyInfo {
  const checkVersion = baseVersion(raw.versionSpec);
  return {
    name: raw.name,
    ecosystem,
    versionSpec: raw.versionSpec,
    checkVersion,
    dev: raw.dev,
    manifestPath,
    osvChecked: checkVersion !== null,
    latestReleaseAt: null,
    abandoned: null,
  };
}

/** Parse package.json: `dependencies` + `devDependencies`.
 *  Values may be version ranges, URLs, or workspace links — only
 *  range-like values yield a checkVersion; the rest are still
 *  listed, with osvChecked false. */
export function parsePackageJson(text: string, manifestPath: string): DependencyInfo[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  const out: DependencyInfo[] = [];
  for (const [section, dev] of [
    ['dependencies', false],
    ['devDependencies', true],
  ] as const) {
    const deps = obj[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      out.push(toDependency({ name, versionSpec: spec, dev }, 'npm', manifestPath));
    }
  }
  return out;
}

/** Parse requirements.txt: one requirement per line. Comments,
 *  blank lines, options (-r, --index-url, ...) and environment
 *  markers are skipped. `requests==2.31.0` → version "2.31.0";
 *  a bare name has no version. Extras (requests[security]) are
 *  stripped from the name. */
export function parseRequirementsTxt(text: string, manifestPath: string): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const nameMatch = /^([A-Za-z0-9_.-]+)(\[[^\]]*\])?/.exec(line);
    if (!nameMatch?.[1]) continue;
    const rest = line.slice(nameMatch[0].length);
    const versionMatch = /(?:==|>=|<=|~=|>|<|!=)\s*([^\s;,]+)/.exec(rest);
    out.push(
      toDependency(
        { name: nameMatch[1].toLowerCase(), versionSpec: versionMatch?.[1] ?? null, dev: false },
        'pypi',
        manifestPath,
      ),
    );
  }
  return out;
}

/** Parse go.mod: `require` blocks and single-line requires.
 *  Module paths are the package names; versions are exact
 *  (v1.2.3 or pseudo-versions). Indirect requirements
 *  ("// indirect") are skipped — direct dependencies only. */
export function parseGoMod(text: string, manifestPath: string): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  const single = /^\s*require\s+(\S+)\s+(\S+)\s*$/;
  const entry = /^\s*(\S+)\s+(\S+)(?:\s*\/\/.*)?$/;
  let inBlock = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('require (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    if (!inBlock) {
      const m = single.exec(line);
      if (m?.[1] && m[2] && !line.includes('// indirect')) {
        out.push(toDependency({ name: m[1], versionSpec: m[2], dev: false }, 'go', manifestPath));
      }
      continue;
    }
    if (line.includes('// indirect')) continue;
    const m = entry.exec(line);
    if (m?.[1] && m[2]) {
      out.push(toDependency({ name: m[1], versionSpec: m[2], dev: false }, 'go', manifestPath));
    }
  }
  return out;
}

/** Parse Cargo.toml [dependencies] / [dev-dependencies]. A
 *  line-based parser for the common shapes: `serde = "1.0"` and
 *  `serde = { version = "1.0", features = [...] }`. Anything else
 *  is skipped rather than guessed. */
export function parseCargoToml(text: string, manifestPath: string): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  let section: 'deps' | 'dev' | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      if (line === '[dependencies]') section = 'deps';
      else if (line === '[dev-dependencies]') section = 'dev';
      else section = null;
      continue;
    }
    if (!section || !line || line.startsWith('#')) continue;
    const nameMatch = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (!nameMatch?.[1]) continue;
    const versionMatch = /version\s*=\s*"([^"]+)"/.exec(line) ?? /^[^=]+=\s*"([^"]+)"/.exec(line);
    out.push(
      toDependency(
        { name: nameMatch[1], versionSpec: versionMatch?.[1] ?? null, dev: section === 'dev' },
        'cargo',
        manifestPath,
      ),
    );
  }
  return out;
}

/** Parse a Gemfile: `gem 'name'` / `gem "name", "version"`.
 *  Group blocks are ignored — every gem line is read the same way.
 *  `~> 7.0` yields the base version "7.0" via baseVersion. */
export function parseGemfile(text: string, manifestPath: string): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('gem ')) continue;
    const m = /^gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/.exec(line);
    if (!m?.[1]) continue;
    out.push(
      toDependency(
        { name: m[1], versionSpec: m[2] ?? null, dev: false },
        'rubygems',
        manifestPath,
      ),
    );
  }
  return out;
}

/** Dispatch to the right parser for a manifest's ecosystem. */
export function parseManifest(
  ecosystem: Ecosystem,
  text: string,
  manifestPath: string,
): DependencyInfo[] {
  switch (ecosystem) {
    case 'npm':
      return parsePackageJson(text, manifestPath);
    case 'pypi':
      return parseRequirementsTxt(text, manifestPath);
    case 'go':
      return parseGoMod(text, manifestPath);
    case 'cargo':
      return parseCargoToml(text, manifestPath);
    case 'rubygems':
      return parseGemfile(text, manifestPath);
  }
}
