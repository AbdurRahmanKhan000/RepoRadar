import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile2';
fs.rmSync(profile, { recursive: true, force: true });

// NOTE: Playwright route interception does NOT reach an extension
// service worker's fetch, so live api.github.com calls cannot be
// intercepted here — and local Chromium has no external internet.
// The live client is therefore validated separately against the real
// api.github.com (Node/Vitest live check: react/react, languages,
// 404 — all passed). This browser script verifies the panel end to
// end on the cache path, plus the graceful offline error state.
const context = await chromium.launchPersistentContext(profile, {
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, '--no-sandbox', '--disable-gpu'],
});
await context.route('https://github.com/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head><title>GitHub</title></head><body><h1>Fake GitHub page</h1></body></html>' });
});

const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

function check(name, cond) {
  console.log((cond ? 'OK: ' : 'FAIL: ') + name);
  if (!cond) process.exitCode = 1;
}
async function waitForText(p, needle, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await p.evaluate(() => document.body.innerText);
    if (t.includes(needle)) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return await p.evaluate(() => document.body.innerText);
}

let sw = null;
for (let i = 0; i < 30; i++) { sw = context.serviceWorkers().find((w) => w.url().includes('background.js')); if (sw) break; await new Promise((r) => setTimeout(r, 500)); }
const extId = new URL(sw.url()).hostname;

// Seed a FRESH cache for react/react via the service worker's storage.
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const facts = {
    id: 'github:react/react', platform: 'github', owner: 'react', name: 'react', fullName: 'react/react',
    htmlUrl: 'https://github.com/react/react', description: 'The library for web and native user interfaces.',
    stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 1526, primaryLanguage: 'JavaScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: '2026-11-13T13:36:54Z', pushedAt: '2026-11-13T10:28:38Z', archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt,
  };
  const languages = { entries: [{ name: 'JavaScript', bytes: 5629897, percent: 50 }, { name: 'Rust', bytes: 3025843, percent: 26.9 }, { name: 'TypeScript', bytes: 2609522, percent: 23.2 }], totalBytes: 11265262, fetchedAt };
  return chrome.storage.local.set({
    'reporadar:cache:v1:github:react/react:repo': { value: facts, fetchedAt, etag: null },
    'reporadar:cache:v1:github:react/react:languages': { value: languages, fetchedAt, etag: null },
  });
}, now);

await page.goto('https://github.com/react/react', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
let text = await waitForText(panel, '252.6k');
check('cached overview shows stars 252.6k', text.includes('252.6k'));
check('cached overview shows MIT + JavaScript', text.includes('MIT') && text.includes('JavaScript'));
check('cached overview shows language breakdown', text.includes('Languages') && text.includes('Rust'));
check('cached overview shows Cached banner', text.includes('Cached'));
check('cached overview shows evidence source', text.includes('GET /repos/{owner}/{repo}'));
check('cached overview notes open-issues counts PRs', text.includes('pull requests'));

// Unknown repo, no cache, Chromium offline -> graceful network-error state.
// NOTE (0.3.0): wait for 'Technical detail:', not 'Could not reach
// GitHub' — the seeded report now contains that phrase itself (the
// supply-chain section reports "Supply-chain risk could not be
// checked: Could not reach GitHub…"), so the old needle matched the
// stale report and the check read the wrong card.
await page.goto('https://github.com/unknown/nope', { waitUntil: 'domcontentloaded' });
text = await waitForText(panel, 'Technical detail:', 15000);
check('offline unknown repo shows graceful error state', text.includes('Could not reach GitHub') && text.includes('Try again'));

check('no page/console errors during data-layer run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'BUILD 2 BROWSER VERIFICATION FAILED' : 'BUILD 2 BROWSER VERIFICATION PASSED');
