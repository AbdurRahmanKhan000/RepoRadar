// Extension message contracts — spec §16.2 (illustrative in the spec;
// refined here into strict TypeScript types).
// Build 1: REPOSITORY_CONTEXT, OPEN_PANEL.
// Build 2: ANALYZE_REPOSITORY (request) -> ANALYSIS_PROGRESS /
// ANALYSIS_COMPLETE (OverviewResult) / ANALYSIS_ERROR (response).
// Build 3: ANALYSIS_COMPLETE carries the scored RepositoryReport
// alongside the overview.
// Build 4: it also carries the ActivityData the report was scored
// from, so the UI can chart weekly commits without re-fetching.

import type { ActivityData } from '../domain/activity';
import type { ConnectionProbeResult } from '../diagnostics/connection';
import type { RepositoryReport } from '../domain/report';
import type { OverviewResult, ProviderErrorCode } from '../domain/repository';
import type { RepoContext } from '../shared/repo-url';

export type RepoId = `${string}/${string}`;

export type ExtensionMessage =
  | { type: 'REPOSITORY_CONTEXT'; owner: string; repo: string; url: string }
  | { type: 'OPEN_PANEL'; owner: string; repo: string }
  | { type: 'ANALYZE_REPOSITORY'; owner: string; repo: string; forceRefresh?: boolean }
  | { type: 'ANALYSIS_PROGRESS'; repoId: RepoId; stage: string }
  | { type: 'ANALYSIS_COMPLETE'; overview: OverviewResult; report: RepositoryReport; activity: ActivityData }
  | { type: 'ANALYSIS_ERROR'; repoId: RepoId; code: ProviderErrorCode; message: string; detail?: string | null }
  | { type: 'TEST_CONNECTION' }
  | { type: 'TEST_CONNECTION_RESULT'; results: ConnectionProbeResult[] };

export function repositoryContextMessage(
  context: RepoContext,
  url: string,
): Extract<ExtensionMessage, { type: 'REPOSITORY_CONTEXT' }> {
  return { type: 'REPOSITORY_CONTEXT', owner: context.owner, repo: context.repo, url };
}

/** Storage key for the last repository context seen on github.com. */
export const LAST_REPO_STORAGE_KEY = 'reporadar:lastRepo';

export interface LastRepoRecord extends RepoContext {
  url: string;
  detectedAt: string;
}
