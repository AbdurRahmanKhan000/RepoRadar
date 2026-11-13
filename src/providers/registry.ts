// Provider registry — one place that knows which platforms exist.
// GitHub is registered in Build 2. GitLab (and Bitbucket / Codeberg /
// Gitea) register here later by implementing RepoProvider; nothing in
// the UI, service or scoring engine needs to change to add one —
// except its host permission and content-script match (spec §12.1).

import { ProviderError, type RepoRef } from '../domain/repository';
import { GitHubProvider } from './github/provider';
import type { RepoProvider } from './types';

const providers: RepoProvider[] = [new GitHubProvider()];

export function listProviders(): RepoProvider[] {
  return [...providers];
}

export function getProviderForHost(hostname: string): RepoProvider {
  const host = hostname.toLowerCase();
  const provider = providers.find((p) => (p.hosts as readonly string[]).includes(host));
  if (!provider) {
    // GitLab is the next platform (owner requirement, 2026-11-13).
    // Fail loudly and specifically — never silently fall back to
    // GitHub for a different host's repository.
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) {
      throw new ProviderError(
        'UNSUPPORTED_PLATFORM',
        'GitLab support is planned — the provider interface is ready, but the GitLab implementation is not built yet. GitHub repositories work today.',
      );
    }
    throw new ProviderError(
      'UNSUPPORTED_PLATFORM',
      `RepoRadar does not analyse repositories on ${host}. Supported today: GitHub. Planned: GitLab and other Git-hosting platforms.`,
    );
  }
  return provider;
}

export function getProviderForRef(ref: RepoRef): RepoProvider {
  return getProviderForHost(ref.host);
}
