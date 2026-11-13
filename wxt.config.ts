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
    version: '0.2.1',
    // 'downloads' (Build 5): report/comparison exports. No other
    // new permission — the extension still only touches GitHub.
    permissions: ['storage', 'sidePanel', 'downloads'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
    action: {
      default_title: 'RepoRadar',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
