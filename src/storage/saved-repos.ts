// Saved repositories — spec §7 FR-11 (Build 5).
// A saved repo is a snapshot of the headline numbers at save time
// (score, grade, coverage, confidence), not a live link: re-opening
// one re-analyzes it from the cache / API, so the numbers shown in
// the list are always labelled with the date they were saved. The
// list is capped at 50 entries; the cap is a hard refusal, not a
// silent eviction — the UI tells the user to remove one first.
// Storage is behind a KeyValueStore interface so unit tests use an
// in-memory store and the panel passes chrome.storage.local.

import type { Confidence, Grade } from '../domain/report';

export const SAVED_REPOS_STORAGE_KEY = 'reporadar:savedRepos';

/** Maximum saved repositories. */
export const MAX_SAVED_REPOS = 50;

export interface SavedRepoEntry {
  /** "github:owner/repo" — the repoRefId form, unique per repo. */
  repoId: string;
  owner: string;
  repo: string;
  overallScore: number | null;
  grade: Grade | null;
  coverage: number;
  confidence: Confidence;
  /** When the underlying facts were fetched (ISO). */
  fetchedAt: string;
  /** When the user saved it (ISO). */
  savedAt: string;
}

export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type AddSavedResult =
  | { ok: true; added: boolean }
  | { ok: false; reason: 'cap' };

function isSavedRepoEntry(value: unknown): value is SavedRepoEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.repoId === 'string' &&
    typeof v.owner === 'string' &&
    typeof v.repo === 'string' &&
    (v.overallScore === null || typeof v.overallScore === 'number') &&
    (v.grade === null || typeof v.grade === 'string') &&
    typeof v.coverage === 'number' &&
    typeof v.confidence === 'string' &&
    typeof v.fetchedAt === 'string' &&
    typeof v.savedAt === 'string'
  );
}

export class SavedReposStore {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async load(): Promise<SavedRepoEntry[]> {
    const result = await this.store.get(SAVED_REPOS_STORAGE_KEY);
    const raw = result[SAVED_REPOS_STORAGE_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(isSavedRepoEntry);
  }

  async save(entries: SavedRepoEntry[]): Promise<void> {
    await this.store.set({ [SAVED_REPOS_STORAGE_KEY]: entries });
  }

  async isSaved(repoId: string): Promise<boolean> {
    const entries = await this.load();
    return entries.some((e) => e.repoId === repoId);
  }

  /** Add a repo, or refresh the saved snapshot if it is already
   *  there (dedup by repoId — saving twice never duplicates).
   *  Returns { ok: false, reason: 'cap' } when a *new* entry would
   *  exceed MAX_SAVED_REPOS; refreshing an existing entry is
   *  always allowed. */
  async add(entry: SavedRepoEntry): Promise<AddSavedResult> {
    const entries = await this.load();
    const index = entries.findIndex((e) => e.repoId === entry.repoId);
    if (index >= 0) {
      entries[index] = entry;
      await this.save(entries);
      return { ok: true, added: false };
    }
    if (entries.length >= MAX_SAVED_REPOS) {
      return { ok: false, reason: 'cap' };
    }
    entries.push(entry);
    await this.save(entries);
    return { ok: true, added: true };
  }

  /** Remove a repo. Returns true when an entry was removed. */
  async remove(repoId: string): Promise<boolean> {
    const entries = await this.load();
    const next = entries.filter((e) => e.repoId !== repoId);
    if (next.length === entries.length) return false;
    await this.save(next);
    return true;
  }

  async clear(): Promise<void> {
    await this.save([]);
  }
}

/** In-memory KeyValueStore for unit tests. */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();

  async get(key: string): Promise<Record<string, unknown>> {
    const value = this.data.get(key);
    return value === undefined ? {} : { [key]: value };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, value);
    }
  }
}
