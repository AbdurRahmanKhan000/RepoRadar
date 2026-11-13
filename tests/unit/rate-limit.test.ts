import { describe, expect, it } from 'vitest';

import { isRateLimitExhausted, msUntilReset, parseRateLimit, resetInLabel } from '../../src/api/rate-limit';

function headers(pairs: Record<string, string>): Headers {
  return new Headers(pairs);
}

describe('parseRateLimit', () => {
  it('reads GitHub x-ratelimit-* headers and Retry-After', () => {
    const info = parseRateLimit(
      headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '59',
        'x-ratelimit-reset': '1794577200',
        'retry-after': '30',
      }),
    );
    expect(info.limit).toBe(60);
    expect(info.remaining).toBe(59);
    expect(info.resetAtMs).toBe(1794577200 * 1000);
    expect(info.retryAfterMs).toBe(30_000);
  });

  it('leaves fields null when headers are absent — never guesses', () => {
    const info = parseRateLimit(headers({}));
    expect(info.limit).toBeNull();
    expect(info.remaining).toBeNull();
    expect(info.resetAtMs).toBeNull();
    expect(info.retryAfterMs).toBeNull();
  });

  it('ignores non-numeric header values', () => {
    const info = parseRateLimit(headers({ 'x-ratelimit-remaining': 'banana' }));
    expect(info.remaining).toBeNull();
  });
});

describe('rate-limit helpers', () => {
  it('detects an exhausted window only when remaining is 0', () => {
    expect(isRateLimitExhausted({ limit: 60, remaining: 0, resetAtMs: null, retryAfterMs: null, source: 'test' })).toBe(true);
    expect(isRateLimitExhausted({ limit: 60, remaining: 1, resetAtMs: null, retryAfterMs: null, source: 'test' })).toBe(false);
    expect(isRateLimitExhausted(null)).toBe(false);
  });

  it('computes ms until reset and a human label', () => {
    const now = 1_000_000;
    const info = { limit: 60, remaining: 0, resetAtMs: now + 12 * 60_000, retryAfterMs: null, source: 'test' };
    expect(msUntilReset(info, now)).toBe(12 * 60_000);
    expect(resetInLabel(info, now)).toBe('12m');
    expect(resetInLabel(null, now)).toBe('unknown');
  });
});
