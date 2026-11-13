// Pure, deterministic metric functions — spec §5.1 (L1).
// Every function takes its inputs explicitly, including `nowMs`
// where time is involved. Nothing here calls Date.now(), reads
// the network, or uses randomness, so the same inputs always give
// the same outputs (unit-tested, spec §14.1). All formulas are
// documented where they are used, and the scoring module records
// each formula in the report's evidence.

/** Whole days between an ISO timestamp and `nowMs`. Null when the
 *  timestamp is null or unparseable. Negative (future-dated) values
 *  clamp to 0 — a future push is treated as "just now". */
export function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((nowMs - ms) / 86_400_000));
}

/** 100 * exp(-days / scale): 100 today, decaying exponentially.
 *  scale=120 → ~37 at 120 days; scale=180 → ~37 at 180 days. */
export function expDecay(days: number, scale: number): number {
  return 100 * Math.exp(-days / scale);
}

/** Logarithmic 0–100 scale: value `base` scores exactly 100, 0
 *  scores 0, growth above `base` is capped at 100. Used for
 *  popularity (stars/forks) and contributor counts so that a
 *  10x-bigger repo does not get a 10x-bigger score (spec §6.1). */
export function logScale(value: number, base: number): number {
  if (value <= 0) return 0;
  return Math.min(100, (100 * Math.log10(1 + value)) / Math.log10(1 + base));
}

/** Median of a list of numbers; null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** closed / (open + closed); null when there are no items at all. */
export function closureRatio(open: number, closed: number): number | null {
  if (open + closed === 0) return null;
  return closed / (open + closed);
}

/** Share of all contributions made by the top contributor, 0–1.
 *  Null when there are no contributions. This is a proxy for
 *  concentration, NOT a definitive bus factor (spec §6.1). */
export function topContributorShare(contributions: number[]): number | null {
  const total = contributions.reduce((sum, n) => sum + n, 0);
  if (total === 0 || contributions.length === 0) return null;
  return (Math.max(...contributions) as number) / total;
}

/** Distinct author logins in a list of commits, restricted to a
 *  window ending at `nowMs`. Commits without a linked login, or
 *  without a date, are ignored (they cannot be attributed). */
export function distinctCommitters(
  commits: { authorLogin: string | null; committedAt: string | null }[],
  windowDays: number,
  nowMs: number,
): number {
  const sinceMs = nowMs - windowDays * 86_400_000;
  const logins = new Set<string>();
  for (const commit of commits) {
    if (!commit.authorLogin || !commit.committedAt) continue;
    const ms = Date.parse(commit.committedAt);
    if (Number.isNaN(ms) || ms < sinceMs || ms > nowMs) continue;
    logins.add(commit.authorLogin);
  }
  return logins.size;
}

/** How many commits fall in the window ending at `nowMs`. */
export function commitsInWindow(
  commits: { committedAt: string | null }[],
  windowDays: number,
  nowMs: number,
): number {
  const sinceMs = nowMs - windowDays * 86_400_000;
  let count = 0;
  for (const commit of commits) {
    if (!commit.committedAt) continue;
    const ms = Date.parse(commit.committedAt);
    if (Number.isNaN(ms) || ms < sinceMs || ms > nowMs) continue;
    count++;
  }
  return count;
}

/** How many releases were published in the window ending at `nowMs`.
 *  Releases without a publish date are not counted. */
export function releasesInWindow(
  releases: { publishedAt: string | null }[],
  windowDays: number,
  nowMs: number,
): number {
  const sinceMs = nowMs - windowDays * 86_400_000;
  let count = 0;
  for (const release of releases) {
    if (!release.publishedAt) continue;
    const ms = Date.parse(release.publishedAt);
    if (Number.isNaN(ms) || ms < sinceMs || ms > nowMs) continue;
    count++;
  }
  return count;
}

/** Days since the most recent release; null when no release has a
 *  publish date. */
export function daysSinceLatestRelease(
  releases: { publishedAt: string | null }[],
  nowMs: number,
): number | null {
  const days = releases
    .map((r) => daysSince(r.publishedAt, nowMs))
    .filter((d): d is number => d !== null);
  if (days.length === 0) return null;
  return Math.min(...days);
}

/** Bucketed score for "recent contributors" (distinct committers in
 *  the 90-day sample): 0 → 0, 1 → 30, 2–3 → 60, 4–9 → 85, 10+ → 100. */
export function recentContributorsScore(distinctCount: number): number {
  if (distinctCount <= 0) return 0;
  if (distinctCount === 1) return 30;
  if (distinctCount <= 3) return 60;
  if (distinctCount <= 9) return 85;
  return 100;
}

/** Bucketed score for release frequency (releases in the last 12
 *  months): 0 → 10, 1 → 50, 2–3 → 75, 4+ → 100. Zero releases is
 *  evidence of poor release hygiene, not missing data — so it
 *  scores 10, not null. */
export function releaseFrequencyScore(count12mo: number): number {
  if (count12mo <= 0) return 10;
  if (count12mo === 1) return 50;
  if (count12mo <= 3) return 75;
  return 100;
}

/** Round a score to 1 decimal for display/storage. Scores are
 *  computed at full precision and rounded only at the end, so two
 *  runs of the same inputs stay byte-identical. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
