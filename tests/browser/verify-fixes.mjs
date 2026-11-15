import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile-fixes';
fs.rmSync(profile, { recursive: true, force: true });

// Fixes 0.2.1 verification:
//  (a) popup "Open analysis" opens the panel directly (gesture in
//      the popup), no lastPanelError recorded.
//  (b) content-script pill opens the panel directly, same assertion.
//  (c) offline NETWORK_ERROR card shows the technical detail +
//      Test connection, which reports api.github.com unreachable.
//  (d) headers show the logo image, no "RR" monogram.
//  (e) popup footer line is gone.
//  (f) gauge + activity chart + language donut render as SVG.
// Same constraint as Builds 2–6: Playwright interception does not
// reach the service worker's fetch and local Chromium has no
// external internet, so live fetches fail offline by design.
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
async function waitForText(p, needle, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await p.evaluate(() => document.body.innerText);
    if (t.includes(needle)) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return await p.evaluate(() => document.body.innerText);
}
/** All known targets (tabs + side panel) via CDP. */
async function sidePanelTargetPresent(cdpPage) {
  const session = await cdpPage.context().newCDPSession(cdpPage);
  const { targetInfos } = await session.send('Target.getTargets');
  await session.detach();
  return targetInfos.some((t) => t.url.includes('sidepanel.html'));
}
async function lastPanelError(sw) {
  const stored = await sw.evaluate(() => chrome.storage.local.get('reporadar:lastPanelError'));
  return stored['reporadar:lastPanelError'] ?? null;
}

let sw = null;
for (let i = 0; i < 30; i++) { sw = context.serviceWorkers().find((w) => w.url().includes('background.js')); if (sw) break; await new Promise((r) => setTimeout(r, 500)); }
const extId = new URL(sw.url()).hostname;

// Seed a full cache for big/huge-repo (gauge/charts check).
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const facts = {
    id: 'github:big/huge-repo', platform: 'github', owner: 'big', name: 'huge-repo', fullName: 'big/huge-repo',
    htmlUrl: 'https://github.com/big/huge-repo', description: 'The library for web and native user interfaces.',
    stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 20, primaryLanguage: 'JavaScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: fetchedAt, pushedAt: fetchedAt, archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt,
  };
  const languages = { entries: [{ name: 'JavaScript', bytes: 5629897, percent: 50 }, { name: 'Rust', bytes: 3025843, percent: 26.9 }, { name: 'TypeScript', bytes: 2609522, percent: 23.2 }], totalBytes: 11265262, fetchedAt };
  const commits = [];
  for (let i = 0; i < 50; i++) commits.push({ sha: `sha${i}`, authorLogin: `dev${i % 12}`, committedAt: isoDaysAgo((i % 30) + 0.5) });
  const issues = [];
  for (let i = 0; i < 20; i++) issues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(20), closedAt: null, isPullRequest: false });
  for (let i = 0; i < 80; i++) issues.push({ number: 21 + i, state: 'closed', createdAt: isoDaysAgo(30), closedAt: isoDaysAgo(5), isPullRequest: false });
  const pulls = [];
  for (let i = 0; i < 15; i++) pulls.push({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) });
  for (let i = 0; i < 5; i++) pulls.push({ number: 16 + i, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) });
  const contributors = [{ login: 'lead', contributions: 120 }];
  for (let i = 1; i < 100; i++) contributors.push({ login: `dev${i}`, contributions: 8 });
  const activity = {
    contributors, commits,
    releases: [30, 60, 90, 150, 210, 300].map((d, i) => ({ tagName: `v1.${i}.0`, publishedAt: isoDaysAgo(d) })),
    issues, pulls,
    communityProfile: { readme: true, license: true, contributing: true, codeOfConduct: true, issueTemplate: true, pullRequestTemplate: true, healthPercentage: 100 },
    ciWorkflowsPresent: true,
    truncated: { contributors: true, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };
  return chrome.storage.local.set({
    'reporadar:cache:v1:github:big/huge-repo:repo': { value: facts, fetchedAt, etag: null },
    'reporadar:cache:v1:github:big/huge-repo:languages': { value: languages, fetchedAt, etag: null },
    'reporadar:cache:v1:github:big/huge-repo:activity': { value: activity, fetchedAt, etag: null },
  });
}, now);

// --- (a) Popup "Open analysis" opens the panel directly. ---
await page.goto('https://github.com/big/huge-repo', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForSelector('text=Open analysis');
await popup.click('text=Open analysis');
await new Promise((r) => setTimeout(r, 2500));
let panelOpen = await sidePanelTargetPresent(page);
check('popup Open analysis opens the side panel', panelOpen);
check('popup Open analysis records no panel error', (await lastPanelError(sw)) === null);

// --- (b) Content-script pill opens the panel directly. ---
// Close any side panel first by navigating the main page away and back.
await page.goto('https://github.com/big/huge-repo', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#reporadar-entrypoint', { timeout: 10000 });
await page.click('#reporadar-entrypoint');
await new Promise((r) => setTimeout(r, 2500));
panelOpen = await sidePanelTargetPresent(page);
check('pill click opens the side panel', panelOpen);
check('pill click records no panel error', (await lastPanelError(sw)) === null);

// --- (d) Headers show the logo image, no "RR" monogram. ---
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await waitForText(panel, '94.3');
const panelHeader = await panel.evaluate(() => {
  const img = document.querySelector('header img.mark-img');
  return { hasImg: !!img, imgSrc: img?.getAttribute('src') ?? '', headerText: document.querySelector('header')?.innerText ?? '' };
});
check('side-panel header shows the logo image', panelHeader.hasImg && panelHeader.imgSrc.includes('icon/128.png'));
check('side-panel header has no RR monogram', !panelHeader.headerText.includes('RR'));
const popupHeader = await popup.evaluate(() => {
  const img = document.querySelector('header img.mark-img');
  return { hasImg: !!img, headerText: document.querySelector('header')?.innerText ?? '' };
}).catch(() => ({ hasImg: false, headerText: '' }));
// The popup tab closed itself on Open analysis; reopen it fresh.
const popup2 = await context.newPage();
await popup2.goto(`chrome-extension://${extId}/popup.html`);
await popup2.waitForSelector('header', { timeout: 10000 });
const popupHeader2 = await popup2.evaluate(() => {
  const img = document.querySelector('header img.mark-img');
  return { hasImg: !!img, headerText: document.querySelector('header')?.innerText ?? '', bodyText: document.body.innerText };
});
check('popup header shows the logo image', popupHeader2.hasImg);
check('popup header has no RR monogram', !popupHeader2.headerText.includes('RR'));
// --- (e) Popup footer line is gone. ---
check('popup has no Build/footer line', !popupHeader2.bodyText.includes('Build 6') && !popupHeader2.bodyText.includes('no account'));

// --- (f) Gauge + activity chart + language donut render as SVG. ---
const svgCount = await panel.evaluate(() => document.querySelectorAll('svg').length);
check('gauge, activity chart and donut render as SVG (3+)', svgCount >= 3);
const panelText = await panel.evaluate(() => document.body.innerText);
check('seeded report still scores 94.3', panelText.includes('94.3'));

// --- (c) Offline NETWORK_ERROR card: detail + Test connection. ---
// NOTE (0.3.0): wait for 'Technical detail:', not 'Could not reach
// GitHub' — the seeded huge-repo report now contains that phrase
// itself (the supply-chain section reports "Supply-chain risk could
// not be checked: Could not reach GitHub…"), so the old needle
// matched the stale report and the checks below read the wrong card.
await page.goto('https://github.com/unknown/nope', { waitUntil: 'domcontentloaded' });
let text = await waitForText(panel, 'Technical detail:', 30000);
check('offline unknown repo shows the network error card', text.includes('Could not reach GitHub'));
check('error card shows a technical detail line', text.includes('Technical detail:'));
check('error card names the raw fetch failure', /Failed to fetch/.test(text));
check('error card offers Test connection', text.includes('Test connection'));
await panel.click('text=Test connection');
text = await waitForText(panel, 'api.github.com:', 30000);
check('Test connection reports api.github.com unreachable offline', text.includes('api.github.com: unreachable'));
check('Test connection distinguishes the hosts', text.includes('github.com: unreachable') || text.includes('github.com: reachable'));

check('no page/console errors during fixes run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'FIXES BROWSER VERIFICATION FAILED' : 'FIXES BROWSER VERIFICATION PASSED');
