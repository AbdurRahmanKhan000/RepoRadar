// GitHub repository detection — Build 1 (FR-01, FR-02).
// Runs only on github.com (manifest host permission, spec §12.1).
// - Detects owner/repo from the URL (src/shared/repo-url.ts).
// - Handles GitHub SPA navigation: GitHub uses Turbo/pushState, so a
//   full page load is not guaranteed when moving between repositories.
//   We patch pushState/replaceState, listen for popstate, and watch
//   the document title as a fallback, re-syncing on every change.
// - Injects ONE restrained, fixed-position "Analyze with RepoRadar"
//   button. It is fixed, so it never disrupts GitHub's native layout
//   (spec §8.1). It is removed the moment the page stops being a
//   repository page.
// - Sends REPOSITORY_CONTEXT on every context change and stores the
//   last context in chrome.storage.local so the popup and side panel
//   can read it without a `tabs` permission.

import { parseRepoFromUrl, repoId } from '../src/shared/repo-url';
import {
  LAST_REPO_STORAGE_KEY,
  repositoryContextMessage,
  type LastRepoRecord,
} from '../src/messaging/messages';
import type { RepoContext } from '../src/shared/repo-url';

const ENTRYPOINT_ID = 'reporadar-entrypoint';
const STYLE_ID = 'reporadar-entrypoint-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ENTRYPOINT_ID} {
      position: fixed; right: 16px; bottom: 16px; z-index: 9999;
      padding: 8px 14px; border-radius: 999px; border: 1px solid #30363d;
      background: #1f6feb; color: #fff; font: 600 13px/1.4 system-ui, sans-serif;
      cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.35);
    }
    #${ENTRYPOINT_ID}:hover { background: #388bfd; }
    #${ENTRYPOINT_ID}:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}

function removeEntrypoint(): void {
  document.getElementById(ENTRYPOINT_ID)?.remove();
}

function injectEntrypoint(context: RepoContext): void {
  ensureStyle();
  if (document.getElementById(ENTRYPOINT_ID)) return;
  const button = document.createElement('button');
  button.id = ENTRYPOINT_ID;
  button.type = 'button';
  button.textContent = 'Analyze with RepoRadar';
  button.setAttribute('aria-label', `Analyze ${repoId(context)} with RepoRadar`);
  button.addEventListener('click', () => {
    // Fixes 0.2.1 — same gesture rule as the popup: sidePanel.open()
    // must be called where the click happened. A message hop to the
    // background loses the user activation and open() throws there.
    // Try directly first (guarded: the API may be undefined in a
    // content script), fall back to the background message route.
    const openDirectly = async () => {
      const sidePanel = (
        browser as unknown as {
          sidePanel?: { open: (opts?: Record<string, unknown>) => Promise<void> };
        }
      ).sidePanel;
      if (!sidePanel) throw new Error('Side Panel API unavailable in this context');
      await sidePanel.open();
    };
    void openDirectly().catch(() => {
      void browser.runtime
        .sendMessage({ type: 'OPEN_PANEL', owner: context.owner, repo: context.repo })
        .catch(() => undefined);
    });
  });
  document.body.appendChild(button);
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    let currentKey = '';

    const sync = (): void => {
      const context = parseRepoFromUrl(window.location.href);
      const key = context ? repoId(context) : '';
      if (key === currentKey && context !== null) return;
      currentKey = key;

      if (!context) {
        removeEntrypoint();
        return;
      }

      const record: LastRepoRecord = {
        owner: context.owner,
        repo: context.repo,
        url: window.location.href,
        detectedAt: new Date().toISOString(),
      };
      void browser.storage.local.set({ [LAST_REPO_STORAGE_KEY]: record }).catch(() => undefined);
      void browser.runtime
        .sendMessage(repositoryContextMessage(context, window.location.href))
        .catch(() => undefined);
      injectEntrypoint(context);
    };

    // GitHub SPA navigation: patch history methods, then sync.
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      const result = origPushState(...args);
      sync();
      return result;
    };
    history.replaceState = (...args) => {
      const result = origReplaceState(...args);
      sync();
      return result;
    };
    window.addEventListener('popstate', sync);

    // Fallback: GitHub also swaps the <title> on Turbo navigation.
    // Note: patching history.pushState here only affects the content
    // script's isolated world, not the page's own Turbo code — so it
    // cannot be the only SPA signal. The interval below is the
    // reliable one: it catches any URL change, however it happened.
    let lastHref = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        sync();
      }
    });
    const title = document.querySelector('title');
    if (title) observer.observe(title, { childList: true });
    window.setInterval(() => {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        sync();
      }
    }, 500);

    sync();
  },
});
