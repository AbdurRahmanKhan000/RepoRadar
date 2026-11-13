// GitHub rate-limit header parsing — spec §10.3.
// GitHub documents 60 req/hour unauthenticated and 5,000/hour
// authenticated in common cases; secondary limits also apply.
// We never guess: when a header is absent, the field stays null.

import type { RateLimitInfo } from '../domain/repository';

function toInt(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseRateLimit(headers: Headers): RateLimitInfo {
  const limit = toInt(headers.get('x-ratelimit-limit'));
  const remaining = toInt(headers.get('x-ratelimit-remaining'));
  const resetSeconds = toInt(headers.get('x-ratelimit-reset'));
  const retryAfterSeconds = toInt(headers.get('retry-after'));

  return {
    limit,
    remaining,
    resetAtMs: resetSeconds !== null ? resetSeconds * 1000 : null,
    retryAfterMs: retryAfterSeconds !== null ? retryAfterSeconds * 1000 : null,
    source: 'x-ratelimit-* headers',
  };
}

/** True when the API says no requests remain in this window. */
export function isRateLimitExhausted(info: RateLimitInfo | null): boolean {
  return info !== null && info.remaining !== null && info.remaining <= 0;
}

/** Milliseconds until the window resets, or null when unknown. */
export function msUntilReset(info: RateLimitInfo | null, nowMs = Date.now()): number | null {
  if (!info || info.resetAtMs === null) return null;
  return Math.max(0, info.resetAtMs - nowMs);
}

/** Human "resets in 12m" label for the UI. */
export function resetInLabel(info: RateLimitInfo | null, nowMs = Date.now()): string {
  const ms = msUntilReset(info, nowMs);
  if (ms === null) return 'unknown';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
