// RepoRadar service worker — Build 2 (FR-02, FR-03, FR-04, FR-14).
// Routes messages only; holds no long-lived global state (spec §9.3)
// beyond the service instance, whose state lives in chrome.storage.
//   OPEN_PANEL: open the side panel for the requesting tab, or fall
//     back to opening the panel page as a full tab (§4.3).
//   ANALYZE_REPOSITORY: run the repository service (cache -> GitHub
//     API) and reply with ANALYSIS_COMPLETE / ANALYSIS_ERROR.
//     The reply uses sendResponse, so the listener returns true to
//     keep the channel open for the async service call.

import { testConnection } from '../src/diagnostics/connection';
import { ProviderError, type RepoRef } from '../src/domain/repository';
import { getProviderForHost } from '../src/providers/registry';
import { RepositoryService } from '../src/services/repository-service';
import { ChromeStorageCache } from '../src/storage/cache';

async function openPanel(tabId?: number): Promise<void> {
  const sidePanel = (
    browser as unknown as {
      sidePanel?: { open: (opts: { tabId?: number }) => Promise<void> };
    }
  ).sidePanel;

  let targetTabId = tabId;
  if (targetTabId === undefined) {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    targetTabId = active?.id;
  }

  if (sidePanel) {
    await sidePanel.open({ tabId: targetTabId });
    return;
  }

  // Fallback where the Side Panel API is unavailable.
  await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
}

function recordPanelError(error: unknown): void {
  void browser.storage.local
    .set({
      'reporadar:lastPanelError': {
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      },
    })
    .catch(() => undefined);
}

export default defineBackground(() => {
  const service = new RepositoryService(new ChromeStorageCache());

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const type = (message as { type?: string }).type;

    if (type === 'OPEN_PANEL') {
      // sidePanel.open requires a user gesture — the click that sent
      // this message is that gesture.
      void openPanel(sender.tab?.id).catch(recordPanelError);
      return false;
    }

    if (type === 'TEST_CONNECTION') {
      // Connection diagnostics (fixes 0.2.1): probe both hosts the
      // extension depends on and report the raw outcome per host.
      // Runs here, in the worker, because it owns the network.
      // fetch is bound to the global scope for the same reason as
      // in GitHubApiClient: an unbound call throws "Illegal
      // invocation" in a service worker.
      void testConnection(fetch.bind(globalThis)).then((results) => {
        sendResponse({ type: 'TEST_CONNECTION_RESULT', results });
      });
      return true;
    }

    if (type === 'ANALYZE_REPOSITORY') {
      const { owner, repo, forceRefresh } = message as {
        owner: string;
        repo: string;
        forceRefresh?: boolean;
      };
      void (async () => {
        try {
          // Host is github.com in Build 2 (the only registered
          // provider); the registry is the single place that knows.
          const provider = getProviderForHost('github.com');
          const ref: RepoRef = { platform: provider.platform, host: 'github.com', owner, repo };
          const { overview, report, activity, trajectory, supplyChain, verdict } =
            await service.getReport(ref, {
              forceRefresh: Boolean(forceRefresh),
            });
          sendResponse({ type: 'ANALYSIS_COMPLETE', overview, report, activity, trajectory, supplyChain, verdict });
        } catch (error) {
          if (error instanceof ProviderError) {
            sendResponse({
              type: 'ANALYSIS_ERROR',
              repoId: `github:${owner}/${repo}`,
              code: error.code,
              message: error.message,
              detail: error.detail,
            });
            return;
          }
          sendResponse({
            type: 'ANALYSIS_ERROR',
            repoId: `github:${owner}/${repo}`,
            code: 'UNKNOWN',
            message: error instanceof Error ? error.message : 'Repository could not be loaded.',
            detail: error instanceof Error ? `${error.name}: ${error.message}` : null,
          });
        }
      })();
      return true;
    }

    if (type === 'RETRY_SUPPLY_CHAIN') {
      // 0.3.0 — retry just the supply-chain section (fresh OSV /
      // deps.dev lookups, cache bypassed). Never throws: the
      // service returns an 'unknown' result on failure.
      const { owner, repo, branch } = message as { owner: string; repo: string; branch: string };
      void (async () => {
        const provider = getProviderForHost('github.com');
        const ref: RepoRef = { platform: provider.platform, host: 'github.com', owner, repo };
        const supplyChain = await service.getSupplyChain(ref, { forceRefresh: true }, branch, Date.now());
        sendResponse({ type: 'SUPPLY_CHAIN_RESULT', supplyChain });
      })();
      return true;
    }

    // REPOSITORY_CONTEXT is stored by the content script itself;
    // the background only needs to receive it without erroring.
    return false;
  });
});
