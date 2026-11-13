// Local cache — spec §10.3.
// TTLs (configurable, documented): core repository metadata 12 min
// (spec range 10–15), activity/language data 45 min (spec range
// 30–60). A stale entry is still returned when the network fails, so
// the UI can show "cached from …" instead of nothing — but it is
// always labelled stale, never presented as fresh.
// The CacheStore interface is the seam: chrome.storage.local backs
// it today (small JSON payloads); IndexedDB/Dexie can replace the
// implementation when history grows (Build 5) without touching the
// service or the UI.

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  /** ETag for conditional requests, when the API sent one. */
  etag: string | null;
}

export interface CachedValue<T> {
  entry: CacheEntry<T>;
  /** True when fetchedAt is older than the TTL. */
  stale: boolean;
}

export interface CacheStore {
  get<T>(key: string): Promise<CachedValue<T> | null>;
  getWithTtl<T>(key: string, ttlMs: number, nowMs?: number): Promise<CachedValue<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export const CORE_TTL_MS = 12 * 60 * 1000;
export const LANGUAGES_TTL_MS = 45 * 60 * 1000;
/** Activity samples (contributors/commits/releases/issues/PRs/
 *  community profile/CI) are bulkier and slower-moving: 45 min,
 *  inside the spec's 30–60 min range for activity/release data. */
export const ACTIVITY_TTL_MS = 45 * 60 * 1000;

export function cacheKeyForRepo(platform: string, owner: string, repo: string): string {
  return `reporadar:cache:v1:${platform}:${owner}/${repo}:repo`;
}

export function cacheKeyForLanguages(platform: string, owner: string, repo: string): string {
  return `reporadar:cache:v1:${platform}:${owner}/${repo}:languages`;
}

export function cacheKeyForActivity(platform: string, owner: string, repo: string): string {
  return `reporadar:cache:v1:${platform}:${owner}/${repo}:activity`;
}

function isStale(fetchedAt: string, ttlMs: number, nowMs = Date.now()): boolean {
  const age = nowMs - new Date(fetchedAt).getTime();
  return age > ttlMs;
}

export class ChromeStorageCache implements CacheStore {
  async get<T>(key: string): Promise<CachedValue<T> | null> {
    const result = await browser.storage.local.get(key);
    const entry = result[key] as CacheEntry<T> | undefined;
    if (!entry || typeof entry.fetchedAt !== 'string') return null;
    return { entry, stale: false };
  }

  /** Get with a TTL check — the caller decides fresh vs stale. */
  async getWithTtl<T>(key: string, ttlMs: number, nowMs = Date.now()): Promise<CachedValue<T> | null> {
    const found = await this.get<T>(key);
    if (!found) return null;
    return { entry: found.entry, stale: isStale(found.entry.fetchedAt, ttlMs, nowMs) };
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    await browser.storage.local.set({ [key]: entry });
  }

  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  }

  async clear(): Promise<void> {
    const all = await browser.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('reporadar:cache:'));
    if (keys.length > 0) await browser.storage.local.remove(keys);
  }
}

/** In-memory CacheStore for unit tests (no browser APIs). */
export class InMemoryCache implements CacheStore {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<CachedValue<T> | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    return { entry, stale: false };
  }

  async getWithTtl<T>(key: string, ttlMs: number, nowMs = Date.now()): Promise<CachedValue<T> | null> {
    const found = await this.get<T>(key);
    if (!found) return null;
    return { entry: found.entry, stale: isStale(found.entry.fetchedAt, ttlMs, nowMs) };
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    this.store.set(key, entry as CacheEntry<unknown>);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
