// Domain model — spec §16.1 (refined into strict types).
// A RepositoryFacts is L0: observable facts only, no interpretation.
// Unknown values stay null — never zero, never invented (spec §5.1).

export type Platform = 'github' | 'gitlab' | 'bitbucket' | 'codeberg' | 'gitea';

/** A repository on a specific hosting platform. */
export interface RepoRef {
  platform: Platform;
  /** Hostname, e.g. github.com — the provider registry keys on this. */
  host: string;
  owner: string;
  repo: string;
}

export function repoRefId(ref: RepoRef): string {
  return `${ref.platform}:${ref.owner}/${ref.repo}`;
}

export function repoRefUrl(ref: RepoRef): string {
  return `https://${ref.host}/${ref.owner}/${ref.repo}`;
}

export interface RepositoryFacts {
  id: string;
  platform: Platform;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  forks: number;
  watchers: number;
  /** GitHub counts open issues AND open pull requests here. See the
   *  evidence limitation on this field — never present it as
   *  "open issues only". */
  openIssuesCount: number;
  primaryLanguage: string | null;
  licenseSpdxId: string | null;
  licenseName: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  archived: boolean;
  isFork: boolean;
  defaultBranch: string;
  fetchedAt: string;
}

export interface LanguageEntry {
  name: string;
  bytes: number;
  /** Percentage of total bytes, 0–100, rounded to 1 decimal. */
  percent: number;
}

export interface LanguageBreakdown {
  entries: LanguageEntry[];
  totalBytes: number;
  fetchedAt: string;
}

export interface EvidenceItem {
  key: string;
  value: number | string | boolean | null;
  /** e.g. "GET /repos/{owner}/{repo}" or "GET /repos/{owner}/{repo}/languages" */
  source: string;
  observedAt: string;
  window?: string;
  limitation?: string;
}

export interface RateLimitInfo {
  /** Requests allowed per window, when the API reports it. */
  limit: number | null;
  remaining: number | null;
  /** Epoch ms when the window resets, when reported. */
  resetAtMs: number | null;
  /** Retry-After in ms, when the API sent one. */
  retryAfterMs: number | null;
  /** Raw source of the numbers, e.g. "x-ratelimit-* headers". */
  source: string;
}

export type ProviderErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNKNOWN';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly rateLimit: RateLimitInfo | null;
  readonly status: number | null;
  /** Raw underlying failure, e.g. "TypeError: Failed to fetch".
   *  The human message stays friendly; the detail is what makes a
   *  network failure diagnosable instead of a dead end (fixes
   *  0.2.1). Never contains credentials or tokens — it is only the
   *  fetch error's name and message. */
  readonly detail: string | null;

  constructor(
    code: ProviderErrorCode,
    message: string,
    opts: { rateLimit?: RateLimitInfo | null; status?: number | null; detail?: string | null } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.rateLimit = opts.rateLimit ?? null;
    this.status = opts.status ?? null;
    this.detail = opts.detail ?? null;
  }
}

/** Plain, message-safe error data. Error *instances* do not survive
 *  chrome.runtime messaging intact (custom fields are lost), so the
 *  service converts ProviderError to this shape before anything
 *  crosses a message boundary. */
export interface ProviderErrorData {
  code: ProviderErrorCode;
  message: string;
  status: number | null;
  /** Raw underlying failure (see ProviderError.detail). */
  detail: string | null;
}

/** Convert a ProviderError to its message-safe form. Lives here
 *  (not in the service) so the supply-chain service can use it
 *  without importing the repository service — that would be a
 *  circular import. */
export function toErrorData(error: ProviderError): ProviderErrorData {
  return { code: error.code, message: error.message, status: error.status, detail: error.detail };
}

/** What the side panel renders for one repository (Build 2). */
export interface OverviewResult {
  ref: RepoRef;
  facts: RepositoryFacts;
  languages: LanguageBreakdown | null;
  /** Non-fatal: the languages endpoint failed but the repo loaded. */
  languagesError: ProviderErrorData | null;
  /** Fatal-for-live-data: the live repo fetch failed, but the facts
   *  below are a stale cached copy, labelled by `stale: true`. */
  liveError: ProviderErrorData | null;
  evidence: EvidenceItem[];
  rateLimit: RateLimitInfo | null;
  fromCache: boolean;
  /** True when any part of the result is stale cached data. */
  stale: boolean;
  fetchedAt: string;
}
