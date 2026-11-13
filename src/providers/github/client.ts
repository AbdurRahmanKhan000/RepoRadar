// Typed GitHub REST client — spec §9.3 / §10.3.
// Responsibilities, in order:
//   1. One place that talks to api.github.com (no fetch() scattered
//      through the UI or the scoring engine).
//   2. Rate-limit awareness: parse x-ratelimit-* + Retry-After on
//      every response, surface them, never retry blindly.
//   3. Bounded retries: 429 / 5xx / network only, max 3 attempts,
//      exponential backoff with jitter, respecting Retry-After and
//      the rate-limit reset time. 404/401/403 are never retried.
//   4. Request coalescing: concurrent identical GETs share one
//      in-flight request, so the panel + popup cannot double-spend
//      the 60/hour unauthenticated budget.
//   5. Conditional requests: If-None-Match / 304 support via ETag.
//
// No token in V1 (FR-15 is P2). When a token is added later it goes
// through this client only, stored locally, never logged.

import { z } from 'zod';

import { ProviderError, type RateLimitInfo } from '../../domain/repository';
import { isRateLimitExhausted, parseRateLimit } from '../../api/rate-limit';

export interface GitHubRequestOptions {
  etag?: string;
  signal?: AbortSignal;
}

export interface GitHubResponse<T> {
  data: T;
  etag: string | null;
  rateLimit: RateLimitInfo;
  notModified: boolean;
  fetchedAt: string;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 60_000);
  // Exponential backoff with jitter: 1s, 2s, 4s ± 25%.
  const base = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export class GitHubApiClient {
  readonly apiBase = 'https://api.github.com';
  private readonly inFlight = new Map<string, Promise<GitHubResponse<unknown>>>();
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    // fetch must run with the global scope as its receiver. Calling
    // it as a method of this client (this.fetchFn(...)) throws
    // "Illegal invocation" in a service worker — which used to make
    // EVERY request fail with NETWORK_ERROR, even on a perfect
    // connection (the owner's live-Chrome "Could not reach GitHub"
    // was this bug, not his network). Binding once here fixes every
    // call site below. Fixes 0.2.1.
    this.fetchFn = fetchFn.bind(globalThis);
  }

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: GitHubRequestOptions = {},
  ): Promise<GitHubResponse<T>> {
    const key = `GET ${path}|${options.etag ?? ''}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<GitHubResponse<T>>;

    const promise = this.requestWithRetries<T>(path, schema, options);
    this.inFlight.set(key, promise as Promise<GitHubResponse<unknown>>);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async requestWithRetries<T>(
    path: string,
    schema: z.ZodType<T>,
    options: GitHubRequestOptions,
  ): Promise<GitHubResponse<T>> {
    let lastError: ProviderError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce<T>(path, schema, options);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        lastError = error;
        const retryable =
          error.code === 'RATE_LIMITED' ||
          error.code === 'NETWORK_ERROR' ||
          error.code === 'UNKNOWN';
        if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;
        await sleep(backoffMs(attempt, error.rateLimit?.retryAfterMs ?? null));
      }
    }
    // Unreachable: the loop either returns or throws.
    throw lastError ?? new ProviderError('UNKNOWN', 'GitHub request failed');
  }

  private async requestOnce<T>(
    path: string,
    schema: z.ZodType<T>,
    options: GitHubRequestOptions,
  ): Promise<GitHubResponse<T>> {
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    if (options.etag) headers.set('If-None-Match', options.etag);

    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiBase}${path}`, {
        headers,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // Keep the raw failure: without it a NETWORK_ERROR is a dead
      // end — the panel cannot tell a blocked api.github.com from a
      // dead connection. The detail is only the error's name/message.
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new ProviderError(
        'NETWORK_ERROR',
        'Could not reach GitHub. Check your connection and try again.',
        { detail },
      );
    }

    const rateLimit = parseRateLimit(response.headers);
    const fetchedAt = new Date().toISOString();
    const etag = response.headers.get('etag');

    if (response.status === 304) {
      // Caller handles a 304 by using its cached body; signal it with
      // a dedicated error the service catches — the client itself has
      // no cache, so it cannot return data it never received.
      throw new NotModifiedError(rateLimit, etag, fetchedAt);
    }

    if (response.status === 404) {
      throw new ProviderError('NOT_FOUND', 'Repository not found on GitHub.', {
        rateLimit,
        status: 404,
      });
    }
    if (response.status === 401) {
      throw new ProviderError('UNAUTHORIZED', 'GitHub rejected the request (401).', {
        rateLimit,
        status: 401,
      });
    }
    if (response.status === 403 || response.status === 429) {
      const exhausted = isRateLimitExhausted(rateLimit) || response.status === 429;
      if (exhausted) {
        throw new ProviderError(
          'RATE_LIMITED',
          'GitHub API rate limit reached. RepoRadar will retry after the window resets — cached data is shown where available.',
          { rateLimit, status: response.status },
        );
      }
      throw new ProviderError(
        'FORBIDDEN',
        'GitHub refused this request (403). The repository may be unavailable to unauthenticated requests.',
        { rateLimit, status: response.status },
      );
    }
    if (!response.ok) {
      throw new ProviderError('UNKNOWN', `GitHub request failed (${response.status}).`, {
        rateLimit,
        status: response.status,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ProviderError('INVALID_RESPONSE', 'GitHub returned a response RepoRadar could not read.', {
        rateLimit,
        status: response.status,
      });
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'GitHub returned data in an unexpected shape. RepoRadar did not guess at the missing fields.',
        { rateLimit, status: response.status },
      );
    }

    return { data: parsed.data, etag, rateLimit, notModified: false, fetchedAt };
  }
}

/** Thrown (and caught by the service) when the API answers 304. */
export class NotModifiedError extends Error {
  readonly rateLimit: RateLimitInfo;
  readonly etag: string | null;
  readonly fetchedAt: string;

  constructor(rateLimit: RateLimitInfo, etag: string | null, fetchedAt: string) {
    super('Not modified');
    this.name = 'NotModifiedError';
    this.rateLimit = rateLimit;
    this.etag = etag;
    this.fetchedAt = fetchedAt;
  }
}
