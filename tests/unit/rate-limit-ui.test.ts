import { describe, expect, it } from 'vitest';

import { isRefreshDisabled, tryAgainForceRefresh } from '../../src/shared/rate-limit-ui';

const freshLimit = { limit: 60, remaining: 59, resetAtMs: Date.now() + 3_600_000, retryAfterMs: null, source: 'x-ratelimit-* headers' };
const exhaustedLimit = { limit: 60, remaining: 0, resetAtMs: Date.now() + 900_000, retryAfterMs: null, source: 'x-ratelimit-* headers' };

describe('rate-limit UI rules', () => {
  it('enables Refresh when loading is finished and requests remain', () => {
    expect(isRefreshDisabled({ loading: false, rateLimit: freshLimit, lastErrorCode: null })).toBe(false);
  });

  it('disables Refresh while loading', () => {
    expect(isRefreshDisabled({ loading: true, rateLimit: freshLimit, lastErrorCode: null })).toBe(true);
  });

  it('disables Refresh when the last known rate limit is exhausted', () => {
    expect(isRefreshDisabled({ loading: false, rateLimit: exhaustedLimit, lastErrorCode: null })).toBe(true);
  });

  it('disables Refresh after a rate-limit failure, even without a known limit', () => {
    expect(isRefreshDisabled({ loading: false, rateLimit: null, lastErrorCode: 'RATE_LIMITED' })).toBe(true);
  });

  it('keeps Refresh enabled after other errors', () => {
    expect(isRefreshDisabled({ loading: false, rateLimit: freshLimit, lastErrorCode: 'NETWORK_ERROR' })).toBe(false);
  });

  it('Try again forces a live request for ordinary errors', () => {
    expect(tryAgainForceRefresh('NOT_FOUND')).toBe(true);
    expect(tryAgainForceRefresh('NETWORK_ERROR')).toBe(true);
    expect(tryAgainForceRefresh('UNKNOWN')).toBe(true);
  });

  it('Try again is cache-first after a rate-limit failure', () => {
    expect(tryAgainForceRefresh('RATE_LIMITED')).toBe(false);
  });
});
