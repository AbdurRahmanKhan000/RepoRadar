// Build 5: saved-repo store — add/remove/cap/dedup over the
// in-memory store (the panel uses chrome.storage.local behind the
// same interface).

import { describe, expect, it } from 'vitest';
import {
  InMemoryKeyValueStore,
  MAX_SAVED_REPOS,
  SavedReposStore,
  type SavedRepoEntry,
} from '../../src/storage/saved-repos';

function entry(repoId: string, owner = 'test', repo = 'repo'): SavedRepoEntry {
  return {
    repoId,
    owner,
    repo,
    overallScore: 94.2,
    grade: 'A',
    coverage: 100,
    confidence: 'high',
    fetchedAt: '2026-11-13T12:00:00Z',
    savedAt: '2026-11-13T12:00:00Z',
  };
}

describe('SavedReposStore', () => {
  it('starts empty and adds a repo', async () => {
    const store = new SavedReposStore(new InMemoryKeyValueStore());
    expect(await store.load()).toEqual([]);
    expect(await store.add(entry('github:test/repo'))).toEqual({ ok: true, added: true });
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.repoId).toBe('github:test/repo');
    expect(await store.isSaved('github:test/repo')).toBe(true);
  });

  it('dedups: saving the same repo refreshes it instead of duplicating', async () => {
    const store = new SavedReposStore(new InMemoryKeyValueStore());
    await store.add(entry('github:test/repo'));
    const refreshed = { ...entry('github:test/repo'), overallScore: 88.5, savedAt: '2026-11-13T13:00:00Z' };
    expect(await store.add(refreshed)).toEqual({ ok: true, added: false });
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.overallScore).toBe(88.5);
    expect(loaded[0]?.savedAt).toBe('2026-11-13T13:00:00Z');
  });

  it('removes a repo and reports whether anything was removed', async () => {
    const store = new SavedReposStore(new InMemoryKeyValueStore());
    await store.add(entry('github:test/repo'));
    await store.add(entry('github:other/repo', 'other', 'repo'));
    expect(await store.remove('github:test/repo')).toBe(true);
    expect(await store.remove('github:test/repo')).toBe(false);
    expect(await store.load()).toHaveLength(1);
    expect(await store.isSaved('github:test/repo')).toBe(false);
  });

  it('refuses a new entry at the 50 cap, but still refreshes an existing one', async () => {
    const store = new SavedReposStore(new InMemoryKeyValueStore());
    expect(MAX_SAVED_REPOS).toBe(50);
    for (let i = 0; i < MAX_SAVED_REPOS; i++) {
      const result = await store.add(entry(`github:owner${i}/repo${i}`, `owner${i}`, `repo${i}`));
      expect(result).toEqual({ ok: true, added: true });
    }
    expect((await store.load()).length).toBe(50);
    expect(await store.add(entry('github:owner50/repo50', 'owner50', 'repo50'))).toEqual({
      ok: false,
      reason: 'cap',
    });
    expect((await store.load()).length).toBe(50);
    // Refreshing an entry already in the list is still allowed.
    expect(await store.add(entry('github:owner0/repo0', 'owner0', 'repo0'))).toEqual({
      ok: true,
      added: false,
    });
  });

  it('ignores malformed stored entries instead of crashing', async () => {
    const kv = new InMemoryKeyValueStore();
    await kv.set({ 'reporadar:savedRepos': [{ repoId: 'github:ok/repo', owner: 'ok', repo: 'repo', overallScore: 50, grade: 'C', coverage: 90, confidence: 'medium', fetchedAt: '2026-11-13T12:00:00Z', savedAt: '2026-11-13T12:00:00Z' }, { notARepo: true }, 'junk', null] });
    const store = new SavedReposStore(kv);
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.repoId).toBe('github:ok/repo');
  });
});
