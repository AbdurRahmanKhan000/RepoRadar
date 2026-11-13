// GitHub repository URL parsing — Build 1 (FR-01).
// Pure function, no browser APIs, so it is fully unit-testable.
//
// Detection rule (spec §7 FR-01, Build 1 exit criteria):
//   A repository context is `github.com/{owner}/{repo}` — two path
//   segments — plus any sub-path inside that repository, EXCEPT the
//   repository settings pages (`/{owner}/{repo}/settings...`), which
//   are not content pages.
//   Everything else is NOT a repository:
//   - `/` (home), `/{owner}` (profile), `/{owner}/...` with a
//     reserved first segment (settings, organizations, marketplace,
//     explore, notifications, search, issues, pulls, trending, …)
//   - global routes such as `/issues`, `/pulls`, `/settings`,
//     `/search`, `/explore`, `/marketplace`, `/notifications`.
//
// Repo sub-pages (issues, pulls, tree, blob, releases, …) still
// resolve to the same owner/repo — they are pages *inside* a
// repository, and the user may want an analysis from any of them.
// The "ignore issues/settings" in FR-01 refers to the *global*
// /issues and /settings routes, not to a repository's own tabs.

export interface RepoContext {
  owner: string;
  repo: string;
}

/** First path segments that can never be a repository owner. */
const RESERVED_FIRST_SEGMENTS = new Set([
  'settings',
  'organizations',
  'orgs',
  'marketplace',
  'explore',
  'notifications',
  'search',
  'issues',
  'pulls',
  'trending',
  'collections',
  'features',
  'sponsors',
  'sponsorships',
  'about',
  'pricing',
  'contact',
  'login',
  'signup',
  'join',
  'sessions',
  'dashboard',
  'new',
  'codespaces',
  'copilot',
  'apps',
  'topics',
  'showcases',
  'events',
  'enterprise',
  'security',
  'site',
  'blog',
  'education',
  'nonprofit',
  'customer-stories',
  'readme',
  'git-guides',
  'open-source',
  'support',
  'docs',
]);

/** Sub-paths inside a repository that are not repository content. */
const IGNORED_REPO_SUBPATHS = new Set(['settings']);

/**
 * Hardening (Build 6): owner/repo segments are validated against
 * GitHub's own name rules, not just checked for "." / "..".
 *   - Owner (user/org): 1–39 chars, ASCII letters/digits/hyphens,
 *     never starting or ending with a hyphen, no dots.
 *   - Repository: 1–100 chars, ASCII letters/digits, dots, hyphens,
 *     underscores; "." and ".." are never names (".github" is).
 * This rejects, in one place, percent-encoded traversal ("%2e%2e",
 * "repo%2Fevil" — "%" is not in either alphabet), over-long
 * segments, control characters, and non-ASCII homograph lookalikes.
 * A rejected name is never sent to the API — the caller gets null
 * and the panel shows "no repository detected" instead.
 */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$/;

export function parseRepoFromUrl(input: string | URL): RepoContext | null {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return null;
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null;
  }

  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return null;

  const [owner, repo, ...rest] = segments;
  if (!owner || !repo) return null;
  if (RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) return null;
  if (!OWNER_PATTERN.test(owner)) return null;
  if (repo === '.' || repo === '..' || !REPO_PATTERN.test(repo)) return null;
  const subpath = rest[0];
  if (subpath !== undefined && IGNORED_REPO_SUBPATHS.has(subpath.toLowerCase())) {
    return null;
  }

  return { owner, repo };
}

export function repoId(context: RepoContext): string {
  return `${context.owner}/${context.repo}`;
}

export function repoUrl(context: RepoContext): string {
  return `https://github.com/${context.owner}/${context.repo}`;
}
