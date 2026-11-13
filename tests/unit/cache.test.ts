import { describe, expect, it } from 'vitest';

import { CORE_TTL_MS, InMemoryCache } from '../../src/storage/cache';

describe('InMemoryCache TTL behaviour', () => {
  it('returns fresh entries as not stale', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', { value: 42, fetchedAt: new Date(Date.now() - 1000).toISOString(), etag: null });
    const found = await cache.getWithTtl<number>('k', CORE_TTL_MS);
    expect(found?.entry.value).toBe(42);
    expect(found?.stale).toBe(false);
  });

  it('marks entries older than the TTL as stale, but still returns them', async () => {
    const cache = new InMemoryCache();
    await cache.set('k', {
      value: 42,
      fetchedAt: new Date(Date.now() - CORE_TTL_MS - 1000).toISOString(),
      etag: '"abc"',
    });
    const found = await cache.getWithTtl<number>('k', CORE_TTL_MS);
    expect(found?.entry.value).toBe(42);
    expect(found?.stale).toBe(true);
    expect(found?.entry.etag).toBe('"abc"');
  });

  it('returns null for missing keys and clears namespaced entries', async () => {
    const cache = new InMemoryCache();
    expect(await cache.get('missing')).toBeNull();
    await cache.set('a', { value: 1, fetchedAt: new Date().toISOString(), etag: null });
    await cache.clear();
    expect(await cache.get('a')).toBeNull();
  });
});
