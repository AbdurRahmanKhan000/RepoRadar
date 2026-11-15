import { defineConfig } from 'wxt';

// RepoRadar — Build 1.
// Stack locked 2026-11-13 (spec §11, choose-one rules):
//   WXT (not Vite + CRXJS), React, TypeScript, Manifest V3.
//   Charts (Recharts) and API validation (Zod) arrive with the
//   builds that need them (Build 3/4 and Build 2) — not silently here.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'RepoRadar',
    description:
      'Evidence-based repository intelligence for GitHub — transparent maintenance signals, with the evidence behind every score.',
    version: '0.3.0',
    // 'downloads' (Build 5): report/comparison exports. No other
    // new permission — the extension still only touches GitHub.
    permissions: ['storage', 'sidePanel', 'downloads'],
    // 0.3.0: api.osv.dev (vulnerability database, free, no auth)
    // and api.deps.dev (dependency release index, free, no auth)
    // for the supply-chain risk signals. No tokens are sent to
    // either — only package names + versions being checked.
    host_permissions: [
      'https://github.com/*',
      'https://api.github.com/*',
      'https://api.osv.dev/*',
      'https://api.deps.dev/*',
    ],
    action: {
      default_title: 'RepoRadar',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
