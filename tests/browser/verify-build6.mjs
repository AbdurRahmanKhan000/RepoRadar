import { chromium } from 'playwright-core';
import fs from 'node:fs';

const extPath = '/home/hatch/workspace/RepoRadar/.output/chrome-mv3';
const profile = '/tmp/rr-profile6';
fs.rmSync(profile, { recursive: true, force: true });

// Build 6 hardening checks. Same constraint as Builds 2–5: Playwright
// route interception does not reach the extension service worker's
// fetch, and local Chromium has no external internet, so the panel
// is verified on the cache path. The live rate-limit path is covered
// by unit tests (client 403/429 mapping, service propagation,
// resetInLabel) — see tests/unit/hardening.test.ts — plus the owner's
// live-Chrome test before release. Two honest gaps found by this
// build are NOT fixed here (App.tsx is frozen while Build 5 lands):
//   (1) Refresh is not disabled when the rate limit is exhausted —
//       the panel does show the reset countdown when rateLimit is
//       present, but the button stays enabled.
//   (2) On a RATE_LIMITED error the "Try again" button force-refreshes,
//       which re-hits the limit; the guidance says to wait or use
//       cached data. See README Known limitations (Build 6).
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

let sw = null;
for (let i = 0; i < 30; i++) { sw = context.serviceWorkers().find((w) => w.url().includes('background.js')); if (sw) break; await new Promise((r) => setTimeout(r, 500)); }
const extId = new URL(sw.url()).hostname;

// Seed caches: (a) archived repo old/archived-lib, (b) large repo
// big/huge-repo with a truncated contributor page.
const now = new Date().toISOString();
await sw.evaluate((fetchedAt) => {
  const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
  const archivedFacts = {
    id: 'github:old/archived-lib', platform: 'github', owner: 'old', name: 'archived-lib', fullName: 'old/archived-lib',
    htmlUrl: 'https://github.com/old/archived-lib', description: 'An old archived library.',
    stars: 500, forks: 40, watchers: 500, openIssuesCount: 8, primaryLanguage: 'TypeScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: isoDaysAgo(900), pushedAt: isoDaysAgo(900), archived: true, isFork: false,
    defaultBranch: 'main', fetchedAt,
  };
  const archivedLanguages = { entries: [{ name: 'TypeScript', bytes: 100, percent: 100 }], totalBytes: 100, fetchedAt };
  const archivedIssues = [];
  for (let i = 0; i < 8; i++) archivedIssues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(400), closedAt: null, isPullRequest: false });
  for (let i = 0; i < 2; i++) archivedIssues.push({ number: 9 + i, state: 'closed', createdAt: isoDaysAgo(410), closedAt: isoDaysAgo(5), isPullRequest: false });
  const archivedActivity = {
    contributors: [{ login: 'lead', contributions: 30 }, { login: 'dev1', contributions: 8 }, { login: 'dev2', contributions: 4 }, { login: 'dev3', contributions: 4 }, { login: 'dev4', contributions: 4 }],
    commits: [],
    releases: [{ tagName: 'v1.0.0', publishedAt: isoDaysAgo(800) }],
    issues: archivedIssues,
    pulls: [],
    communityProfile: { readme: true, license: true, contributing: false, codeOfConduct: false, issueTemplate: false, pullRequestTemplate: false, healthPercentage: 30 },
    ciWorkflowsPresent: false,
    truncated: { contributors: false, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };

  const hugeFacts = {
    id: 'github:big/huge-repo', platform: 'github', owner: 'big', name: 'huge-repo', fullName: 'big/huge-repo',
    htmlUrl: 'https://github.com/big/huge-repo', description: 'The library for web and native user interfaces.',
    stars: 252573, forks: 52552, watchers: 252573, openIssuesCount: 20, primaryLanguage: 'JavaScript',
    licenseSpdxId: 'MIT', licenseName: 'MIT License', createdAt: '2013-05-24T16:15:54Z',
    updatedAt: fetchedAt, pushedAt: fetchedAt, archived: false, isFork: false,
    defaultBranch: 'main', fetchedAt,
  };
  const hugeLanguages = { entries: [{ name: 'JavaScript', bytes: 5629897, percent: 50 }, { name: 'Rust', bytes: 3025843, percent: 26.9 }, { name: 'TypeScript', bytes: 2609522, percent: 23.2 }], totalBytes: 11265262, fetchedAt };
  const hugeContributors = [{ login: 'lead', contributions: 120 }];
  for (let i = 1; i < 100; i++) hugeContributors.push({ login: `dev${i}`, contributions: i === 1 ? 88 : 8 });
  const hugeCommits = [];
  for (let i = 0; i < 50; i++) hugeCommits.push({ sha: `sha${i}`, authorLogin: `dev${i % 12}`, committedAt: isoDaysAgo((i % 30) + 0.5) });
  const hugeIssues = [];
  for (let i = 0; i < 20; i++) hugeIssues.push({ number: i + 1, state: 'open', createdAt: isoDaysAgo(20), closedAt: null, isPullRequest: false });
  for (let i = 0; i < 80; i++) hugeIssues.push({ number: 21 + i, state: 'closed', createdAt: isoDaysAgo(30), closedAt: isoDaysAgo(5), isPullRequest: false });
  const hugePulls = [];
  for (let i = 0; i < 15; i++) hugePulls.push({ number: i + 1, state: 'closed', mergedAt: isoDaysAgo(2), closedAt: isoDaysAgo(2) });
  for (let i = 0; i < 5; i++) hugePulls.push({ number: 16 + i, state: 'closed', mergedAt: null, closedAt: isoDaysAgo(3) });
  const hugeActivity = {
    contributors: hugeContributors,
    commits: hugeCommits,
    releases: [30, 60, 90, 150, 210, 300].map((d, i) => ({ tagName: `v1.${i}.0`, publishedAt: isoDaysAgo(d) })),
    issues: hugeIssues,
    pulls: hugePulls,
    communityProfile: { readme: true, license: true, contributing: true, codeOfConduct: true, issueTemplate: true, pullRequestTemplate: true, healthPercentage: 100 },
    ciWorkflowsPresent: true,
    truncated: { contributors: true, commits: false, releases: false, issues: false, pulls: false },
    errors: {},
    fetchedAt,
  };

  return chrome.storage.local.set({
    'reporadar:cache:v1:github:old/archived-lib:repo': { value: archivedFacts, fetchedAt, etag: null },
    'reporadar:cache:v1:github:old/archived-lib:languages': { value: archivedLanguages, fetchedAt, etag: null },
    'reporadar:cache:v1:github:old/archived-lib:activity': { value: archivedActivity, fetchedAt, etag: null },
    'reporadar:cache:v1:github:big/huge-repo:repo': { value: hugeFacts, fetchedAt, etag: null },
    'reporadar:cache:v1:github:big/huge-repo:languages': { value: hugeLanguages, fetchedAt, etag: null },
    'reporadar:cache:v1:github:big/huge-repo:activity': { value: hugeActivity, fetchedAt, etag: null },
  });
}, now);

// (a) Archived repo.
await page.goto('https://github.com/old/archived-lib', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
let text = await waitForText(panel, '18.1');
check('archived repo scores 18.1 (F)', text.includes('18.1') && text.includes('F'));
check('archived repo shows the Archived badge', text.includes('Archived'));
check('archived repo shows the archived observation', text.includes('Archived — no longer maintained'));
// No rate-limit line on the cache path (rateLimit is null when served from cache).
check('cached path shows no stale rate-limit countdown', !text.includes('requests remaining'));

// (b) Large repo with a truncated contributor page.
await page.goto('https://github.com/big/huge-repo', { waitUntil: 'domcontentloaded' });
text = await waitForText(panel, '94.3', 15000);
check('large repo scores 94.3', text.includes('94.3'));
check('truncated sample caps confidence at Medium', text.includes('Medium confidence'));
check('truncated sample note is shown', text.includes('Contributor sample capped at its page limit'));
check('large repo still renders all six category rows', (await panel.evaluate(() => document.querySelectorAll('.cat-row').length)) === 6);
const refreshEnabled = await panel.evaluate(() => {
  const btn = document.querySelector('button.refresh');
  return btn !== null && !btn.disabled;
});
check('Refresh is enabled in the normal (non-exhausted) state', refreshEnabled);

// (c) Offline unknown repo -> graceful error state (regression).
await page.goto('https://github.com/unknown/nope', { waitUntil: 'domcontentloaded' });
text = await waitForText(panel, 'Could not reach GitHub', 15000);
check('offline unknown repo shows graceful error state', text.includes('Could not reach GitHub') && text.includes('Try again'));

// (d) Fixes 0.2.1: the popup footer line was removed at the
// owner's request, so it must NOT appear any more.
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
text = await waitForText(popup, 'RepoRadar');
check('popup footer line is gone', !text.includes('Build 6') && !text.includes('no account'));

// (e) Build artifacts: error-boundary fallback ships in the bundle,
// and the final icons exist at their exact sizes in the output.
const jsFiles = fs.readdirSync(extPath, { recursive: true }).filter((f) => String(f).endsWith('.js'));
const bundleText = jsFiles.map((f) => fs.readFileSync(`${extPath}/${f}`, 'utf8')).join('\n');
check('error-boundary fallback ships in the built bundle', bundleText.includes('Something went wrong') && bundleText.includes('Try again'));
function pngSize(path) {
  const buf = fs.readFileSync(path);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
let iconsOk = true;
for (const size of [16, 32, 48, 96, 128]) {
  const p = `${extPath}/icon/${size}.png`;
  if (!fs.existsSync(p)) { iconsOk = false; break; }
  const { w, h } = pngSize(p);
  if (w !== size || h !== size) { iconsOk = false; break; }
}
check('final icons ship in the build at exact sizes 16/32/48/96/128', iconsOk);

check('no page/console errors during hardening run', errors.length === 0);
if (errors.length) console.log('  errors:', errors.slice(0, 5));
await context.close();
console.log(process.exitCode ? 'BUILD 6 BROWSER VERIFICATION FAILED' : 'BUILD 6 BROWSER VERIFICATION PASSED');
