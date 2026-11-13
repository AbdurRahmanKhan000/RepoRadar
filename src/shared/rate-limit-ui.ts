import { isRateLimitExhausted } from '../api/rate-limit';
import type { ProviderErrorCode, RateLimitInfo } from '../domain/repository';

/**
 * Whether the panel's Refresh button must be disabled.
 *
 * Refresh always forces a live request, so it is disabled while a load is
 * in progress, when the last known rate limit is exhausted, and when the
 * last load failed because the rate limit was hit. In the exhausted cases
 * the error card's "Try again" is the way back — it is cache-first (see
 * tryAgainForceRefresh), so it never spends a request that does not exist.
 */
export function isRefreshDisabled(options: {
  loading: boolean;
  rateLimit: RateLimitInfo | null | undefined;
  lastErrorCode: ProviderErrorCode | null;
}): boolean {
  if (options.loading) return true;
  if (options.lastErrorCode === 'RATE_LIMITED') return true;
  if (options.rateLimit && isRateLimitExhausted(options.rateLimit)) return true;
  return false;
}

/**
 * Whether the error card's "Try again" should force a live request.
 *
 * After a rate-limit failure it must NOT force one: the window is spent,
 * so the retry goes cache-first and shows cached data when it exists.
 * Every other error retries live, as before.
 */
export function tryAgainForceRefresh(errorCode: ProviderErrorCode): boolean {
  return errorCode !== 'RATE_LIMITED';
}
