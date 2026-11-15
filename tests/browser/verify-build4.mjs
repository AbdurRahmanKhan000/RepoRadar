import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile4';
fs.rmSync(profile, { recursive: true, force: true });

// NOTE (same as Builds 2–3): Playwright route interception does NOT
// reach an extension service worker's fetch, and local Chromium has
// no external internet. The live client was validated against the
// real api.github.com in Build 2, and scoring is covered by 82 unit
// tests. This script verifies the Build 4 UI end to end on the
// cache path: overview + activity seeded in chrome.storage.local,
// the redesigned panel renders, the drawer opens, the theme toggle
// persists, and the offline error state is still graceful.
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
async function waitForText(p, needle, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await p.evaluate(() => document.body.innerText);
    if (t.includes(needle)) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return await p.evaluate(() => document.body.innerText);
}
async function waitForSelector(p, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await p.evaluate((sel) => !!document.querySelector(sel), selector)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let sw = null;
for (let i = 0; i < 30; i++) { sw = context.serviceWorkers().find((w) => w.url().includes('background.js')); if (sw) break; await new Promise((r) => setTimeout(r, 500)); }
const extId = new URL(sw.url()).hostname;

// Seed FRESH repo + languages + activity caches for react/react
// (same fixture as Build 3: expected overall 94.3, grade A).
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const facts = {
    id: 'github:react/react', platform: 'github', owner: 'react', name: 'react', fullName: 'react/react',
    htmlUrl: 'https://github.com/react/react', description: 'The library for web and native user interfaces.',
    stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 20, primaryLanguage: 'JavaScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: fetchedAt, pushedAt: fetchedAt, archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt,
  };
  const languages = { entries: [{ name: 'JavaScript', bytes: 5629897, percent: 50 }, { name: 'Rust', bytes: 3025843, percent: 26.9 }, { name: 'TypeScript', bytes: 2609522, percent: 23.2 }], totalBytes: 11265262, fetchedAt };
  const contributors = [{ login: 'lead', contributions: 240 }];
  for (let i = 1; i < 200; i++) contributors.push({ login: `dev${i}`, contributions: i === 1 ? 176 : 8 });
  const commits = [];
  for (let i = 0; i < 50; i++) {
    commits.push({ sha: `sha${i}`, authorLogin: `dev${i % 12}`, committedAt: isoDaysAgo((i % 30) + 0.5) });
  }
  const issues = [];
  for (let i = 0; i < 20; i++) issues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(20), closedAt: null, isPullRequest: false });
  for (let i = 0; i < 80; i++) issues.push({ number: 21 + i, state: 'closed', createdAt: isoDaysAgo(30), closedAt: isoDaysAgo(5), isPullRequest: false });
  const pulls = [];
  for (let i = 0; i < 15; i++) pulls.push({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) });
  for (let i = 0; i < 5; i++) pulls.push({ number: 16 + i, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) });
  const activity = {
    contributors,
    commits,
    releases: [30, 60, 90, 150, 210, 300].map((d, i) => ({ tagName: `v1.${i}.0`, publishedAt: isoDaysAgo(d) })),
    issues,
    pulls,
    communityProfile: { readme: true, license: true, contributing: true, codeOfConduct: true, issueTemplate: true, pullRequestTemplate: true, healthPercentage: 100 },
    ciWorkflowsPresent: true,
    truncated: { contributors: false, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };
  return chrome.storage.local.set({
    'reporadar:cache:v1:github:react/react:repo': { value: facts, fetchedAt, etag: null },
    'reporadar:cache:v1:github:react/react:languages': { value: languages, fetchedAt, etag: null },
    'reporadar:cache:v1:github:react/react:activity': { value: activity, fetchedAt, etag: null },
  });
}, now);

await page.goto('https://github.com/react/react', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel = await context.newPage();

// Loading skeleton: poll tightly right after navigation — the panel
// mounts in its loading state before the cached analysis resolves.
const panelNav = panel.goto(`chrome-extension://${extId}/sidepanel.html`);
let skeletonSeen = false;
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 50));
  try {
    if (await panel.evaluate(() => !!document.querySelector('.skeleton'))) { skeletonSeen = true; break; }
  } catch { /* page still navigating */ }
  if (await panel.evaluate(() => document.body.innerText.includes('94.3')).catch(() => false)) break;
}
await panelNav;
check('loading skeleton appears briefly on a fresh panel load', skeletonSeen);

let text = await waitForText(panel, '94.3');
check('gauge renders (SVG) with score text 94.3', text.includes('94.3') && (await waitForSelector(panel, '.score-gauge svg')));
check('gauge shows grade A Excellent', text.includes('A · Excellent'));
check('score meta shows coverage 100% and high confidence', text.includes('Coverage 100%') && text.includes('High confidence'));

const catRowCount = await panel.evaluate(() => document.querySelectorAll('.cat-row').length);
check('all six category rows render', catRowCount === 6);

// Evidence drawer: open the Maintenance row.
await panel.click('.cat-row >> nth=0');
text = await waitForText(panel, 'GET /repos/{owner}/{repo}');
check('category row opens evidence drawer with source endpoint', text.includes('GET /repos/{owner}/{repo}'));
check('drawer shows a signal formula', text.includes('Formula') && text.includes('exp'));
const drawerFocus = await panel.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
check('drawer moves focus to its close button', drawerFocus.includes('Close evidence'));
// Escape closes the drawer and focus returns to the triggering row.
await panel.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 500));
const drawerGone = await panel.evaluate(() => !document.querySelector('.drawer'));
const focusBack = await panel.evaluate(() => document.activeElement?.classList.contains('cat-row') ?? false);
check('Escape closes the drawer and focus returns to the category row', drawerGone && focusBack);

// Charts render as SVG.
check('activity chart renders as SVG', await waitForSelector(panel, '.activity-chart svg'));
check('language donut renders as SVG', await waitForSelector(panel, '.language-donut svg'));
text = await panel.evaluate(() => document.body.innerText);
check('donut legend lists languages with percentages', text.includes('JavaScript — 50%') && text.includes('Rust — 26.9%'));

// Theme toggle: flip the theme, then reload — it must persist.
const themeBefore = await panel.evaluate(() => document.documentElement.getAttribute('data-theme'));
await panel.click('button.theme-toggle');
await new Promise((r) => setTimeout(r, 300));
const themeAfter = await panel.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('theme toggle switches the applied theme', themeBefore !== themeAfter && (themeAfter === 'light' || themeAfter === 'dark'));
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
text = await waitForText(panel, '94.3');
const themeReloaded = await panel.evaluate(() => document.documentElement.getAttribute('data-theme'));
const storedTheme = await sw.evaluate(() => chrome.storage.local.get('reporadar:theme').then((r) => r['reporadar:theme']));
check('theme choice persists across a panel reload', themeReloaded === themeAfter && storedTheme === themeAfter);

// Popup: restyled, same theme, score summary from cached data.
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
text = await waitForText(popup, 'Health score:');
check('popup shows the cached score summary', text.includes('Health score:') && text.includes('94.3'));
check('popup shows Open analysis', text.includes('Open analysis'));

// Unknown repo, no cache, Chromium offline -> graceful network-error state.
// NOTE (0.3.0): wait for 'Technical detail:', not 'Could not reach
// GitHub' — the seeded report now contains that phrase itself (the
// supply-chain section reports "Supply-chain risk could not be
// checked: Could not reach GitHub…"), so the old needle matched the
// stale report and the check read the wrong card.
await page.goto('https://github.com/unknown/nope', { waitUntil: 'domcontentloaded' });
text = await waitForText(panel, 'Technical detail:', 15000);
check('offline unknown repo shows graceful error state', text.includes('Could not reach GitHub') && text.includes('Try again'));

check('no page/console errors during UI run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'BUILD 4 BROWSER VERIFICATION FAILED' : 'BUILD 4 BROWSER VERIFICATION PASSED');
